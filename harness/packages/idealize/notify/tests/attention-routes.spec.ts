/**
 * The alert chain over a real mount of both halves: a Studio event recorded
 * through `@idealize/studio`'s own route meets the MVP table here, the alerts
 * land on the ledger and on the bridge feed, and the person's answer to an
 * alert changes that record and nothing else.
 *
 * The third record of the spec's trio — whether the request was answered —
 * stays with the fold, so the tests read it back from the Studio's own state
 * after dismissing the alert (FR-P0-19).
 */

import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply as applyStudio, EVENT_PATH, STATE_PATH } from '@idealize/studio'
import { apply as applyNotify, ATTENTION_PATH, ATTENTION_READ_PATH, ATTENTION_STATE_PATH, chimeSoundCacheDir } from '../src/index.ts'
import type { AttentionLedger } from '../src/attention-store.ts'
import type { SoundSources } from '../src/sounds.ts'

// The sound routes are exercised over a Mac with two alert sounds, one of
// which afconvert refuses, whatever machine runs this suite.
vi.mock('../src/sounds.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/sounds.ts')>()
  const fakeMachine = (): SoundSources => ({
    platform: 'darwin',
    env: {},
    readdir: async dir => (dir === '/System/Library/Sounds' ? ['Glass.aiff', 'Odd.aiff'] : []),
    size: async () => 0,
    exists: async () => false,
    mkdir: async (dir) => { await mkdir(dir, { recursive: true }) },
    transcode: async (input, output) => {
      if (input.endsWith('Odd.aiff')) throw new Error('afconvert refused')
      await writeFile(output, 'RIFF fake wav')
    },
  })
  return { ...original, createSoundLibrary: (cacheDir: string) => original.createSoundLibrary(cacheDir, fakeMachine()) }
})

type RouteHandler = (req: FakeRequest, res: FakeResponse) => Promise<void> | void

class FakeRequest extends EventEmitter {
  constructor(
    public url: string,
    public method: string,
    public headers: Record<string, string>,
    private readonly body = '',
  ) {
    super()
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<Buffer> {
    if (this.body !== '') yield Buffer.from(this.body)
  }
}

class FakeResponse {
  status = 0
  body = ''
  writeHead(status: number, _headers: Record<string, string>) {
    this.status = status
    return this
  }

  end(chunk?: string) {
    if (chunk !== undefined) this.body += chunk
  }

  json(): unknown {
    return JSON.parse(this.body)
  }
}

/** One `attention` push, as the browser half would receive it. */
interface FeedEvent {
  kind: string
  title: string
  body: string
  project?: string
  studioEvent?: string
}

const homes: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  for (const context of contexts.splice(0)) await context.fiber.dispose()
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true })
})

const PROJECT = '/work/demo'

async function mount(options: {
  bridge?: boolean
  before?: (home: string) => Promise<void>
  desktop?: false | { throws?: unknown }
  appVersion?: string
} = {}) {
  const home = await mkdtemp(join(tmpdir(), 'idealize-notify-alerts-'))
  homes.push(home)
  vi.stubEnv('DSH_HOME', home)
  await options.before?.(home)
  const ctx = new Context()
  contexts.push(ctx)
  const handlers = new Map<string, RouteHandler>()
  ctx.provide('webServer', {
    register(route: { path: string; handler: RouteHandler }) {
      handlers.set(route.path, route.handler)
      return () => { handlers.delete(route.path) }
    },
  })
  const sections: unknown[] = []
  ctx.provide('settings', {
    register: (namespace: unknown, schema: unknown) => { sections.push({ namespace, schema }); return () => {} },
  } as never)
  const feed: FeedEvent[] = []
  if (options.bridge !== false) {
    // The real buffer's two members: the plugin pushes, the invariant companion subscribes.
    const listeners = new Set<(event: FeedEvent) => void>()
    ctx.provide('idealizeBridge', {
      buffer: {
        push: (event: FeedEvent) => {
          feed.push(event)
          for (const listener of listeners) listener(event)
          return event
        },
        subscribe: (listener: (event: FeedEvent) => void) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
      },
    })
  }
  const notified: { title: string; body: string }[] = []
  if (options.desktop !== undefined && options.desktop !== false) {
    ctx.provide('desktopActions', {
      notify: (notification: { title: string; body: string }) => {
        if (options.desktop !== false && options.desktop?.throws !== undefined) throw options.desktop.throws
        notified.push(notification)
      },
    })
  }
  await ctx.plugin({ name: 'idealize-studio', inject: [], apply: applyStudio })
  await ctx.plugin(
    { name: 'idealize-notify', inject: [], apply: applyNotify },
    options.appVersion === undefined ? {} : { appVersion: options.appVersion },
  )
  await new Promise(resolve => setTimeout(resolve, 0))

  interface CallInit { body?: unknown; auth?: boolean; query?: string; host?: string; bareRequest?: boolean }
  const call = async (path: string, init: CallInit = {}) => {
    const handler = handlers.get(path)
    if (handler === undefined) throw new Error(`no route ${path}`)
    // An empty host stands for a request that carries no Host header at all.
    const headers: Record<string, string> = init.host === '' ? {} : { host: init.host ?? '127.0.0.1:3180' }
    if (init.auth !== false) headers['x-idealize-auth'] = '1'
    // A bare request carries no url at all, as Node types allow.
    const req = new FakeRequest(
      init.bareRequest === true ? undefined as unknown as string : `${path}${init.query ?? ''}`,
      init.body === undefined ? 'GET' : 'POST',
      headers,
      init.body === undefined ? '' : (typeof init.body === 'string' ? init.body : JSON.stringify(init.body)),
    )
    const res = new FakeResponse()
    await handler(req, res)
    return res
  }

  /** Record one Studio event and wait for the alert chain to settle. */
  const record = async (event: Record<string, unknown>): Promise<string> => {
    const posted = await call(EVENT_PATH, { body: { project: PROJECT, ...event } })
    expect(posted.status).toBe(200)
    const id = (posted.json() as { event: { id: string } }).event.id
    await settle()
    return id
  }

  const ledger = async (): Promise<AttentionLedger> => (await call(ATTENTION_PATH)).json() as AttentionLedger

  return { call, ctx, feed, record, ledger, notified, sections }
}

