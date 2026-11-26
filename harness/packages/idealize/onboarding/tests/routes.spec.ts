// Composition coverage for the onboarding routes over a real settings
// document and web server: the agents detection answers from the (stubbed)
// subprocess and credentials seams, and the OpenRouter save verifies against
// a stand-in server before persisting — the fences, the refusals, and the
// llm-pi-ai profile write included. The align route runs over stand-in
// Terminal, default-model and models sections and a stubbed model listing.
import { createServer, request } from 'node:http'
import type { Server } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
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
/** The sections the align route reads and writes (their own packages own the real schemas). */
const TERMINAL_NS = settingsNamespace('idealize-ui-terminal')
const DEFAULT_MODEL_NS = settingsNamespace('agent-default-model')
const MODELS_NS = settingsNamespace('idealize-models')

/** The Terminal's launch choices, as its shipped configuration lists the ones these tests name. */
const CLIS = [
  { id: 'claude-code', label: 'Claude Code', command: 'claude --dangerously-skip-permissions' },
  { id: 'codex', label: 'Codex CLI', command: 'codex' },
  { id: 'gemini', label: 'Gemini CLI', command: 'gemini' },
  { id: 'antigravity', label: 'Antigravity CLI', command: 'agy' },
  { id: 'kimi', label: 'Kimi CLI', command: 'kimi' },
  { id: 'pi', label: 'Pi', command: 'pi' },
]

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
  /** The body the mock OpenRouter answers an accepted key with; the default is an empty model list. */
  directoryBody?: string
  /** Credentials stored before the routes mount. */
  storedKeys?: Record<string, string>
  /** Leave the Terminal's section unregistered. */
  noTerminalSection?: boolean
  /** Leave the default chat model's section unregistered. */
  noDefaultModelSection?: boolean
  /** Register the models section in this mode; absent leaves it unregistered. */
  modelsMode?: 'manual' | 'auto'
  /** The model ids the `openrouter` route lists; absent composes no llm service. */
  models?: readonly string[]
  /** Refuse every model listing. */
  unlistableModels?: boolean
  /** The settings document as stored before this launch. */
  settingsYaml?: string
}

