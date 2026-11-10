import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Candidate } from '../src/decide.ts'
import { apply } from '../src/index.ts'
import { canStepIn, chooseStandIn, stepInRationale } from '../src/step-in.ts'
import type { StepInInput } from '../src/step-in.ts'

const astra = { provider: 'openai-codex', model: 'gpt-6-astra' }
const luna: Candidate = { provider: 'openai-codex', model: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', price: 'free' }
const opus: Candidate = { provider: 'anthropic', model: 'claude-opus-5-5', label: 'Claude Opus 5.5', price: { input: 15, output: 75 } }
const free: Candidate = { provider: 'freetokens', model: 'auto', label: 'Free tokens', price: 'free', images: false }
const embeddings: Candidate = { provider: 'openrouter', model: 'some/embedder', label: 'Embedder', price: 'free' }

/** A chat already sent to these companies, so the ranking tests are not also testing the company rule. */
const visited = ['anthropic', 'freetokens', 'free-route'].map(provider => ({ provider, model: 'earlier-model' }))

const input = (over: Partial<StepInInput>): StepInInput => ({
  failed: astra, code: 'MISSING_CREDENTIAL', tried: visited, candidates: [luna, opus, free, embeddings],
  reading: { task: 'code', difficulty: 'hard' }, weights: { cost: 30, speed: 50, intelligence: 80 }, preferFree: true, hasImages: false, ...over,
})
const noWindow = () => Promise.resolve(undefined)

describe('which failures the router steps in for', () => {
  it('answers a model that cannot serve the account, and leaves a dropped connection alone', () => {
    for (const code of ['MISSING_CREDENTIAL', 'NO_ADAPTER', 'AUTH', 'INVALID_CREDENTIAL', 'QUOTA', 'RATE_LIMIT', 'SERVER']) expect(canStepIn(code)).toBe(true)
    for (const code of ['TRANSPORT', 'TIMEOUT', 'ABORTED', 'INVALID_REQUEST', 'CONTEXT_WINDOW_EXCEEDED', 'PI_AI_ERROR']) expect(canStepIn(code)).toBe(false)
  })
})

describe('choosing a stand-in', () => {
  it('rules out the whole route when the account is the fault, and takes the free engine over a paid model', async () => {
    expect(await chooseStandIn(input({}), noWindow)).toMatchObject({ kind: 'use', to: { provider: 'freetokens' } })
  })

  it('keeps the route open when only the model was busy', async () => {
    const choice = await chooseStandIn(input({ code: 'RATE_LIMIT', candidates: [luna, opus] }), noWindow)
    expect(choice).toMatchObject({ kind: 'use', to: { model: 'gpt-5.6-luna' } })
  })

  it('takes a paid model when nothing free can answer, and says it is paid', async () => {
    // JJ, 4 Nov 2026: a colleague holding a working OpenRouter key failed every turn on an empty free tier.
    const choice = await chooseStandIn(input({ candidates: [luna, opus] }), noWindow)
    expect(choice).toMatchObject({ kind: 'use', to: { model: 'claude-opus-5-5' } })
    expect(stepInRationale('Free tokens', 'MISSING_CREDENTIAL', choice as never)).toMatch(/took the turn\. .* is a paid model\.$/)
  })

  describe('moving a chat to another company', () => {
    const haiku: Candidate = { provider: 'openrouter', model: '~anthropic/claude-haiku-latest', label: 'Haiku', price: { input: 1, output: 5 } as never }
    const flash: Candidate = { provider: 'openrouter', model: '~deepseek/deepseek-v4-flash-latest', label: 'Flash', price: { input: 1, output: 2 } as never }
    const failed = { provider: 'anthropic', model: 'claude-sonnet' }

    it('only offers a model at another company, naming it as the reason', async () => {
      const choice = await chooseStandIn(input({ tried: [], failed, code: 'QUOTA', candidates: [flash] }), noWindow)
      expect(choice).toMatchObject({ kind: 'offer', reason: 'other-company', to: { label: 'Flash' } })
    })

    it('reaches the same company through another account with no question', async () => {
      const choice = await chooseStandIn(input({ tried: [], failed, code: 'QUOTA', candidates: [flash, haiku] }), noWindow)
      expect(choice).toMatchObject({ kind: 'use', to: { label: 'Haiku' } })
    })

    it('moves freely within one account', async () => {
      const choice = await chooseStandIn(input({ tried: [], failed: { provider: 'openrouter', model: '~anthropic/claude-haiku-latest' }, code: 'RATE_LIMIT', candidates: [flash] }), noWindow)
      expect(choice).toMatchObject({ kind: 'use', to: { label: 'Flash' } })
    })

    it('follows an empty free engine anywhere, because it never received the chat', async () => {
      const choice = await chooseStandIn(input({ tried: [], failed: { provider: 'freetokens', model: 'auto' }, code: 'MISSING_CREDENTIAL', candidates: [flash] }), noWindow)
      expect(choice).toMatchObject({ kind: 'use', to: { label: 'Flash' } })
    })

    it('asks when a free engine holding keys fails', async () => {
      const choice = await chooseStandIn(input({ tried: [], failed: { provider: 'freetokens', model: 'auto' }, code: 'RATE_LIMIT', candidates: [flash] }), noWindow)
      expect(choice).toMatchObject({ kind: 'offer', reason: 'other-company' })
    })

    it.each([
      ['deepseek-official', 'deepseek-v4-flash', '~deepseek/deepseek-v4-flash-latest'],
      ['xai', 'grok-5', 'x-ai/grok-5'],
      ['mistral', 'mistral-large', 'mistralai/mistral-large'],
      ['zai', 'glm-5', 'z-ai/glm-5'],
    ])('counts %s and OpenRouter’s copy as one company, in both directions', async (provider, model, routed) => {
      const direct: Candidate = { provider, model, label: 'Direct', price: { input: 1, output: 1 } } as Candidate
      const viaRouter = { provider: 'openrouter', model: routed, label: 'Via router', price: { input: 1, output: 1 } } as Candidate
      const toDirect = await chooseStandIn(input({ tried: [], failed: { provider: 'openrouter', model: routed }, code: 'MISSING_CREDENTIAL', candidates: [direct] }), noWindow)
      expect(toDirect).toMatchObject({ kind: 'use', to: { label: 'Direct' } })
      const toRouter = await chooseStandIn(input({ tried: [], failed: { provider, model }, code: 'QUOTA', candidates: [viaRouter] }), noWindow)
      expect(toRouter).toMatchObject({ kind: 'use', to: { label: 'Via router' } })
    })

    it('lets a first message on a route with no account go to the account the person connected', async () => {
      const unserved = { provider: 'openrouter', model: 'deepseek/deepseek-v4-flash' }
      const opusDirect: Candidate = { ...haiku, provider: 'anthropic', model: 'claude-opus' }
      for (const code of ['NO_ADAPTER', 'MISSING_CREDENTIAL']) {
        const asked = input({ tried: [], failed: unserved, code, nothingSent: true, candidates: [opusDirect] })
        const choice = await chooseStandIn(asked, noWindow)
        expect(choice).toMatchObject({ kind: 'use', to: { provider: 'anthropic' } })
      }
    })

    it('asks before a chat with history leaves for another company, even when its route has no account', async () => {
      const unserved = { provider: 'openrouter', model: 'deepseek/deepseek-v4-flash' }
      const opusDirect: Candidate = { ...haiku, provider: 'anthropic', model: 'claude-opus' }
      const choice = await chooseStandIn(input({ tried: [], failed: unserved, code: 'MISSING_CREDENTIAL', nothingSent: false, candidates: [opusDirect] }), noWindow)
      expect(choice).toMatchObject({ kind: 'offer', reason: 'other-company' })
    })

    it('treats a first message refused by a real key as a move that asks', async () => {
      const opusDirect: Candidate = { ...haiku, provider: 'anthropic', model: 'claude-opus' }
      const choice = await chooseStandIn(input({ tried: [], failed: { provider: 'deepseek-official', model: 'deepseek-v4-flash' }, code: 'AUTH', nothingSent: true, candidates: [opusDirect] }), noWindow)
      expect(choice).toMatchObject({ kind: 'offer', reason: 'other-company' })
    })

    it('treats a key gateway\'s route as the company it fronts, both ways', async () => {
      const gatewayClaude: Candidate = { provider: 'gateway-anthropic', model: 'claude-sonnet-5-5', label: 'Sonnet via gateway', price: { input: 3, output: 15 } }
      const directClaude: Candidate = { provider: 'anthropic', model: 'claude-sonnet-5-5', label: 'Sonnet', price: { input: 3, output: 15 } }
      expect(await chooseStandIn(input({ tried: [], failed: { provider: 'gateway-anthropic', model: 'claude-sonnet-5-5' }, code: 'SERVER', candidates: [directClaude] }), noWindow))
        .toMatchObject({ kind: 'use', to: { provider: 'anthropic' } })
      expect(await chooseStandIn(input({ tried: [], failed: { provider: 'anthropic', model: 'claude-sonnet-5-5' }, code: 'QUOTA', candidates: [gatewayClaude] }), noWindow))
        .toMatchObject({ kind: 'use', to: { provider: 'gateway-anthropic' } })
      const gatewayRouter: Candidate = { provider: 'gateway-openrouter', model: '~openai/gpt-5.5', label: 'GPT via gateway', price: { input: 1, output: 4 } }
      expect(await chooseStandIn(input({ tried: [], failed: { provider: 'anthropic', model: 'claude-sonnet-5-5' }, code: 'QUOTA', candidates: [gatewayRouter] }), noWindow))
        .toMatchObject({ kind: 'offer', reason: 'other-company' })
    })

    it('treats ChatGPT’s sign-in as the same company as OpenAI', async () => {
      const gpt: Candidate = { provider: 'openai', model: 'gpt-5.6', label: 'GPT', price: { input: 1, output: 2 } as never }
      const choice = await chooseStandIn(input({ tried: [], failed: { provider: 'openai-codex', model: 'gpt-5.6-luna' }, code: 'AUTH', candidates: [gpt] }), noWindow)
      expect(choice).toMatchObject({ kind: 'use', to: { label: 'GPT' } })
    })
  })

  it('never rests a rescue on OpenRouter’s shared free pool', async () => {
    const pool: Candidate = { provider: 'openrouter', model: 'google/gemma-4:free', label: 'Gemma', price: 'free' }
    const choice = await chooseStandIn(input({ candidates: [pool, opus] }), noWindow)
    expect(choice).toMatchObject({ kind: 'use', to: { model: 'claude-opus-5-5' } })
  })

  it('puts a free stand-in ahead of a stronger paid one', async () => {
    const free = { provider: 'free-route', model: 'deepseek-v4-flash', label: 'Flash', price: 'free' as const }
    const choice = await chooseStandIn(input({ candidates: [opus, free] }), noWindow)
    expect(choice).toMatchObject({ kind: 'use', to: { model: 'deepseek-v4-flash' } })
  })

  it('takes the paid model itself once the person allowed paid switches', async () => {
    expect(await chooseStandIn(input({ preferFree: false }), noWindow)).toMatchObject({ kind: 'use', to: { model: 'claude-opus-5-5' } })
  })

  it('only offers a model that would cut the chat', async () => {
    const choice = await chooseStandIn(input({ candidates: [free], contextTokens: 900_000 }), () => Promise.resolve(32_000))
    expect(choice).toMatchObject({ kind: 'offer', reason: 'loses-context' })
  })

  it('skips a model that cannot see the chat’s images, a model it already tried and a one-star model', async () => {
    expect(await chooseStandIn(input({ candidates: [free], hasImages: true }), noWindow)).toEqual({ kind: 'none' })
    expect(await chooseStandIn(input({ candidates: [free], tried: [free] }), noWindow)).toEqual({ kind: 'none' })
    const barred = await chooseStandIn(input({ candidates: [free], standingOf: () => ({ bonus: 0, barred: true }) as never }), noWindow)
    expect(barred).toEqual({ kind: 'none' })
  })

  it('never lands on a model the table cannot score', async () => {
    expect(await chooseStandIn(input({ candidates: [embeddings] }), noWindow)).toEqual({ kind: 'none' })
  })

  it('says why in the chat', async () => {
    const choice = await chooseStandIn(input({}), noWindow)
    if (choice.kind === 'none') throw new Error('expected a stand-in')
    expect(stepInRationale('GPT-6 Astra', 'MISSING_CREDENTIAL', choice)).toBe('GPT-6 Astra has no key or sign-in, so Free tokens took the turn.')
  })
})

describe('the router in a failing turn', () => {
  let home: string
  const saved = process.env.DSH_HOME

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'idealize-router-'))
    process.env.DSH_HOME = home
  })
  afterEach(async () => {
    if (saved === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = saved
    await rm(home, { recursive: true, force: true })
  })

  /** Mount the router with the free engine connected and hand back a chat to drive it with. */
  async function mount(
    config: object = {}, events: Array<{ type: string; data: unknown }> = [],
    routes: Array<{ id: string; models: string[] }> = [{ id: 'openai', models: ['gpt-5.5'] }],
  ) {
    const ctx = new Context()
    const log: Array<{ type: string; data: Record<string, unknown> }> = []
    ctx.provide('llm', {
      listConfigurableProviders: () => routes.map(route => ({ provider: route.id, settingsNs: route.id, settingsPath: [] })),
      listModels: (provider: string) => Promise.resolve((routes.find(route => route.id === provider)?.models ?? []).map(id => ({ id, name: id === 'auto' ? 'Free tokens' : id }))),
      resolveModelInfo: () => Promise.resolve({}),
    })
    ctx.provide('settings', { get: () => ({ apiKeyEnv: 'FREETOKENS_API_KEY' }), update: () => Promise.resolve(), register: () => () => {} })
    ctx.provide('credentials', { resolve: () => Promise.resolve({ value: 'stored' }) })
    await ctx.plugin({ name: 'idealize-router', inject: [], apply }, { useJev: false, preferFree: false, ...config })
    await new Promise(resolve => setTimeout(resolve, 0))
    const session = {
      header: { id: 'session-one' },
      events: [{ type: 'idealize/space', data: { space: 'chat' } }, ...events] as Array<{ type: string; data: Record<string, unknown> }>,
      append: (type: string, data: Record<string, unknown>) => {
        log.push({ type, data })
        session.events.push({ type, data })
      },
    }
    const agent = { session }
    const signal = new AbortController().signal
    const request = () => ctx.waterfall('agent/request', { agent, turn: 1, step: 2, signal } as never, () => Promise.resolve(astra as never))
    const fail = (code: string, retry?: () => unknown) => {
      const payload = { agent, turn: 1, step: 2, provider: 'openai-codex', failure: { code, message: code }, signal }
      return ctx.waterfall('agent/request-error', payload as never, () => Promise.resolve(retry?.() as never))
    }
    return { ctx, request, fail, log }
  }

  it('hands the turn to a connected model, says so, and keeps it there', async () => {
    const chat = await mount()
    expect(await chat.request()).toMatchObject(astra)
    expect(await chat.fail('MISSING_CREDENTIAL')).toEqual({ kind: 'retry' })
    expect(await chat.request()).toMatchObject({ provider: 'openai', model: 'gpt-5.5' })
    expect(chat.log).toHaveLength(1)
    expect(chat.log[0]?.data).toMatchObject({
      outcome: 'switched', from: { model: 'gpt-6-astra' }, to: { model: 'gpt-5.5' },
      rationale: expect.stringMatching(/^gpt-6-astra has no key or sign-in, so .+ took the turn\./u),
    })
  })

  it('offers a model at another company and lets the turn fail, so the chat stays where it is', async () => {
    const chat = await mount({}, [], [{ id: 'anthropic', models: ['claude-opus-5-5'] }])
    await chat.request()
    expect(await chat.fail('QUOTA')).toBeUndefined()
    expect(await chat.request()).toMatchObject(astra)
    expect(chat.log[0]?.data).toMatchObject({ outcome: 'offer', reason: 'other-company', to: { model: 'claude-opus-5-5' } })
  })

  it('moves a first message off a route with no key to the account the person connected', async () => {
    const chat = await mount({}, [], [{ id: 'anthropic', models: ['claude-opus-5-5'] }])
    await chat.request()
    expect(await chat.fail('MISSING_CREDENTIAL')).toEqual({ kind: 'retry' })
    expect(await chat.request()).toMatchObject({ provider: 'anthropic', model: 'claude-opus-5-5' })
  })

  describe('on Free tokens with an empty engine', () => {
    const emptyEngine = (keys: unknown[]) => vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url.endsWith('/api/keys')) return Promise.resolve(new Response(JSON.stringify(keys), { status: 200 }))
      if (url.includes('/api/auth/')) return Promise.resolve(new Response(JSON.stringify({ token: 'session' }), { status: 200 }))
      return Promise.resolve(new Response('ok', { status: 200 }))
    }))
    const onFree = { provider: 'freetokens', model: 'auto' }
    const company = { id: 'openrouter', models: ['moonshotai/kimi-k3'] }
    afterEach(() => { vi.unstubAllGlobals() })

    /** A chat whose own model is Free tokens, with an engine the probe can read. */
    async function mountOnFree(config: Record<string, unknown> = {}, space = 'chat') {
      const ctx = new Context()
      const log: Array<{ type: string; data: Record<string, unknown> }> = []
      const routes = [{ id: 'freetokens', models: ['auto'] }, company]
      ctx.provide('llm', {
        listConfigurableProviders: () => routes.map(route => ({ provider: route.id, settingsNs: route.id, settingsPath: [] })),
        listModels: (provider: string) => Promise.resolve((routes.find(route => route.id === provider)?.models ?? []).map(id => ({ id,
          name: id }))),
        resolveModelInfo: () => Promise.resolve({}),
      })
      const providers = { freetokens: { baseURL: 'http://127.0.0.1:3213/v1', models: [{ id: 'auto' }] } }
      ctx.provide('settings', { get: () => ({ apiKeyEnv: 'THE_KEY', providers }), update: () => Promise.resolve(), register: () => () => {} })
      ctx.provide('credentials', { resolve: () => Promise.resolve({ value: 'stored' }) })
      await ctx.plugin({ name: 'idealize-router', inject: [], apply }, { useJev: false, ...config })
      await new Promise(resolve => setTimeout(resolve, 0))
      const session = {
        header: { id: 'session-free' },
        events: [{ type: 'idealize/space', data: { space } }] as Array<{ type: string; data: Record<string, unknown> }>,
        append: (type: string, data: Record<string, unknown>) => {
          log.push({ type, data })
          session.events.push({ type, data })
        },
      }
      const signal = new AbortController().signal
      const request = (turn = 1) => ctx.waterfall('agent/request', { agent: { session }, turn, step: 1, signal } as never, () => Promise.resolve(onFree as never))
      return { ctx, log, request }
    }

    it('moves to the connected key before the request goes out, even with free-only switches on', async () => {
      emptyEngine([])
      const chat = await mountOnFree({ preferFree: true })
      expect(await chat.request()).toMatchObject({ provider: 'openrouter', model: 'moonshotai/kimi-k3' })
      expect(chat.log[0]?.data).toMatchObject({
        outcome: 'switched', from: { label: 'Free tokens' }, to: { provider: 'openrouter' },
        rationale: expect.stringMatching(/^Free tokens has no keys, so .* took the turn\./) as string,
      })
    })

    it('rescues an image chat as well, whose own conversation needs a model too', async () => {
      emptyEngine([])
      const chat = await mountOnFree({ preferFree: true }, 'gallery')
      expect(await chat.request()).toMatchObject({ provider: 'openrouter', model: 'moonshotai/kimi-k3' })
    })

    it('leaves a terminal chat alone', async () => {
      emptyEngine([])
      const chat = await mountOnFree({ preferFree: true }, 'terminal')
      expect(await chat.request()).toMatchObject(onFree)
    })

    it('stays on Free tokens while the engine holds a key', async () => {
      emptyEngine([{ enabled: true, status: 'healthy' }])
      const chat = await mountOnFree()
      expect(await chat.request()).toMatchObject(onFree)
      expect(chat.log).toEqual([])
    })

    it('gives Auto the connected model', async () => {
      emptyEngine([])
      const chat = await mountOnFree()
      const router = chat.ctx.get('idealizeRouter') as { bestConnected: () => Promise<unknown> }
      await expect(router.bestConnected()).resolves.toEqual({ provider: 'openrouter', model: 'moonshotai/kimi-k3' })
    })

    it('leaves the chat alone with the router switched off', async () => {
      emptyEngine([])
      const chat = await mountOnFree({ enabled: false })
      expect(await chat.request()).toMatchObject(onFree)
    })
  })

  it('moves past a stand-in that refuses the chat’s history, without marking it down', async () => {
    const chat = await mount({}, [], [{ id: 'openai', models: ['gpt-5.5'] }, { id: 'openrouter', models: ['openai/gpt-5.5'] }])
    await chat.request()
    expect(await chat.fail('MISSING_CREDENTIAL')).toEqual({ kind: 'retry' })
    const first = await chat.request() as { provider: string }
    expect(await chat.fail('INVALID_REQUEST')).toEqual({ kind: 'retry' })
    const second = await chat.request() as { provider: string }
    expect(second.provider).not.toBe(first.provider)
    await expect(readFile(join(home, 'router-refused.json'), 'utf8')).rejects.toThrow()
  })

  it('leaves out a stand-in the route could not run, as it does a routed model', async () => {
    const chat = await mount({}, [], [{ id: 'openai', models: ['gpt-5.5'] }, { id: 'openrouter', models: ['openai/gpt-5.5'] }])
    await chat.request()
    await chat.fail('MISSING_CREDENTIAL')
    const first = await chat.request() as { provider: string; model: string }
    expect(await chat.fail('PI_AI_ERROR')).toEqual({ kind: 'retry' })
    const refused = JSON.parse(await readFile(join(home, 'router-refused.json'), 'utf8')) as Record<string, number>
    expect(Object.keys(refused)).toEqual([`${first.provider}/${first.model}`])
  })

  it('lets the turn fail when a stand-in fails and nothing else is connected', async () => {
    const chat = await mount()
    await chat.request()
    expect(await chat.fail('MISSING_CREDENTIAL')).toEqual({ kind: 'retry' })
    await chat.request()
    expect(await chat.fail('SERVER')).toBeUndefined()
  })

  it('waits for the retry policy, and steps in only once it gives up', async () => {
    const chat = await mount()
    await chat.request()
    const policy = vi.fn(() => ({ kind: 'retry' }))
    expect(await chat.fail('RATE_LIMIT', policy)).toEqual({ kind: 'retry' })
    expect(policy).toHaveBeenCalledOnce()
    expect(chat.log).toEqual([])
    expect(await chat.fail('RATE_LIMIT')).toEqual({ kind: 'retry' })
    expect(chat.log).toHaveLength(1)
  })

  it('leaves a dropped connection, a locked chat and a router switched off to fail as before', async () => {
    const dropped = await mount()
    await dropped.request()
    expect(await dropped.fail('TRANSPORT')).toBeUndefined()

    const locked = await mount({}, [{ type: 'idealize/router-lock', data: { locked: true } }])
    await locked.request()
    expect(await locked.fail('MISSING_CREDENTIAL')).toBeUndefined()

    const off = await mount({ enabled: false })
    await off.request()
    expect(await off.fail('MISSING_CREDENTIAL')).toBeUndefined()
    expect([...dropped.log, ...locked.log, ...off.log]).toEqual([])
  })
})

