/**
 * Powell's loop over a real plugin mount with a fake agent registry: a
 * message wakes Powell's own session, its streamed reply leaves as spoken
 * sentences the moment each is complete, the finished turn becomes a bubble
 * with its Open or choice buttons, a permission prompt waits in the bubble
 * for Allow, and Stop cancels the turn. The routes keep the loopback and
 * auth fences.
 */

import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply, Config, type PowellService, type PowellStreamEvent } from '../src/index.ts'

type Handler = (req: FakeRequest, res: FakeResponse) => Promise<void> | void

class FakeRequest extends EventEmitter {
  constructor(public url: string, public method: string, public headers: Record<string, string>, private readonly body = '') {
    super()
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<Buffer> {
    if (this.body !== '') yield Buffer.from(this.body)
  }
}

class FakeResponse {
  status = 0
  body = ''
  headersSent = false
  writeHead(status: number) {
    this.status = status
    this.headersSent = true
    return this
  }

  write(chunk: string | Buffer) {
    this.body += chunk.toString()
  }

  end(chunk?: string | Buffer) {
    if (chunk !== undefined) this.body += chunk.toString()
  }
}

let home: string
const contexts: Context[] = []

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'powell-'))
  vi.stubEnv('DSH_HOME', home)
  // The clip library warms in the background; no network in a spec.
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })))
})

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  await rm(home, { recursive: true, force: true })
})

/** One fake live agent. */
function fakeAgent(id: string) {
  return {
    id,
    status: 'idle' as 'idle' | 'running',
    session: { header: { id }, events: [] as { type: string; data: unknown }[], append: vi.fn() },
    followup: vi.fn(),
    steer: vi.fn(),
    cancel: vi.fn(),
  }
}

async function mount() {
  const ctx = new Context()
  contexts.push(ctx)
  const handlers = new Map<string, Handler>()
  const agents = new Map<string, ReturnType<typeof fakeAgent>>()
  ctx.provide('webServer', {
    register(route: { path: string; handler: Handler }) {
      handlers.set(route.path, route.handler)
      return () => { handlers.delete(route.path) }
    },
  })
  ctx.provide('agents', {
    get: (id: string) => agents.get(id),
    create: vi.fn(async (options: { sessionId: string }) => {
      const agent = fakeAgent(options.sessionId)
      agents.set(agent.id, agent)
      return { agent }
    }),
    resume: vi.fn(async () => { throw new Error('gone') }),
  })
  ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'test', model: 'fast' }) })
  await ctx.plugin({ name: 'idealize-powell', inject: [], Config, apply })
  await new Promise(resolve => setTimeout(resolve, 10))
  const powell = (ctx as unknown as { get(name: string): PowellService }).get('idealizePowell')
  const events: PowellStreamEvent[] = []
  powell.subscribe((event) => { events.push(event) })
  const call = async (path: string, init: { method?: string; body?: unknown; auth?: boolean; query?: string } = {}) => {
    const handler = handlers.get(path)
    if (handler === undefined) throw new Error(`no route ${path}`)
    const headers: Record<string, string> = { host: '127.0.0.1:3180' }
    if (init.auth !== false) headers['x-idealize-auth'] = '1'
    const req = new FakeRequest(`${path}${init.query ?? ''}`, init.method ?? (init.body === undefined ? 'GET' : 'POST'), headers, init.body === undefined ? '' : JSON.stringify(init.body))
    const res = new FakeResponse()
    await handler(req, res)
    return res
  }
  return { ctx, powell, events, agents, call }
}

const said = (events: PowellStreamEvent[]) => events.flatMap(event => event.type === 'say' ? [{ text: event.text, clip: event.clip }] : [])

/** Feed one session event to Powell as the session would. */
function feed(powell: PowellService, type: string, data: Record<string, unknown>) {
  powell.observe({ type, data } as never)
}