/** Boot the real composition over a scratch home, with machine facts stubbed. */
async function boot(options: BootOptions) {
  root = await mkdtemp(join(tmpdir(), 'idealize-onboarding-comp-'))
  const stored = new Map<string, string>(Object.entries(options.storedKeys ?? {}))
  if (options.settingsYaml !== undefined) await writeFile(join(root, 'settings.yaml'), options.settingsYaml)

  // The mock OpenRouter: 200 with an empty catalog for accepted keys, 401 else.
  openrouter = createServer((req, res) => {
    const key = (req.headers.authorization ?? '').replace(/^Bearer /, '')
    if (options.serverError === true) {
      res.writeHead(500, { 'content-type': 'text/plain' }).end('upstream is unwell')
      return
    }
    if (options.goodKeys.includes(key)) {
      res.writeHead(200, { 'content-type': 'application/json' }).end(options.directoryBody ?? JSON.stringify({ data: [] }))
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
  if (options.noTerminalSection !== true) {
    ctx.settings.register(TERMINAL_NS, z.object({
      launchCommand: z.string().default('claude --dangerously-skip-permissions'),
      clis: z.array(z.object({ id: z.string(), label: z.string(), command: z.string() })).default(CLIS),
    }))
  }
  if (options.noDefaultModelSection !== true) {
    ctx.settings.register(DEFAULT_MODEL_NS, z.object({ provider: z.string().default('deepseek'), model: z.string().default('deepseek-chat') }))
  }
  if (options.modelsMode !== undefined) {
    ctx.settings.register(MODELS_NS, z.object({ mode: z.union(['manual', 'auto']).default(options.modelsMode) }))
  }
  if (options.models !== undefined) {
    const models = options.models
    ctx.provide('llm', {
      listModels: (provider: string) => options.unlistableModels === true
        ? Promise.reject(new Error('the route has no usable credentials'))
        : Promise.resolve(provider === 'openrouter' ? models.map(id => ({ id })) : []),
    } as never)
  }
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

  it('reports the fal key and the Terminal\'s default launch command', async () => {
    const { origin } = await boot({ claudeInstalled: false, goodKeys: [], storedKeys: { FAL_KEY: 'fal-1' } })
    const state = await (await fetch(`${origin}/idealize/onboarding/agents`)).json() as Record<string, unknown>
    expect(state.fal).toEqual({ connected: true })
    expect(state.launchCommand).toBe('claude --dangerously-skip-permissions')

    const bare = await boot({ claudeInstalled: false, goodKeys: [], noTerminalSection: true })
    const without = await (await fetch(`${bare.origin}/idealize/onboarding/agents`)).json() as Record<string, unknown>
    expect(without.fal).toEqual({ connected: false })
    expect('launchCommand' in without).toBe(false)
  }, 30_000)
})

describe('the idealize-onboarding settings section', () => {
  it('reads a section stored before simplerSeen existed, with the field false', async () => {
    expect(onboarding.OnboardingSettingsSchema({ done: true, steps: { agents: 'done', tools: 'skipped' } } as never)).toEqual({
      done: true, steps: { agents: 'done', tools: 'skipped' }, simplerSeen: false,
    })
    const { ctx } = await boot({
      claudeInstalled: false,
      goodKeys: [],
      settingsYaml: 'idealize-onboarding:\n  done: true\n  steps:\n    agents: done\n    tools: skipped\n  completedAt: "2026-09-14T10:00:00.000Z"\n',
    })
    expect(ctx.settings.get(settingsNamespace('idealize-onboarding'))).toEqual({
      done: true, steps: { agents: 'done', tools: 'skipped' }, completedAt: '2026-09-14T10:00:00.000Z', simplerSeen: false,
    })
  }, 30_000)
})

/** The align route's answer. */
interface Aligned {
  launchCommand?: string
  defaultModel?: { provider: string; model: string }
  note?: string
  error?: string
}

/** OpenRouter's directory as the mock serves it: listing dates and per-token prices, with rows the reader must pass over. */
const DIRECTORY = JSON.stringify({
  data: [
    null,
    { created: 5 },
    { id: 'anthropic/claude-3-haiku', created: 100, pricing: { prompt: '0.00000025', completion: '0.00000125' } },
    { id: 'anthropic/claude-haiku-4.5', created: 300, pricing: { prompt: '0.000001', completion: '0.000005' } },
    { id: 'anthropic/claude-3.5-haiku', created: 200, pricing: { prompt: '0.0000008', completion: '0.000004' } },
    { id: 'openai/gpt-5-mini', created: 400, pricing: { prompt: '0.00000025', completion: '0.000002' } },
    { id: 'google/gemini-2.5-flash', created: 'yesterday', pricing: { prompt: '0.0000003', completion: '0.0000025' } },
    { id: 'moonshotai/kimi-k2', created: 250, pricing: { prompt: '0.0000006', completion: '0.0000025' } },
    { id: 'moonshotai/kimi-k2-turbo', created: 260, pricing: { prompt: '0.0000024', completion: '0.00001' } },
    { id: 'moonshotai/kimi-lite', created: 270, pricing: { prompt: '0.0000001', completion: '0.0000004' } },
    { id: 'moonshotai/kimi-unpriced', created: 280 },
    { id: 'moonshotai/kimi-zero', created: 290, pricing: { prompt: '0', completion: '0' } },
  ],
})

/** The `openrouter` route's model list for the mapping tests, in the route's own order. */
const MODELS = [
  'anthropic/claude-3-haiku', 'anthropic/claude-haiku-4.5', 'anthropic/claude-3.5-haiku', 'anthropic/claude-sonnet-4.5',
  'openai/gpt-5', 'openai/gpt-5-mini',
  'google/gemini-2.5-pro', 'google/gemini-2.5-flash', 'google/gemini-2.0-flash-exp:free',
  'moonshotai/kimi-unpriced', 'moonshotai/kimi-zero', 'moonshotai/kimi-k2', 'moonshotai/kimi-lite', 'moonshotai/kimi-k2-turbo',
  'moonshotai/kimi-k2:free',
]

describe('POST /idealize/onboarding/align', () => {
  const align = async (origin: string, body: unknown): Promise<{ status: number; body: Aligned }> => {
    const reply = await fetch(`${origin}/idealize/onboarding/align`, {
      method: 'POST', headers: HEADERS, body: typeof body === 'string' ? body : JSON.stringify(body),
    })
    return { status: reply.status, body: await reply.json() as Aligned }
  }
  const connected = { claudeInstalled: true, goodKeys: ['sk-or-good'], storedKeys: { OPENROUTER_API_KEY: 'sk-or-good' } } as const

  it('takes POST alone, behind the auth header, with a JSON body', async () => {
    const { origin } = await boot({ claudeInstalled: true, goodKeys: [] })
    const read = await fetch(`${origin}/idealize/onboarding/align`, { headers: HEADERS })
    expect([read.status, read.headers.get('allow')]).toEqual([405, 'POST'])
    const unfenced = await fetch(`${origin}/idealize/onboarding/align`, { method: 'POST', body: '{}' })
    expect(unfenced.status).toBe(403)
    expect((await align(origin, 'nope')).status).toBe(400)
  }, 30_000)

  it('changes nothing when no coding app is named', async () => {
    const { origin, ctx } = await boot({ ...connected, models: MODELS, directoryBody: DIRECTORY })
    const reply = await align(origin, {})
    expect(reply.status).toBe(200)
    expect(reply.body).toEqual({ note: 'No coding app was named, so nothing changed.' })
    expect(ctx.settings.get(DEFAULT_MODEL_NS)).toEqual({ provider: 'deepseek', model: 'deepseek-chat' })
  }, 30_000)

  it('refuses a cli that names no launch choice, and writes nothing', async () => {
    const { origin, ctx } = await boot({ ...connected, models: MODELS, directoryBody: DIRECTORY })
    for (const cli of ['cursor', 7]) {
      const reply = await align(origin, { cli })
      expect(reply.status).toBe(400)
      expect(reply.body.error).toContain('launch choices')
    }
    expect((ctx.settings.get(TERMINAL_NS) as { launchCommand: string }).launchCommand).toBe('claude --dangerously-skip-permissions')

    const bare = await boot({ ...connected, noTerminalSection: true })
    expect((await align(bare.origin, { cli: 'codex' })).status).toBe(400)
  }, 30_000)

  it('refuses when the default chat model has no settings section, before any write', async () => {
    const { origin, ctx } = await boot({ ...connected, noDefaultModelSection: true })
    const reply = await align(origin, { cli: 'codex' })
    expect(reply.status).toBe(500)
    expect(reply.body.error).toContain('agent-default-model settings section is not registered')
    expect((ctx.settings.get(TERMINAL_NS) as { launchCommand: string }).launchCommand).toBe('claude --dangerously-skip-permissions')
  }, 30_000)

  it('stores the launch command alone when no OpenRouter key is connected', async () => {
    const { origin, ctx, stored } = await boot({ claudeInstalled: true, goodKeys: [], models: MODELS })
    const reply = await align(origin, { cli: 'codex' })
    expect(reply.body).toEqual({ launchCommand: 'codex', note: 'No OpenRouter key is connected, so the chat model stays as it is.' })
    expect((ctx.settings.get(TERMINAL_NS) as { launchCommand: string }).launchCommand).toBe('codex')
    expect(ctx.settings.get(DEFAULT_MODEL_NS)).toEqual({ provider: 'deepseek', model: 'deepseek-chat' })

    // A stored key with nothing in it connects nothing.
    stored.set('OPENROUTER_API_KEY', '')
    expect((await align(origin, { cli: 'gemini' })).body.note).toContain('No OpenRouter key')

    // A credential store that refuses the read connects nothing either.
    const locked = await boot({ claudeInstalled: true, goodKeys: [], unreadableCredentials: true })
    expect((await align(locked.origin, { cli: 'codex' })).body.note).toContain('No OpenRouter key')
  }, 30_000)

  it('stores the launch command alone for a coding app with no company on OpenRouter', async () => {
    const { origin, ctx } = await boot({ ...connected, models: MODELS, directoryBody: DIRECTORY })
    const reply = await align(origin, { cli: 'pi' })
    expect(reply.body.launchCommand).toBe('pi')
    expect(reply.body.note).toContain('no matching company')
    expect(reply.body.defaultModel).toBeUndefined()
    expect(ctx.settings.get(DEFAULT_MODEL_NS)).toEqual({ provider: 'deepseek', model: 'deepseek-chat' })
  }, 30_000)

  it('points the default chat model at the coding app\'s company', async () => {
    const { origin, ctx } = await boot({ ...connected, models: MODELS, directoryBody: DIRECTORY })
    const expected: [string, string, string][] = [
      // The most recently listed haiku, not the first in the list.
      ['claude-code', 'claude --dangerously-skip-permissions', 'anthropic/claude-haiku-4.5'],
      ['codex', 'codex', 'openai/gpt-5-mini'],
      // The free variant never wins, and one launch choice per Google app reaches the same company.
      ['gemini', 'gemini', 'google/gemini-2.5-flash'],
      ['antigravity', 'agy', 'google/gemini-2.5-flash'],
      // No hint word for Kimi: the cheapest model that states a price.
      ['kimi', 'kimi', 'moonshotai/kimi-lite'],
    ]
    for (const [cli, command, model] of expected) {
      const reply = await align(origin, { cli })
      expect(reply.body).toEqual({ launchCommand: command, defaultModel: { provider: 'openrouter', model } })
      expect((ctx.settings.get(TERMINAL_NS) as { launchCommand: string }).launchCommand).toBe(command)
      expect(ctx.settings.get(DEFAULT_MODEL_NS)).toEqual({ provider: 'openrouter', model })
    }
  }, 30_000)

  it('changes no model when the list has none of that company, and says so', async () => {
    const { origin, ctx } = await boot({ ...connected, models: ['openai/gpt-5-mini', 'anthropic/claude-haiku-4.5:free'], directoryBody: DIRECTORY })
    const reply = await align(origin, { cli: 'claude-code' })
    expect(reply.body).toEqual({
      launchCommand: 'claude --dangerously-skip-permissions',
      note: 'OpenRouter lists no anthropic model here, so the chat model stays as it is.',
    })
    expect(ctx.settings.get(DEFAULT_MODEL_NS)).toEqual({ provider: 'deepseek', model: 'deepseek-chat' })

    // No llm service, and a listing that refuses, both read as an empty list.
    const without = await boot({ ...connected })
    expect((await align(without.origin, { cli: 'codex' })).body.note).toContain('lists no openai model')
    const refusing = await boot({ ...connected, models: MODELS, unlistableModels: true })
    expect((await align(refusing.origin, { cli: 'codex' })).body.note).toContain('lists no openai model')
  }, 30_000)

  it('chooses without the directory when OpenRouter gives none', async () => {
    // The stored key is refused, the answer is no JSON, and the answer is no list: each reads as no facts.
    const refused = await boot({ claudeInstalled: true, goodKeys: [], storedKeys: { OPENROUTER_API_KEY: 'sk-or-stale' }, models: MODELS })
    const haiku = await align(refused.origin, { cli: 'claude-code' })
    expect(haiku.body.defaultModel).toEqual({ provider: 'openrouter', model: 'anthropic/claude-3-haiku' })
    const kimi = await align(refused.origin, { cli: 'kimi' })
    expect(kimi.body).toEqual({ launchCommand: 'kimi', note: 'No moonshotai model on OpenRouter states a price, so the chat model stays as it is.' })

    const garbled = await boot({ ...connected, models: MODELS, directoryBody: 'not json' })
    expect((await align(garbled.origin, { cli: 'kimi' })).body.note).toContain('states a price')
    const listless = await boot({ ...connected, models: MODELS, directoryBody: JSON.stringify({ data: 'none' }) })
    expect((await align(listless.origin, { cli: 'kimi' })).body.note).toContain('states a price')
    const offline = await boot({ ...connected, models: MODELS, unreachable: true })
    expect((await align(offline.origin, { cli: 'codex' })).body.defaultModel).toEqual({ provider: 'openrouter', model: 'openai/gpt-5-mini' })
  }, 30_000)

  it('stands the auto policy down so the chosen default holds', async () => {
    const auto = await boot({ ...connected, models: MODELS, directoryBody: DIRECTORY, modelsMode: 'auto' })
    await align(auto.origin, { cli: 'codex' })
    expect(auto.ctx.settings.get(MODELS_NS)).toEqual({ mode: 'manual' })

    const manual = await boot({ ...connected, models: MODELS, directoryBody: DIRECTORY, modelsMode: 'manual' })
    await align(manual.origin, { cli: 'codex' })
    expect(manual.ctx.settings.get(MODELS_NS)).toEqual({ mode: 'manual' })
  }, 30_000)
})
