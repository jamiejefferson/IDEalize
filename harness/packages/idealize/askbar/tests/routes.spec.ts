/**
 * The two loopback routes over a real plugin mount: the roster join against
 * probed comm/studio fakes (and its degrade when neither is composed), the
 * transform dispatch into desktopActions with the 501 when no shell is
 * composed, and the loopback/auth fences.
 */

import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { OWL_FRAME_STILL } from '@idealize/skin'
import { apply, Config, FOCUS_PATH, OWL_PATH, ROSTER_PATH, TRANSFORM_PATH } from '../src/index.ts'
import type { AskbarRoster } from '../src/index.ts'

type RouteHandler = (req: AskbarRequest, res: AskbarResponse) => Promise<void> | void

class AskbarRequest extends EventEmitter {
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

class AskbarResponse {
  status = 0
  body = ''
  headers: Record<string, string> = {}
  bytes: Buffer | undefined
  writeHead(status: number, headers: Record<string, string>) {
    this.status = status
    this.headers = headers
    return this
  }

  end(chunk?: string | Buffer) {
    if (Buffer.isBuffer(chunk)) this.bytes = chunk
    else if (chunk !== undefined) this.body += chunk
  }

  json(): unknown {
    return JSON.parse(this.body)
  }
}

const contexts: Context[] = []

afterEach(async () => {
  for (const context of contexts.splice(0)) await context.fiber.dispose()
})

async function mount(services: Record<string, unknown> = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  const handlers = new Map<string, RouteHandler>()
  ctx.provide('webServer', {
    register(route: { path: string; handler: RouteHandler }) {
      handlers.set(route.path, route.handler)
      return () => { handlers.delete(route.path) }
    },
  })
  for (const [name, service] of Object.entries(services)) ctx.provide(name, service)
  await ctx.plugin({ name: 'idealize-askbar', inject: [], Config, apply })
  await new Promise(resolve => setTimeout(resolve, 0))
  type CallInit = {
    method?: string
    body?: unknown
    rawBody?: string
    auth?: boolean
    host?: string | null
    query?: string
    noUrl?: boolean
  }
  const call = async (path: string, init: CallInit = {}) => {
    const handler = handlers.get(path)
    if (handler === undefined) throw new Error(`no route ${path}`)
    const headers: Record<string, string> = {}
    if (init.host !== null) headers['host'] = init.host ?? '127.0.0.1:3180'
    if (init.auth !== false) headers['x-idealize-auth'] = '1'
    const req = new AskbarRequest(`${path}${init.query ?? ''}`, init.method ?? (init.body === undefined && init.rawBody === undefined ? 'GET' : 'POST'), headers,
      init.rawBody ?? (init.body === undefined ? '' : JSON.stringify(init.body)))
    if (init.noUrl === true) Object.assign(req, { url: undefined })
    const res = new AskbarResponse()
    await handler(req, res)
    return res
  }
  return { ctx, call }
}

/** A comm fake serving one project chat and one board row. */
const comm = {
  async handle(request: { command: string }) {
    if (request.command === 'list') {
      return {
        ok: true,
        sessions: [
          { id: 's-juno', name: 'Juno', title: 'Launch email', projectPath: '/work/demo', unread: 1, role: 'chat', running: true, live: true },
        ],
      }
    }
    if (request.command === 'board') return { ok: true, rungs: [{ session: 's-juno', blocker: 'none' }] }
    return { ok: false }
  },
}

const studio = {
  async overview() {
    return [{ project: '/work/demo', state: await studio.state('/work/demo') }]
  },
  async state(project: string) {
    if (project !== '/work/demo') throw new Error(`unexpected project ${project}`)
    return {
      agents: { 's-juno': { displayed: 't1', queued: [], unresolved: [] } },
      tasks: [{
        id: 't1', goal: 'Draft the launch email', owner: 's-juno', state: 'working', attention: 'none',
        created: '2026-09-01T09:00:00Z', createdSeq: 1, updated: '2026-09-01T09:05:00Z',
      }],
      deliveries: {},
    }
  },
}

describe('askbar routes', () => {
  it('serves the joined roster with the configured timings', async () => {
    const { call } = await mount({ idealizeComm: comm, idealizeStudio: studio })
    const res = await call(ROSTER_PATH, { query: '?project=/work/demo' })
    expect(res.status).toBe(200)
    const roster = res.json() as AskbarRoster
    expect(roster.project).toBe('/work/demo')
    expect(roster.config).toMatchObject({ edge: 'left', pendingSendMs: 1000, hoverRevealMs: 150 })
    expect(roster.chips).toEqual([expect.objectContaining({
      id: 's-juno', name: 'Juno', state: 'working', task: 'Draft the launch email', unread: 1,
    })])
  })

  it('covers the requested sessions in order when the bar names them, and nothing when it names none', async () => {
    const twoChats = {
      async handle(request: { command: string }) {
        if (request.command === 'list') {
          return {
            ok: true,
            sessions: [
              { id: 's-juno', name: 'Juno', title: 'Launch email', projectPath: '/work/demo', unread: 0, role: 'chat', running: true, live: true },
              { id: 's-nova', name: 'Nova', title: 'Captions', projectPath: '/work/elsewhere', unread: 0, role: 'chat', running: false, live: false },
            ],
          }
        }
        return { ok: true, rungs: [] }
      },
    }
    const { call } = await mount({ idealizeComm: twoChats })
    const named = (await call(ROSTER_PATH, { query: '?project=/work/demo&sessions=s-nova,s-unknown,s-juno' })).json() as AskbarRoster
    expect(named.chips.map(chip => chip.id)).toEqual(['s-nova', 's-juno'])
    expect(named.chips[0]).toMatchObject({ state: 'idle' })
    const none = (await call(ROSTER_PATH, { query: '?project=/work/demo&sessions=' })).json() as AskbarRoster
    expect(none.chips).toEqual([])
    const unnamed = (await call(ROSTER_PATH, { query: '?project=/work/demo' })).json() as AskbarRoster
    expect(unnamed.chips.map(chip => chip.id)).toEqual(['s-juno'])
  })

  it('serves the skin’s still owl as WebP, loopback only', async () => {
    const { call } = await mount()
    const res = await call(OWL_PATH)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('image/webp')
    expect(res.bytes?.toString('base64')).toBe(OWL_FRAME_STILL.slice(OWL_FRAME_STILL.indexOf(',') + 1))
    // RIFF....WEBP: the decoded bytes are a WebP container.
    expect(res.bytes?.subarray(0, 4).toString('ascii')).toBe('RIFF')
    expect(res.bytes?.subarray(8, 12).toString('ascii')).toBe('WEBP')
    expect((await call(OWL_PATH, { host: 'evil.example:3180' })).status).toBe(403)
  })

  it('serves an empty roster when neither comm nor studio is composed', async () => {
    const { call } = await mount()
    const res = await call(ROSTER_PATH, { query: '?project=/work/demo' })
    expect(res.status).toBe(200)
    expect((res.json() as AskbarRoster).chips).toEqual([])
  })

  it('refuses a roster read without a project and from off-loopback', async () => {
    const { call } = await mount()
    expect((await call(ROSTER_PATH)).status).toBe(400)
    expect((await call(ROSTER_PATH, { query: '?project=/work/demo', host: 'evil.example:3180' })).status).toBe(403)
  })

  it('serves an empty roster, not an error, to a window with no project yet', async () => {
    const { call } = await mount({ idealizeComm: comm, idealizeStudio: studio })
    const res = await call(ROSTER_PATH, { query: '?project=' })
    expect(res.status).toBe(200)
    const roster = res.json() as AskbarRoster
    expect(roster.project).toBe('')
    expect(roster.chips).toEqual([])
  })

  it('answers 501 for a transform when no desktop shell is composed', async () => {
    const { call } = await mount()
    const res = await call(TRANSFORM_PATH, { body: { to: 'maxi' } })
    expect(res.status).toBe(501)
  })

  it('dispatches transforms to the desktop shell and validates the direction', async () => {
    const calls: string[] = []
    const desktopActions = {
      collapseToBar: () => { calls.push('mini') },
      expandFromBar: () => { calls.push('maxi') },
    }
    const { call } = await mount({ desktopActions })
    expect((await call(TRANSFORM_PATH, { body: { to: 'mini' } })).status).toBe(200)
    expect((await call(TRANSFORM_PATH, { body: { to: 'maxi' } })).status).toBe(200)
    expect(calls).toEqual(['mini', 'maxi'])
    expect((await call(TRANSFORM_PATH, { body: { to: 'sideways' } })).status).toBe(400)
    expect((await call(TRANSFORM_PATH, { body: { to: 'maxi' }, auth: false })).status).toBe(403)
  })

  it('hands the keyboard to the bar window and back through the desktop shell, and validates the flag', async () => {
    const focusBar = vi.fn()
    const { call } = await mount({ desktopActions: { focusBar } })
    expect((await call(FOCUS_PATH, { body: { focus: true } })).status).toBe(200)
    expect((await call(FOCUS_PATH, { body: { focus: false } })).status).toBe(200)
    expect(focusBar.mock.calls).toEqual([[true], [false]])
    expect((await call(FOCUS_PATH, { body: { focus: 'yes' } })).status).toBe(400)
    expect((await call(FOCUS_PATH, { body: { focus: true }, auth: false })).status).toBe(403)
    const bare = await mount({})
    expect((await bare.call(FOCUS_PATH, { body: { focus: true } })).status).toBe(501)
  })

  it('relays a Group chat request onto the host bridge before the transform, and validates it', async () => {
    const pushed: unknown[] = []
    const calls: string[] = []
    const idealizeBridge = { buffer: { push: (event: unknown) => { pushed.push(event); return event } } }
    const desktopActions = { collapseToBar: () => {}, expandFromBar: () => { calls.push('maxi') } }
    const { call } = await mount({ desktopActions, idealizeBridge })
    expect((await call(TRANSFORM_PATH, { body: { to: 'maxi', open: 'studio', project: '/work/demo' } })).status).toBe(200)
    expect(pushed).toEqual([{ kind: 'open-studio', title: 'Open the Studio', body: '/work/demo', project: '/work/demo' }])
    expect(calls).toEqual(['maxi'])
    // A plain expand pushes nothing; a malformed request pushes nothing and moves no window.
    expect((await call(TRANSFORM_PATH, { body: { to: 'maxi' } })).status).toBe(200)
    expect((await call(TRANSFORM_PATH, { body: { to: 'maxi', open: 'gallery', project: '/work/demo' } })).status).toBe(400)
    expect(pushed).toHaveLength(1)
    // The Studio spans every project: a request without one still opens it.
    expect((await call(TRANSFORM_PATH, { body: { to: 'maxi', open: 'studio' } })).status).toBe(200)
    expect(pushed[1]).toEqual({ kind: 'open-studio', title: 'Open the Studio', body: '' })
    expect(calls).toEqual(['maxi', 'maxi', 'maxi'])
  })

  it('serves a Group chat request without a desktop shell: the bridge event lands, the transform answers 501', async () => {
    const pushed: unknown[] = []
    const idealizeBridge = { buffer: { push: (event: unknown) => { pushed.push(event); return event } } }
    const { call } = await mount({ idealizeBridge })
    expect((await call(TRANSFORM_PATH, { body: { to: 'maxi', open: 'studio', project: '/work/demo' } })).status).toBe(501)
    expect(pushed).toHaveLength(1)
  })

  it('refuses a request with no host header, and 400s one with no URL', async () => {
    const { call } = await mount()
    expect((await call(ROSTER_PATH, { host: null })).status).toBe(403)
    expect((await call(ROSTER_PATH, { noUrl: true })).status).toBe(400)
  })

  it('answers 500 with the failure text when a roster source throws', async () => {
    const brokenComm = { handle: async () => { throw new Error('comm exploded') } }
    const { call } = await mount({ idealizeComm: brokenComm })
    const res = await call(ROSTER_PATH, { query: '?project=/work/demo' })
    expect(res.status).toBe(500)
    expect(res.json()).toMatchObject({ ok: false, error: 'comm exploded' })

    const rudeComm = { handle: async () => { throw 'not an Error' } }
    const { call: rudeCall } = await mount({ idealizeComm: rudeComm })
    const rude = await rudeCall(ROSTER_PATH, { query: '?project=/work/demo' })
    expect(rude.status).toBe(500)
    expect(rude.json()).toMatchObject({ ok: false, error: 'not an Error' })
  })

  it('rejects non-POST and non-JSON transform requests', async () => {
    const { call } = await mount()
    expect((await call(TRANSFORM_PATH, { method: 'GET' })).status).toBe(405)
    expect((await call(TRANSFORM_PATH, { method: 'POST', rawBody: 'not json' })).status).toBe(400)
  })

  it('answers 500 with the failure text when the shell transform throws', async () => {
    const { call } = await mount({ desktopActions: { collapseToBar: () => { throw new Error('no display') } } })
    const res = await call(TRANSFORM_PATH, { body: { to: 'mini' } })
    expect(res.status).toBe(500)
    expect(res.json()).toMatchObject({ ok: false, error: 'no display' })

    const { call: rudeCall } = await mount({ desktopActions: { collapseToBar: () => { throw 'window gone' } } })
    const rude = await rudeCall(TRANSFORM_PATH, { body: { to: 'mini' } })
    expect(rude.status).toBe(500)
    expect(rude.json()).toMatchObject({ ok: false, error: 'window gone' })
  })
})

/** comm across two projects, plus one chat outside every project. */
const twoProjects = {
  async handle(request: { command: string; path?: string }) {
    if (request.command === 'list') {
      return {
        ok: true,
        sessions: [
          { id: 's-nova', name: 'Nova', title: 'Captions', projectPath: '/work/other', unread: 0, role: 'chat', running: false, live: false },
          { id: 's-juno', name: 'Juno', title: 'Launch email', projectPath: '/work/demo', unread: 1, role: 'chat', running: true, live: true },
          { id: 's-loose', name: 'Loose', title: 'Scratch', unread: 0, role: 'chat', running: false, live: false },
        ],
      }
    }
    // The grouped read asks for every project's rungs, naming no path.
    if (request.command === 'board' && request.path === undefined) {
      return { ok: true, rungs: [{ session: 's-nova', blocker: 'waiting-on-user' }] }
    }
    return { ok: true, rungs: [] }
  },
}

describe('the roster across every project', () => {
  it('groups each project’s agents in path order, naming the folder’s last segment', async () => {
    const { call } = await mount({ idealizeComm: twoProjects, idealizeStudio: studio })
    const roster = (await call(ROSTER_PATH, { query: '?project=/work/demo&all=1' })).json() as AskbarRoster
    expect(roster.groups?.map(group => [group.project, group.name])).toEqual([
      ['/work/demo', 'demo'],
      ['/work/other', 'other'],
    ])
    expect(roster.groups?.map(group => group.chips.map(chip => chip.id))).toEqual([['s-juno'], ['s-nova']])
    // A chat belonging to no project joins no group.
    expect(roster.groups?.flatMap(group => group.chips).map(chip => chip.id)).not.toContain('s-loose')
  })

  it('groups the rows the sidebar names, in the order it names them, and no other', async () => {
    const { call } = await mount({ idealizeComm: twoProjects, idealizeStudio: studio })
    // The sidebar lists other before demo; a loose chat and an id comm has
    // not seen ride along and contribute nothing.
    const roster = (await call(ROSTER_PATH, { query: '?project=/work/demo&all=1&sessions=s-nova,s-juno,s-loose,s-unknown' })).json() as AskbarRoster
    expect(roster.groups?.map(group => [group.project, group.chips.map(chip => chip.id)])).toEqual([
      ['/work/other', ['s-nova']],
      ['/work/demo', ['s-juno']],
    ])
    // Named rows alone: a project whose rows the sidebar did not name has no group.
    const one = (await call(ROSTER_PATH, { query: '?project=/work/demo&all=1&sessions=s-juno' })).json() as AskbarRoster
    expect(one.groups?.map(group => group.project)).toEqual(['/work/demo'])
    // No rows named at all: no groups, and the window's own chips stay empty too.
    const none = (await call(ROSTER_PATH, { query: '?project=/work/demo&all=1&sessions=' })).json() as AskbarRoster
    expect(none.groups).toEqual([])
    expect(none.chips).toEqual([])
  })

  it('reads each project’s own fold and its own board rows', async () => {
    const { call } = await mount({ idealizeComm: twoProjects, idealizeStudio: studio })
    const roster = (await call(ROSTER_PATH, { query: '?project=/work/demo&all=1' })).json() as AskbarRoster
    // The fold the Studio holds for demo names Juno's task; other has no fold.
    expect(roster.groups?.[0]?.chips[0]).toMatchObject({ task: 'Draft the launch email', state: 'working' })
    // The board row for Nova comes from the pathless read, so it lands even
    // though the window follows another project.
    expect(roster.groups?.[1]?.chips[0]).toMatchObject({ state: 'needs-input' })
  })

  it('groups even for a window that names no project yet, and carries no groups unless asked', async () => {
    const { call } = await mount({ idealizeComm: twoProjects, idealizeStudio: studio })
    const homeless = (await call(ROSTER_PATH, { query: '?project=&all=1' })).json() as AskbarRoster
    expect(homeless.chips).toEqual([])
    expect(homeless.groups?.map(group => group.project)).toEqual(['/work/demo', '/work/other'])

    const unasked = (await call(ROSTER_PATH, { query: '?project=/work/demo' })).json() as AskbarRoster
    expect(unasked.groups).toBeUndefined()
  })

  it('groups on what comm alone can tell when no Studio is composed', async () => {
    const { call } = await mount({ idealizeComm: twoProjects })
    const roster = (await call(ROSTER_PATH, { query: '?project=/work/demo&all=1' })).json() as AskbarRoster
    expect(roster.groups?.map(group => group.chips.map(chip => chip.state))).toEqual([['working'], ['needs-input']])
  })

  it('names a chat living at the filesystem root by that path', async () => {
    const atRoot = {
      async handle(request: { command: string }) {
        if (request.command !== 'list') return { ok: true, rungs: [] }
        return {
          ok: true,
          sessions: [{ id: 's-root', name: 'Root', title: 'Scratch', projectPath: '/', unread: 0, role: 'chat', running: false, live: false }],
        }
      },
    }
    const { call } = await mount({ idealizeComm: atRoot })
    const roster = (await call(ROSTER_PATH, { query: '?project=&all=1' })).json() as AskbarRoster
    expect(roster.groups?.map(group => [group.project, group.name])).toEqual([['/', '/']])
  })

  it('serves no groups at all when comm is absent', async () => {
    const { call } = await mount({})
    const roster = (await call(ROSTER_PATH, { query: '?project=/work/demo&all=1' })).json() as AskbarRoster
    expect(roster.groups).toEqual([])
  })
})