/** Let the listener's reads and its ledger write finish. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await new Promise(resolve => setTimeout(resolve, 1))
}

/** The person asks for a task and an agent takes it up. */
const assign = { author: 'user', kind: 'assignment', subtype: 'new-task', taskId: 't1', target: 'agent-alpha', body: 'Ship the walk' }

describe('alerts over the MVP table', () => {
  it('alerts on a request that names the person, and records the delivery once', async () => {
    const { feed, record, ledger } = await mount()
    await record(assign)
    expect(feed).toHaveLength(0)

    const requestId = await record({ author: 'agent-alpha', kind: 'request', subtype: 'needs-input', taskId: 't1', target: 'user', body: 'Which font?' })
    expect(feed).toEqual([{
      kind: 'attention',
      title: 'agent-alpha needs your input',
      body: 'Which font?',
      project: PROJECT,
      studioEvent: requestId,
    }])
    expect((await ledger()).notifications).toEqual([
      expect.objectContaining({ event: requestId, project: PROJECT, row: 'needs-input', state: 'sent' }),
    ])
  })

  it('leaves routine progress alone', async () => {
    const { feed, record, ledger } = await mount()
    await record(assign)
    await record({ author: 'agent-alpha', kind: 'task-update', subtype: 'working', taskId: 't1' })
    await record({ author: 'agent-alpha', kind: 'task-update', subtype: 'progress', taskId: 't1', body: 'half way' })
    expect(feed).toHaveLength(0)
    expect((await ledger()).notifications).toEqual([])
  })

  it('alerts on a failed task the person asked for, and stays quiet when an agent asked', async () => {
    const { feed, record } = await mount()
    await record(assign)
    await record({ author: 'agent-alpha', kind: 'task-update', subtype: 'failed', taskId: 't1', body: 'the key expired' })
    expect(feed.map(event => event.title)).toEqual(['agent-alpha could not finish'])

    await record({ author: 'agent-beta', kind: 'assignment', subtype: 'new-task', taskId: 't2', target: 'agent-alpha', body: 'Retry it' })
    await record({ author: 'agent-alpha', kind: 'task-update', subtype: 'failed', taskId: 't2', body: 'again' })
    expect(feed).toHaveLength(1)
  })

  it('dismissing an alert leaves the unanswered request unanswered', async () => {
    const { call, record, ledger } = await mount()
    await record(assign)
    const requestId = await record({ author: 'agent-alpha', kind: 'request', subtype: 'needs-input', taskId: 't1', target: 'user', body: 'Which font?' })

    const dismissed = await call(ATTENTION_STATE_PATH, { body: { event: requestId, state: 'dismissed' } })
    expect(dismissed.status).toBe(200)
    expect((await ledger()).notifications[0]).toMatchObject({ state: 'dismissed' })

    // The third record is the fold's, and the dismissal did not touch it.
    const state = await call(STATE_PATH, { query: `?project=${PROJECT}` })
    expect(state.json()).toMatchObject({ tasks: [{ id: 't1', state: 'waiting', attention: 'needs-input', requestEvent: requestId }] })

    // Answering the request is what resolves it.
    await record({ author: 'user', kind: 'system', subtype: 'resolve-request', taskId: 't1', source: { event: requestId } })
    const answered = await call(STATE_PATH, { query: `?project=${PROJECT}` })
    expect(answered.json()).toMatchObject({ tasks: [{ id: 't1', state: 'working', attention: 'none' }] })
    // The alert's own record still says what happened to the alert.
    expect((await ledger()).notifications[0]).toMatchObject({ state: 'dismissed' })
  })

  it('records an opened alert, and refuses a state for an event that never alerted', async () => {
    const { call, record, ledger } = await mount()
    await record(assign)
    const requestId = await record({ author: 'agent-alpha', kind: 'request', subtype: 'needs-action', taskId: 't1', target: 'user', body: 'Approve it' })
    expect((await call(ATTENTION_STATE_PATH, { body: { event: requestId, state: 'opened' } })).status).toBe(200)
    expect((await ledger()).notifications[0]).toMatchObject({ state: 'opened', row: 'needs-action' })

    const unknown = await call(ATTENTION_STATE_PATH, { body: { event: 'se-nothing', state: 'opened' } })
    expect(unknown.status).toBe(404)
  })

  it('keeps the read position where the person left it', async () => {
    const { call, ledger } = await mount()
    expect((await call(ATTENTION_READ_PATH, { body: { project: PROJECT, seq: 3 } })).json()).toEqual({ ok: true, seq: 3 })
    // A relative spelling of one folder is one project, as the Studio's own routes resolve it.
    expect((await call(ATTENTION_READ_PATH, { body: { project: `${PROJECT}/../demo`, seq: 5 } })).json()).toEqual({ ok: true, seq: 5 })
    expect((await ledger()).read).toEqual({ [PROJECT]: 5 })
  })

  it('refuses a malformed write and demands the auth header', async () => {
    const { call } = await mount()
    expect((await call(ATTENTION_READ_PATH, { body: { project: '', seq: 1 } })).status).toBe(400)
    expect((await call(ATTENTION_READ_PATH, { body: { project: PROJECT, seq: 1.5 } })).status).toBe(400)
    expect((await call(ATTENTION_READ_PATH, { body: { project: PROJECT } })).status).toBe(400)
    expect((await call(ATTENTION_STATE_PATH, { body: { event: 'se-1', state: 'shrugged' } })).status).toBe(400)
    expect((await call(ATTENTION_STATE_PATH, { body: { state: 'opened' } })).status).toBe(400)
    expect((await call(ATTENTION_READ_PATH, { body: { project: PROJECT, seq: 1 }, auth: false })).status).toBe(403)
  })

  it('alerts on a request that belongs to no task', async () => {
    const { feed, record } = await mount()
    const requestId = await record({ author: 'agent-alpha', kind: 'request', subtype: 'needs-action', target: 'user', body: 'Approve the spend' })
    expect(feed).toEqual([expect.objectContaining({ studioEvent: requestId, title: 'agent-alpha needs you to act' })])
  })

  it('stays quiet when one event arrives twice', async () => {
    const { call, ctx, feed, ledger } = await mount()
    const posted = await call(EVENT_PATH, {
      body: { project: PROJECT, author: 'agent-alpha', kind: 'request', subtype: 'needs-input', target: 'user', body: 'Which font?' },
    })
    const event = (posted.json() as { event: Record<string, unknown> }).event
    await settle()
    // The same recorded event, delivered again: the ledger already holds it.
    ctx.emit('idealize/studio-event', event as never)
    await settle()
    expect(feed).toHaveLength(1)
    expect((await ledger()).notifications).toHaveLength(1)
  })

  it('keeps serving when the ledger cannot be written, and records nothing', async () => {
    const { feed, record, ledger } = await mount({
      before: async (home) => {
        await mkdir(join(home, 'idealize'), { recursive: true })
        await writeFile(join(home, 'idealize', 'notify'), 'not a directory\n')
      },
    })
    await record({ author: 'agent-alpha', kind: 'request', subtype: 'needs-input', target: 'user', body: 'Which font?' })
    expect(feed).toHaveLength(0)
    // The failed write left no record: the in-memory copy went with the file.
    expect(await ledger()).toEqual({ read: {}, notifications: [] })
  })

  it('records the alert with no bridge composed, so nothing is lost when no window is listening', async () => {
    const { record, ledger } = await mount({ bridge: false })
    await record(assign)
    const requestId = await record({ author: 'agent-alpha', kind: 'request', subtype: 'needs-input', taskId: 't1', target: 'user', body: 'Which font?' })
    expect((await ledger()).notifications).toEqual([expect.objectContaining({ event: requestId, state: 'sent' })])
  })

})