describe('a video chat holding a picture its model cannot see', () => {
  let home: string
  const saved = process.env.DSH_HOME
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'idealize-router-sight-'))
    process.env.DSH_HOME = home
  })
  afterEach(async () => {
    if (saved === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = saved
    await rm(home, { recursive: true, force: true })
  })

  async function mountVideo(withPicture: boolean, models: Record<string, { id: string; inputModalities: string[] }[]>, onModel = { provider: 'deepseek', model: 'deepseek-v4-flash' }) {
    const ctx = new Context()
    const log: Array<{ type: string; data: Record<string, unknown> }> = []
    ctx.provide('llm', {
      listProviders: () => Object.keys(models).map(id => ({ id })),
      listConfigurableProviders: () => Object.keys(models).map(provider => ({ provider, settingsNs: provider, settingsPath: [] })),
      listModels: (provider: string) => Promise.resolve(models[provider] ?? []),
      resolveModelInfo: () => Promise.resolve({}),
    })
    ctx.provide('settings', { get: () => ({ apiKeyEnv: 'THE_KEY' }), update: () => Promise.resolve(), register: () => () => {} })
    ctx.provide('credentials', { resolve: () => Promise.resolve({ value: 'stored' }) })
    await ctx.plugin({ name: 'idealize-router', inject: [], apply }, { useJev: false, preferFree: false })
    await new Promise(resolve => setTimeout(resolve, 0))
    const picture = { type: 'image', attachment: { attachmentId: 'a', mediaType: 'image/png', bytes: 1, width: 1, height: 1 } }
    const session = {
      header: { id: 'session-video' },
      events: [
        { type: 'idealize/space', data: { space: 'motion' } },
        { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'animate this' }, ...withPicture ? [picture] : []] } },
      ] as Array<{ type: string; data: Record<string, unknown> }>,
      append: (type: string, data: Record<string, unknown>) => {
        log.push({ type, data })
        session.events.push({ type, data })
      },
    }
    const signal = new AbortController().signal
    const request = () => ctx.waterfall('agent/request', { agent: { session }, turn: 1, step: 1, signal } as never, () => Promise.resolve(onModel as never))
    return { log, request }
  }

  const models = {
    deepseek: [{ id: 'deepseek-v4-flash', inputModalities: ['text'] }],
    openrouter: [{ id: 'deepseek/deepseek-v4-flash', inputModalities: ['text'] }, { id: 'openai/gpt-5.4-mini', inputModalities: ['text', 'image'] }],
  }

  it('moves within the account before the request, so the picture never reaches a model that would refuse it', async () => {
    const chat = await mountVideo(true, models, { provider: 'openrouter', model: 'deepseek/deepseek-v4-flash' })
    expect(await chat.request()).toMatchObject({ provider: 'openrouter', model: 'openai/gpt-5.4-mini' })
    expect(chat.log[0]?.data).toMatchObject({
      outcome: 'switched', rationale: expect.stringContaining('can\'t see the pictures in this chat') as string,
    })
  })

  it('offers a model at another company that can see it, as any rescue would', async () => {
    const chat = await mountVideo(true, models)
    expect(await chat.request()).toMatchObject({ provider: 'deepseek', model: 'deepseek-v4-flash' })
    expect(chat.log[0]?.data).toMatchObject({ outcome: 'offer', to: { provider: 'openrouter', model: 'openai/gpt-5.4-mini' } })
  })

  it('leaves a video chat with no picture where it is', async () => {
    const chat = await mountVideo(false, models)
    expect(await chat.request()).toMatchObject({ provider: 'deepseek', model: 'deepseek-v4-flash' })
    expect(chat.log).toEqual([])
  })
})
