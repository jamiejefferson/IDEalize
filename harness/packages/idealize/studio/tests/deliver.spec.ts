/**
 * The delivery pipeline and presence: one logical message through record,
 * mailbox attempt and the recorded delivery state; retries that re-attempt a
 * queued delivery without duplicating the message; presence derived from the
 * live agent roster.
 */

import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply, DELIVER_PATH, EVENT_PATH, STATE_PATH, TIMELINE_PATH } from '../src/index.ts'
import type { StudioConfig } from '../src/index.ts'
import type { StudioEvent } from '../src/index.ts'

type RouteHandler = (req: DeliverRequest, res: DeliverResponse) => Promise<void> | void

class DeliverRequest extends EventEmitter {
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

class DeliverResponse {
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

/** A mailbox stand-in for ctx.idealizeComm: records sends, answers as told. */
class FakeComm {
  sends: { from?: string | undefined; target?: string | undefined; body?: string | undefined }[] = []
  ok = true
  handle(request: { command?: string; from?: string; target?: string; body?: string }) {
    this.sends.push(request)
    return Promise.resolve(this.ok ? { ok: true, info: 'delivered' } : { ok: false, error: 'nobody by that name' })
  }
}

const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  for (const context of contexts.splice(0)) await context.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function mount(options: { comm?: FakeComm; liveSessions?: string[]; config?: StudioConfig } = {}) {
  const home = await mkdtemp(join(tmpdir(), 'idealize-studio-deliver-'))
  roots.push(home)
  vi.stubEnv('DSH_HOME', home)
  const ctx = new Context()
  contexts.push(ctx)
  const handlers = new Map<string, RouteHandler>()
  ctx.provide('webServer', {
    register(route: { path: string; handler: RouteHandler }) {
      handlers.set(route.path, route.handler)
      return () => { handlers.delete(route.path) }
    },
  })
  if (options.comm !== undefined) ctx.provide('idealizeComm', options.comm)
  if (options.liveSessions !== undefined) {
    ctx.provide('agents', {
      roots: () => (options.liveSessions ?? []).map(id => ({ status: 'idle', session: { header: { id } } })),
    })
  }
  await ctx.plugin({ name: 'idealize-studio', inject: [], apply }, options.config)
  await new Promise(resolve => setTimeout(resolve, 0))
  const call = async (path: string, body?: unknown, query = '') => {
    const handler = handlers.get(path)
    if (handler === undefined) throw new Error(`no route ${path}`)
    const req = new DeliverRequest(`${path}${query}`, body === undefined ? 'GET' : 'POST',
      { host: '127.0.0.1:3180', 'x-idealize-auth': '1' }, body === undefined ? '' : JSON.stringify(body))
    const res = new DeliverResponse()
    await handler(req, res)
    return res
  }
  return { ctx, call }
}

function addressed(body: string, extra: Record<string, unknown> = {}) {
  return { project: '/work/demo', author: 'user', kind: 'message', target: 'agent-a', body, messageId: 'm-1', ...extra }
}

describe('deliver', () => {
  it('records the message, sends it to the mailbox, and records delivered', async () => {
    const comm = new FakeComm()
    const { call } = await mount({ comm })
    const res = await call(DELIVER_PATH, addressed('please start'))
    expect(res.json()).toMatchObject({ ok: true, duplicate: false, delivery: 'delivered', event: { seq: 1 } })
    expect(comm.sends).toEqual([{ command: 'send', from: 'user', target: 'agent-a', body: 'please start' }])
    const timeline = await call(TIMELINE_PATH, undefined, '?project=/work/demo')
    const events = (timeline.json() as { events: StudioEvent[] }).events
    expect(events.map(event => [event.kind, event.subtype])).toEqual([
      ['message', undefined],
      ['system', 'delivery-delivered'],
    ])
    expect(events[1]?.source?.event).toBe(events[0]?.id)
    const state = await call(STATE_PATH, undefined, '?project=/work/demo')
    expect((state.json() as { deliveries: Record<string, string> }).deliveries).toEqual({ [String(events[0]?.id)]: 'delivered' })
  })

  it('queues without a messaging service and retries into delivered without duplicating', async () => {
    const { ctx, call } = await mount()
    const first = await call(DELIVER_PATH, addressed('are you there'))
    expect(first.json()).toMatchObject({ ok: true, delivery: 'queued' })
    const comm = new FakeComm()
    ctx.provide('idealizeComm', comm)
    const retry = await call(DELIVER_PATH, addressed('are you there'))
    expect(retry.json()).toMatchObject({ ok: true, duplicate: true, delivery: 'delivered' })
    expect(comm.sends).toHaveLength(1)
    const timeline = await call(TIMELINE_PATH, undefined, '?project=/work/demo')
    const events = (timeline.json() as { events: StudioEvent[] }).events
    expect(events.filter(event => event.kind === 'message')).toHaveLength(1)
    expect(events.map(event => event.subtype)).toEqual([undefined, 'delivery-queued', 'delivery-delivered'])
  })

  it('never re-sends a delivered message', async () => {
    const comm = new FakeComm()
    const { call } = await mount({ comm })
    await call(DELIVER_PATH, addressed('once'))
    const again = await call(DELIVER_PATH, addressed('once'))
    expect(again.json()).toMatchObject({ duplicate: true, delivery: 'delivered' })
    expect(comm.sends).toHaveLength(1)
  })

  it('records a refused send as queued with the refusal', async () => {
    const comm = new FakeComm()
    comm.ok = false
    const { call } = await mount({ comm })
    const res = await call(DELIVER_PATH, addressed('to nobody'))
    expect(res.json()).toMatchObject({ delivery: 'queued' })
    const timeline = await call(TIMELINE_PATH, undefined, '?project=/work/demo')
    const events = (timeline.json() as { events: StudioEvent[] }).events
    expect(events[1]).toMatchObject({ subtype: 'delivery-queued', body: 'nobody by that name' })
  })

  it('refuses an unaddressed deliver toward the group-post path, recording and sending nothing', async () => {
    const comm = new FakeComm()
    const { call } = await mount({ comm })
    const res = await call(DELIVER_PATH, { project: '/work/demo', author: 'user', kind: 'message', body: 'x' })
    expect(res.status).toBe(400)
    expect((res.json() as { error: string }).error).toContain('event')
    expect(comm.sends).toHaveLength(0)
    const timeline = await call(TIMELINE_PATH, undefined, '?project=/work/demo')
    expect((timeline.json() as { events: unknown[] }).events).toHaveLength(0)
  })
})

describe('retryQueued', () => {
  it('delivers the backlog when the target session starts, without duplicating messages', async () => {
    const { ctx, call } = await mount()
    await call(DELIVER_PATH, addressed('first', { messageId: 'm-1' }))
    await call(DELIVER_PATH, addressed('second', { messageId: 'm-2' }))
    const comm = new FakeComm()
    ctx.provide('idealizeComm', comm)
    ctx.emit('agent/session-start', { agent: { session: { header: { id: 'agent-a' } } } } as never)
    await vi.waitFor(async () => {
      const state = await call(STATE_PATH, undefined, '?project=/work/demo')
      const deliveries = (state.json() as { deliveries: Record<string, string> }).deliveries
      expect(Object.values(deliveries)).toEqual(['delivered', 'delivered'])
    })
    expect(comm.sends.map(send => send.body)).toEqual(['first', 'second'])
    const timeline = await call(TIMELINE_PATH, undefined, '?project=/work/demo')
    const events = (timeline.json() as { events: StudioEvent[] }).events
    expect(events.filter(event => event.kind === 'message')).toHaveLength(2)
  })

  it('leaves other targets queued and records expiry instead of attempting stale messages', async () => {
    const { ctx, call } = await mount({ config: { deliveryExpiryHours: 0 } })
    await call(DELIVER_PATH, addressed('stale', { messageId: 'm-1' }))
    await call(DELIVER_PATH, addressed('other', { messageId: 'm-2', target: 'agent-b' }))
    const comm = new FakeComm()
    ctx.provide('idealizeComm', comm)
    const outcome = await ctx.idealizeStudio.retryQueued('agent-a')
    expect(outcome).toEqual({ delivered: 0, expired: 1 })
    expect(comm.sends).toHaveLength(0)
    const state = await call(STATE_PATH, undefined, '?project=/work/demo')
    const deliveries = (state.json() as { deliveries: Record<string, string> }).deliveries
    expect(Object.values(deliveries).sort()).toEqual(['expired', 'queued'])
  })

  it('revives an expired delivery on an explicit messageId retry', async () => {
    const { ctx, call } = await mount({ config: { deliveryExpiryHours: 0 } })
    await call(DELIVER_PATH, addressed('stale', { messageId: 'm-1' }))
    await ctx.idealizeStudio.retryQueued('agent-a')
    const comm = new FakeComm()
    ctx.provide('idealizeComm', comm)
    const retry = await call(DELIVER_PATH, addressed('stale', { messageId: 'm-1' }))
    expect(retry.json()).toMatchObject({ duplicate: true, delivery: 'delivered' })
    expect(comm.sends).toHaveLength(1)
  })
})

describe('presence', () => {
  it('marks owners reachable exactly while a live root agent runs their session', async () => {
    const { call } = await mount({ comm: new FakeComm(), liveSessions: ['agent-a'] })
    await call('/idealize/studio/event', { project: '/work/demo', author: 'user', kind: 'assignment', subtype: 'new-task', taskId: 't1', target: 'agent-a' })
    await call('/idealize/studio/event', { project: '/work/demo', author: 'user', kind: 'assignment', subtype: 'new-task', taskId: 't2', target: 'agent-b' })
    const state = await call(STATE_PATH, undefined, '?project=/work/demo')
    expect((state.json() as { presence: Record<string, string> }).presence).toEqual({ 'agent-a': 'reachable', 'agent-b': 'unreachable' })
  })

  it('serves empty presence with no agents service composed', async () => {
    const { call } = await mount()
    await call('/idealize/studio/event', { project: '/work/demo', author: 'user', kind: 'assignment', subtype: 'new-task', taskId: 't1', target: 'agent-a' })
    const state = await call(STATE_PATH, undefined, '?project=/work/demo')
    expect((state.json() as { presence: Record<string, string> }).presence).toEqual({ 'agent-a': 'unreachable' })
  })
})

describe('a task ending in the group chat', () => {
  /** Assign one task, then end it, and read the timeline back. */
  async function endTask(subtype: string, outcome?: string) {
    const { call } = await mount()
    await call(EVENT_PATH, {
      project: '/work/demo', author: 'agent-a', kind: 'assignment', subtype: 'new-task',
      taskId: 't1', target: 'agent-a', body: 'Draft the launch email',
    })
    await call(EVENT_PATH, {
      project: '/work/demo', author: 'agent-a', kind: 'task-update', subtype, taskId: 't1',
      ...outcome === undefined ? {} : { body: outcome },
    })
    const timeline = (await call(TIMELINE_PATH, undefined, '?project=/work/demo')).json() as { events: StudioEvent[] }
    return timeline.events
  }

  it('says the task finished, naming its goal and the outcome the agent gave', async () => {
    const events = await endTask('done', 'Sent it to the list')
    const posts = events.filter(event => event.kind === 'message')
    expect(posts).toHaveLength(1)
    expect(posts[0]?.body).toBe('Finished: Draft the launch email — Sent it to the list')
    // It is the agent's own line, and it wakes nobody.
    expect(posts[0]?.author).toBe('agent-a')
    expect(posts[0]?.target).toBeUndefined()
  })

  it('says as much for a task that failed or was cancelled', async () => {
    expect((await endTask('failed', 'the API refused the key')).find(event => event.kind === 'message')?.body)
      .toBe('Could not finish: Draft the launch email — the API refused the key')
    expect((await endTask('cancelled')).find(event => event.kind === 'message')?.body)
      .toBe('Cancelled: Draft the launch email')
  })

  it('stays quiet for an update that leaves the task open', async () => {
    for (const subtype of ['summary', 'blocked', 'paused']) {
      expect((await endTask(subtype, 'still going')).filter(event => event.kind === 'message')).toEqual([])
    }
  })

  it('posts once for a retried submission, because a duplicate writes nothing', async () => {
    const { call } = await mount()
    const ending = {
      project: '/work/demo', author: 'agent-a', kind: 'task-update', subtype: 'done',
      taskId: 't1', body: 'done twice over', messageId: 'end-1',
    }
    await call(EVENT_PATH, ending)
    await call(EVENT_PATH, ending)
    const timeline = (await call(TIMELINE_PATH, undefined, '?project=/work/demo')).json() as { events: StudioEvent[] }
    expect(timeline.events.filter(event => event.kind === 'message')).toHaveLength(1)
  })
})
