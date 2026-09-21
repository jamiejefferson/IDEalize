// Composition coverage for the owl clips route over a real web server: every
// step's URL answers its clip's bytes as immutable WebM, byte ranges are
// honoured (a looping <video> seeks through them), and anything else under
// the prefix — a stale hash included — answers 404. The web server is the
// only service composed: the clips must serve without the wizard's others.
import { createHash } from 'node:crypto'
import { request } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import * as onboarding from '../src/index.ts'
import { OWL_CLIP_FILES, OWL_CLIP_PREFIX, owlClipUrl } from '../src/owl-clip-urls.ts'
import { OWL_CLIP_BASE64 } from '../src/owl-clips.ts'
import { ONBOARDING_STEP_IDS } from '../src/step-ids.ts'

let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
})

/** Boot the web server and the onboarding plugin alone. */
async function boot() {
  const ctx = new Context()
  context = ctx
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(onboarding, {})
  return { origin: `http://127.0.0.1:${String(ctx.webServer.port)}`, port: ctx.webServer.port }
}

/** A raw request with a chosen Host header (fetch cannot send a foreign one). */
function rawStatus(port: number, host: string, path: string): Promise<number> {
  return new Promise((resolvePromise, rejectPromise) => {
    const req = request({ host: '127.0.0.1', port, path, headers: { host } }, (res) => {
      res.resume()
      res.on('end', () => { resolvePromise(res.statusCode ?? 0) })
    })
    req.on('error', rejectPromise)
    req.end()
  })
}

const AGENTS_BYTES = Buffer.from(OWL_CLIP_BASE64.agents, 'base64')

describe('the /idealize/onboarding/owl clips route', () => {
  it('serves every step its clip as immutable WebM', async () => {
    const { origin } = await boot()
    for (const step of ONBOARDING_STEP_IDS) {
      const clip = step === 'skills-folder' ? 'documentation-folder' : step
      const expected = Buffer.from(OWL_CLIP_BASE64[clip], 'base64')
      const res = await fetch(`${origin}${owlClipUrl(step)}`)
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('video/webm')
      expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
      expect(res.headers.get('accept-ranges')).toBe('bytes')
      expect(res.headers.get('content-length')).toBe(String(expected.length))
      const body = Buffer.from(await res.arrayBuffer())
      expect(body.length).toBe(expected.length)
      expect(body.equals(expected)).toBe(true)
    }
  })

  it('names each clip by a hash of its bytes, so a changed clip changes its URL', () => {
    for (const [id, file] of Object.entries(OWL_CLIP_FILES)) {
      const bytes = Buffer.from(OWL_CLIP_BASE64[id as keyof typeof OWL_CLIP_FILES], 'base64')
      const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 12)
      expect(file).toBe(`${id}.${hash}.webm`)
    }
    expect(owlClipUrl('agents')).toBe(`${OWL_CLIP_PREFIX}/${OWL_CLIP_FILES.agents}`)
    expect(owlClipUrl('skills-folder')).toBe(owlClipUrl('documentation-folder'))
  })

  it('answers 404 for an unknown clip, a stale hash, and the bare prefix', async () => {
    const { origin } = await boot()
    expect((await fetch(`${origin}${OWL_CLIP_PREFIX}/nobody.webm`)).status).toBe(404)
    expect((await fetch(`${origin}${OWL_CLIP_PREFIX}/agents.000000000000.webm`)).status).toBe(404)
    expect((await fetch(`${origin}${OWL_CLIP_PREFIX}/agents`)).status).toBe(404)
    expect((await fetch(`${origin}${OWL_CLIP_PREFIX}`)).status).toBe(404)
  })

  it('takes GET alone and stays loopback-fenced', async () => {
    const { origin, port } = await boot()
    const post = await fetch(`${origin}${owlClipUrl('agents')}`, { method: 'POST' })
    expect(post.status).toBe(405)
    expect(post.headers.get('allow')).toBe('GET')
    expect(await rawStatus(port, 'evil.example:3180', owlClipUrl('agents'))).toBe(403)
  })

  it('honours a byte range: closed, open-ended, and suffix', async () => {
    const { origin } = await boot()
    const url = `${origin}${owlClipUrl('agents')}`
    const size = AGENTS_BYTES.length

    const closed = await fetch(url, { headers: { range: 'bytes=10-19' } })
    expect(closed.status).toBe(206)
    expect(closed.headers.get('content-range')).toBe(`bytes 10-19/${String(size)}`)
    expect(closed.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(Buffer.from(await closed.arrayBuffer()).equals(AGENTS_BYTES.subarray(10, 20))).toBe(true)

    const open = await fetch(url, { headers: { range: 'bytes=0-' } })
    expect(open.status).toBe(206)
    expect(open.headers.get('content-range')).toBe(`bytes 0-${String(size - 1)}/${String(size)}`)
    expect(Buffer.from(await open.arrayBuffer()).equals(AGENTS_BYTES)).toBe(true)

    const suffix = await fetch(url, { headers: { range: 'bytes=-8' } })
    expect(suffix.status).toBe(206)
    expect(Buffer.from(await suffix.arrayBuffer()).equals(AGENTS_BYTES.subarray(size - 8))).toBe(true)

    // An end past the clip clamps to its last byte; a suffix longer than the clip is the whole clip.
    const clamped = await fetch(url, { headers: { range: `bytes=${String(size - 4)}-${String(size + 100)}` } })
    expect(clamped.headers.get('content-range')).toBe(`bytes ${String(size - 4)}-${String(size - 1)}/${String(size)}`)
    const long = await fetch(url, { headers: { range: `bytes=-${String(size + 100)}` } })
    expect(long.headers.get('content-range')).toBe(`bytes 0-${String(size - 1)}/${String(size)}`)
  })

  it('answers 416 for a range outside the clip and the whole clip for a range it cannot read', async () => {
    const { origin } = await boot()
    const url = `${origin}${owlClipUrl('agents')}`
    const size = AGENTS_BYTES.length

    for (const range of [`bytes=${String(size)}-`, 'bytes=20-10', 'bytes=-0']) {
      const res = await fetch(url, { headers: { range } })
      expect(res.status).toBe(416)
      expect(res.headers.get('content-range')).toBe(`bytes */${String(size)}`)
    }
    for (const range of ['bytes=-', 'bytes=0-1,4-5', 'items=0-1']) {
      const res = await fetch(url, { headers: { range } })
      expect(res.status).toBe(200)
      expect((await res.arrayBuffer()).byteLength).toBe(size)
    }
  })
})
