/**
 * REAL-composition coverage of the icon route: the web server booted through
 * the vendored Loader beside `@idealize/spaces` serves each declared space's
 * packaged SVG, refuses every other path under the prefix by table lookup, and
 * keeps the loopback fence the other spaces routes keep.
 */

import { readFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import HttpServer from '@deepseek-ai/dsh-host-webserver'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as Spaces from '../src/index.ts'
import { iconSpace, SPACE_ICON_PATH, SPACE_IDS, spaceIconSrc } from '../src/index.ts'
import { spaceIconSrc as clientSpaceIconSrc } from '../src/client.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** Boot the web server and the spaces plugin alone through the real Loader. */
async function loadComposition(): Promise<number> {
  root = await mkdtemp(join(tmpdir(), 'idealize-space-icons-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-host-webserver'",
    '  config:',
    "    host: '127.0.0.1'",
    '    port: 0',
    '- id: idealize-spaces',
    "  name: '@idealize/spaces'",
    '',
  ].join('\n'))

  context = new Context()
  context.baseUrl = `${pathToFileURL(root).href}/`
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-host-webserver', HttpServer],
    ['@idealize/spaces', Spaces],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  return context.webServer.port
}

interface Reply {
  status: number
  headers: Record<string, string | string[] | undefined>
  body: Buffer
}

/** One request, loopback Host header unless overridden. */
function get(
  port: number,
  path: string,
  headers: Record<string, string> = { host: '127.0.0.1' },
  method = 'GET',
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => { chunks.push(chunk) })
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) })
      })
    })
    req.on('error', reject)
    req.end()
  })
}

describe('space icon route', () => {
  it('serves every declared space its packaged SVG, byte for byte, as image/svg+xml', async () => {
    const port = await loadComposition()
    for (const id of SPACE_IDS) {
      const reply = await get(port, spaceIconSrc(id))
      const file = await readFile(new URL(`../assets/icons/${id}.svg`, import.meta.url))
      expect(reply.status).toBe(200)
      expect(reply.headers['content-type']).toBe('image/svg+xml')
      expect(reply.headers['content-length']).toBe(String(file.length))
      expect(reply.headers['cache-control']).toBe('no-cache')
      expect(reply.body.equals(file)).toBe(true)
      const svg = reply.body.toString('utf8')
      expect(svg).toContain('viewBox="0 0 24 24"')
      // An outline in the text colour at the weight JJ chose; a fixed colour or
      // a fill would show through the currentColor mask as a solid block.
      expect(svg).toContain('stroke="currentColor" stroke-width="1.25"')
      expect(svg).not.toMatch(/fill="#/)
    }
  })

  it('answers a repeat load that presents the ETag with 304 and no body', async () => {
    const port = await loadComposition()
    const first = await get(port, spaceIconSrc('chat'))
    const etag = first.headers.etag
    expect(typeof etag).toBe('string')
    const again = await get(port, spaceIconSrc('chat'), { host: '127.0.0.1', 'if-none-match': etag as string })
    expect(again.status).toBe(304)
    expect(again.body.length).toBe(0)
    expect(again.headers.etag).toBe(etag)
  })

  it('answers 404 for a space it does not declare, a file it does not serve, and a traversal attempt', async () => {
    const port = await loadComposition()
    for (const path of [
      `${SPACE_ICON_PATH}/trajectory.svg`,
      `${SPACE_ICON_PATH}/chat.png`,
      `${SPACE_ICON_PATH}/chat`,
      `${SPACE_ICON_PATH}/`,
      SPACE_ICON_PATH,
      `${SPACE_ICON_PATH}/..%2F..%2Fpackage.json`,
    ]) {
      const reply = await get(port, path)
      expect(reply.status, path).toBe(404)
      expect(reply.body.toString('utf8'), path).toBe('no such space icon')
    }
    // A `..` segment, raw or percent-encoded, is resolved by the web server
    // before routing, so the request leaves the prefix and lands on the
    // server's own 404 with no file behind it.
    for (const path of [`${SPACE_ICON_PATH}/../../package.json`, `${SPACE_ICON_PATH}/%2e%2e/chat.svg`]) {
      const reply = await get(port, path)
      expect(reply.status, path).toBe(404)
      expect(reply.body.toString('utf8'), path).not.toContain('<svg')
      expect(reply.body.toString('utf8'), path).not.toContain('"name"')
    }
  })

  it('answers only GET, from loopback', async () => {
    const port = await loadComposition()
    expect((await get(port, spaceIconSrc('chat'), { host: '127.0.0.1' }, 'POST')).status).toBe(405)
    const foreign = await get(port, spaceIconSrc('chat'), { host: 'example.com' })
    expect(foreign.status).toBe(403)
    expect(foreign.body.toString('utf8')).toBe('loopback only')
  })

  it('names the icon by table lookup so no request text reaches the filesystem', () => {
    expect(iconSpace('/idealize/spaces/icons/gallery.svg')).toBe('gallery')
    expect(iconSpace('/idealize/spaces/icons/gallery.svg/')).toBeUndefined()
    expect(iconSpace('/idealize/spaces/icons/.svg')).toBeUndefined()
    expect(iconSpace('/idealize/spaces/icons/../gallery.svg')).toBeUndefined()
    expect(iconSpace('/idealize/spaces/iconsx/gallery.svg')).toBeUndefined()
  })

  it('exposes one helper on both faces, naming the same route', () => {
    expect(clientSpaceIconSrc('soundstage')).toBe('/idealize/spaces/icons/soundstage.svg')
    expect(clientSpaceIconSrc('soundstage')).toBe(spaceIconSrc('soundstage'))
  })
})
