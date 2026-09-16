/**
 * The safety net under the prompt's posting rule (JJ, 8 Sep 2026: "when an
 * agent completes an action I want them to post a note into the studio"): a
 * turn that called a generation tool and stored artefacts, in which the agent
 * posted nothing to the Studio, earns one `idealize`-authored line on the
 * project's timeline naming the agent, the count and the artefact ids, linked
 * to the agent's chat. A turn the agent reported itself, a turn with no
 * generation, a generation that stored nothing, and the Studio chat record
 * nothing. The plugin wires the check to every session's `turn/end`.
 */
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IdealizeStudio, StudioStore } from '@idealize/studio'
import { apply } from '../src/index.ts'
import { DEFAULT_COMM_CONFIG } from '../src/config.ts'
import { describeArtefacts, IdealizeComm } from '../src/service.ts'
import { CommStore, commStorePath } from '../src/store.ts'

const PROJECT = '/proj/alpha'
const T0 = Date.parse('2026-09-08T10:00:00.000Z')

function event(seq: number, type: string, data: unknown): SessionEvent {
  return { seq, time: T0 + seq * 1000, type, data } as unknown as SessionEvent
}

function artefact(seq: number, id: string, mediaType: string): SessionEvent {
  return event(seq, 'artefact/created', { record: { id, mediaType } })
}

