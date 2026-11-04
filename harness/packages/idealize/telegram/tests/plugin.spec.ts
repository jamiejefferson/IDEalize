/**
 * The plugin's wiring over hand-built services, for the compositions the
 * Loader spec does not boot: no credential or settings store, a store that
 * refuses writes, Telegram unreachable while a token is checked, the
 * approvals stream and the bridge feed composed, and the settings watch that
 * re-offers pending requests. Telegram is a stubbed `fetch`.
 */

import { EventEmitter } from 'node:events'
import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PAIR_REPLIES } from '../src/format.ts'
import type { TelegramStatus } from '../src/settings.ts'
import { apply, Config, CONFIRM_PATH, PAIR_PATH, problemText, STATUS_PATH, TOKEN_ENV, TOKEN_PATH } from '../src/index.ts'
import { TELEGRAM_DEFAULTS, type TelegramSettings } from '../src/settings.ts'

type Handler = (req: FakeRequest, res: FakeResponse) => Promise<void>

class FakeRequest extends EventEmitter {
  headers: Record<string, string>
  constructor(public method: string, private readonly body = '') {
    super()
    this.headers = { host: '127.0.0.1:4000', 'x-idealize-auth': '1' }
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<Buffer> {
    if (this.body !== '') yield Buffer.from(this.body)
  }
}

class FakeResponse {
  status = 0
  body = ''
  writeHead(status: number) { this.status = status; return this }
  end(chunk?: string) { if (chunk !== undefined) this.body += chunk }
}

const TOKEN = '123456:test-token'
const contexts: Context[] = []

afterEach(async () => {
  for (const context of contexts.splice(0)) await context.fiber.dispose()
  vi.unstubAllGlobals()
})

interface TelegramFlags {
  getMeDown: boolean
  sendFails: boolean
}

/** Telegram as a stubbed global fetch: queued updates, recorded sends. */
function stubTelegram(flagsIn: Partial<TelegramFlags> = {}) {
  const flags: TelegramFlags = { getMeDown: false, sendFails: false, ...flagsIn }
  const state = { flags, updates: [] as unknown[], sent: [] as { chat_id: string; text: string }[] }
  const ok = (result: unknown): Response => new Response(JSON.stringify({ ok: true, result }))
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
    const method = href.slice(href.lastIndexOf('/') + 1)
    const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, unknown>
    if (method === 'getMe') {
      if (flags.getMeDown) throw new TypeError('fetch failed')
      return ok({ id: 1, username: 'idealize_bot' })
    }
    if (method === 'getUpdates') {
      const ready = state.updates.splice(0)
      if (ready.length > 0) return ok(ready)
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 10)
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(timer)
          reject(new Error('aborted'))
        }, { once: true })
      })
      return ok([])
    }
    if (method === 'sendMessage') {
      if (flags.sendFails) return new Response(JSON.stringify({ ok: false, error_code: 400, description: 'chat not found' }), { status: 400 })
      state.sent.push({ chat_id: String(body.chat_id), text: String(body.text) })
      return ok({ message_id: state.sent.length })
    }
    return ok(true)
  }))
  return state
}

interface MountOptions {
  credentials?: false | { token?: string; setThrows?: boolean; unsetThrows?: boolean }
  settings?: false | Partial<TelegramSettings>
  comm?: boolean
  studio?: { stateThrows?: unknown }
  agents?: boolean
  apiProxy?: boolean
  bridge?: boolean
}

