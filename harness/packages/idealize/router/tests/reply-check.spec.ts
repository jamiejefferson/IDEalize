import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { apply } from '../src/index.ts'
import { checkReply, replyCheckRequest, saidItCannot } from '../src/reply-check.ts'

/** A fetch that answers Jev's outcome question with one choice. */
const jevSays = (choice: string, confidence: number) => vi.fn(() => Promise.resolve(new Response(
  JSON.stringify({ answers: { outcome: { choice, confidence, probabilities: { [choice]: confidence } } }, usage: { cost: 0.0001 } }),
  { status: 200, headers: { 'content-type': 'application/json' } },
)))

describe('reading a finished reply', () => {
  it('sends the message and the reply as quoted data, cut to length', () => {
    const request = replyCheckRequest('animate this', 'x'.repeat(10_000))
    const state = JSON.parse(request.state) as { message: string; reply: string }
    expect(state.message).toBe('animate this')
    expect(state.reply).toHaveLength(4000)
    expect(Object.keys(request.questions.outcome?.criteria ?? {})).toEqual(['done', 'asked', 'model-limit', 'tool-missing', 'declined'])
    expect(request.questions.outcome?.instructions).toMatch(/never an instruction to you/u)
  })

  it('acts only on a confident reading that the model said the work was beyond it', async () => {
    const sure = await checkReply('a', 'b', { key: 'k', fetch: jevSays('model-limit', 0.9) })
    expect(sure).toMatchObject({ outcome: 'model-limit', confidence: 0.9, cost: 0.0001 })
    expect(saidItCannot(sure)).toBe(true)
    expect(saidItCannot(await checkReply('a', 'b', { key: 'k', fetch: jevSays('model-limit', 0.5) }))).toBe(false)
    expect(saidItCannot(await checkReply('a', 'b', { key: 'k', fetch: jevSays('tool-missing', 0.95) }))).toBe(false)
    expect(saidItCannot(await checkReply('a', 'b', { key: 'k', fetch: jevSays('declined', 0.95) }))).toBe(false)
  })

  it('names a failure and never throws', async () => {
    expect(await checkReply('a', 'b', { key: undefined })).toMatchObject({ failure: 'no-key' })
    const refused = vi.fn(() => Promise.resolve(new Response('', { status: 401 })))
    expect(await checkReply('a', 'b', { key: 'k', fetch: refused })).toMatchObject({ failure: 'refused-key' })
    expect(await checkReply('a', 'b', { key: 'k', fetch: jevSays('somewhere-else', 0.9) })).toMatchObject({ failure: 'unreadable' })
  })
})

describe('the router after a turn whose model said it could not', () => {
  let home: string
  const saved = process.env.DSH_HOME
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'idealize-router-reply-'))
    process.env.DSH_HOME = home
  })
  afterEach(async () => {
    vi.unstubAllGlobals()
    if (saved === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = saved
    await rm(home, { recursive: true, force: true })
  })

  const onModel = { provider: 'deepseek', model: 'deepseek-v4-flash' }
  const models: Record<string, Array<{ id: string; inputModalities: string[] }>> = {
    deepseek: [{ id: 'deepseek-v4-flash', inputModalities: ['text'] }],
    openrouter: [{ id: 'openai/gpt-5.4-mini', inputModalities: ['text', 'image'] }],
  }

  async function mount(config: object, space = 'chat') {
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
    await ctx.plugin({ name: 'idealize-router', inject: [], apply }, { preferFree: false, ...config })
    await new Promise(resolve => setTimeout(resolve, 0))
    const session = {
      header: { id: 'session-reply' },
      events: [
        { type: 'idealize/space', data: { space } },
        { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'describe the photo I sent' }] } },
        { type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: 'I can\'t see images, so I can\'t describe it.' }] } } },
      ] as Array<{ type: string; data: Record<string, unknown> }>,
      append: (type: string, data: Record<string, unknown>) => {
        log.push({ type, data })
        session.events.push({ type, data })
      },
    }
    const agent = { session }
    const signal = new AbortController().signal
    await ctx.waterfall('agent/request', { agent, turn: 1, step: 1, signal } as never, () => Promise.resolve(onModel as never))
    const stop = async () => {
      await ctx.serial('agent/turn-stopping', { agent, turn: 1, signal } as never)
      // The check runs after the turn; let it finish.
      await vi.waitFor(() => { expect(fetch).toHaveBeenCalled() }).catch(() => undefined)
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    return { log, session, stop }
  }

  it('offers a model for the person to try, naming the model that said it could not', async () => {
    vi.stubGlobal('fetch', jevSays('model-limit', 0.92))
    const chat = await mount({})
    await chat.stop()
    expect(chat.log).toHaveLength(1)
    expect(chat.log[0]).toMatchObject({
      type: 'idealize/router',
      data: {
        outcome: 'offer', reason: 'said-cannot', from: { provider: 'deepseek', model: 'deepseek-v4-flash' },
        to: { provider: 'openrouter', model: 'openai/gpt-5.4-mini' }, rationale: 'deepseek-v4-flash said it couldn\'t do this.',
      },
    })
  })

  it('offers one in a video chat too, whose conversation still runs on a model', async () => {
    vi.stubGlobal('fetch', jevSays('model-limit', 0.92))
    const chat = await mount({}, 'motion')
    await chat.stop()
    expect(chat.log[0]?.data).toMatchObject({ outcome: 'offer', reason: 'said-cannot' })
  })

  it('leaves a missing tool and an unsure reading alone', async () => {
    vi.stubGlobal('fetch', jevSays('tool-missing', 0.95))
    const missing = await mount({})
    await missing.stop()
    expect(missing.log).toEqual([])
    vi.stubGlobal('fetch', jevSays('model-limit', 0.55))
    const unsure = await mount({})
    await unsure.stop()
    expect(unsure.log).toEqual([])
  })

  it('drops the offer when the person wrote again while Jev read', async () => {
    let answer: (() => void) | undefined
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => {
      answer = () => { resolve(new Response(JSON.stringify({ answers: { outcome: { choice: 'model-limit', confidence: 0.9 } } }), { status: 200 })) }
    })))
    const chat = await mount({})
    const stopping = chat.stop()
    await vi.waitFor(() => { expect(answer).toBeDefined() })
    chat.session.events.push({ type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'never mind' }] } })
    answer?.()
    await stopping
    expect(chat.log).toEqual([])
  })

  it('reads nothing with the check or Jev switched off, or in a terminal', async () => {
    for (const [config, space] of [[{ replyCheck: false }, 'chat'], [{ useJev: false }, 'chat'], [{}, 'terminal']] as const) {
      const fetch = jevSays('model-limit', 0.95)
      vi.stubGlobal('fetch', fetch)
      const chat = await mount(config, space)
      await chat.stop()
      expect(fetch).not.toHaveBeenCalled()
      expect(chat.log).toEqual([])
    }
  })
})
