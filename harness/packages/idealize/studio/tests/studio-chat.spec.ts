/**
 * The Studio chat posts through the ordinary composer (JJ, 3 Sep 2026): the
 * pre-step listener takes a `studio`-space chat's message before any model
 * runs, delivers a leading `@name` to that participant on its own project or
 * the rest to the one Studio coordinator on the Studio's own timeline, and
 * rejects the step; other chats pass through. The overview serves every
 * stored project in one read.
 */

import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply, EVENT_PATH, OVERVIEW_PATH, resolveAddress } from '../src/index.ts'
import type { StudioOverviewProject } from '../src/index.ts'

type RouteHandler = (req: Req, res: Res) => Promise<void> | void

class Req extends EventEmitter {
  constructor(public url: string, public method: string, public headers: Record<string, string>, private readonly body = '') { super() }
  async *[Symbol.asyncIterator](): AsyncGenerator<Buffer> { if (this.body !== '') yield Buffer.from(this.body) }
}

class Res {
  status = 0
  body = ''
  writeHead(status: number, _headers: Record<string, string>) { this.status = status; return this }
  end(chunk?: string) { if (chunk !== undefined) this.body += chunk }
  json(): unknown { return JSON.parse(this.body) }
}

/** comm's face as the Studio reads it: a roster for `list`, a start for `spawn`, a mailbox for `send`. */
class FakeComm {
  sends: { from?: string; target?: string; body?: string }[] = []
  spawns: { command: string; studio?: boolean }[] = []
  constructor(
    private readonly roster: { id: string; name?: string; title: string; projectPath?: string; role?: string; live?: boolean }[],
    /** The session id a `spawn` returns; null makes the start fail. */
    private readonly spawned: string | null = 'studio-1',
  ) {}
  handle(request: { command: string; from?: string; target?: string; body?: string; studio?: boolean }) {
    if (request.command === 'list') return Promise.resolve({ ok: true, sessions: this.roster })
    if (request.command === 'spawn') {
      this.spawns.push(request)
      return Promise.resolve(this.spawned === null ? { ok: false } : { ok: true, info: this.spawned })
    }
    this.sends.push(request)
    return Promise.resolve({ ok: true, info: 'delivered' })
  }
}

const roots: string[] = []
const contexts: Context[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  for (const context of contexts.splice(0)) await context.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function mount(comm?: FakeComm) {
  const home = await mkdtemp(join(tmpdir(), 'idealize-studio-chat-'))
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
  if (comm !== undefined) ctx.provide('idealizeComm', comm)
  const notices: { title: string; body: string }[] = []
  ctx.provide('idealizeBridge', { buffer: { push: (event: { title: string; body: string }) => { notices.push(event) } } })
  await ctx.plugin({ name: 'idealize-studio', inject: [], apply })
  await new Promise(resolve => setTimeout(resolve, 0))
  const call = async (path: string, body?: unknown, query = '') => {
    const handler = handlers.get(path)
    if (handler === undefined) throw new Error(`no route ${path}`)
    const req = new Req(`${path}${query}`, body === undefined ? 'GET' : 'POST',
      { host: '127.0.0.1:3180', 'x-idealize-auth': '1' }, body === undefined ? '' : JSON.stringify(body))
    const res = new Res()
    await handler(req, res)
    return res
  }
  /** Run the pre-step waterfall for a chat whose log holds `events`, offering `text`. */
  const preStep = (events: { type: string; data: unknown }[], text: string) => ctx.waterfall('agent/pre-step', {
    agent: { session: { events } },
    messages: [
      { role: 'user', source: { kind: 'plugin', plugin: 'idealize-comm' }, content: [{ type: 'text', text: 'Your name in IDEalize is Clegg Holdfast.' }] },
      { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] },
    ],
    turn: 1, step: 1, signal: new AbortController().signal,
  } as never, () => Promise.resolve({ kind: 'enter', messages: [] }) as never)
  return { ctx, call, preStep, notices }
}

const STUDIO_LOG = [{ type: 'idealize/space', data: { space: 'studio' } }]

describe('resolveAddress', () => {
  const roster = [
    { id: 's1', name: 'Mas Amedda', title: 'Owl', project: '/w/a' },
    { id: 's2', name: 'Mas', title: 'Short', project: '/w/b' },
  ]
  it('takes the longest matching name at a word boundary and the rest as the body', () => {
    expect(resolveAddress('Mas Amedda how is the owl', roster)).toEqual({ target: roster[0], body: 'how is the owl' })
    expect(resolveAddress('mas hello', roster)).toEqual({ target: roster[1], body: 'hello' })
    expect(resolveAddress('Masters', roster)).toBeNull()
  })
})