async function mount(options: MountOptions = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  const handlers = new Map<string, Handler>()
  ctx.provide('webServer', {
    register(route: { path: string; handler: Handler }) {
      handlers.set(route.path, route.handler)
      return () => { handlers.delete(route.path) }
    },
  } as never)

  const stored = new Map<string, string>()
  if (options.credentials !== false) {
    const flags = options.credentials ?? {}
    if (flags.token !== undefined) stored.set(TOKEN_ENV, flags.token)
    ctx.provide('credentials', {
      resolve: async (ref: string) => (stored.has(ref) ? { value: stored.get(ref), source: 'file' } : undefined),
      describe: async (ref: string) => ({ configured: stored.has(ref), writable: true }),
      set: async (ref: string, value: string) => {
        if (flags.setThrows === true) throw new Error('the environment sets IDEALIZE_TELEGRAM_BOT_TOKEN')
        stored.set(ref, value)
      },
      unset: async (ref: string) => {
        if (flags.unsetThrows === true) throw new Error('the environment sets IDEALIZE_TELEGRAM_BOT_TOKEN')
        stored.delete(ref)
      },
    } as never)
  }

  let settings: TelegramSettings = { ...TELEGRAM_DEFAULTS, ...options.settings === false ? {} : options.settings }
  let watcher: ((next: TelegramSettings, prev: TelegramSettings) => void) | undefined
  if (options.settings !== false) {
    ctx.provide('settings', {
      register: () => ({
        get: () => settings,
        update: async (patch: Partial<TelegramSettings>) => {
          const prev = settings
          settings = { ...settings, ...patch }
          watcher?.(settings, prev)
        },
        watch: (callback: typeof watcher) => {
          watcher = callback
          return () => { watcher = undefined }
        },
      }),
    } as never)
  }

  const posts: string[] = []
  const cancels: string[] = []
  if (options.studio !== undefined) {
    const studio = options.studio
    ctx.provide('idealizeStudio', {
      postFromChat: async (text: string) => {
        posts.push(text)
        return { kind: 'delivered', target: 's-bo', project: 'studio', delivery: 'delivered' }
      },
      overview: async () => [],
      state: async () => {
        if (studio.stateThrows !== undefined) throw studio.stateThrows
        return { tasks: [], agents: {}, deliveries: {} }
      },
    } as never)
  }
  if (options.comm === true) {
    ctx.provide('idealizeComm', { roster: async () => [{ id: 's-ada', name: 'Ada', label: 'Site', role: 'project-agent', running: true }] } as never)
  }
  if (options.agents === true) {
    ctx.provide('agents', { get: (id: string) => (id === 's-ada' ? { status: 'running', cancel: () => { cancels.push(id) } } : undefined) } as never)
  }
  const opens = vi.fn()
  if (options.apiProxy === true) {
    ctx.provide('apiProxy', {
      events: {
        mux: (_request: unknown, signal: AbortSignal) => {
          opens()
          return (async function* () {
            yield {
              rpcId: 'r-1',
              payload: { type: 'approval/requested', sessionId: 's-ada', approvalId: 'ap-1', toolName: 'bash' },
            }
            await new Promise((_resolve, reject) => {
              signal.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
            })
          })()
        },
      },
      respond: async () => ({ accepted: true }),
    } as never)
  }
  let bridgeListener: ((event: unknown) => void) | undefined
  if (options.bridge === true) {
    ctx.provide('idealizeBridge', {
      buffer: {
        subscribe: (listener: (event: unknown) => void) => {
          bridgeListener = listener
          return () => { bridgeListener = undefined }
        },
      },
    } as never)
  }

  apply(ctx, Config({ holdSeconds: 1, retryDelaysMs: [10], muxReopenDelayMs: 10 } as Config))
  await settle()

  const call = async (method: string, path: string, body?: unknown) => {
    const res = new FakeResponse()
    await handlers.get(path)?.(new FakeRequest(method, body === undefined ? '' : JSON.stringify(body)), res)
    return { status: res.status, body: JSON.parse(res.body) as Record<string, unknown> }
  }
  return {
    ctx, call, stored, posts, cancels, opens,
    settings: () => settings,
    update: (patch: Partial<TelegramSettings>) => watcher?.({ ...settings, ...patch }, settings),
    bridge: (event: unknown) => { bridgeListener?.(event) },
  }
}

const settle = (ms = 30) => new Promise(resolve => setTimeout(resolve, ms))

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !check(); i += 1) await settle(5)
  expect(check()).toBe(true)
}

const update = (id: number, text: string) => ({
  update_id: id,
  message: { message_id: id, date: Math.floor(Date.now() / 1000), chat: { id: 42, type: 'private' }, from: { id: 42 }, text },
})

