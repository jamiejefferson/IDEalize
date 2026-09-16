/**
 * The hatch over a real DSH home: what the inspector reports, what a home
 * patch save accepts and snapshots, what a rollback restores, and the fences
 * that keep all of it on this machine.
 */

import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply } from '../src/index.ts'
import { describeError } from '../src/service.ts'

const PATCH = "- insert:\n    - id: demo-row\n      name: '@demo/row'\n"

class FakeRequest extends EventEmitter {
  headers: Record<string, string>
  constructor(public method: string, public url: string, headers: Record<string, string>, private readonly body = '') {
    super()
    this.headers = headers
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<Buffer> {
    if (this.body !== '') yield Buffer.from(this.body)
  }
}

class FakeResponse {
  status = 0
  headers: Record<string, string> = {}
  body = ''
  writeHead(status: number, headers: Record<string, string> = {}) {
    this.status = status
    this.headers = headers
    return this
  }

  end(chunk?: string) { if (chunk !== undefined) this.body += chunk }
  json(): { [key: string]: unknown } { return JSON.parse(this.body) as { [key: string]: unknown } }
}

const homes: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  for (const context of contexts.splice(0)) await context.fiber.dispose()
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

/** One host root over a scratch DSH home, with the two services the hatch acquires. */
async function mount(options: {
  profile?: 'good' | 'broken'
  homePatch?: string
  serviceSource?: string
  settings?: false
  createThrows?: unknown
} = {}) {
  const home = mkdtempSync(join(tmpdir(), 'idealize-hatch-home-'))
  homes.push(home)
  vi.stubEnv('DSH_HOME', home)
  if (options.homePatch !== undefined) writeFileSync(join(home, 'cordis.patch.yml'), options.homePatch, 'utf8')
  if (options.profile !== undefined) {
    const dir = join(home, 'profiles', 'demo')
    mkdirSync(dir, { recursive: true })
    // A profile naming one bundle layer; an unreadable manifest is the error
    // the inspector reports beside the profile instead of failing the request.
    writeFileSync(
      join(dir, 'package.json'),
      options.profile === 'good' ? '{"name":"demo","dsh":{"profile":{"bundles":["@demo/bundle"]}}}' : 'not json',
      'utf8',
    )
    writeFileSync(join(dir, 'cordis.patch.yml'), PATCH, 'utf8')
    const bundle = join(dir, 'node_modules', '@demo', 'bundle')
    mkdirSync(bundle, { recursive: true })
    writeFileSync(join(bundle, 'package.json'), '{"name":"@demo/bundle","dsh":{"bundle":{"patch":"cordis.patch.yml"}}}', 'utf8')
    writeFileSync(join(bundle, 'cordis.patch.yml'), "- insert:\n    - id: bundle-row\n      name: '@demo/bundle-row'\n", 'utf8')
  }

  const ctx = new Context()
  contexts.push(ctx)
  const handlers = new Map<string, (req: FakeRequest, res: FakeResponse) => Promise<void> | void>()
  const created: string[] = []
  let stored = options.serviceSource
  if (options.settings !== false) {
    ctx.provide('settings', {
      register: () => ({ get: () => ({ serviceSource: stored }), watch: () => () => {} }),
      update: async (_ns: unknown, patch: { serviceSource?: string }) => { stored = patch.serviceSource },
    } as never)
  }
  ctx.provide('webServer', {
    register(route: { path: string; handler: (req: FakeRequest, res: FakeResponse) => Promise<void> | void }) {
      handlers.set(route.path, route.handler)
      return () => { handlers.delete(route.path) }
    },
  } as never)
  ctx.provide('workspaceRegistry', {
    resolveByPath: async (path: string) => (path === options.serviceSource && created.includes(path) ? { id: 'ws-existing' } : undefined),
    create: async (path: string) => {
      if (options.createThrows !== undefined) throw options.createThrows
      created.push(path)
      return { id: 'ws-new' }
    },
  } as never)

  await ctx.plugin(
    { name: 'idealize-hatch', inject: [], apply },
    options.serviceSource === undefined ? {} : { serviceSource: options.serviceSource },
  ).await()

  const call = async (
    path: string,
    init: { method?: string; body?: string; auth?: boolean; host?: string; query?: string | null } = {},
  ) => {
    const handler = handlers.get(path)
    if (handler === undefined) throw new Error(`no route ${path}`)
    // An empty host stands for a request that carries no Host header at all.
    const headers: Record<string, string> = init.host === '' ? {} : { host: init.host ?? '127.0.0.1:3180' }
    if (init.auth !== false) headers['x-idealize-auth'] = '1'
    const res = new FakeResponse()
    // A null query stands for a request that carries no url at all.
    const url = init.query === null ? undefined : `${path}${init.query ?? ''}`
    await handler(new FakeRequest(init.method ?? 'GET', url as string, headers, init.body ?? ''), res)
    return res
  }
  return { home, call, created, source: () => stored }
}

describe('the inspector', () => {
  it('serves its own page', async () => {
    const { call } = await mount()
    const page = await call('/idealize/hatch')
    expect(page.status).toBe(200)
    expect(page.body).toContain('idealize/hatch/composition')
  })

  it('reports every profile’s layers and the entries they compose to', async () => {
    const homePatch = "- insert:\n    - id: home-row\n      name: '@demo/home'\n"
    const { home, call } = await mount({ profile: 'good', homePatch })
    const answer = (await call('/idealize/hatch/composition')).json()
    expect(answer.home).toBe(home)
    expect(answer.homePatchCount).toBe(1)
    expect(answer.profiles).toEqual([{
      name: 'demo',
      layers: [{ packageName: '@demo/bundle', patchCount: 1 }],
      profilePatchCount: 1,
      entries: ['bundle-row', 'demo-row', 'home-row'],
    }])
  })

  it('names the profile it cannot read instead of failing the request', async () => {
    const { call } = await mount({ profile: 'broken' })
    const [profile] = (await call('/idealize/hatch/composition')).json().profiles as { error?: string }[]
    expect(profile?.error).toBeDefined()
  })

  it('reports no profiles and an empty patch on an untouched home', async () => {
    const { call } = await mount()
    expect((await call('/idealize/hatch/composition')).json()).toMatchObject({ homePatchCount: 0, profiles: [] })
    expect((await call('/idealize/hatch/home-patch')).body).toBe('')
    expect((await call('/idealize/hatch/snapshots')).json()).toEqual([])
  })
})

describe('saving the home patch', () => {
  it('validates, snapshots the previous content, and writes the new one', async () => {
    const { home, call } = await mount({ homePatch: '- insert:\n    - id: old-row\n      name: "@demo/old"\n' })
    const saved = await call('/idealize/hatch/home-patch', { method: 'POST', body: JSON.stringify({ content: PATCH }) })

    expect(saved.status).toBe(200)
    expect(saved.json()).toMatchObject({ ok: true, note: 'restart applies the change' })
    expect(readFileSync(join(home, 'cordis.patch.yml'), 'utf8')).toBe(PATCH)
    const snapshots = (await call('/idealize/hatch/snapshots')).json() as unknown as string[]
    expect(snapshots).toHaveLength(1)
    expect(readFileSync(join(home, 'hatch-snapshots', snapshots[0]!), 'utf8')).toContain('old-row')
  })

  it('removes the file when the layer is emptied, since boot refuses an empty one', async () => {
    const { home, call } = await mount({ homePatch: PATCH })
    expect((await call('/idealize/hatch/home-patch', { method: 'POST', body: JSON.stringify({ content: '  ' }) })).status).toBe(200)
    expect(readdirSync(home)).not.toContain('cordis.patch.yml')
    // Emptying an already-absent layer is the same answer with no snapshot.
    const again = await call('/idealize/hatch/home-patch', { method: 'POST', body: JSON.stringify({ content: '' }) })
    expect(again.json().snapshot).toBeUndefined()
  })

  it('refuses a body with no content and YAML the loader rejects', async () => {
    const { call } = await mount()
    expect((await call('/idealize/hatch/home-patch', { method: 'POST', body: JSON.stringify({ content: 7 }) })).status).toBe(400)
    const invalid = await call('/idealize/hatch/home-patch', { method: 'POST', body: JSON.stringify({ content: 'id: not-a-list\n' }) })
    expect(invalid.status).toBe(422)
    expect(String(invalid.json().error)).toContain('patch rejected')
  })

  it('answers its own failure rather than hanging up', async () => {
    const { call } = await mount()
    const broken = await call('/idealize/hatch/home-patch', { method: 'POST', body: 'not json at all' })
    expect(broken.status).toBe(500)
    expect(broken.json().error).toBeDefined()
  })

  it('demands the header for a write, whichever route carries it', async () => {
    const { call } = await mount()
    expect((await call('/idealize/hatch/home-patch', { method: 'POST', body: '{}', auth: false })).status).toBe(403)
    expect((await call('/idealize/hatch/rollback', { auth: false })).status).toBe(403)
  })
})

describe('rolling back', () => {
  it('restores a snapshot and keeps the content it replaced', async () => {
    const { home, call } = await mount({ homePatch: '- insert:\n    - id: first-row\n      name: "@demo/first"\n' })
    await call('/idealize/hatch/home-patch', { method: 'POST', body: JSON.stringify({ content: PATCH }) })
    const [snapshot] = (await call('/idealize/hatch/snapshots')).json() as unknown as string[]

    const rolled = await call('/idealize/hatch/rollback', { query: `?name=${snapshot!}` })
    expect(rolled.json()).toMatchObject({ ok: true, restored: snapshot })
    expect(rolled.json().previousSavedAs).toBeDefined()
    expect(readFileSync(join(home, 'cordis.patch.yml'), 'utf8')).toContain('first-row')
  })

  it('keeps two snapshots taken in the same millisecond apart, so a rollback restores the older one', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-16T20:00:00.000Z'))
    try {
      const { home, call } = await mount({ homePatch: '- insert:\n    - id: first-row\n      name: "@demo/first"\n' })
      await call('/idealize/hatch/home-patch', { method: 'POST', body: JSON.stringify({ content: PATCH }) })
      await call('/idealize/hatch/home-patch', { method: 'POST', body: JSON.stringify({ content: '' }) })
      const names = (await call('/idealize/hatch/snapshots')).json() as unknown as string[]
      expect(names).toEqual(['2026-09-16T20-00-00-000Z_1.yml', '2026-09-16T20-00-00-000Z.yml'])
      const rolled = await call('/idealize/hatch/rollback', { query: `?name=${names[1]!}` })
      expect(rolled.json()).toMatchObject({ ok: true, restored: names[1] })
      expect(readFileSync(join(home, 'cordis.patch.yml'), 'utf8')).toContain('first-row')
    } finally {
      vi.useRealTimers()
    }
  })

  it('refuses a name that is not a snapshot filename, and one that is not there', async () => {
    const { call } = await mount()
    expect((await call('/idealize/hatch/rollback')).status).toBe(400)
    expect((await call('/idealize/hatch/rollback', { query: '?name=../escape.yml' })).status).toBe(400)
    expect((await call('/idealize/hatch/rollback', { query: '?name=notes.txt' })).status).toBe(400)
    expect((await call('/idealize/hatch/rollback', { query: '?name=2026-01-01.yml' })).status).toBe(404)
    // A request that names no url has no name to roll back to either.
    expect((await call('/idealize/hatch/rollback', { query: null })).status).toBe(400)
  })

  it('takes no snapshot when there is no home patch to keep', async () => {
    const { home, call } = await mount({ homePatch: PATCH })
    const [snapshot] = await (async () => {
      await call('/idealize/hatch/home-patch', { method: 'POST', body: JSON.stringify({ content: '' }) })
      return (await call('/idealize/hatch/snapshots')).json() as unknown as string[]
    })()

    const rolled = await call('/idealize/hatch/rollback', { query: `?name=${snapshot!}` })
    expect(rolled.json()).toEqual({ ok: true, restored: snapshot })
    expect(readFileSync(join(home, 'cordis.patch.yml'), 'utf8')).toBe(PATCH)
  })
})