/** A finished turn 1 that called `generate_image` and stored two images, then a turn 2 that is still open. */
function generationTurn(): SessionEvent[] {
  return [
    event(1, 'turn/start', { turn: 1 }),
    event(2, 'tool/call', { turn: 1, step: 1, callId: 'c1', name: 'generate_image', arguments: '{"prompt":"an owl"}' }),
    artefact(3, 'art-1', 'image/png'),
    artefact(4, 'art-2', 'image/png'),
    event(5, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    event(6, 'turn/start', { turn: 2 }),
    event(7, 'tool/call', { turn: 2, step: 1, callId: 'c2', name: 'generate_video', arguments: '{}' }),
  ]
}

function session(id: string, events: SessionEvent[], cwd: string | undefined = PROJECT): Session {
  return { header: { id, cwd }, events } as unknown as Session
}

/** comm + a real Studio service over one temp home, with the worker named. */
async function studioComm() {
  const home = await mkdtemp(join(tmpdir(), 'idealize-comm-turn-end-'))
  const ctx = new Context()
  const comm = new IdealizeComm(ctx, { store: new CommStore(commStorePath(home)), config: () => DEFAULT_COMM_CONFIG })
  const studio = new IdealizeStudio(ctx, { store: new StudioStore(join(home, 'studio')) })
  await comm.state.load()
  await comm.state.setName('sess-worker', 'Watto')
  return { ctx, comm, studio }
}

describe('describeArtefacts', () => {
  it('groups by media kind, in first-seen order, counting rather than listing ids', () => {
    expect(describeArtefacts([{ id: 'a', mediaType: 'image/png' }])).toBe('an image')
    expect(describeArtefacts([
      { id: 'a', mediaType: 'video/mp4' }, { id: 'b', mediaType: 'audio/wav' }, { id: 'c', mediaType: 'audio/mp3' }, { id: 'd', mediaType: 'model/gltf' },
    ])).toBe('a video and 2 sounds and a file')
  })
})

describe('IdealizeComm.reportFinishedTurn', () => {
  it('posts one system line naming the agent and the artefacts when the agent posted nothing during the turn', async () => {
    const { comm, studio } = await studioComm()
    const line = await comm.reportFinishedTurn(session('sess-worker', generationTurn()), 1)
    expect(line).toBe('Watto generated 2 images')
    const timeline = await studio.timeline(PROJECT)
    expect(timeline).toHaveLength(1)
    expect(timeline[0]).toMatchObject({ author: 'idealize', kind: 'message', body: line, source: { thread: 'sess-worker' } })
    // The open turn 2 has not ended; its video is not reported yet.
    expect(await comm.reportFinishedTurn(session('sess-worker', generationTurn()), 2)).toBeUndefined()
  })

  it('stays quiet when the agent posted to the Studio during the turn, even before the artefacts landed', async () => {
    const { comm, studio } = await studioComm()
    await studio.record({ project: PROJECT, author: 'sess-worker', kind: 'message', body: 'owl.png is in Images/' })
    const events = generationTurn()
    // The post lands within the turn: after its start, before its end.
    const [start] = events
    ;(start as unknown as { time: number }).time = Date.now() - 60_000
    expect(await comm.reportFinishedTurn(session('sess-worker', events), 1)).toBeUndefined()
    expect(await studio.timeline(PROJECT)).toHaveLength(1)
  })

  it('records nothing for a turn without a generation call, a generation that stored nothing, no project, or the Studio chat', async () => {
    const { comm, studio } = await studioComm()
    const plain = [event(1, 'turn/start', { turn: 1 }), event(2, 'tool/call', { turn: 1, step: 1, callId: 'c', name: 'read', arguments: '{}' }), artefact(3, 'x', 'image/png'), event(4, 'turn/end', { turn: 1, reason: { kind: 'completed' } })]
    expect(await comm.reportFinishedTurn(session('sess-worker', plain), 1)).toBeUndefined()
    const failed = [event(1, 'turn/start', { turn: 1 }), event(2, 'tool/call', { turn: 1, step: 1, callId: 'c', name: 'generate_audio', arguments: '{}' }), event(3, 'turn/end', { turn: 1, reason: { kind: 'completed' } })]
    expect(await comm.reportFinishedTurn(session('sess-worker', failed), 1)).toBeUndefined()
    expect(await comm.reportFinishedTurn(session('sess-worker', generationTurn(), ''), 1)).toBeUndefined()
    expect(await comm.reportFinishedTurn(session('sess-worker', generationTurn()), 9)).toBeUndefined()
    const studioChat = [event(1, 'idealize/space', { space: 'studio' }), ...generationTurn().map(row => ({ ...row, seq: row.seq + 1 }))]
    expect(await comm.reportFinishedTurn(session('sess-studio', studioChat), 1)).toBeUndefined()
    expect(await studio.timeline(PROJECT)).toHaveLength(0)
  })

  it('falls back to the logged name, then the id, when the store holds no name', async () => {
    const { comm } = await studioComm()
    const named = [event(1, 'idealize/agent-name', { name: 'Sebulba', pool: 0 }), ...generationTurn().map(row => ({ ...row, seq: row.seq + 1 }))]
    expect(await comm.reportFinishedTurn(session('sess-other', named), 1)).toBe('Sebulba generated 2 images')
    expect(await comm.reportFinishedTurn(session('sess-anon', generationTurn()), 1)).toBe('sess-anon generated 2 images')
  })

  it('answers undefined without a Studio service', async () => {
    const home = await mkdtemp(join(tmpdir(), 'idealize-comm-turn-end-bare-'))
    const comm = new IdealizeComm(new Context(), { store: new CommStore(commStorePath(home)), config: () => DEFAULT_COMM_CONFIG })
    expect(await comm.reportFinishedTurn(session('sess-worker', generationTurn()), 1)).toBeUndefined()
  })
})

describe('the plugin', () => {
  afterEach(() => { vi.unstubAllEnvs() })

  it('reports a finished turn on every session\'s turn/end', async () => {
    const home = await mkdtemp(join(tmpdir(), 'idealize-comm-turn-end-plugin-'))
    vi.stubEnv('DSH_HOME', home)
    const ctx = new Context()
    const studio = new IdealizeStudio(ctx, { store: new StudioStore(join(home, 'studio')) })
    apply(ctx)
    try {
      await vi.waitFor(() => { expect(ctx.get('idealizeComm')).toBeDefined() })
      const events = generationTurn()
      ctx.emit('session/event', session('sess-worker', events), events[4]!)
      await vi.waitFor(async () => {
        expect((await studio.timeline(PROJECT)).map(row => row.body)).toEqual(['sess-worker generated 2 images'])
      })
      // Other events pass without a read.
      ctx.emit('session/event', session('sess-worker', events), events[1]!)
      expect(await studio.timeline(PROJECT)).toHaveLength(1)
      // A failed read is logged and the session's turn is unaffected.
      const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
      vi.spyOn(studio, 'timeline').mockRejectedValueOnce(new Error('disk gone'))
      ctx.emit('session/event', session('sess-worker', events), events[4]!)
      await vi.waitFor(() => {
        expect(warn.mock.calls.flat().join('\n')).toContain('idealize-comm: finished-turn note failed: Error: disk gone')
      })
    } finally {
      await ctx.fiber.dispose()
    }
  })
})

/**
 * The safety net's background path: a `run_in_background` generation stores
 * its artefacts after the turn that started it has ended, where the turn read
 * never sees them.
 */
describe('IdealizeComm.noteBackgroundArtefact', () => {
  /** Long enough that a first artefact is still pending when the test looks, short enough to wait out twice. */
  const WINDOW_MS = 150

  /** comm + a real Studio over one temp home, with the batching window the tests wait out. */
  async function backgroundComm() {
    const home = await mkdtemp(join(tmpdir(), 'idealize-comm-background-'))
    const ctx = new Context()
    const comm = new IdealizeComm(ctx, {
      store: new CommStore(commStorePath(home)),
      config: () => ({ ...DEFAULT_COMM_CONFIG, backgroundPostDelayMs: WINDOW_MS }),
    })
    const studio = new IdealizeStudio(ctx, { store: new StudioStore(join(home, 'studio')) })
    await comm.state.load()
    await comm.state.setName('sess-worker', 'Watto')
    return { ctx, comm, studio, home }
  }

  const settle = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

  /** An artefact stored by a generation tool, with the source task every record carries. */
  function background(seq: number, id: string, mediaType: string, toolName = 'generate_video', turnSeq = 1): SessionEvent {
    return event(seq, 'artefact/created', { record: { id, mediaType, sourceTask: { turnSeq, callId: 'c1', toolName } } })
  }

  /** A finished turn that started a background generation and stored nothing itself. */
  function finishedTurn(): SessionEvent[] {
    return [
      event(1, 'turn/start', { turn: 1 }),
      event(2, 'tool/call', { turn: 1, step: 1, callId: 'c1', name: 'generate_video', arguments: '{"run_in_background":true}' }),
      event(3, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ]
  }

  it('reports one line for the batch a background job stores after its turn ended', async () => {
    const { comm, studio } = await backgroundComm()
    const events = [...finishedTurn(), background(4, 'art-9', 'video/mp4'), background(5, 'art-10', 'video/mp4')]
    const chat = session('sess-worker', events)
    comm.noteBackgroundArtefact(chat, events[3] as never)
    expect(await studio.timeline(PROJECT)).toHaveLength(0)
    // The second artefact restarts the window, so both land in one line.
    comm.noteBackgroundArtefact(chat, events[4] as never)
    await vi.waitFor(async () => { expect(await studio.timeline(PROJECT)).toHaveLength(1) })
    const [line] = await studio.timeline(PROJECT)
    expect(line).toMatchObject({
      author: 'idealize',
      kind: 'message',
      body: 'Watto finished generating 2 videos in the background',
      source: { thread: 'sess-worker' },
    })
  })

  it('ignores an artefact whose own turn is still running, one no generation tool stored, the Studio chat and a chat outside a project', async () => {
    const { comm, studio } = await backgroundComm()
    // A foreground generation: its own turn 2 has not ended, so the turn read owns it.
    const openTurn = [...finishedTurn(), event(4, 'turn/start', { turn: 2 }), background(5, 'art-11', 'image/png', 'generate_image', 2)]
    comm.noteBackgroundArtefact(session('sess-worker', openTurn), openTurn[4] as never)
    // A record naming no turn is left alone.
    const unknownTurn = [...finishedTurn(), background(4, 'art-17', 'image/png', 'generate_image', 0)]
    comm.noteBackgroundArtefact(session('sess-worker', unknownTurn), unknownTurn[3] as never)
    const otherTool = [...finishedTurn(), background(4, 'art-12', 'text/markdown', 'write_file')]
    comm.noteBackgroundArtefact(session('sess-worker', otherTool), otherTool[3] as never)
    const loose = [...finishedTurn(), background(4, 'art-13', 'image/png')]
    comm.noteBackgroundArtefact(session('sess-worker', loose, ''), loose[3] as never)
    const studioChat = [event(1, 'idealize/space', { space: 'studio' }), ...finishedTurn().map(row => ({ ...row, seq: row.seq + 1 })), background(5, 'art-14', 'image/png')]
    comm.noteBackgroundArtefact(session('sess-studio', studioChat), studioChat[4] as never)
    await settle(WINDOW_MS * 2)
    expect(await studio.timeline(PROJECT)).toHaveLength(0)
  })

  it('reports a background artefact that lands while the person has started another turn', async () => {
    const { comm, studio } = await backgroundComm()
    // The job's own turn 1 ended; turn 2 is open, and the artefact belongs to neither read but this one.
    const events = [...finishedTurn(), event(4, 'turn/start', { turn: 2 }), background(5, 'art-18', 'video/mp4', 'generate_video', 1)]
    comm.noteBackgroundArtefact(session('sess-worker', events), events[4] as never)
    await vi.waitFor(async () => { expect(await studio.timeline(PROJECT)).toHaveLength(1) })
    expect((await studio.timeline(PROJECT))[0]?.body).toBe('Watto finished generating a video in the background')
  })

  it('drops a pending batch when the session goes, and posts nothing without a Studio service', async () => {
    const { comm, studio } = await backgroundComm()
    const events = [...finishedTurn(), background(4, 'art-15', 'audio/wav')]
    const chat = session('sess-worker', events)
    comm.noteBackgroundArtefact(chat, events[3] as never)
    comm.forgetSession(chat)
    // A session with nothing pending is forgotten without complaint.
    comm.forgetSession(session('sess-quiet', events))
    await settle(WINDOW_MS * 2)
    expect(await studio.timeline(PROJECT)).toHaveLength(0)

    const home = await mkdtemp(join(tmpdir(), 'idealize-comm-background-bare-'))
    const bare = new IdealizeComm(new Context(), {
      store: new CommStore(commStorePath(home)),
      config: () => ({ ...DEFAULT_COMM_CONFIG, backgroundPostDelayMs: WINDOW_MS }),
    })
    bare.noteBackgroundArtefact(chat, events[3] as never)
    await settle(WINDOW_MS * 2)
    expect(await studio.timeline(PROJECT)).toHaveLength(0)
  })

  it('is wired to every session’s artefact/created and drops its batches with the plugin', async () => {
    const home = await mkdtemp(join(tmpdir(), 'idealize-comm-background-plugin-'))
    vi.stubEnv('DSH_HOME', home)
    const ctx = new Context()
    const studio = new IdealizeStudio(ctx, { store: new StudioStore(join(home, 'studio')) })
    apply(ctx, { ...DEFAULT_COMM_CONFIG, backgroundPostDelayMs: WINDOW_MS })
    try {
      await vi.waitFor(() => { expect(ctx.get('idealizeComm')).toBeDefined() })
      const events = [...finishedTurn(), background(4, 'art-16', 'image/png')]
      const chat = session('sess-worker', events)
      ctx.emit('session/event', chat, events[3]!)
      await vi.waitFor(async () => {
        expect((await studio.timeline(PROJECT)).map(row => row.body))
          .toEqual(['sess-worker finished generating an image in the background'])
      })
      // A disposed session drops its pending batch.
      ctx.emit('session/event', chat, events[3]!)
      ctx.emit('session/disposed', chat)
      await settle(WINDOW_MS * 2)
      expect(await studio.timeline(PROJECT)).toHaveLength(1)
      // A failed post is logged and nothing else stops.
      const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
      vi.spyOn(studio, 'record').mockRejectedValueOnce(new Error('disk gone'))
      ctx.emit('session/event', chat, events[3]!)
      await vi.waitFor(() => {
        expect(warn.mock.calls.flat().join('\n')).toContain('idealize-comm: background note failed: Error: disk gone')
      })
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
