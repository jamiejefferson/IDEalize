/**
 * The `/idealize/cron/*` routes the Schedule pane reads and writes through,
 * and the agent run a fire performs: what a task's run records, what a
 * reminder skips, and what happens when the agent services are not there.
 */

import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply } from '../src/index.ts'
import type { CronTask } from '../src/store.ts'

type Handler = (req: FakeRequest, res: FakeResponse) => Promise<void>

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
  body = ''
  writeHead(status: number) { this.status = status; return this }
  end(chunk?: string) { if (chunk !== undefined) this.body += chunk }
  json(): { [key: string]: unknown } { return JSON.parse(this.body) as { [key: string]: unknown } }
}

const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  for (const context of contexts.splice(0)) await context.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/** A future one-off, far enough out that no timer fires during the test. */
const reminder = (overrides: Partial<CronTask> = {}) => ({
  name: 'Dentist',
  schedule: { kind: 'at', at: '2099-03-04T09:30:00Z' },
  cwd: '/Users/jj/Life',
  remind: true,
  ...overrides,
})

/** One host root serving every cron route, with the agent stack optionally faked. */
async function mount(options: {
  agents?: false | { errors?: boolean; slow?: boolean; quietTurn?: boolean }
  flushThrows?: unknown
  home?: string
  notifierThrows?: unknown
} = {}) {
  const root = options.home ?? await mkdtemp(join(tmpdir(), 'idealize-cron-routes-'))
  if (options.home === undefined) roots.push(root)
  vi.stubEnv('DSH_HOME', root)
  const ctx = new Context()
  contexts.push(ctx)
  const handlers = new Map<string, Handler>()
  const prompts: string[] = []

  ctx.provide('webServer', {
    register(route: { path: string; handler: Handler }) {
      handlers.set(route.path, route.handler)
      return () => { handlers.delete(route.path) }
    },
  } as never)
  if (options.agents !== false) {
    const events = options.agents?.errors === true
      ? [{ type: 'turn/end', data: { reason: { kind: 'error', error: { code: 'no_key', message: 'the key expired' } } } }]
      : options.agents?.quietTurn === true
        ? [{ type: 'turn/end', data: { reason: { kind: 'stop' } } }]
        : []
    ctx.provide('agents', {
      create: async ({ setup }: { setup: (agentCtx: Context) => void }) => {
        setup(ctx)
        return {
          agent: {
            whenIdle: async () => {
              if (options.agents !== false && options.agents?.slow === true) {
                await new Promise(resolve => setTimeout(resolve, 50))
              }
            },
            followup: (message: { content: { text: string }[] }) => { prompts.push(message.content[0]!.text) },
            session: { events },
          },
        }
      },
    } as never)
    ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'openai-codex', model: 'gpt-5.5' }) } as never)
    ctx.provide('sessions', {
      flush: async () => {
        if (options.flushThrows !== undefined) throw options.flushThrows
      },
    } as never)
  }

  if (options.notifierThrows !== undefined) {
    ctx.provide('idealizeDesktop', {
      notify: () => { throw options.notifierThrows },
    } as never)
  }
  await ctx.plugin({ name: 'idealize-cron', inject: [], apply }).await()
  await ctx.plugin({
    name: 'idealize-cron-config',
    inject: ['idealizeCron'],
    apply: () => {},
  }).await()

  const call = async (
    path: string,
    init: { method?: string; body?: unknown; auth?: boolean; host?: string; query?: string | null } = {},
  ) => {
    const handler = handlers.get(path)
    if (handler === undefined) throw new Error(`no route ${path}`)
    // An empty host stands for a request that carries no Host header at all.
    const headers: Record<string, string> = init.host === '' ? {} : { host: init.host ?? '127.0.0.1:3180' }
    if (init.auth !== false) headers['x-idealize-auth'] = '1'
    const res = new FakeResponse()
    // A null query stands for a request that carries no url at all.
    await handler(new FakeRequest(
      init.method ?? 'GET',
      (init.query === null ? undefined : `${path}${init.query ?? ''}`) as string,
      headers,
      init.body === undefined ? '' : (typeof init.body === 'string' ? init.body : JSON.stringify(init.body)),
    ), res)
    return res
  }
  return { ctx, call, prompts, root }
}