describe('what the hatch falls back to', () => {
  it('reads the composed config when no settings provider is present', async () => {
    const source = mkdtempSync(join(tmpdir(), 'idealize-hatch-src-'))
    homes.push(source)
    writeFileSync(join(source, 'FORK.md'), '# fork', 'utf8')
    writeFileSync(join(source, 'package.json'), '{}', 'utf8')
    const { call } = await mount({ serviceSource: source, settings: false })

    expect((await call('/idealize/hatch/service')).json()).toMatchObject({ path: source, valid: true })
    // With nowhere to persist to, the Service tab's edit is refused rather
    // than silently dropped.
    expect((await call('/idealize/hatch/service', { method: 'POST', body: JSON.stringify({ path: source }) })).status).toBe(503)
  })

  it('resolves bundles from the working directory when the process names no entrypoint', async () => {
    const argv = process.argv
    process.argv = ['node']
    try {
      const { call } = await mount({ profile: 'good' })
      expect((await call('/idealize/hatch/composition')).json().profiles).toHaveLength(1)
    } finally {
      process.argv = argv
    }
  })

  it('reports a thrown value that is no Error', async () => {
    const source = mkdtempSync(join(tmpdir(), 'idealize-hatch-src-'))
    homes.push(source)
    writeFileSync(join(source, 'FORK.md'), '# fork', 'utf8')
    writeFileSync(join(source, 'package.json'), '{}', 'utf8')
    const { call } = await mount({ serviceSource: source, createThrows: 'the registry said no' })

    const failed = await call('/idealize/hatch/amend', { method: 'POST' })
    expect([failed.status, failed.json()]).toEqual([500, { error: 'the registry said no' }])
  })

  it('describes an Error by its message and anything else by its text', () => {
    expect(describeError(new Error('the file is locked'))).toBe('the file is locked')
    expect(describeError({ toString: () => 'a thrown object' })).toBe('a thrown object')
  })
})