describe('the notify surface’s other routes', () => {
  it('states the shipped version, and the one the composition names', async () => {
    const shipped = await mount()
    // The version the build ships, when the composition names none.
    expect((await shipped.call('/idealize/notify/app')).json()).toEqual({ appVersion: '1.0.0-dev' })

    const composed = await mount({ appVersion: '9.9.9-test' })
    expect((await composed.call('/idealize/notify/app')).json()).toEqual({ appVersion: '9.9.9-test' })

    // The desktop shell names its packaged version in the environment; the composition still wins.
    process.env.IDEALIZE_APP_VERSION = '1.0.4'
    try {
      expect((await (await mount()).call('/idealize/notify/app')).json()).toEqual({ appVersion: '1.0.4' })
      expect((await (await mount({ appVersion: '9.9.9-test' })).call('/idealize/notify/app')).json()).toEqual({ appVersion: '9.9.9-test' })
    } finally {
      delete process.env.IDEALIZE_APP_VERSION
    }
  })

  it('registers its own settings section when a provider is composed', async () => {
    const { sections } = await mount()
    expect(sections).toHaveLength(1)
  })

  it('serves the chime as audio the browser can cache', async () => {
    const { call } = await mount()
    const reply = await call('/idealize/notify/chime.mp3')
    expect(reply.status).toBe(200)
    expect(reply.body.length).toBeGreaterThan(0)
  })

  it('lists the chime catalogue, the built-in chime first and the sounds this Mac could transcode after it', async () => {
    const { call } = await mount()
    expect((await call('/idealize/notify/sounds')).json()).toEqual({
      sounds: [{ id: 'built-in', label: 'Built-in chime' }, { id: 'system:Glass', label: 'Glass' }],
    })
  })

  it('serves one catalogue sound by id from the cache beside the ledger, and nothing by path or by a stranger\'s id', async () => {
    const { call } = await mount()
    const glass = await call('/idealize/notify/sound', { query: '?id=system%3AGlass' })
    expect(glass.status).toBe(200)
    expect(glass.body).toBe('RIFF fake wav')
    const home = process.env['DSH_HOME'] ?? ''
    expect(chimeSoundCacheDir(home)).toBe(join(home, 'idealize', 'notify', 'sounds'))
    // The id is a catalogue lookup, never a path: the ledger beside the cache cannot be read out through it.
    for (const id of ['system%3AOdd', '..%2Fattention.json', '%2Fetc%2Fpasswd', 'built-in', '']) {
      const refused = await call('/idealize/notify/sound', { query: `?id=${id}` })
      expect([refused.status, refused.json()]).toEqual([404, { error: 'no such sound' }])
    }
    expect((await call('/idealize/notify/sound')).status).toBe(404)
    expect((await call('/idealize/notify/sound', { bareRequest: true })).status).toBe(404)
  })

  it('raises a native notification when a desktop shell is composed', async () => {
    const { call, notified } = await mount({ desktop: {} })
    expect((await call('/idealize/notify/native', { body: { title: 'Apollo', body: 'needs you' } })).json())
      .toEqual({ ok: true })
    expect(notified).toEqual([{ title: 'Apollo', body: 'needs you' }])

    // A body naming neither falls back to the app's own name and no text.
    await call('/idealize/notify/native', { body: {} })
    expect(notified[1]).toEqual({ title: 'IDEalize', body: '' })
  })

  it('says so when no desktop shell is there to raise it', async () => {
    const { call } = await mount()
    const refused = await call('/idealize/notify/native', { body: { title: 'Apollo' } })
    expect([refused.status, refused.json()]).toEqual([409, { error: 'desktop shell not present' }])
  })

  it('answers its own failure rather than hanging up', async () => {
    const { call } = await mount({ desktop: {} })
    const broken = await call('/idealize/notify/native', { body: 'half a json document {' })
    expect(broken.status).toBe(500)
  })

  it('answers this machine alone, and demands the header before a write', async () => {
    const { call } = await mount({ desktop: {} })
    expect((await call('/idealize/notify/app', { host: 'example.com' })).status).toBe(403)
    expect((await call('/idealize/notify/app', { host: '' })).status).toBe(403)
    expect((await call('/idealize/notify/native', { body: {}, auth: false })).status).toBe(403)
    expect((await call('/idealize/notify/app', { host: 'localhost:3180' })).status).toBe(200)
    expect((await call('/idealize/notify/app', { host: '[::1]:3180' })).status).toBe(200)
  })
})