describe('the schedule routes', () => {
  it('save a task, list it, toggle it, and delete it', async () => {
    const { call } = await mount()
    const saved = await call('/idealize/cron/tasks', { method: 'POST', body: reminder() })
    expect(saved.status).toBe(200)
    const id = String(saved.json().id)

    const listed = (await call('/idealize/cron/tasks')).json() as unknown as { id: string; nextFireAt?: string }[]
    expect(listed.map(task => task.id)).toEqual([id])

    const toggled = (await call('/idealize/cron/toggle', { query: `?id=${id}` })).json()
    expect(toggled.enabled).toBe(false)

    expect((await call('/idealize/cron/delete', { query: `?id=${id}` })).json()).toEqual({ deleted: true })
    expect((await call('/idealize/cron/tasks')).json()).toEqual([])
  })

  it('say so when the task to toggle is not there', async () => {
    const { call } = await mount()
    const missing = await call('/idealize/cron/toggle', { query: '?id=nobody' })
    expect([missing.status, missing.json()]).toEqual([404, { error: 'unknown task' }])
  })

  it('report the runs a task recorded', async () => {
    const { call } = await mount()
    const id = String((await call('/idealize/cron/tasks', { method: 'POST', body: reminder() })).json().id)
    await call('/idealize/cron/run-now', { query: `?id=${id}` })

    const all = (await call('/idealize/cron/runs')).json() as unknown as { taskId: string }[]
    expect(all.map(run => run.taskId)).toEqual([id])
    expect(((await call('/idealize/cron/runs', { query: '?task=nobody' })).json() as unknown as unknown[])).toEqual([])
  })

  it('answer their own failure rather than hanging up', async () => {
    const { call } = await mount()
    const refused = await call('/idealize/cron/tasks', { method: 'POST', body: 'not json at all' })
    expect(refused.status).toBe(500)
    expect(refused.json().error).toBeDefined()

    const unknown = await call('/idealize/cron/run-now', { query: '?id=nobody' })
    expect([unknown.status, unknown.json()]).toEqual([500, { error: 'unknown cron task nobody' }])
  })

  it('answer this machine alone, and demand the header before a write', async () => {
    const { call } = await mount()
    expect((await call('/idealize/cron/tasks', { host: 'example.com' })).status).toBe(403)
    expect((await call('/idealize/cron/tasks', { host: '' })).status).toBe(403)
    expect((await call('/idealize/cron/tasks', { method: 'POST', body: reminder(), auth: false })).status).toBe(403)
    expect((await call('/idealize/cron/delete', { query: '?id=x', auth: false })).status).toBe(403)
    expect((await call('/idealize/cron/tasks', { host: 'localhost:3180' })).status).toBe(200)
    expect((await call('/idealize/cron/runs', { host: '[::1]:3180' })).status).toBe(200)
  })
})