describe('the amend flow', () => {
  /** A directory carrying the fork markers the source probe checks for. */
  const checkout = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'idealize-hatch-src-'))
    homes.push(dir)
    writeFileSync(join(dir, 'FORK.md'), '# fork', 'utf8')
    writeFileSync(join(dir, 'package.json'), '{}', 'utf8')
    return dir
  }

  it('opens the service source as a project, then reuses it', async () => {
    const source = checkout()
    const { call, created } = await mount({ serviceSource: source })

    const opened = await call('/idealize/hatch/amend', { method: 'POST' })
    expect(opened.json()).toEqual({ ok: true, workspaceId: 'ws-new', path: source, created: true })
    expect(created).toEqual([source])

    const reopened = await call('/idealize/hatch/amend', { method: 'POST' })
    expect(reopened.json()).toEqual({ ok: true, workspaceId: 'ws-existing', path: source, created: false })
  })

  it('says where it looked when no checkout is there', async () => {
    const { call } = await mount({ serviceSource: join(tmpdir(), 'idealize-hatch-absent') })
    const refused = await call('/idealize/hatch/amend', { method: 'POST' })
    expect(refused.status).toBe(422)
    expect(String(refused.json().error)).toContain('needs FORK.md + package.json')
  })

  it('reports the source and lets the Service tab move it', async () => {
    const source = checkout()
    const { call, source: stored } = await mount({ serviceSource: source })
    expect((await call('/idealize/hatch/service')).json()).toMatchObject({ path: source, valid: true })

    const moved = checkout()
    expect((await call('/idealize/hatch/service', { method: 'POST', body: JSON.stringify({ path: moved }) })).status).toBe(200)
    expect(stored()).toBe(moved)
  })
})

describe('the loopback fence', () => {
  it('answers this machine alone, on every route', async () => {
    const { call } = await mount()
    expect((await call('/idealize/hatch', { host: 'example.com' })).status).toBe(403)
    expect((await call('/idealize/hatch/composition', { host: '' })).status).toBe(403)
    expect((await call('/idealize/hatch/snapshots', { host: 'localhost:3180' })).status).toBe(200)
    expect((await call('/idealize/hatch/home-patch', { host: '[::1]:3180' })).status).toBe(200)
  })
})