describe('the Studio chat', () => {
  it('delivers a leading @name to that participant on its own project and rejects the step', async () => {
    const comm = new FakeComm([{ id: 's1', name: 'Mas Amedda', title: 'Owl', projectPath: '/w/a' }])
    const { call, preStep } = await mount(comm)
    const decision = await preStep(STUDIO_LOG, '@Mas Amedda how is the owl going?')
    expect(decision).toEqual({ kind: 'reject' })
    expect(comm.sends).toEqual([{ command: 'send', from: 'user', target: 's1', body: 'how is the owl going?' }])
    const overview = (await call(OVERVIEW_PATH)).json() as { projects: StudioOverviewProject[] }
    expect(overview.projects.map(row => row.project)).toEqual(['/w/a'])
    expect(overview.projects[0]?.recent.map(event => [event.kind, event.target, event.body])).toEqual([
      ['message', 's1', 'how is the owl going?'],
      ['system', 's1', undefined],
    ])
  })

  it('sends an untagged message to the Studio coordinator, starting one when none runs', async () => {
    const comm = new FakeComm([
      { id: 's1', name: 'Mas Amedda', title: 'Owl', projectPath: '/w/a' },
      { id: 's2', name: 'Kit Fisto', title: 'Terminal', projectPath: '/w/b' },
    ])
    const { call, preStep } = await mount(comm)
    // A third project has a timeline already and no live participant.
    await call(EVENT_PATH, { project: '/w/c', author: 'idealize', kind: 'system', subtype: 'note', messageId: 'seed' })
    expect(await preStep(STUDIO_LOG, 'everyone: pause for lunch')).toEqual({ kind: 'reject' })
    expect(comm.spawns).toEqual([{ command: 'spawn', studio: true }])
    expect(comm.sends).toEqual([{ command: 'send', from: 'user', target: 'studio-1', body: 'everyone: pause for lunch' }])
    const overview = (await call(OVERVIEW_PATH)).json() as { projects: StudioOverviewProject[] }
    const timelines = new Map(overview.projects.map(row => [row.project, row.recent.map(event => [event.kind, event.target, event.body])]))
    // The Studio's own timeline carries it; no project timeline does.
    expect([...timelines.keys()].sort()).toEqual(['/w/c', 'studio'])
    expect(timelines.get('studio')).toEqual([
      ['message', 'studio-1', 'everyone: pause for lunch'],
      ['system', 'studio-1', undefined],
    ])
    expect(timelines.get('/w/c')).toEqual([['system', undefined, undefined]])
  })

  it('reuses the Studio coordinator already on the roster', async () => {
    const comm = new FakeComm([
      { id: 'sc', name: 'Wisp Tallow', title: 'Studio Coordinator', role: 'studio-agent', live: true },
      { id: 's1', name: 'Mas Amedda', title: 'Owl', projectPath: '/w/a' },
    ])
    const { preStep } = await mount(comm)
    expect(await preStep(STUDIO_LOG, 'where are we?')).toEqual({ kind: 'reject' })
    expect(comm.spawns).toEqual([])
    expect(comm.sends).toEqual([{ command: 'send', from: 'user', target: 'sc', body: 'where are we?' }])
  })

  it('asks comm to resume a stored Studio coordinator that is not live', async () => {
    const comm = new FakeComm([
      { id: 'sc', name: 'Wisp Tallow', title: 'Studio Coordinator', role: 'studio-agent', live: false },
    ], 'sc')
    const { preStep } = await mount(comm)
    expect(await preStep(STUDIO_LOG, 'where are we?')).toEqual({ kind: 'reject' })
    expect(comm.spawns).toEqual([{ command: 'spawn', studio: true }])
    expect(comm.sends).toEqual([{ command: 'send', from: 'user', target: 'sc', body: 'where are we?' }])
  })

  it('tells the user when no Studio coordinator can be started', async () => {
    const comm = new FakeComm([], null)
    const { call, preStep, notices } = await mount(comm)
    expect(await preStep(STUDIO_LOG, 'anyone about?')).toEqual({ kind: 'reject' })
    expect(comm.sends).toEqual([])
    expect(notices).toEqual([{
      kind: 'notify',
      title: 'Studio',
      body: 'Your message was not posted: the Studio coordinator could not be started.',
    }])
    expect((await call(OVERVIEW_PATH)).json()).toEqual({ projects: [] })
  })

  it('tells the user when @name matches nobody, and passes other chats through', async () => {
    const comm = new FakeComm([{ id: 's1', name: 'Mas Amedda', title: 'Owl', projectPath: '/w/a' }])
    const { call, preStep, notices } = await mount(comm)
    expect(await preStep(STUDIO_LOG, '@Yoda are you there')).toEqual({ kind: 'reject' })
    expect(comm.sends).toEqual([])
    expect(notices).toEqual([{ kind: 'notify', title: 'Studio', body: 'Nobody called "@Yoda" is present. Present: Mas Amedda.' }])
    expect((await call(OVERVIEW_PATH)).json()).toEqual({ projects: [] })
    expect(await preStep([{ type: 'idealize/space', data: { space: 'chat' } }], 'hello model')).toEqual({ kind: 'enter', messages: [] })
    expect(await preStep([], 'hello model')).toEqual({ kind: 'enter', messages: [] })
  })
})