describe('Powell', () => {
  it('wakes its own session and speaks the reply sentence by sentence', async () => {
    const { powell, events, agents } = await mount()
    await powell.say('Put the voice notes in the Idealize docs', 'text')
    const agent = [...agents.values()][0]
    expect(agent?.followup).toHaveBeenCalledOnce()
    expect(powell.snapshot().mood).toBe('thinking')
    expect(powell.isPowell(agent?.session as never)).toBe(true)
    // The router keeps off Powell's chat.
    expect(agent?.session.append).toHaveBeenCalledWith('idealize/router-lock', { locked: true }, { ignorable: true })

    feed(powell, 'turn/start', { turn: 1 })
    feed(powell, 'step/start', { turn: 1, step: 1 })
    feed(powell, 'tool/call', { turn: 1, step: 1, callId: 'c1', name: 'mcp__plugin_paper-desktop_paper__write_html', arguments: '{}' })
    expect(powell.snapshot()).toMatchObject({ mood: 'acting', status: 'Working in Paper' })
    feed(powell, 'step/end', { turn: 1, step: 1 })
    feed(powell, 'step/start', { turn: 1, step: 2 })
    feed(powell, 'assistant/chunk', { turn: 1, step: 2, chunk: { type: 'text-delta', index: 0, text: 'Done.' } })
    expect(said(events)).toEqual([])
    feed(powell, 'assistant/chunk', { turn: 1, step: 2, chunk: { type: 'text-delta', index: 0, text: " It's in Paper" } })
    // The step's first sentence waits to show it is a reply, not narration before a tool.
    expect(said(events)).toEqual([])
    feed(powell, 'assistant/chunk', { turn: 1, step: 2, chunk: { type: 'text-delta', index: 0, text: ' with notes.\n[open: /work/notes.md]' } })
    // A second sentence proves it: both go out before the reply has finished.
    expect(said(events).map(line => line.text)).toEqual(['Done.', "It's in Paper with notes."])
    feed(powell, 'assistant/message', { turn: 1, step: 2, message: { content: [{ type: 'text', text: "Done. It's in Paper with notes.\n[open: /work/notes.md]" }] } })
    feed(powell, 'step/end', { turn: 1, step: 2 })
    feed(powell, 'turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(said(events)).toEqual([{ text: 'Done.', clip: 'done' }, { text: "It's in Paper with notes.", clip: undefined }])
    expect(powell.snapshot()).toMatchObject({
      mood: 'done',
      busy: false,
      bubble: { text: "Done. It's in Paper with notes.", kind: 'reply', choices: [{ label: 'Open', action: 'open', target: '/work/notes.md', primary: true }] },
    })
  })

  it('keeps narration before a tool call silent and speaks a one-line reply at step end', async () => {
    const { powell, events } = await mount()
    await powell.say('List the projects', 'text')
    feed(powell, 'turn/start', { turn: 1 })
    feed(powell, 'step/start', { turn: 1, step: 1 })
    feed(powell, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: "I'll list the projects for you. " } })
    feed(powell, 'tool/call', { turn: 1, step: 1, callId: 'c1', name: 'glob', arguments: '{}' })
    feed(powell, 'step/end', { turn: 1, step: 1 })
    feed(powell, 'step/start', { turn: 1, step: 2 })
    feed(powell, 'assistant/chunk', { turn: 1, step: 2, chunk: { type: 'text-delta', index: 0, text: 'Idealize, JACQ and Hatch.' } })
    expect(said(events)).toEqual([])
    feed(powell, 'step/end', { turn: 1, step: 2 })
    expect(said(events).map(line => line.text)).toEqual(['Idealize, JACQ and Hatch.'])
  })

  it('asks with tap answers and waits', async () => {
    const { powell } = await mount()
    await powell.say('Open the brief', 'voice')
    feed(powell, 'turn/start', { turn: 1 })
    feed(powell, 'step/start', { turn: 1, step: 1 })
    feed(powell, 'assistant/message', { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'Idealize or JACQ?\n[choices: Idealize | JACQ]' }] } })
    feed(powell, 'turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(powell.snapshot()).toMatchObject({
      mood: 'waiting',
      status: 'Needs you',
      bubble: { text: 'Idealize or JACQ?', kind: 'question', choices: [{ label: 'Idealize', action: 'say', primary: true }, { label: 'JACQ', action: 'say' }] },
    })
  })

  it('keeps the spoken budget across the steps of one turn', async () => {
    const { powell, events } = await mount()
    await powell.say('Tidy the notes', 'text')
    feed(powell, 'turn/start', { turn: 1 })
    feed(powell, 'step/start', { turn: 1, step: 1 })
    feed(powell, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'First. Second. ' } })
    feed(powell, 'step/end', { turn: 1, step: 1 })
    feed(powell, 'step/start', { turn: 1, step: 2 })
    feed(powell, 'assistant/chunk', { turn: 1, step: 2, chunk: { type: 'text-delta', index: 0, text: 'Third. ' } })
    feed(powell, 'step/end', { turn: 1, step: 2 })
    expect(said(events).map(line => line.text)).toEqual(['First.', 'Second.'])
  })

  it('steers a running turn instead of queueing a new one', async () => {
    const { powell, agents } = await mount()
    await powell.say('Make three directions', 'text')
    const agent = [...agents.values()][0]
    if (agent === undefined) throw new Error('no agent')
    agent.status = 'running'
    await powell.say('Actually make it two', 'voice')
    expect(agent.steer).toHaveBeenCalledOnce()
  })

  it('holds a permission prompt in the bubble until Allow', async () => {
    const { powell } = await mount()
    const decision = powell.ask('mcp__hatch__navigate', undefined, undefined)
    const bubble = powell.snapshot().bubble
    expect(bubble).toMatchObject({ kind: 'approval', text: 'Can I use Hatch?' })
    const allow = bubble?.choices.find(choice => choice.action === 'allow')
    if (allow === undefined) throw new Error('no allow')
    await powell.choose(allow)
    await expect(decision).resolves.toBe('allowed-once')
  })

  it('stops the turn and declines a waiting prompt', async () => {
    const { powell, agents, events } = await mount()
    await powell.say('Research auth', 'text')
    const decision = powell.ask('bash', 'run a script', undefined)
    powell.stop()
    await expect(decision).resolves.toBe('rejected')
    expect([...agents.values()][0]?.cancel).toHaveBeenCalled()
    expect(events.at(-1)).toMatchObject({ type: 'view', view: { mood: 'idle', busy: false } })
  })

  it('reports a failed turn as a problem with Try again', async () => {
    const { powell } = await mount()
    await powell.say('Do the thing', 'text')
    feed(powell, 'turn/end', { turn: 1, reason: { kind: 'error', error: { message: 'x', code: 'UNKNOWN' } } })
    expect(powell.snapshot()).toMatchObject({ mood: 'problem', bubble: { kind: 'problem', choices: [{ action: 'retry' }] } })
  })

  it('fences its routes', async () => {
    const { call, powell } = await mount()
    expect((await call('/idealize/powell/say', { body: { text: 'hi' }, auth: false })).status).toBe(403)
    expect((await call('/idealize/powell/say', { body: { text: '' } })).status).toBe(400)
    expect((await call('/idealize/powell/speak', { query: '' })).status).toBe(400)
    const prefs = await call('/idealize/powell/prefs', { body: { voiceConsent: true } })
    expect(prefs.status).toBe(200)
    expect(powell.snapshot().voiceConsent).toBe(true)
    const voice = await call('/idealize/powell/voice')
    const manifest = JSON.parse(voice.body) as { voice: string; clips: { id: string; url: string }[] }
    expect(manifest.voice).toBe('George')
    expect(manifest.clips.find(clip => clip.id === 'on-it')?.url).toBe('/idealize/powell/clip/on-it')
    // The clip route is a prefix route on the bare path (the server matches p and p/<id>).
    expect((await call('/idealize/powell/clip', { query: '/no-such-clip' })).status).toBe(404)
  })

  it('streams speech from the first endpoint that answers', async () => {
    const { call } = await mount()
    const fetchMock = vi.fn(async (url: string) => url.includes('eleven-v4-turbo')
      ? new Response('busy', { status: 503 })
      : new Response('MP3DATA', { status: 200, headers: { 'content-type': 'audio/mpeg' } }))
    vi.stubGlobal('fetch', fetchMock)
    const credentials = { resolve: async () => ({ value: 'k', source: 'env' }) }
    // The key resolves per call, so providing it now reaches this request.
    ;(contexts[0] as unknown as { provide(name: string, value: unknown): void }).provide('credentials', credentials)
    const res = await call('/idealize/powell/speak', { query: '?text=Hello%20there' })
    expect(res.status).toBe(200)
    expect(res.body).toBe('MP3DATA')
    expect(fetchMock.mock.calls.map(args => args[0])).toEqual([
      'https://fal.run/elevenlabs/tts/eleven-v4-turbo/stream',
      'https://fal.run/fal-ai/elevenlabs/tts/turbo-v2.5/stream',
    ])
  })
})
