/**
 * The bridge as a whole: every source it listens to lands one feed event, the
 * buffer keeps the newest 200 and fans out live, and the two read-only routes
 * answer on loopback alone.
 */

import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply, BridgeBuffer, IdealizeBridge } from '../src/index.ts'

type RouteHandler = (req: FakeRequest, res: FakeResponse) => void

class FakeRequest extends EventEmitter {
  constructor(public url: string | undefined, public headers: Record<string, string>) { super() }
}

class FakeResponse {
  status = 0
  headers: Record<string, string> = {}
  body = ''
  writeHead(status: number, headers: Record<string, string>) {
    this.status = status
    this.headers = headers
    return this
  }

  write(chunk: string) { this.body += chunk }
  end(chunk?: string) { if (chunk !== undefined) this.body += chunk }
}

const contexts: Context[] = []

afterEach(async () => {
  for (const context of contexts.splice(0)) await context.fiber.dispose()
})

/** One agent, as the events the bridge listens to carry it. */
const agentWith = (id: string, events: unknown[] = []) => ({ session: { header: { id }, events } })

async function mount() {
  const ctx = new Context()
  contexts.push(ctx)
  const handlers = new Map<string, RouteHandler>()
  ctx.provide('webServer', {
    register(route: { path: string; handler: RouteHandler }) {
      handlers.set(route.path, route.handler)
      return () => { handlers.delete(route.path) }
    },
  })
  await ctx.plugin({ name: 'idealize-host-bridge', inject: [], apply })
  await ctx.fiber.await()

  const call = (path: string, query: string | null = '', host = '127.0.0.1:3180') => {
    const handler = handlers.get(path)
    if (handler === undefined) throw new Error(`no route ${path}`)
    // A null query stands for a request that carries no url at all.
    const req = new FakeRequest(query === null ? undefined : `${path}${query}`, host === '' ? {} : { host })
    const res = new FakeResponse()
    handler(req, res)
    return { req, res }
  }
  return { ctx, call }
}

/**
 * The titles the recent-events body lists, in order.
 * @param body - the route's JSON body.
 * @returns one title per event.
 */
function titles(body: string): string[] {
  return (JSON.parse(body) as { title: string }[]).map(event => event.title)
}

describe('the bridge buffer', () => {
  it('keeps the newest 200 events and counts from one', () => {
    const buffer = new BridgeBuffer()
    for (let index = 0; index < 205; index += 1) {
      buffer.push({ kind: 'notify', title: `n-${String(index)}`, body: '' })
    }
    const retained = buffer.recent(0)
    expect(retained).toHaveLength(200)
    expect([retained[0]?.seq, retained.at(-1)?.seq]).toEqual([6, 205])
    expect(buffer.recent(204).map(event => event.title)).toEqual(['n-204'])
  })

  it('fans out to live listeners, survives a broken one, and detaches', () => {
    const buffer = new BridgeBuffer()
    const seen: string[] = []
    const offBroken = buffer.subscribe(() => { throw new Error('this listener is broken') })
    const off = buffer.subscribe(event => seen.push(event.title))
    expect(buffer.push({ kind: 'mail', title: 'first', body: '' }).seq).toBe(1)
    off()
    offBroken()
    buffer.push({ kind: 'mail', title: 'second', body: '' })
    expect(seen).toEqual(['first'])
  })
})