describe('problemText', () => {
  it('puts each poller problem in plain words', () => {
    expect(problemText(undefined)).toBe('')
    expect(problemText({ kind: 'no-token' })).toBe('')
    expect(problemText({ kind: 'conflict' })).toBe('Another copy of IDEalize is using this bot, so this one is not receiving messages.')
    expect(problemText({ kind: 'unauthorized', message: 'Unauthorized' })).toBe('Telegram rejected the bot token. Paste a new one from @BotFather.')
    expect(problemText({ kind: 'failed', message: 'x' })).toBe('Telegram could not be reached. The app keeps retrying.')
  })
})

describe('a composition without stores', () => {
  it('reports nothing configured and refuses to save or pair', async () => {
    stubTelegram()
    const { call } = await mount({ credentials: false, settings: false })
    expect((await call('GET', STATUS_PATH)).body).toMatchObject({ configured: false, shadowed: false, paired: false })
    expect(await call('POST', TOKEN_PATH, { token: TOKEN })).toEqual({
      status: 503, body: { error: 'No credential store is composed, so the token cannot be saved.' },
    })
    expect((await call('POST', PAIR_PATH)).body).toEqual({ error: 'Save a bot token first.' })
  })
})

describe('the token and pairing routes', () => {
  it('reports a store that refuses the write, and Telegram unreachable during the check', async () => {
    const telegram = stubTelegram({ getMeDown: true })
    const refusing = await mount({ credentials: { setThrows: true, unsetThrows: true }, settings: false })
    expect(await refusing.call('POST', TOKEN_PATH, { token: '' })).toEqual({
      status: 409, body: { error: 'the environment sets IDEALIZE_TELEGRAM_BOT_TOKEN' },
    })
    expect(await refusing.call('POST', TOKEN_PATH, { token: TOKEN })).toEqual({
      status: 502, body: { error: 'Telegram could not be reached to check the token. Try again.' },
    })
    telegram.flags.getMeDown = false
    expect((await refusing.call('POST', TOKEN_PATH, { token: TOKEN })).status).toBe(200)
    expect(await refusing.call('POST', CONFIRM_PATH, { what: 'token', allow: true })).toEqual({
      status: 409, body: { error: 'the environment sets IDEALIZE_TELEGRAM_BOT_TOKEN' },
    })
  })

  it('refuses to pair without a settings store, and unpairs harmlessly', async () => {
    stubTelegram()
    const { call } = await mount({ credentials: { token: TOKEN }, settings: false })
    expect(await call('POST', PAIR_PATH)).toEqual({
      status: 503, body: { error: 'No settings store is composed, so a pairing cannot be kept.' },
    })
    expect((await call('DELETE', PAIR_PATH)).status).toBe(200)
  })

  it('answers a /pair message with "no code" when nothing can keep the pairing', async () => {
    const telegram = stubTelegram({ getMeDown: true })
    const { ctx } = await mount({ credentials: { token: TOKEN }, settings: false })
    ctx.emit('credentials/updated', credentialRef('SOME_OTHER_KEY'))
    ctx.emit('credentials/updated', credentialRef(TOKEN_ENV))
    telegram.updates.push({ ...update(1, '/pair 123456'), message: { ...update(1, '').message, chat: { id: 99, type: 'private' }, from: { id: 99 }, text: '/pair 123456' } })
    await until(() => telegram.sent.some(sent => sent.chat_id === '99' && sent.text === PAIR_REPLIES['no-code']))
  })
})

