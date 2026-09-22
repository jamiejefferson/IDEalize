import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IdealizeStudio, StudioEventId, StudioStore } from '@idealize/studio'
import type { StudioEvent } from '@idealize/studio'
import { parseRequest, refuse, WAKE_NOTICE } from '../src/index.ts'
import { DEFAULT_COMM_CONFIG } from '../src/config.ts'
import { foldAgentName } from '../src/projection.ts'
import { foldExchanges, IdealizeComm, MAIL_NOTICE, STUDIO_MAIL_NOTICE } from '../src/service.ts'
import { CommStore, commStorePath } from '../src/store.ts'

function event(seq: number, type: string, data: unknown): SessionEvent {
  return { seq, time: seq, type, data } as unknown as SessionEvent
}

describe('foldExchanges', () => {
  it('pairs person-authored questions with the assistant text that follows', () => {
    const events = [
      event(1, 'user/message', { source: { kind: 'plugin', plugin: 'x' }, content: [{ type: 'text', text: 'injected' }] }),
      event(2, 'user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'build the hero' }] }),
      event(3, 'assistant/message', { message: { content: [{ type: 'text', text: 'on it' }, { type: 'tool_use' }] } }),
      event(4, 'assistant/message', { message: { content: [{ type: 'text', text: 'done' }] } }),
      event(5, 'user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'and the nav?' }] }),
    ]
    expect(foldExchanges(events)).toEqual([
      { index: 1, question: 'build the hero', answer: 'on it\ndone' },
      { index: 2, question: 'and the nav?' },
    ])
  })
})

/** A bare Context with a fresh store; no agents, persistence, or bridge composed. */
async function bareComm(): Promise<{ ctx: Context; comm: IdealizeComm; home: string }> {
  const home = await mkdtemp(join(tmpdir(), 'idealize-comm-service-'))
  const ctx = new Context()
  const comm = new IdealizeComm(ctx, { store: new CommStore(commStorePath(home)), config: () => DEFAULT_COMM_CONFIG })
  return { ctx, comm, home }
}

describe('foldAgentName', () => {
  it('answers the latest logged name', () => {
    expect(foldAgentName([])).toBeUndefined()
    expect(foldAgentName([
      event(1, 'idealize/agent-name', { name: 'Watto', pool: 0 }),
      event(2, 'idealize/agent-name', { name: 'Sebulba', pool: 0 }),
    ])).toBe('Sebulba')
  })
})

describe('IdealizeComm.ensureName', () => {
  it('draws once per session even when asked concurrently, and logs the draw', async () => {
    const { comm } = await bareComm()
    const session = Session.create(SessionId('session-x'), undefined, {
      version: SESSION_FORMAT_VERSION, id: SessionId('session-x'), createdAt: 1, cwd: '/p/alpha',
    })
    const [first, second] = await Promise.all([comm.ensureName(session), comm.ensureName(session)])
    expect(first).toBe(second)
    const draws = session.events.filter(event => event.type === 'idealize/agent-name')
    expect(draws).toHaveLength(1)
    // The envelope's skip marker: a harness without this event's vocabulary
    // must still read the log (the name lives in the comm store).
    expect(draws[0]?.ignorable).toBe(true)
    expect(await comm.ensureName(session)).toBe(first)
    expect(session.events.filter(event => event.type === 'idealize/agent-name')).toHaveLength(1)
  })
})

describe('IdealizeComm.handle', () => {
  it('answers ping and an empty list without any session services', async () => {
    const { comm } = await bareComm()
    expect(await comm.handle({ command: 'ping' })).toEqual({ ok: true, info: 'pong' })
    expect(await comm.handle({ command: 'list' })).toEqual({ ok: true, sessions: [] })
  })

  it('refuses an unknown sender for mailbox and status commands', async () => {
    const { comm } = await bareComm()
    expect(await comm.handle({ command: 'inbox', from: 'ghost' })).toEqual({ ok: false, error: 'unknown sender session' })
    expect(await comm.handle({ command: 'rung', from: 'ghost', piece: 'x', rung: 'saved' })).toEqual({ ok: false, error: 'unknown sender session' })
    expect(await comm.handle({ command: 'send', from: 'ghost', target: 'nobody', body: 'hi' })).toEqual({ ok: false, error: "no session matching 'nobody'" })
    expect(await comm.handle({ command: 'spawn', from: 'ghost', body: 'task' })).toEqual({ ok: false, error: 'no project folder to spawn in — pass a path' })
    expect(await comm.handle({ command: 'reveal', from: 'ghost', target: '/definitely/not/here' })).toEqual({ ok: false, error: 'no such file: /definitely/not/here' })
  })

  it('raises notify as a typed event carrying the title and sound flag', async () => {
    const { ctx, comm } = await bareComm()
    const seen: unknown[] = []
    ctx.on('idealize/comm-notify', (title, body, sound) => { seen.push([title, body, sound]) })
    expect(await comm.handle({ command: 'notify', title: 'claude', body: 'Build finished', sound: true })).toEqual({ ok: true })
    expect(seen).toEqual([['claude', 'Build finished', true]])
  })
})

/** A live-agent stand-in whose followups the wake tests capture. */
interface FakeLiveAgent {
  status: string
  session: { events: never[]; header: { id: string; cwd: string } }
  followups: unknown[]
  followup(message: unknown): void
}

function liveAgent(id: string, status: string): FakeLiveAgent {
  return {
    status,
    session: { events: [], header: { id, cwd: '/proj/alpha' } },
    followups: [],
    followup(message: unknown) { this.followups.push(message) },
  }
}

/** comm + a real Studio service over one temp home, with a two-chat roster in one project. */
async function studioComm() {
  const home = await mkdtemp(join(tmpdir(), 'idealize-comm-studio-'))
  const ctx = new Context()
  const comm = new IdealizeComm(ctx, { store: new CommStore(commStorePath(home)), config: () => DEFAULT_COMM_CONFIG })
  new IdealizeStudio(ctx, { store: new StudioStore(join(home, 'studio')) })
  const lead = liveAgent('sess-lead', 'idle')
  const worker = liveAgent('sess-worker', 'running')
  ;(ctx as unknown as { provide(name: string, value: unknown): void }).provide('agents', {
    roots: () => [lead, worker],
  })
  return { ctx, comm, lead, worker }
}

function studioEvent(input: Partial<StudioEvent> & { kind: StudioEvent['kind']; author: string }): StudioEvent {
  return {
    id: StudioEventId('se-wake'), seq: 1, at: new Date().toISOString(), project: '/proj/alpha',
    visibility: 'studio', ...input,
  }
}

describe('IdealizeComm.roster', () => {
  it('lists live and persisted chats but never the Studio chat, live or cold', async () => {
    const home = await mkdtemp(join(tmpdir(), 'idealize-comm-roster-'))
    const ctx = new Context()
    const comm = new IdealizeComm(ctx, { store: new CommStore(commStorePath(home)), config: () => DEFAULT_COMM_CONFIG })
    const studioLive = { ...liveAgent('sess-studio', 'idle'), session: { events: [{ type: 'idealize/space', data: { space: 'studio' } }], header: { id: 'sess-studio', cwd: '/proj/alpha' } } }
    const provide = (ctx as unknown as { provide(name: string, value: unknown): void }).provide.bind(ctx)
    provide('agents', { roots: () => [liveAgent('sess-lead', 'idle'), studioLive] })
    provide('sessionPersistence', { list: async () => [{ id: 'sess-cold', cwd: '/proj/beta' }, { id: 'sess-cold-studio', cwd: '/proj/beta' }] })
    provide('sessionProjectionCache', {
      cachedSnapshot: (header: { id: string }) => (header.id === 'sess-cold-studio' ? { asOfSeq: 3, values: { space: { space: 'studio' } } } : undefined),
    })
    const listed = await comm.handle({ command: 'list' })
    expect(listed.ok && listed.sessions?.map(row => row.id)).toEqual(['sess-lead', 'sess-cold'])
  })
})

describe('IdealizeComm.spawn', () => {
  afterEach(() => { vi.unstubAllEnvs() })

  it('answers the running Studio coordinator rather than starting a second one', async () => {
    const home = await mkdtemp(join(tmpdir(), 'idealize-comm-spawn-'))
    vi.stubEnv('DSH_HOME', home)
    const ctx = new Context()
    const comm = new IdealizeComm(ctx, { store: new CommStore(commStorePath(home)), config: () => DEFAULT_COMM_CONFIG })
    ;(ctx as unknown as { provide(name: string, value: unknown): void }).provide('agents', {
      roots: () => [liveAgent('sess-studio', 'idle')],
    })
    // Found by the role alone: the Studio coordinator runs in the harness
    // home, not in the project its live agent happens to sit in.
    await comm.state.setRole('sess-studio', 'studio-agent')
    expect(await comm.handle({ command: 'spawn', studio: true })).toEqual({ ok: true, info: 'sess-studio' })
  })

  it('resumes a stored Studio coordinator that is not running, and wakes it once when mail waits', async () => {
    const home = await mkdtemp(join(tmpdir(), 'idealize-comm-spawn-'))
    vi.stubEnv('DSH_HOME', home)
    const ctx = new Context()
    const comm = new IdealizeComm(ctx, { store: new CommStore(commStorePath(home)), config: () => DEFAULT_COMM_CONFIG })
    const resumed: unknown[] = []
    const revived = liveAgent('sess-studio', 'idle')
    const provide = (ctx as unknown as { provide(name: string, value: unknown): void }).provide.bind(ctx)
    provide('agents', {
      roots: () => [],
      resume: async (options: { resumeSessionId: string }) => { resumed.push(options.resumeSessionId); return { agent: revived } },
    })
    provide('agentDefaultModel', { currentSelection: () => ({ provider: 'p', model: 'm' }) })
    provide('sessionPersistence', { list: async () => [{ id: 'sess-studio', cwd: home }] })
    await comm.state.setRole('sess-studio', 'studio-agent')
    // Two notes from the Studio arrived after the run that started it ended.
    await comm.state.deliver('sess-studio', { from: 'user', fromLabel: 'Studio', body: 'Hello', timestamp: 't1' })
    await comm.state.deliver('sess-studio', { from: 'user', fromLabel: 'Studio', body: 'What are the agents doing?', timestamp: 't2' })

    expect(await comm.handle({ command: 'spawn', studio: true })).toEqual({ ok: true, info: 'sess-studio' })
    expect(resumed).toEqual(['sess-studio'])
    expect(revived.followups).toHaveLength(1)
    expect(JSON.stringify(revived.followups[0])).toContain('sent from the Studio')
  })
})

describe('IdealizeComm.wakeCoordinator', () => {
  it('notes the coordinator and invokes it once while its mailbox was empty', async () => {
    const { comm, lead } = await studioComm()
    await comm.state.setRole('sess-lead', 'project-agent')
    await comm.wakeCoordinator(studioEvent({ kind: 'task-update', subtype: 'blocked', taskId: 't1', author: 'sess-worker', body: 'no key' }))
    expect(comm.state.peek('sess-lead').map(message => message.body)).toEqual(['[studio] unowned blocker on t1: no key'])
    expect(lead.followups).toHaveLength(1)
    expect(JSON.stringify(lead.followups[0])).toContain(WAKE_NOTICE)
    await comm.wakeCoordinator(studioEvent({ kind: 'decision', author: 'sess-worker', body: 'ship Fridays' }))
    expect(comm.state.unread('sess-lead')).toBe(2)
    expect(lead.followups).toHaveLength(1)
  })

  it('wakes nobody for routine events, its own acts, or a missing coordinator', async () => {
    const { comm, lead } = await studioComm()
    await comm.wakeCoordinator(studioEvent({ kind: 'task-update', subtype: 'blocked', author: 'sess-worker' }))
    expect(comm.state.unread('sess-lead')).toBe(0)
    await comm.state.setRole('sess-lead', 'project-agent')
    await comm.wakeCoordinator(studioEvent({ kind: 'message', target: 'sess-x', author: 'sess-worker', body: 'hello' }))
    await comm.wakeCoordinator(studioEvent({ kind: 'task-update', subtype: 'progress', taskId: 't1', author: 'sess-worker' }))
    await comm.wakeCoordinator(studioEvent({ kind: 'task-update', subtype: 'blocked', target: 'sess-worker', taskId: 't1', author: 'sess-worker' }))
    await comm.wakeCoordinator(studioEvent({ kind: 'task-update', subtype: 'done', taskId: 't1', author: 'sess-lead' }))
    await comm.wakeCoordinator(studioEvent({ kind: 'system', subtype: 'delivery-queued', author: 'idealize' }))
    expect(comm.state.unread('sess-lead')).toBe(0)
    expect(lead.followups).toHaveLength(0)
  })

  it('wakes the coordinator for a group post, and not for an addressed message', async () => {
    const { comm, lead } = await studioComm()
    await comm.state.setRole('sess-lead', 'project-agent')
    await comm.wakeCoordinator(studioEvent({ kind: 'message', author: 'sess-worker', body: 'combine done, detail in the vault doc' }))
    expect(comm.state.peek('sess-lead').map(message => message.body))
      .toEqual(['[studio] group post from sess-worker: combine done, detail in the vault doc'])
    expect(lead.followups).toHaveLength(1)
  })

  it('triggers on done, delivery, decision and accepted handoffs', async () => {
    const { comm } = await studioComm()
    await comm.state.setRole('sess-lead', 'project-agent')
    await comm.wakeCoordinator(studioEvent({ kind: 'task-update', subtype: 'done', taskId: 't1', author: 'sess-worker', body: 'shipped' }))
    await comm.wakeCoordinator(studioEvent({ kind: 'delivery', taskId: 't1', author: 'sess-worker' }))
    await comm.wakeCoordinator(studioEvent({ kind: 'handoff', subtype: 'accepted', taskId: 't1', author: 'sess-worker' }))
    expect(comm.state.peek('sess-lead').map(message => message.body)).toEqual([
      '[studio] t1 reported done: shipped',
      '[studio] delivery linked on t1',
      '[studio] t1 changed hands (accepted by sess-worker)',
    ])
  })
})

describe('Studio task commands', () => {
  it('records the Studio coordinator\'s post on the Studio timeline, not on its working folder', async () => {
    const { ctx, comm } = await studioComm()
    await comm.state.setRole('sess-lead', 'studio-agent')
    const posted = await comm.handle({ command: 'post', from: 'sess-lead', body: 'Two chats are idle; nobody is blocked.' })
    expect(posted).toEqual({ ok: true, info: 'posted to the group chat' })
    const studio = (ctx as unknown as { get(name: string): IdealizeStudio | undefined }).get('idealizeStudio')
    const onStudio = await studio?.timeline('studio')
    expect(onStudio?.map(event => [event.kind, event.author, event.body])).toEqual([['message', 'sess-lead', 'Two chats are idle; nobody is blocked.']])
    expect(await studio?.timeline('/proj/alpha')).toEqual([])
    const board = await comm.handle({ command: 'studio', from: 'sess-lead' })
    expect(board.ok).toBe(true)
  })

  it('assigns a task, delivers it to the owner mailbox, and lists it on the board', async () => {
    const { comm } = await studioComm()
    const assigned = await comm.handle({ command: 'task', from: 'sess-lead', target: 'sess-worker', body: 'Build the hero' })
    expect(assigned.ok).toBe(true)
    const match = /^(t-[0-9a-f]{8}) → alpha \(delivered\)$/.exec(assigned.info ?? '')
    expect(match).not.toBeNull()
    const taskId = match?.[1] ?? ''
    expect(comm.state.unread('sess-worker')).toBe(1)
    expect(comm.state.peek('sess-worker')[0]?.body).toBe('Build the hero')
    const board = await comm.handle({ command: 'studio', from: 'sess-worker' })
    expect(board.tasks).toEqual([{
      id: taskId, goal: 'Build the hero', owner: 'sess-worker', ownerLabel: 'alpha',
      state: 'queued', attention: 'none', updated: expect.any(String) as unknown as string,
    }])
  })

  it('walks a task through progress, blocked, need and done', async () => {
    const { comm } = await studioComm()
    const assigned = await comm.handle({ command: 'task', from: 'sess-lead', target: 'sess-worker', body: 'Wire the routes' })
    const taskId = (assigned.info ?? '').split(' ')[0] ?? ''
    const row = async () => (await comm.handle({ command: 'studio', from: 'sess-worker' })).tasks?.[0]

    expect((await comm.handle({ command: 'progress', from: 'sess-worker', task: taskId, body: 'halfway' })).info).toBe(`${taskId} → working`)
    expect(await row()).toMatchObject({ state: 'working', attention: 'none' })

    const blocked = await comm.handle({ command: 'blocked', from: 'sess-worker', task: taskId, body: 'No key stored', owner: 'sess-lead' })
    expect(blocked.info).toBe(`${taskId} → waiting (blocked on alpha)`)
    expect(await row()).toMatchObject({ state: 'waiting', attention: 'blocked', attentionOwner: 'sess-lead', attentionOwnerLabel: 'alpha' })

    expect((await comm.handle({ command: 'progress', from: 'sess-worker', task: taskId })).ok).toBe(true)
    const need = await comm.handle({ command: 'need', from: 'sess-worker', task: taskId, body: 'Which palette?' })
    expect(need.info).toBe(`${taskId} → waiting (needs-input → user)`)
    expect(await row()).toMatchObject({ attention: 'needs-input', attentionOwner: 'user' })

    expect((await comm.handle({ command: 'done', from: 'sess-worker', task: taskId, body: 'Routes wired' })).info)
      .toBe(`${taskId} → done (awaiting acknowledgement)`)
    expect(await row()).toMatchObject({ state: 'done', attention: 'completion' })
  })

  it('hands a task to a peer through offer and accept', async () => {
    const { comm } = await studioComm()
    const assigned = await comm.handle({ command: 'task', from: 'sess-lead', target: 'sess-worker', body: 'Ship it' })
    const taskId = (assigned.info ?? '').split(' ')[0] ?? ''
    expect((await comm.handle({ command: 'handoff', from: 'sess-lead', task: taskId, target: 'sess-worker' })).error)
      .toBe("only the task's owner can offer it")
    const offered = await comm.handle({ command: 'handoff', from: 'sess-worker', task: taskId, target: 'sess-lead', body: 'Needs your authority' })
    expect(offered.info).toBe(`${taskId} offered to alpha (delivered)`)
    expect(comm.state.unread('sess-lead')).toBe(1)
    expect((await comm.handle({ command: 'handoff', from: 'sess-worker', task: taskId, target: 'sess-lead' })).error)
      .toBe('already offered to alpha')
    expect((await comm.handle({ command: 'accept', from: 'sess-worker', task: taskId })).error)
      .toContain('addressed to')
    const accepted = await comm.handle({ command: 'accept', from: 'sess-lead', task: taskId })
    expect(accepted.info).toBe(`${taskId} is yours (was alpha's)`)
    const board = await comm.handle({ command: 'studio', from: 'sess-lead' })
    expect(board.tasks?.[0]).toMatchObject({ owner: 'sess-lead', attention: 'none' })
  })

  it('rejection returns the offer and keeps the owner', async () => {
    const { comm } = await studioComm()
    const assigned = await comm.handle({ command: 'task', from: 'sess-lead', target: 'sess-worker', body: 'Hold it' })
    const taskId = (assigned.info ?? '').split(' ')[0] ?? ''
    await comm.handle({ command: 'handoff', from: 'sess-worker', task: taskId, target: 'sess-lead' })
    const rejected = await comm.handle({ command: 'reject', from: 'sess-lead', task: taskId, body: 'not mine' })
    expect(rejected.info).toBe(`${taskId} declined; alpha keeps it`)
    const board = await comm.handle({ command: 'studio', from: 'sess-worker' })
    expect(board.tasks?.[0]).toMatchObject({ owner: 'sess-worker', attention: 'none' })
    expect((await comm.handle({ command: 'accept', from: 'sess-lead', task: taskId })).error).toContain('no open handoff')
  })

  it('records decisions from anyone and syntheses from role chats only', async () => {
    const { comm } = await studioComm()
    expect((await comm.handle({ command: 'decide', from: 'sess-worker', body: 'Ship on Fridays' })).info).toBe('decision recorded')
    expect((await comm.handle({ command: 'synthesis', from: 'sess-worker', body: 'nope' })).error)
      .toBe('only the coordinator publishes the synthesis')
    await comm.state.setRole('sess-lead', 'project-agent')
    expect((await comm.handle({ command: 'synthesis', from: 'sess-lead', body: 'All quiet' })).info).toBe('synthesis published')
    const fresh = await comm.handle({ command: 'studio', from: 'sess-lead' })
    expect(fresh.synthesis).toMatchObject({ body: 'All quiet', stale: false })
    await comm.handle({ command: 'task', from: 'sess-lead', target: 'sess-worker', body: 'New work' })
    const moved = await comm.handle({ command: 'studio', from: 'sess-lead' })
    expect(moved.synthesis?.stale).toBe(true)
  })

  it('refuses the mistakes agents actually make', async () => {
    const { comm } = await studioComm()
    expect(await comm.handle({ command: 'task', from: 'sess-lead', body: 'goal only' })).toEqual({ ok: false, error: 'missing --to owner' })
    expect(await comm.handle({ command: 'task', from: 'sess-lead', target: 'sess-worker' })).toEqual({ ok: false, error: 'missing task goal' })
    expect((await comm.handle({ command: 'progress', from: 'sess-worker', task: 't-nope' })).error).toContain("no task 't-nope'")
    expect((await comm.handle({ command: 'blocked', from: 'sess-worker', task: 't-x' })).error).toContain('no task')
    expect(await comm.handle({ command: 'studio' })).toEqual({ ok: false, error: 'this chat isn\'t in a project folder — pass --path' })
  })

  it('names the missing Studio service rather than throwing', async () => {
    const { comm } = await bareComm()
    expect(await comm.handle({ command: 'studio', from: 'x' })).toEqual({ ok: false, error: 'the Studio timeline is not composed' })
  })
})

function fakeReq(host: string, auth?: string): Parameters<typeof refuse>[0] {
  return { headers: { host, ...auth === undefined ? {} : { 'x-idealize-auth': auth } } } as unknown as Parameters<typeof refuse>[0]
}

function fakeRes(): { res: Parameters<typeof refuse>[1]; status: () => number | undefined } {
  let status: number | undefined
  const res = {
    writeHead(code: number) {
      status = code
      return { end() {} }
    },
  } as unknown as Parameters<typeof refuse>[1]
  return { res, status: () => status }
}

describe('refuse', () => {
  it('rejects non-loopback hosts and missing auth, and lets ping through bare', () => {
    const remote = fakeRes()
    expect(refuse(fakeReq('example.com:3180', '1'), remote.res, 'list')).toBe(true)
    expect(remote.status()).toBe(403)
    const noAuth = fakeRes()
    expect(refuse(fakeReq('127.0.0.1:3180'), noAuth.res, 'list')).toBe(true)
    expect(noAuth.status()).toBe(403)
    const ping = fakeRes()
    expect(refuse(fakeReq('localhost:3180'), ping.res, 'ping')).toBe(false)
    const ok = fakeRes()
    expect(refuse(fakeReq('[::1]:3180', '1'), ok.res, 'send')).toBe(false)
  })
})

describe('parseRequest', () => {
  it('accepts the wire fields and rejects wrong shapes', () => {
    expect(parseRequest('{"command":"send","target":"t-1","body":"hi","open":true,"limit":5}'))
      .toEqual({ command: 'send', target: 't-1', body: 'hi', open: true, limit: 5 })
    expect(parseRequest('nope')).toEqual({ error: 'body is not JSON' })
    expect(parseRequest('[]')).toEqual({ error: 'body must be a JSON object' })
    expect(parseRequest('{"command":"exec"}')).toEqual({ error: "unknown command 'exec'" })
    expect(parseRequest('{"command":"send","body":3}')).toEqual({ error: 'body must be a string' })
    expect(parseRequest('{"command":"notify","sound":"yes"}')).toEqual({ error: 'sound must be a boolean' })
    expect(parseRequest('{"command":"transcript","limit":1.5}')).toEqual({ error: 'limit must be an integer' })
    expect(parseRequest('{"command":"need","task":"t-1","owner":"lead","action":true,"body":"May I?"}'))
      .toEqual({ command: 'need', task: 't-1', owner: 'lead', action: true, body: 'May I?' })
    expect(parseRequest('{"command":"need","action":"yes"}')).toEqual({ error: 'action must be a boolean' })
    expect(parseRequest('{"command":"spawn","studio":true}')).toEqual({ command: 'spawn', studio: true })
  })
})

describe('IdealizeComm.send', () => {
  it('wakes an idle recipient once for its first unread note, and never a running one or the sender', async () => {
    const { comm, lead, worker } = await studioComm()
    const sent = await comm.handle({ command: 'send', from: 'sess-worker', target: 'sess-lead', body: 'where is the image?' })
    expect(sent.ok).toBe(true)
    expect(lead.followups).toHaveLength(1)
    expect(JSON.stringify(lead.followups[0])).toContain(MAIL_NOTICE)
    // The notice tells the recipient to act on the note, not only to read and answer it.
    expect(MAIL_NOTICE).toContain('carry on with that now')
    // A second note piles up quietly until the inbox drains.
    await comm.handle({ command: 'send', from: 'sess-worker', target: 'sess-lead', body: 'and the sound?' })
    expect(comm.state.unread('sess-lead')).toBe(2)
    expect(lead.followups).toHaveLength(1)
    // A running recipient reads its inbox on its own turn.
    await comm.handle({ command: 'send', from: 'sess-lead', target: 'sess-worker', body: 'Images/' })
    expect(worker.followups).toHaveLength(0)
    // A note to oneself invokes nobody.
    await comm.state.drain('sess-lead')
    await comm.handle({ command: 'send', from: 'sess-lead', target: 'sess-lead', body: 'note to self' })
    expect(lead.followups).toHaveLength(1)
  })

  it('labels a note the person sent from the Studio and tells the idle recipient to answer there', async () => {
    const { comm, lead } = await studioComm()
    // `@idealize/studio` delivers the Studio chat's addressed post as the person.
    const sent = await comm.handle({ command: 'send', from: 'user', target: 'sess-lead', body: 'how is the hero going?' })
    expect(sent.ok).toBe(true)
    expect(comm.state.peek('sess-lead')[0]).toMatchObject({ from: 'user', fromLabel: 'Studio', body: 'how is the hero going?' })
    expect(lead.followups).toHaveLength(1)
    const notice = JSON.stringify(lead.followups[0])
    expect(notice).toContain(STUDIO_MAIL_NOTICE)
    expect(notice).not.toContain(MAIL_NOTICE)
  })
})
