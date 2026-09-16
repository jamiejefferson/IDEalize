// Composition coverage for the onboarding routes over a real settings
// document and web server: the agents detection answers from the (stubbed)
// subprocess and credentials seams, and the OpenRouter save verifies against
// a stand-in server before persisting — the fences, the refusals, and the
// llm-pi-ai profile write included.
import { createServer, request } from 'node:http'
import type { Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import FileSettingsProvider from '@deepseek-ai/dsh-settings-file'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import * as onboarding from '../src/index.ts'

let root: string | undefined
let context: Context | undefined
let openrouter: Server | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (openrouter !== undefined) await new Promise<void>((resolve) => { openrouter!.close(() => { resolve() }) })
  openrouter = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** The llm-pi-ai section as the tests register it (llm-pi-ai owns the real schema). */
const LLM_NS = settingsNamespace('llm-pi-ai')

interface BootOptions {
  /** Leave `openrouterBaseURL` out, so the shipped endpoint stands. */
  shippedEndpoint?: boolean
  /** Point the composition at a port nothing answers on. */
  unreachable?: boolean
  /** Answer every key with HTTP 500 rather than a catalogue or a refusal. */
  serverError?: boolean
  /** Leave the llm-pi-ai section unregistered, as a composition without it. */
  noLlmSection?: boolean
  /** Refuse every credential read. */
  unreadableCredentials?: boolean
  /** Whether the `claude` executable resolves. */
  claudeInstalled: boolean
  /** Keys the mock OpenRouter accepts. */
  goodKeys: readonly string[]
}

/** Boot the real composition over a scratch home, with machine facts stubbed. */
async function boot(options: BootOptions) {
  root = await mkdtemp(join(tmpdir(), 'idealize-onboarding-comp-'))
  const stored = new Map<string, string>()

  // The mock OpenRouter: 200 with an empty catalog for accepted keys, 401 else.
  openrouter = createServer((req, res) => {
    const key = (req.headers.authorization ?? '').replace(/^Bearer /, '')
    if (options.serverError === true) {
      res.writeHead(500, { 'content-type': 'text/plain' }).end('upstream is unwell')
      return
    }
    if (options.goodKeys.includes(key)) {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [] }))
      return
    }
    res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'unauthorized' }))
  })
  await new Promise<void>((resolve) => { openrouter!.listen(0, '127.0.0.1', () => { resolve() }) })
  const openrouterPort = (openrouter.address() as AddressInfo).port

  const ctx = new Context()
  context = ctx
  await ctx.plugin(FileSettingsProvider, { path: join(root, 'settings.yaml'), watch: false })
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  // Machine facts are nondeterministic inputs: the credentials store and the
  // PATH lookup are stubs; everything they feed is the real composition.
  ctx.provide('credentials', {
    resolve: (ref: string) => {
      if (options.unreadableCredentials === true) return Promise.reject(new Error('the credential store is locked'))
      const value = stored.get(ref)
      return Promise.resolve(value === undefined ? undefined : { value, source: 'test' })
    },
    set: (ref: string, value: string) => {
      stored.set(ref, value)
      return Promise.resolve()
    },
  } as never)
  ctx.provide('subprocess', {
    resolveExecutable: (command: string) => options.claudeInstalled
      ? Promise.resolve(`/usr/local/bin/${command}`)
      : Promise.reject(new Error(`subprocess-local: command ${JSON.stringify(command)} was not found on PATH`)),
  } as never)
  // The section the OpenRouter save writes into (llm-pi-ai owns the real one).
  if (options.noLlmSection !== true) ctx.settings.register(LLM_NS, z.object({ providers: z.dict(z.any()) }))
  const endpointPort = options.unreachable === true ? 1 : openrouterPort
  await ctx.plugin(onboarding, options.shippedEndpoint === true
    ? {}
    : { openrouterBaseURL: `http://127.0.0.1:${String(endpointPort)}/api/v1` })

  // The routes register under inject; wait for the plugin's own section first.
  const deadline = Date.now() + 5_000
  while (ctx.settings.get(settingsNamespace('idealize-onboarding')) === undefined) {
    if (Date.now() > deadline) throw new Error('idealize-onboarding settings section never registered')
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  return { ctx, stored, origin: `http://127.0.0.1:${String(ctx.webServer.port)}`, openrouterPort }
}