describe('confirmation in the app window', () => {
  it('does not store a token until the person allows it, and never shows the token', async () => {
    stubTelegram()
    const { call, ctx } = await mount({ credentials: {}, settings: {} })
    const waiting = await call('POST', TOKEN_PATH, { token: TOKEN })
    expect(waiting.body).toMatchObject({ configured: false, confirmToken: { botUsername: 'idealize_bot' } })
    expect(JSON.stringify(waiting.body)).not.toContain(TOKEN)
    expect(await ctx.get('credentials')?.resolve(credentialRef(TOKEN_ENV))).toBeUndefined()

    const allowed = await call('POST', CONFIRM_PATH, { what: 'token', allow: true })
    expect(allowed.body).toMatchObject({ configured: true })
    expect((allowed.body as { confirmToken?: unknown }).confirmToken).toBeUndefined()
    expect((await ctx.get('credentials')?.resolve(credentialRef(TOKEN_ENV)))?.value).toBe(TOKEN)
  })

  it('drops a declined token', async () => {
    stubTelegram()
    const { call, ctx } = await mount({ credentials: {}, settings: {} })
    await call('POST', TOKEN_PATH, { token: TOKEN })
    expect((await call('POST', CONFIRM_PATH, { what: 'token', allow: false })).body).toMatchObject({ configured: false })
    expect(await ctx.get('credentials')?.resolve(credentialRef(TOKEN_ENV))).toBeUndefined()
    expect((await call('POST', CONFIRM_PATH, { what: 'token', allow: true })).status).toBe(409)
  })

  it('ends the pairing when the token changes to a different bot, and keeps it for the same bot', async () => {
    stubTelegram()
    const run = await mount({ credentials: { token: TOKEN }, settings: { chatId: '42', userId: '42' } })
    await run.call('POST', TOKEN_PATH, { token: '123456:rotated-token' })
    await run.call('POST', CONFIRM_PATH, { what: 'token', allow: true })
    expect(run.settings().chatId).toBe('42')
    await run.call('POST', TOKEN_PATH, { token: '777777:another-bot' })
    await run.call('POST', CONFIRM_PATH, { what: 'token', allow: true })
    expect(run.settings()).toMatchObject({ chatId: '', userId: '' })
  })

  it('binds nobody until the person allows who sent the code, then stores the user id', async () => {
    const telegram = stubTelegram()
    const run = await mount({ credentials: { token: TOKEN }, settings: {} })
    const code = ((await run.call('POST', PAIR_PATH)).body as unknown as TelegramStatus).pairing?.code as string
    telegram.updates.push({
      update_id: 1,
      message: { message_id: 1, date: Math.floor(Date.now() / 1000), chat: { id: 42, type: 'private' }, from: { id: 42, username: 'jj' }, text: `/pair ${code}` },
    })
    await until(() => telegram.sent.some(sent => sent.chat_id === '42' && sent.text === PAIR_REPLIES.confirm))
    expect(run.settings().chatId).toBe('')
    expect((await run.call('GET', STATUS_PATH)).body).toMatchObject({ paired: false, confirmPairing: { name: '@jj' } })

    expect((await run.call('POST', CONFIRM_PATH, { what: 'pairing', allow: true })).body).toMatchObject({ paired: true })
    expect(run.settings()).toMatchObject({ chatId: '42', userId: '42' })
    expect(telegram.sent.some(sent => sent.chat_id === '42' && sent.text === PAIR_REPLIES.paired)).toBe(true)
  })

  it('tells someone declined, and binds nobody', async () => {
    const telegram = stubTelegram()
    const run = await mount({ credentials: { token: TOKEN }, settings: {} })
    const code = ((await run.call('POST', PAIR_PATH)).body as unknown as TelegramStatus).pairing?.code as string
    telegram.updates.push({
      update_id: 1,
      message: { message_id: 1, date: Math.floor(Date.now() / 1000), chat: { id: 66, type: 'private' }, from: { id: 66 }, text: `/pair ${code}` },
    })
    await until(() => telegram.sent.some(sent => sent.chat_id === '66' && sent.text === PAIR_REPLIES.confirm))
    await run.call('POST', CONFIRM_PATH, { what: 'pairing', allow: false })
    expect(run.settings().chatId).toBe('')
    expect(telegram.sent.some(sent => sent.chat_id === '66' && sent.text === PAIR_REPLIES.declined)).toBe(true)
  })

  it('refuses a malformed confirmation', async () => {
    stubTelegram()
    const { call } = await mount({ credentials: {}, settings: {} })
    expect((await call('POST', CONFIRM_PATH, { what: 'other', allow: true })).status).toBe(400)
    expect((await call('POST', CONFIRM_PATH, { what: 'token', allow: 'yes' })).status).toBe(400)
  })
})