describe('what a fire runs', () => {
  it('runs the task’s prompt in its own session and records the run', async () => {
    const { call, prompts } = await mount()
    const id = String((await call('/idealize/cron/tasks', {
      method: 'POST',
      body: reminder({ remind: false, prompt: 'Write the brief.' }),
    })).json().id)

    const run = (await call('/idealize/cron/run-now', { query: `?id=${id}` })).json()
    expect(prompts).toEqual(['Write the brief.'])
    expect(run.status).toBe('ok')
    expect(typeof run.sessionId).toBe('string')
  })

  it('records the turn’s own error as the run’s detail', async () => {
    const { call } = await mount({ agents: { errors: true } })
    const id = String((await call('/idealize/cron/tasks', {
      method: 'POST',
      body: reminder({ remind: false, prompt: 'Write the brief.' }),
    })).json().id)

    const run = (await call('/idealize/cron/run-now', { query: `?id=${id}` })).json()
    expect([run.status, run.detail]).toEqual(['error', 'no_key: the key expired'])
  })

  it('records the failure when the agent services are not composed', async () => {
    const { call } = await mount({ agents: false })
    const id = String((await call('/idealize/cron/tasks', {
      method: 'POST',
      body: reminder({ remind: false, prompt: 'Write the brief.' }),
    })).json().id)

    const run = (await call('/idealize/cron/run-now', { query: `?id=${id}` })).json()
    expect([run.status, run.detail]).toEqual(['error', 'agent services unavailable (tree still composing or tearing down)'])
  })

  it('runs one fire at a time, recording the second as skipped', async () => {
    const { ctx, call } = await mount({ agents: { slow: true } })
    const id = String((await call('/idealize/cron/tasks', {
      method: 'POST',
      body: reminder({ remind: false, prompt: 'Write the brief.' }),
    })).json().id)

    const [first, second] = await Promise.all([ctx.idealizeCron.fire(id), ctx.idealizeCron.fire(id)])
    expect([first.status, second.status].sort()).toEqual(['ok', 'skipped-busy'])
  })

  it('reports a thrown value that is no Error as the run’s detail', async () => {
    const { ctx, call } = await mount({ flushThrows: 'the session store said no' })
    const id = String((await call('/idealize/cron/tasks', {
      method: 'POST',
      body: reminder({ remind: false, prompt: 'Write the brief.' }),
    })).json().id)
    const run = await ctx.idealizeCron.fire(id)
    expect([run.status, run.detail]).toEqual(['error', 'the session store said no'])
  })
})

describe('what a saved task carries', () => {
  it('names an unnamed task, and keeps the route a task chooses for itself', async () => {
    const { call } = await mount()
    const plain = (await call('/idealize/cron/tasks', { method: 'POST', body: reminder({ name: '' }) })).json()
    expect(plain.name).toBe('Scheduled task')
    expect(plain.provider).toBeUndefined()

    const routed = (await call('/idealize/cron/tasks', {
      method: 'POST',
      body: reminder({ provider: 'anthropic', model: 'claude-x' }),
    })).json()
    expect([routed.provider, routed.model]).toEqual(['anthropic', 'claude-x'])
  })
})

describe('what a request naming nothing gets', () => {
  it('is answered rather than crashing, on every route that reads a query', async () => {
    const { call } = await mount()
    expect((await call('/idealize/cron/delete')).json()).toEqual({ deleted: false })
    expect((await call('/idealize/cron/toggle')).status).toBe(404)
    expect((await call('/idealize/cron/runs', { query: null })).json()).toEqual([])
    expect((await call('/idealize/cron/delete', { query: null })).json()).toEqual({ deleted: false })
    expect((await call('/idealize/cron/toggle', { query: null })).status).toBe(404)
    expect((await call('/idealize/cron/run-now', { query: null })).status).toBe(500)
  })

  it('arms the tasks a previous run left in the document', async () => {
    const first = await mount()
    await first.call('/idealize/cron/tasks', { method: 'POST', body: reminder() })
    await first.ctx.fiber.dispose()

    const second = await mount({ home: first.root })
    const listed = (await second.call('/idealize/cron/tasks')).json() as unknown as { nextFireAt?: string }[]
    expect(listed).toHaveLength(1)
    expect(typeof listed[0]?.nextFireAt).toBe('string')
  })

  it('takes a turn that ended without an error as a clean run', async () => {
    const { call } = await mount({ agents: { quietTurn: true } })
    const id = String((await call('/idealize/cron/tasks', {
      method: 'POST',
      body: reminder({ remind: false, prompt: 'Write the brief.' }),
    })).json().id)
    expect((await call('/idealize/cron/run-now', { query: `?id=${id}` })).json().status).toBe('ok')
  })
})
