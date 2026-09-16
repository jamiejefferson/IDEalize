/**
 * The three loopback routes over a real plugin mount: submission with wire
 * validation and the auth fence, timeline cursors, folded state, duplicate
 * suppression end to end, and the commit-then-announce order.
 */

import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply, EVENT_PATH, STATE_PATH, TIMELINE_PATH } from '../src/index.ts'
import type { StudioEvent } from '../src/index.ts'

type RouteHandler = (req: StudioRequest, res: StudioResponse) => Promise<void> | void

class StudioRequest extends EventEmitter {
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

class StudioResponse {
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

const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  for (const context of contexts.splice(0)) await context.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function mount() {
  const home = await mkdtemp(join(tmpdir(), 'idealize-studio-routes-'))
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
  await ctx.plugin({ name: 'idealize-studio', inject: [], apply })
  await new Promise(resolve => setTimeout(resolve, 0))
  const call = async (path: string, init: { method?: string; body?: unknown; auth?: boolean; host?: string; query?: string } = {}) => {
    const handler = handlers.get(path)
    if (handler === undefined) throw new Error(`no route ${path}`)
    const headers: Record<string, string> = { host: init.host ?? '127.0.0.1:3180' }
    if (init.auth !== false) headers['x-idealize-auth'] = '1'
    const req = new StudioRequest(`${path}${init.query ?? ''}`, init.method ?? (init.body === undefined ? 'GET' : 'POST'), headers,
      init.body === undefined ? '' : JSON.stringify(init.body))
    const res = new StudioResponse()
    await handler(req, res)
    return res
  }
  return { ctx, call }
}

function submission(body: string, extra: Record<string, unknown> = {}) {
  return { project: '/work/demo', author: 'user', kind: 'system', body, ...extra }
}

describe('studio routes', () => {
  it('records an event and serves it back with its cursor', async () => {
    const { call } = await mount()
    const posted = await call(EVENT_PATH, { body: submission('hello') })
    expect(posted.status).toBe(200)
    expect(posted.json()).toMatchObject({ ok: true, duplicate: false, event: { seq: 1, kind: 'system', body: 'hello' } })
    await call(EVENT_PATH, { body: submission('again') })
    const all = await call(TIMELINE_PATH, { query: '?project=/work/demo' })
    expect(all.json()).toMatchObject({ lastSeq: 2 })
    const after = await call(TIMELINE_PATH, { query: '?project=/work/demo&since=1' })
    const events = (after.json() as { events: StudioEvent[] }).events
    expect(events.map(event => event.body)).toEqual(['again'])
  })

  it('suppresses a duplicate messageId end to end', async () => {
    const { call } = await mount()
    await call(EVENT_PATH, { body: submission('once', { messageId: 'm-1' }) })
    const retry = await call(EVENT_PATH, { body: submission('twice', { messageId: 'm-1' }) })
    expect(retry.json()).toMatchObject({ ok: true, duplicate: true, event: { body: 'once' } })
    const timeline = await call(TIMELINE_PATH, { query: '?project=/work/demo' })
    expect((timeline.json() as { events: unknown[] }).events).toHaveLength(1)
  })

  it('refuses an addressed message on the event route, and records an unaddressed one as a group post', async () => {
    const { ctx, call } = await mount()
    const addressed = await call(EVENT_PATH, { body: { project: '/work/demo', author: 'user', kind: 'message', target: 'agent-a', body: 'hi' } })
    expect(addressed.status).toBe(400)
    expect((addressed.json() as { error: string }).error).toContain('deliver')
    // An unaddressed message is a group post: on the timeline, invoking nobody.
    const post = await call(EVENT_PATH, { body: { project: '/work/demo', author: 'user', kind: 'message', body: 'hello everyone' } })
    expect(post.status).toBe(200)
    const timeline = await call(TIMELINE_PATH, { query: '?project=/work/demo' })
    expect((timeline.json() as { events: { body?: string }[] }).events.map(event => event.body)).toEqual(['hello everyone'])
    // The service refuses the addressed form too, so no typed caller bypasses deliver.
    await expect(ctx.idealizeStudio.record({ project: '/work/demo', author: 'user', kind: 'message', target: 'agent-a', body: 'hi' }))
      .rejects.toThrow('deliver')
  })

  it('folds submitted events into the state route', async () => {
    const { call } = await mount()
    await call(EVENT_PATH, { body: { project: '/work/demo', author: 'user', kind: 'assignment', subtype: 'new-task', taskId: 't1', target: 'agent-a', body: 'Write it' } })
    await call(EVENT_PATH, { body: { project: '/work/demo', author: 'agent-a', kind: 'task-update', subtype: 'working', taskId: 't1' } })
    const state = await call(STATE_PATH, { query: '?project=/work/demo' })
    expect(state.json()).toMatchObject({
      tasks: [{ id: 't1', state: 'working', owner: 'agent-a' }],
      agents: { 'agent-a': { displayed: 't1' } },
    })
  })

  it('announces a committed event after the store retains it, and never for a duplicate', async () => {
    const { ctx, call } = await mount()
    const seen: StudioEvent[] = []
    ctx.on('idealize/studio-event', (event) => {
      seen.push(event)
      expect(ctx.idealizeStudio.lastSeq(event.project)).toBeGreaterThanOrEqual(event.seq)
    }, { global: true })
    await call(EVENT_PATH, { body: submission('hello', { messageId: 'm-1' }) })
    await call(EVENT_PATH, { body: submission('hello', { messageId: 'm-1' }) })
    expect(seen).toHaveLength(1)
    expect(seen[0]?.seq).toBe(1)
  })

  it('refuses bad submissions at the wire', async () => {
    const { call } = await mount()
    expect((await call(EVENT_PATH, { body: submission('x', { kind: 'party' }) })).status).toBe(400)
    expect((await call(EVENT_PATH, { body: { author: 'user', kind: 'message' } })).status).toBe(400)
    expect((await call(EVENT_PATH, { body: submission('x', { extra: true }) })).status).toBe(400)
    expect((await call(EVENT_PATH, { body: submission('x'.repeat(4001)) })).status).toBe(400)
    expect((await call(EVENT_PATH, { method: 'GET' })).status).toBe(405)
  })

  it('fences the wire: auth on writes, loopback on everything', async () => {
    const { call } = await mount()
    expect((await call(EVENT_PATH, { body: submission('x'), auth: false })).status).toBe(403)
    expect((await call(EVENT_PATH, { body: submission('x'), host: 'evil.example:80' })).status).toBe(403)
    expect((await call(TIMELINE_PATH, { query: '?project=/p', host: 'evil.example:80' })).status).toBe(403)
    expect((await call(TIMELINE_PATH, { query: '' })).status).toBe(400)
  })
})