describe('a pairing stored before the user id was kept', () => {
  it('keeps working from a private chat with no change for the person', async () => {
    const telegram = stubTelegram()
    const run = await mount({ credentials: { token: TOKEN }, settings: { chatId: '42' }, comm: true, studio: {}, agents: true })
    expect((await run.call('GET', STATUS_PATH)).body).toMatchObject({ paired: true, problem: '' })
    telegram.updates.push(update(1, '/help'))
    await until(() => telegram.sent.some(sent => sent.chat_id === '42'))
  })

  it('stops listening to and sending to a group, and says how to fix it', async () => {
    const telegram = stubTelegram()
    const run = await mount({ credentials: { token: TOKEN }, settings: { chatId: '-100' }, comm: true, studio: {}, agents: true })
    const body = (await run.call('GET', STATUS_PATH)).body as unknown as TelegramStatus
    expect(body.paired).toBe(false)
    expect(body.problem).toContain('private chat')
    telegram.updates.push({
      update_id: 1,
      message: { message_id: 1, date: Math.floor(Date.now() / 1000), chat: { id: -100, type: 'group' }, from: { id: 5 }, text: '/help' },
    })
    await settle(100)
    expect(telegram.sent).toEqual([])
  })
})

describe('pairing from the phone', () => {
  it('keeps the chat unpaired when no code is live', async () => {
    const telegram = stubTelegram()
    const run = await mount({ credentials: { token: TOKEN }, settings: {} })
    telegram.updates.push(update(1, '/pair 000000'))
    await until(() => telegram.sent.some(sent => sent.chat_id === '42' && sent.text === PAIR_REPLIES['no-code']))
    expect(run.settings().chatId).toBe('')
  })
})

describe('a full composition', () => {
  it('posts text to the Studio and resolves /stop through comm and the agent registry', async () => {
    const telegram = stubTelegram()
    const run = await mount({ credentials: { token: TOKEN }, settings: { chatId: '42' }, comm: true, studio: {}, agents: true })
    telegram.updates.push(update(1, 'hello'), update(2, '/stop Ada'))
    await until(() => run.posts.includes('hello') && telegram.sent.some(sent => sent.text === 'Stop Ada? It keeps its queued messages.'))
  })

  it('sends pending approvals to the paired chat, named by id when comm is absent', async () => {
    const telegram = stubTelegram()
    const run = await mount({ credentials: { token: TOKEN }, settings: { chatId: '42' }, apiProxy: true })
    await until(() => telegram.sent.some(sent => sent.chat_id === '42' && sent.text === 's-ada wants to run bash.'))
    expect(run.opens).toHaveBeenCalledTimes(1)

    run.update({ forwardTaskEndings: false })
    await settle()
    expect(run.opens).toHaveBeenCalledTimes(1)
    run.update({ forwardApprovals: false })
    await until(() => run.opens.mock.calls.length === 2)
    run.update({ chatId: '43' })
    await until(() => run.opens.mock.calls.length === 3)
  })

  it('holds approvals back while no chat is paired', async () => {
    const telegram = stubTelegram()
    const run = await mount({ credentials: { token: TOKEN }, settings: {}, apiProxy: true })
    await until(() => run.opens.mock.calls.length === 1)
    await settle()
    expect(telegram.sent).toEqual([])
  })

  it('forwards bridge alerts and survives sends that fail', async () => {
    const telegram = stubTelegram()
    const run = await mount({ credentials: { token: TOKEN }, settings: { chatId: '42' }, bridge: true, studio: { stateThrows: 'state unreadable' } })
    run.bridge({ seq: 1, at: '', kind: 'attention', title: 'Ada needs your input', body: '' })
    await until(() => telegram.sent.some(sent => sent.text === 'Ada needs your input'))

    run.ctx.emit('idealize/studio-event', {
      id: 'e1', seq: 1, at: '', visibility: 'studio', project: '/work/site', author: 's-ada', kind: 'task-update', subtype: 'done',
    } as never)
    telegram.flags.sendFails = true
    run.bridge({ seq: 2, at: '', kind: 'attention', title: 'Ada is blocked', body: '' })
    await settle()
    expect(telegram.sent.map(sent => sent.text)).toEqual(['Ada needs your input'])
  })
})