const HEADERS = { 'x-idealize-auth': '1', 'content-type': 'application/json' }

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

describe('the /idealize/onboarding routes', () => {
  it('reports detection from the subprocess and credentials seams', async () => {
    const { origin, stored } = await boot({ claudeInstalled: true, goodKeys: [] })

    const before = await (await fetch(`${origin}/idealize/onboarding/agents`)).json() as {
      claudeCode: { installed: boolean; path?: string }
      openrouter: { connected: boolean }
    }
    expect(before.claudeCode).toEqual({ installed: true, path: '/usr/local/bin/claude' })
    expect(before.openrouter.connected).toBe(false)

    stored.set('OPENROUTER_API_KEY', 'sk-or-test')
    const after = await (await fetch(`${origin}/idealize/onboarding/agents`)).json() as {
      openrouter: { connected: boolean }
    }
    expect(after.openrouter.connected).toBe(true)
  }, 30_000)

  it('reports Claude Code as absent when the executable does not resolve', async () => {
    const { origin } = await boot({ claudeInstalled: false, goodKeys: [] })
    const state = await (await fetch(`${origin}/idealize/onboarding/agents`)).json() as {
      claudeCode: { installed: boolean; path?: string }
    }
    expect(state.claudeCode).toEqual({ installed: false })
  }, 30_000)

  it('fences the mutation: no auth header and a foreign Host both earn 403', async () => {
    const { origin, ctx } = await boot({ claudeInstalled: false, goodKeys: [] })

    const unfenced = await fetch(`${origin}/idealize/onboarding/openrouter`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ apiKey: 'sk-or-good' }),
    })
    expect(unfenced.status).toBe(403)

    expect(await rawStatus(ctx.webServer.port, 'evil.example.com', '/idealize/onboarding/agents')).toBe(403)
  }, 30_000)

  it('verifies the key before persisting: a rejected key stores nothing', async () => {
    const { origin, ctx, stored } = await boot({ claudeInstalled: false, goodKeys: ['sk-or-good'] })

    const refused = await fetch(`${origin}/idealize/onboarding/openrouter`, {
      method: 'POST', headers: HEADERS, body: JSON.stringify({ apiKey: 'sk-or-bad' }),
    })
    expect(refused.status).toBe(400)
    const refusal = await refused.json() as { ok: boolean; error: string }
    expect(refusal.ok).toBe(false)
    expect(refusal.error).toContain('rejected')
    expect(stored.has('OPENROUTER_API_KEY')).toBe(false)
    const section = ctx.settings.get(LLM_NS) as { providers?: Record<string, unknown> }
    expect(section.providers?.openrouter).toBeUndefined()
  }, 30_000)

  it('stores the credential and binds the openrouter route to it', async () => {
    const { origin, ctx, stored } = await boot({ claudeInstalled: false, goodKeys: ['sk-or-good'] })

    const saved = await fetch(`${origin}/idealize/onboarding/openrouter`, {
      method: 'POST', headers: HEADERS, body: JSON.stringify({ apiKey: 'sk-or-good' }),
    })
    expect(saved.status).toBe(200)
    expect(stored.get('OPENROUTER_API_KEY')).toBe('sk-or-good')
    const section = ctx.settings.get(LLM_NS) as {
      providers?: Record<string, { displayName?: string; apiKeyEnv?: string }>
    }
    expect(section.providers?.openrouter).toEqual({ displayName: 'OpenRouter', apiKeyEnv: 'OPENROUTER_API_KEY' })

    // … so the detection route now reports the connection.
    const agents = await (await fetch(`${origin}/idealize/onboarding/agents`)).json() as {
      openrouter: { connected: boolean }
    }
    expect(agents.openrouter.connected).toBe(true)
  }, 30_000)

  it('refuses a malformed body at the wire boundary', async () => {
    const { origin } = await boot({ claudeInstalled: false, goodKeys: ['sk-or-good'] })
    const blank = await fetch(`${origin}/idealize/onboarding/openrouter`, {
      method: 'POST', headers: HEADERS, body: JSON.stringify({ apiKey: '  ' }),
    })
    expect(blank.status).toBe(400)
    const illegal = await fetch(`${origin}/idealize/onboarding/openrouter`, {
      method: 'POST', headers: HEADERS, body: JSON.stringify({ apiKey: 'sk-or with space' }),
    })
    expect(illegal.status).toBe(400)
    const notJson = await fetch(`${origin}/idealize/onboarding/openrouter`, {
      method: 'POST', headers: HEADERS, body: 'nope',
    })
    expect(notJson.status).toBe(400)
  }, 30_000)

  it('falls back to the shipped OpenRouter endpoint when the composition names none', async () => {
    const { origin } = await boot({ shippedEndpoint: true, claudeInstalled: false, goodKeys: [] })
    // The reads answer without ever reaching the endpoint, which is what
    // proves the fallback mounted rather than refused.
    const reply = await fetch(`${origin}/idealize/onboarding/agents`, { headers: HEADERS })
    expect(reply.status).toBe(200)
  })

  it('reads no connection when the credential store refuses', async () => {
    const { origin } = await boot({ claudeInstalled: false, goodKeys: [], unreadableCredentials: true })
    const reply = await fetch(`${origin}/idealize/onboarding/agents`, { headers: HEADERS })
    expect(((await reply.json()) as { openrouter: { connected: boolean } }).openrouter.connected).toBe(false)
  }, 30_000)

  it('takes POST alone on the save route', async () => {
    const { origin } = await boot({ claudeInstalled: false, goodKeys: [] })
    const reply = await fetch(`${origin}/idealize/onboarding/openrouter`, { headers: HEADERS })
    expect([reply.status, reply.headers.get('allow')]).toEqual([405, 'POST'])
  }, 30_000)

  it('refuses a body whose key is no text at all', async () => {
    const { origin } = await boot({ claudeInstalled: false, goodKeys: [] })
    const reply = await fetch(`${origin}/idealize/onboarding/openrouter`, {
      method: 'POST', headers: HEADERS, body: JSON.stringify({ apiKey: 7 }),
    })
    expect(reply.status).toBe(400)
  }, 30_000)

  it('says it could not reach OpenRouter, and reports an answer that is no catalogue', async () => {
    const unreachable = await boot({ claudeInstalled: false, goodKeys: ['sk-or-good'], unreachable: true })
    const offline = await fetch(`${unreachable.origin}/idealize/onboarding/openrouter`, {
      method: 'POST', headers: HEADERS, body: JSON.stringify({ apiKey: 'sk-or-good' }),
    })
    expect(offline.status).toBe(502)
    expect(((await offline.json()) as { error: string }).error).toContain('Could not reach OpenRouter')

    const unwell = await boot({ claudeInstalled: false, goodKeys: ['sk-or-good'], serverError: true })
    const answered = await fetch(`${unwell.origin}/idealize/onboarding/openrouter`, {
      method: 'POST', headers: HEADERS, body: JSON.stringify({ apiKey: 'sk-or-good' }),
    })
    expect(answered.status).toBe(502)
    expect(((await answered.json()) as { error: string }).error).toContain('HTTP 500')
  }, 30_000)

  it('refuses to store a verified key when llm-pi-ai is not composed', async () => {
    const { origin } = await boot({ claudeInstalled: false, goodKeys: ['sk-or-good'], noLlmSection: true })
    const reply = await fetch(`${origin}/idealize/onboarding/openrouter`, {
      method: 'POST', headers: HEADERS, body: JSON.stringify({ apiKey: 'sk-or-good' }),
    })
    expect(reply.status).toBe(500)
    expect(((await reply.json()) as { error: string }).error).toContain('llm-pi-ai settings section is not registered')
  }, 30_000)
})
