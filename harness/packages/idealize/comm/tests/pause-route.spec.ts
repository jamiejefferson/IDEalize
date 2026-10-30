// `/idealize/pause` on a mounted plugin (feedback 495cec0a): a working chat
// agent is steered to save its notes, the pause completes when it goes idle,
// the document lands under the harness home, and Resume follows up with the
// carry-on line.
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, PAUSE_PATH } from '../src/index.ts'

class FakeRequest extends EventEmitter {
  constructor(readonly method: string, readonly headers: Record<string, string>, private readonly body: string) { super() }
  async *[Symbol.asyncIterator]() { if (this.body !== '') yield Buffer.from(this.body) }
}

class FakeResponse {
  status = 0
  text = ''
  writeHead(status: number) { this.status = status; return this }
  end(text = '') { this.text = text; return this }
  json(): unknown { return JSON.parse(this.text) }
}

type Handler = (req: FakeRequest, res: FakeResponse) => Promise<void> | void

/** One live chat agent mid-turn, recording what it is told. */
function workingAgent(id: string, cwd: string) {
  let idle: () => void = () => {}
  const agent = {
    status: 'running' as 'running' | 'idle',
    session: { header: { id, cwd, createdAt: 0, version: 0 }, events: [] as unknown[] },
    steered: [] as unknown[],
    followups: [] as unknown[],
    steer(message: unknown) { agent.steered.push(message) },
    followup(message: unknown) { agent.followups.push(message) },
    cancel() {},
    whenIdle: () => new Promise<void>((resolve) => { idle = resolve }),
    finish() { agent.status = 'idle'; idle() },
  }
  return agent
}

let home: string | undefined

afterEach(async () => {
  vi.unstubAllEnvs()
  if (home !== undefined) await rm(home, { recursive: true, force: true })
  home = undefined
})

async function mount() {
  home = await mkdtemp(join(tmpdir(), 'idealize-pause-route-'))
  vi.stubEnv('DSH_HOME', home)
  const ctx = new Context()
  const routes = new Map<string, Handler>()
  ctx.provide('webServer', {
    port: 4100,
    register(route: { path: string; handler: Handler }) {
      routes.set(route.path, route.handler)
      return () => { routes.delete(route.path) }
    },
  } as never)
  const agent = workingAgent('sess-1', '/Users/jj/AMI')
  ctx.provide('agents', { roots: () => [agent] } as never)
  apply(ctx)
  await vi.waitFor(() => { expect(routes.has(PAUSE_PATH)).toBe(true) })
  const call = async (method: 'GET' | 'POST', body?: unknown, auth = true) => {
    const res = new FakeResponse()
    const headers: Record<string, string> = { host: '127.0.0.1:4100', ...auth ? { 'x-idealize-auth': '1' } : {} }
    await routes.get(PAUSE_PATH)!(new FakeRequest(method, headers, body === undefined ? '' : JSON.stringify(body)), res)
    return res
  }
  return { ctx, agent, call, home }
}

describe('the pause route', () => {
  it('pauses a working chat agent through its notes, persists the pause, and resumes it', async () => {
    const { ctx, agent, call, home: dshHome } = await mount()
    expect((await call('GET')).json()).toMatchObject({ phase: 'running', working: 1 })

    const pressed = await call('POST', { action: 'pause' })
    expect(pressed.json()).toMatchObject({ phase: 'saving', saving: 1 })
    expect(ctx.get('idealizePause')?.held()).toBe(true)
    expect(JSON.stringify(agent.steered)).toContain('/Users/jj/AMI/.idealize/paused/')
    expect(JSON.stringify(agent.steered)).toContain('start nothing new')

    agent.finish()
    await vi.waitFor(async () => { expect((await call('GET')).json()).toMatchObject({ phase: 'paused', saving: 0 }) })
    const stored = JSON.parse(await readFile(join(dshHome, 'idealize', 'pause.json'), 'utf8')) as { phase: string }
    expect(stored.phase).toBe('paused')

    expect((await call('POST', { action: 'resume' })).json()).toMatchObject({ phase: 'running', open: [] })
    expect(JSON.stringify(agent.followups)).toContain('IDEalize has resumed after a pause.')
    expect(ctx.get('idealizePause')?.held()).toBe(false)
  })

  it('refuses a press without the header, and an unknown action', async () => {
    const { call } = await mount()
    expect((await call('POST', { action: 'pause' }, false)).status).toBe(403)
    expect((await call('POST', { action: 'nap' })).status).toBe(400)
    expect((await call('GET', undefined, false)).status).toBe(200)
  })
})