describe('the bridge’s sources', () => {
  it('forwards a schedule run with its duration and detail', async () => {
    const { ctx } = await mount()
    ctx.emit('idealize/cron-run', { status: 'ok', durationMs: 2100, detail: 'wrote the digest', sessionId: 's-1' } as never, { id: 't-1', name: 'Nightly digest' } as never)
    ctx.emit('idealize/cron-run', { status: 'failed' } as never, { id: 't-2', name: 'Weekly sweep' } as never)
    expect(ctx.idealizeBridge.buffer.recent(0).map(event => [event.title, event.body, event.sessionId])).toEqual([
      ['Nightly digest — ok in 2.1s', 'wrote the digest', 's-1'],
      ['Weekly sweep — failed', '', undefined],
    ])
  })

  it('reports a finish only for an agent that was running, and every error', async () => {
    const { ctx } = await mount()
    const agent = agentWith('session-1')
    // An idle flip with no running spell behind it is not a finish.
    ctx.emit('agent/status', { agent, status: 'idle' } as never)
    ctx.emit('agent/status', { agent, status: 'running' } as never)
    ctx.emit('agent/status', { agent, status: 'idle' } as never)
    ctx.emit('agent/error', { agent, error: new Error('the key expired') } as never)
    ctx.emit('agent/error', { agent, error: 'a thrown string' } as never)
    expect(ctx.idealizeBridge.buffer.recent(0).map(event => [event.kind, event.title, event.body])).toEqual([
      ['agent-finished', 'Agent finished', ''],
      ['agent-error', 'Agent hit an error', 'the key expired'],
      ['agent-error', 'Agent hit an error', 'a thrown string'],
    ])
  })

  it('says a turn that ended on an error left no reply', async () => {
    const { ctx } = await mount()
    const agent = agentWith('session-2', [
      { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
      { type: 'turn/end', data: { turn: 2, reason: { kind: 'error', error: { code: 'TRANSPORT', message: '503' } } } },
    ])
    ctx.emit('agent/status', { agent, status: 'running' } as never)
    ctx.emit('agent/status', { agent, status: 'idle' } as never)
    expect(ctx.idealizeBridge.buffer.recent(0).map(event => [event.kind, event.title, event.failed])).toEqual([
      ['agent-finished', 'Agent stopped on an error', true],
    ])
  })

  it('records an approval ask and what the answerers decided, deciding nothing itself', async () => {
    const { ctx } = await mount()
    const outcome = await ctx.waterfall(
      'approval/request',
      { toolName: 'bash', reason: 'rm -rf', agent: agentWith('session-2') } as never,
      (() => Promise.resolve('allowed-once')) as never,
    )
    expect(outcome).toBe('allowed-once')
    expect(ctx.idealizeBridge.buffer.recent(0).map(event => [event.kind, event.title, event.body])).toEqual([
      ['approval-pending', 'Approval needed: bash', 'rm -rf'],
      ['approval-decided', 'Approval granted: bash', 'answers the ask at seq 1'],
    ])
  })

  it('names a refusal by its own word', async () => {
    const { ctx } = await mount()
    await ctx.waterfall(
      'approval/request',
      { toolName: 'write', agent: agentWith('session-3') } as never,
      (() => Promise.resolve('denied')) as never,
    )
    expect(ctx.idealizeBridge.buffer.recent(0).at(-1)?.title).toBe('Approval denied: write')
  })
})

describe('the bridge’s routes', () => {
  it('serves the retained tail after a cursor', async () => {
    const { ctx, call } = await mount()
    ctx.idealizeBridge.buffer.push({ kind: 'notify', title: 'one', body: '' })
    ctx.idealizeBridge.buffer.push({ kind: 'notify', title: 'two', body: '' })
    const all = call('/idealize/events/recent')
    expect(titles(all.res.body)).toEqual(['one', 'two'])
    const after = call('/idealize/events/recent', '?since=1')
    expect(titles(after.res.body)).toEqual(['two'])
    // A cursor that is not a whole count reads as the whole tail, and so does
    // a request that names no url.
    const nonsense = call('/idealize/events/recent', '?since=-4')
    expect(JSON.parse(nonsense.res.body)).toHaveLength(2)
    expect(JSON.parse(call('/idealize/events/recent', null).res.body)).toHaveLength(2)
  })

  it('streams the tail then every later event, until the reader goes', async () => {
    const { ctx, call } = await mount()
    ctx.idealizeBridge.buffer.push({ kind: 'notify', title: 'before', body: '' })
    const { req, res } = call('/idealize/events/stream', '?since=0')
    expect(res.headers['content-type']).toBe('text/event-stream')
    ctx.idealizeBridge.buffer.push({ kind: 'notify', title: 'after', body: '' })
    expect(res.body).toContain('"title":"before"')
    expect(res.body).toContain('"title":"after"')
    req.emit('close')
    ctx.idealizeBridge.buffer.push({ kind: 'notify', title: 'later', body: '' })
    expect(res.body).not.toContain('"title":"later"')
    // A nonsense cursor, and a request with no url, both replay the whole tail.
    expect(call('/idealize/events/stream', '?since=-2').res.body).toContain('"title":"before"')
    expect(call('/idealize/events/stream', null).res.body).toContain('"title":"before"')
  })

  it('answers loopback alone, both routes', async () => {
    const { call } = await mount()
    expect(call('/idealize/events/recent', '', 'example.com').res.status).toBe(403)
    expect(call('/idealize/events/stream', '', '').res.status).toBe(403)
    expect(call('/idealize/events/recent', '', 'localhost:3180').res.status).toBe(200)
    expect(call('/idealize/events/stream', '', '[::1]:3180').res.status).toBe(200)
  })
})

describe('the service itself', () => {
  it('is what ctx.idealizeBridge holds', async () => {
    const { ctx } = await mount()
    expect(ctx.idealizeBridge).toBeInstanceOf(IdealizeBridge)
  })
})
