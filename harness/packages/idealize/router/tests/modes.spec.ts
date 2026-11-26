import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { apply } from '../src/index.ts'

/** The chat's own model, and the two models OpenRouter lists beside it: one of its company and a stronger one of another. */
const mini = { provider: 'openrouter', model: 'openai/gpt-5.4-mini' }
const gpt = { provider: 'openrouter', model: 'openai/gpt-5.5' }
const opus = { provider: 'openrouter', model: 'anthropic/claude-opus-5' }
const listed = [
  { id: mini.model, name: 'GPT-5.4 mini' },
  { id: gpt.model, name: 'GPT-5.5' },
  { id: opus.model, name: 'Claude Opus 5' },
]
const hard = `Refactor this TypeScript module and debug the failing unit tests. ${'It has many parts. '.repeat(60)}`

type Handler = (req: unknown, res: unknown) => Promise<void>
interface Reply { status: number; body: Record<string, unknown> }
interface Logged { type: string; data: Record<string, unknown> }

describe('the router under the chip’s settings', () => {
  let home: string
  const saved = process.env.DSH_HOME
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'idealize-router-modes-'))
    process.env.DSH_HOME = home
  })
  afterEach(async () => {
    if (saved === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = saved
    await rm(home, { recursive: true, force: true })
  })

  /** Mount the router with OpenRouter connected, and hand back one chat and the routes to drive it with. */
  async function mount(config: object = {}, options: { events?: Logged[]; defaultModel?: boolean; header?: object } = {}) {
    const ctx = new Context()
    const handlers = new Map<string, Handler>()
    const updates: unknown[] = []
    const log: Logged[] = []
    ctx.provide('llm', {
      listProviders: () => [{ id: 'openrouter' }],
      listConfigurableProviders: () => [{ provider: 'openrouter', settingsNs: 'openrouter', settingsPath: [] }],
      listModels: () => Promise.resolve(listed),
      resolveModelInfo: () => Promise.resolve({}),
    })
    ctx.provide('settings', {
      get: () => ({ apiKeyEnv: 'THE_KEY' }),
      update: (_ns: string, patch: unknown) => {
        updates.push(patch)
        return Promise.resolve()
      },
      register: () => () => {},
    })
    ctx.provide('credentials', { resolve: () => Promise.resolve({ value: 'stored' }) })
    ctx.provide('webServer', {
      register: (route: { path: string; handler: Handler }) => {
        handlers.set(route.path, route.handler)
        return () => {}
      },
    })
    const session = {
      header: { id: 'chat-one' },
      events: [{ type: 'idealize/space', data: { space: 'chat' } }, ...options.events ?? []] as Logged[],
      append: (type: string, data: Record<string, unknown>) => {
        log.push({ type, data })
        session.events.push({ type, data })
      },
      requestHeader: () => options.header,
    }
    ctx.provide('sessions', { get: (id: string) => (id === 'chat-one' ? session : undefined) })
    if (options.defaultModel !== false) ctx.provide('agentDefaultModel', { currentSelection: () => opus })
    await ctx.plugin({ name: 'idealize-router', inject: [], apply }, { useJev: false, preferFree: false, aggressiveness: 'aggressive', lean: 100, ...config })
    await new Promise(resolve => setTimeout(resolve, 0))

    const agent = { session }
    const signal = new AbortController().signal
    /** One turn the person opened with a hard coding ask, on the chat's own model. */
    const turn = async (number = 1) => {
      const asked = { kind: 'enter', messages: [{ source: { kind: 'user' }, content: [{ type: 'text', text: hard }] }] }
      await ctx.waterfall('agent/pre-step', { agent, turn: number } as never, () => Promise.resolve(asked as never))
      return ctx.waterfall('agent/request', { agent, turn: number, step: 1, signal } as never, () => Promise.resolve(mini as never))
    }
    const call = async (path: string, body?: object): Promise<Reply> => {
      const [route] = path.split('?')
      const handler = handlers.get(route ?? path)
      if (handler === undefined) throw new Error(`no route ${path}`)
      const req = Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]), {
        headers: { 'host': '127.0.0.1:4321', 'x-idealize-auth': '1' }, url: path, method: body === undefined ? 'GET' : 'POST',
      })
      const reply: Reply = { status: 0, body: {} }
      const res = {
        writeHead(status: number) {
          reply.status = status
          return res
        },
        end(text: string) {
          reply.body = JSON.parse(text) as Record<string, unknown>
        },
      }
      await handler(req, res)
      return reply
    }
    return { turn, call, log, updates, session }
  }

  describe('auto', () => {
    it('moves the chat to a better model of its own company, and passes over a stronger one elsewhere', async () => {
      const chat = await mount()
      expect(await chat.turn()).toMatchObject(gpt)
      expect(chat.log).toHaveLength(1)
      expect(chat.log[0]?.data).toMatchObject({ outcome: 'switched', from: { model: mini.model }, to: { model: gpt.model, label: 'GPT-5.5' } })
    })

    it('considers every company once the limit is off', async () => {
      const chat = await mount({ sameCompany: false })
      expect(await chat.turn()).toMatchObject(opus)
    })

    it('never moves to a model the person unticked', async () => {
      const chat = await mount({ excluded: ['openrouter/openai/gpt-5.5'] })
      expect(await chat.turn()).toMatchObject(mini)
      expect(chat.log).toEqual([])
    })

    it('routes a chat whose recorded preset an earlier version had switched off', async () => {
      const events = [{ type: 'idealize/brain', data: { brain: 'coding', instructions: '' } }]
      const chat = await mount({ offBrains: ['coding'], brains: { coding: { cost: 100, speed: 0, intelligence: 0 } } }, { events })
      expect(await chat.turn()).toMatchObject(gpt)
    })

    it('still honours the chat’s own lock', async () => {
      const chat = await mount({}, { events: [{ type: 'idealize/router-lock', data: { locked: true } }] })
      expect(await chat.turn()).toMatchObject(mini)
      expect(chat.log).toEqual([])
    })
  })

  describe('ask', () => {
    it('answers on the chat’s model and records the move as an offer', async () => {
      const chat = await mount({ mode: 'ask' })
      expect(await chat.turn()).toMatchObject(mini)
      expect(chat.log).toHaveLength(1)
      expect(chat.log[0]?.data).toMatchObject({ outcome: 'offer', reason: 'ask', from: { model: mini.model }, to: { model: gpt.model } })
    })

    it('records Stay as a declined offer, once', async () => {
      const chat = await mount({ mode: 'ask' })
      await chat.turn()
      expect(await chat.call('/idealize/router/reset', { sessionId: 'chat-one', decline: true })).toEqual({ status: 200, body: { ok: true, reset: false, declined: true } })
      expect(chat.log[1]?.data).toMatchObject({ outcome: 'declined', from: { model: mini.model }, to: { model: gpt.model } })
      expect((await chat.call('/idealize/router/reset', { sessionId: 'chat-one', decline: true })).body).toMatchObject({ declined: false })
      // A declined offer is answered: taking the model back afterwards finds nothing open.
      expect((await chat.call('/idealize/router/reset', { sessionId: 'chat-one' })).body).toEqual({ ok: true, reset: false })
      expect(chat.log).toHaveLength(2)
    })

    it('records Switch as the switch the person took', async () => {
      const chat = await mount({ mode: 'ask' })
      await chat.turn()
      expect((await chat.call('/idealize/router/reset', { sessionId: 'chat-one' })).body).toEqual({ ok: true, reset: true })
      expect(chat.log[1]?.data).toMatchObject({ outcome: 'switched', via: 'offer', to: { model: gpt.model } })
    })
  })

  describe('fixed', () => {
    it('neither moves the chat nor offers a move', async () => {
      const chat = await mount({ mode: 'fixed' })
      expect(await chat.turn()).toMatchObject(mini)
      expect(chat.log).toEqual([])
    })
  })

  describe('the settings route', () => {
    it('reports the mode, the slider and the unticked models beside the fields it had', async () => {
      const chat = await mount({ mode: 'ask', lean: 62, excluded: ['openrouter/openai/gpt-5.5'] })
      const { status, body } = await chat.call('/idealize/router/state')
      expect(status).toBe(200)
      expect(body.settings).toEqual({
        enabled: true, aggressiveness: 'aggressive', preferFree: false, showRationale: true, useJev: false, offBrains: [],
        mode: 'ask', lean: 62, excluded: ['openrouter/openai/gpt-5.5'], sameCompany: true,
      })
    })

    it('reports the defaults when nothing is stored', async () => {
      const chat = await mount({ lean: undefined })
      expect((await chat.call('/idealize/router/state')).body.settings).toMatchObject({ mode: 'auto', lean: 35, excluded: [], sameCompany: true })
    })

    it('writes a mode, a slider position held to a whole number from 0 to 100, and the unticked models', async () => {
      const chat = await mount()
      expect((await chat.call('/idealize/router/settings', { mode: 'fixed' })).status).toBe(200)
      expect((await chat.call('/idealize/router/settings', { lean: 140.2 })).status).toBe(200)
      expect((await chat.call('/idealize/router/settings', { excluded: ['openrouter/openai/gpt-5.5'], enabled: false })).status).toBe(200)
      expect(chat.updates).toEqual([{ mode: 'fixed' }, { lean: 100 }, { excluded: ['openrouter/openai/gpt-5.5'], enabled: false }])
    })

    it('turns routing back on when a person chooses Auto or Ask me, unless the same request says otherwise', async () => {
      const chat = await mount({ enabled: false })
      await chat.call('/idealize/router/settings', { mode: 'ask' })
      await chat.call('/idealize/router/settings', { mode: 'auto', enabled: false })
      expect(chat.updates).toEqual([{ mode: 'ask', enabled: true }, { mode: 'auto', enabled: false }])
    })

    it('refuses a body with nothing it can write', async () => {
      const chat = await mount()
      const { status, body } = await chat.call('/idealize/router/settings', { mode: 'sometimes', lean: 'high', excluded: [1] })
      expect(status).toBe(400)
      expect(body.error).toContain('mode, lean or excluded')
      expect(chat.updates).toEqual([])
    })
  })

  describe('the choices route', () => {
    const labels = (body: Record<string, unknown>) => (body.models as Array<{ label: string }>).map(model => model.label)

    it('lists the company of the chat’s own model, names the routed model as answering, and marks an unticked model', async () => {
      const chat = await mount({ lean: 100, excluded: ['openrouter/openai/gpt-5.4-mini'] })
      await chat.turn()
      const { status, body } = await chat.call('/idealize/router/choices?sessionId=chat-one')
      expect(status).toBe(200)
      expect(body).toMatchObject({ mode: 'auto', lean: 100, company: 'openai', answering: { ...gpt, label: 'GPT-5.5' } })
      expect(labels(body).sort()).toEqual(['GPT-5.4 mini', 'GPT-5.5'])
      expect(body.models).toEqual(expect.arrayContaining([
        expect.objectContaining({ ...gpt, allowed: true, answering: true }),
        expect.objectContaining({ ...mini, allowed: false, answering: false }),
      ]))
    })

    it('takes the chat’s own model from the chip, which knows it before the first turn', async () => {
      const chat = await mount()
      const { body } = await chat.call(`/idealize/router/choices?sessionId=chat-one&provider=openrouter&model=${encodeURIComponent(opus.model)}`)
      expect(body).toMatchObject({ company: 'anthropic', answering: { ...opus, label: 'Claude Opus 5' } })
      expect(labels(body)).toEqual(['Claude Opus 5'])
    })

    it('reads the chat’s logged request back through a switch that still holds', async () => {
      const switched = { type: 'idealize/router', data: { outcome: 'switched', at: '2026-11-25T10:00:00Z', from: { ...mini, label: 'GPT-5.4 mini' }, to: { ...gpt, label: 'GPT-5.5' } } }
      const held = await mount({}, { events: [switched], header: { config: gpt } })
      expect((await held.call('/idealize/router/choices?sessionId=chat-one')).body).toMatchObject({ company: 'openai', answering: gpt })
      const plain = await mount({}, { header: { config: opus } })
      expect((await plain.call('/idealize/router/choices?sessionId=chat-one')).body).toMatchObject({ company: 'anthropic', answering: opus })
    })

    it('falls to the model new chats start on with no chat, an unknown chat, or a chat that has asked nothing', async () => {
      const chat = await mount()
      for (const path of ['/idealize/router/choices', '/idealize/router/choices?sessionId=', '/idealize/router/choices?sessionId=nobody', '/idealize/router/choices?sessionId=chat-one&provider=openrouter']) {
        expect((await chat.call(path)).body).toMatchObject({ company: 'anthropic', answering: opus })
      }
    })

    it('reads routing switched off by an earlier version as Fixed', async () => {
      const chat = await mount({ enabled: false, mode: 'auto' })
      expect((await chat.call('/idealize/router/choices')).body).toMatchObject({ mode: 'fixed' })
    })

    it('says so when no model is chosen anywhere', async () => {
      const chat = await mount({}, { defaultModel: false })
      expect(await chat.call('/idealize/router/choices')).toEqual({ status: 409, body: { error: 'no model is chosen yet' } })
    })
  })
})
