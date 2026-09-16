/**
 * The Gallery Definitions fold the log into rows. The generation Definition
 * folds one task's events into one row: the call starts it, `artefact/created`
 * settles it done, `artefact/failed` settles it with the provider's own cause,
 * and a failing `tool/result` settles a call that never reached a provider.
 * The turn Definition folds one turn into thinking, generating, generated or
 * no-generation, carrying the model's last text; the prompt Definition
 * publishes each user message, and the builder joins it to its turn. The
 * events replayed here are the payloads the host writes (`@idealize/gen-tools`
 * and the agent loop), so the contracts stay anchored to the real log.
 */

import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type {
  ConversationMatch, ConversationNodeContext, ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
import {
  EMPTY_GALLERY_SNAPSHOT, galleryDefinition, galleryPromptDefinition, galleryTurnDefinition, galleryViewDefinition,
  joinPrompts, readToolArguments,
} from '../src/client/definition.ts'
import type {
  GalleryConversationViewNode, GalleryGenerationViewNode, GalleryPrompt, GalleryRow, GalleryTurn,
} from '../src/client/contract.ts'

const CALL = 'call-image-1'

function event(type: string, seq: number, data: unknown): SessionEvent {
  return { type, seq, time: 1_700_000_000_000 + seq, data } as unknown as SessionEvent
}

function toolCall(name = 'generate_image', args = '{"prompt":"a paper boat","aspect":"16:9"}'): SessionEvent {
  return event('tool/call', 4, { turn: 1, step: 1, callId: CALL, name, arguments: args })
}

function artefactCreated(id = 'artefact-1'): SessionEvent {
  return event('artefact/created', 6, {
    record: {
      schemaVersion: 1,
      id,
      mediaType: 'image/png',
      storage: { kind: 'file', relPath: `Images/2026-08-24_${id}.png`, bytes: 2048, sha256: 'a'.repeat(64) },
      sourceTask: { sessionId: 's1', turnSeq: 1, callId: CALL, toolName: 'generate_image' },
      settings: { prompt: 'a paper boat', aspect: '16:9' },
      provenance: { provider: 'fixture', model: 'fixture-still', createdAt: '2026-08-24T09:00:00.000Z', workspaceId: 'w1' },
    },
  })
}

function artefactFailed(cause: string): SessionEvent {
  return event('artefact/failed', 6, {
    artefactId: 'reserved-1',
    mediaType: 'image/png',
    workspaceId: 'w1',
    sourceTask: { sessionId: 's1', turnSeq: 1, callId: CALL, toolName: 'generate_image' },
    error: cause,
  })
}

function disposition(id: string, verdict: 'kept' | 'archived', relPath: string, toolName = 'generate_image'): SessionEvent {
  return event('artefact/disposition', 8, {
    artefactId: id,
    disposition: verdict,
    relPath,
    sourceTask: { sessionId: 's1', turnSeq: 1, callId: CALL, toolName },
  })
}

function failingResult(text: string): SessionEvent {
  return event('tool/result', 7, {
    turn: 1,
    step: 1,
    message: { content: [{ type: 'tool-result', toolCallId: CALL, isError: true, content: [{ type: 'text', text }] }] },
  })
}

/** Replay events through one Definition the way the assembler does, keeping the Context of `id` (the first started, by default). */
function foldWith<State>(definition: ConversationNodeDefinition<State>, events: readonly SessionEvent[], id?: string): State | undefined {
  let state: State | undefined
  let chosen = id
  const matches: ConversationMatch[] = []
  for (const raw of events) {
    const matched = definition.match(raw)
    if (matched === null) continue
    chosen ??= matched.id
    if (matched.id !== chosen) continue
    const match = { event: raw, role: matched.role, location: { kind: 'unresolved' } } as unknown as ConversationMatch
    matches.push(match)
    const base = {
      key: `${definition.kind}:${matched.id}`,
      kind: definition.kind,
      id: matched.id,
      matches,
      start: matches[0],
      state,
      current: new Map(),
    } as unknown as ConversationNodeContext<State>
    state = matched.role === 'start'
      ? definition.start(base, match, { previous: () => undefined })
      : state === undefined
        ? undefined
        : definition.update({ ...base, state }, match)
  }
  return state
}

/** Replay events through the generation Definition. */
function fold(events: readonly SessionEvent[]): GalleryRow | undefined {
  return foldWith(galleryDefinition, events)
}

function turnStart(turn: number, seq: number): SessionEvent {
  return event('turn/start', seq, { turn })
}

function turnEnd(turn: number, seq: number, reason: unknown = { kind: 'completed' }): SessionEvent {
  return event('turn/end', seq, { turn, reason })
}

function userMessage(id: string, seq: number, text: string, source: unknown = { kind: 'user' }): SessionEvent {
  return event('user/message', seq, { id, role: 'user', content: [{ type: 'text', text }], source })
}

function assistantMessage(turn: number, seq: number, blocks: unknown[]): SessionEvent {
  return event('assistant/message', seq, { turn, step: 1, message: { id: `m${String(seq)}`, role: 'assistant', content: blocks, source: { kind: 'model' } } })
}

describe('readToolArguments', () => {
  it('reads the prompt and the settings the model named', () => {
    expect(readToolArguments('{"prompt":"a paper boat","aspect":"16:9"}'))
      .toEqual({ prompt: 'a paper boat', settings: { aspect: '16:9' } })
    expect(readToolArguments('{"prompt":"a hum","duration_s":8}'))
      .toEqual({ prompt: 'a hum', settings: { durationSeconds: 8 } })
  })

  it('still yields a row for arguments the model malformed', () => {
    expect(readToolArguments('{not json')).toEqual({ prompt: '', settings: {} })
    expect(readToolArguments('"a string"')).toEqual({ prompt: '', settings: {} })
    expect(readToolArguments('{"aspect":7}')).toEqual({ prompt: '', settings: {} })
  })
})

describe('the Gallery Definition', () => {
  it('ignores calls, artefacts and results that belong to other tools', () => {
    expect(galleryDefinition.match(toolCall('bash', '{}'))).toBeNull()
    expect(galleryDefinition.match(event('artefact/created', 3, {
      record: { sourceTask: { toolName: 'write_file', callId: 'c9' } },
    }))).toBeNull()
    expect(galleryDefinition.match(event('tool/result', 3, {
      message: { content: [{ toolCallId: 'c9', isError: false, content: [] }] },
    }))).toBeNull()
    expect(galleryDefinition.match(event('assistant/message', 3, {}))).toBeNull()
  })

  it('starts a running row carrying the prompt, the settings the call asked for, and its turn', () => {
    const row = fold([toolCall()])
    expect(row).toMatchObject({
      callId: CALL,
      toolName: 'generate_image',
      artefactKind: 'image',
      prompt: 'a paper boat',
      settings: { aspect: '16:9' },
      status: 'running',
      startSeq: 4,
      turn: 1,
      artefacts: [],
    })
  })

  it('settles the row done and keeps every artefact the task committed', () => {
    const row = fold([toolCall(), artefactCreated('artefact-1'), artefactCreated('artefact-2')])
    expect(row?.status).toBe('done')
    expect(row?.artefacts.map(artefact => artefact.id)).toEqual(['artefact-1', 'artefact-2'])
    expect(row?.artefacts[0]).toMatchObject({ mediaType: 'image/png', bytes: 2048, archived: false })
  })

  it('archives and keeps one artefact by its disposition event, the path following the file', () => {
    const archived = fold([toolCall(), artefactCreated('artefact-1'), artefactCreated('artefact-2'),
      disposition('artefact-1', 'archived', 'Images/Archive/2026-08-24_artefact-1.png')])
    expect(archived?.artefacts.map(artefact => [artefact.id, artefact.archived, artefact.relPath])).toEqual([
      ['artefact-1', true, 'Images/Archive/2026-08-24_artefact-1.png'],
      ['artefact-2', false, 'Images/2026-08-24_artefact-2.png'],
    ])
    const kept = fold([toolCall(), artefactCreated('artefact-1'),
      disposition('artefact-1', 'archived', 'Images/Archive/2026-08-24_artefact-1.png'),
      disposition('artefact-1', 'kept', 'Images/2026-08-24_artefact-1.png')])
    expect(kept?.artefacts[0]).toMatchObject({ archived: false, relPath: 'Images/2026-08-24_artefact-1.png' })
    // Another tool's disposition is not a Gallery event.
    expect(galleryDefinition.match(disposition('x', 'kept', 'Images/x.png', 'some_other_tool'))).toBeNull()
  })

  it('carries the adapter\'s provider cause onto a failed row and never overwrites it', () => {
    const row = fold([toolCall(), artefactFailed('openrouter: 402 insufficient credits'), failingResult('Error: openrouter: 402 insufficient credits')])
    expect(row?.status).toBe('failed')
    expect(row?.error).toBe('openrouter: 402 insufficient credits')
  })

  it('settles a call that never reached a provider from its failing result', () => {
    const row = fold([toolCall(), failingResult('no compatible image generation model is available. Add an OpenRouter key.')])
    expect(row?.status).toBe('failed')
    expect(row?.error).toContain('no compatible image generation model is available')
  })

  it('publishes nothing for an artefact whose call fell out of the loaded window', () => {
    const orphan = {
      key: 'gallery:call-x',
      kind: 'gallery-generation',
      id: 'call-x',
      matches: [],
      start: undefined,
      state: undefined,
      current: new Map(),
    } as unknown as ConversationNodeContext<GalleryRow> & { readonly state: GalleryRow }
    expect(galleryDefinition.buildViewNode?.(orphan)).toBeNull()
  })
})

describe('the turn Definition', () => {
  const foldTurn = (events: readonly SessionEvent[]) => foldWith(galleryTurnDefinition, events)

  it('opens a turn thinking, with no prompt of its own and nothing said yet', () => {
    expect(foldTurn([turnStart(1, 2)])).toEqual({
      turn: 1, startSeq: 2, startedAt: 1_700_000_000_002, prompt: '', phase: 'thinking', callIds: [], reply: '',
    })
    // Boundaries and generation calls of another turn are not this turn's.
    expect(galleryTurnDefinition.match(turnStart(2, 9))).toEqual({ id: '2', role: 'start' })
    expect(galleryTurnDefinition.match(toolCall('bash', '{}'))).toBeNull()
    expect(galleryTurnDefinition.match(userMessage('u1', 3, 'hi'))).toBeNull()
    expect(galleryTurnDefinition.match(event('tool/result', 5, { turn: 1, message: { content: [{ toolCallId: 'x', isError: true, content: [] }] } }))).toBeNull()
  })

  it('moves to generating at the generation call and ends generated, keeping the call ids', () => {
    const turn = foldTurn([turnStart(1, 2), assistantMessage(1, 3, [{ type: 'text', text: 'Making it now.' }]), toolCall(), turnEnd(1, 8)])
    expect(turn).toMatchObject({ phase: 'generated', callIds: [CALL], reply: 'Making it now.', endReason: 'completed' })
    expect(foldTurn([turnStart(1, 2), toolCall()])?.phase).toBe('generating')
  })

  it('ends with no generation carrying the model\'s last text, and the way the turn ended', () => {
    const turn = foldTurn([
      turnStart(1, 2),
      assistantMessage(1, 3, [{ type: 'reasoning', text: 'hmm' }, { type: 'text', text: 'Which aspect' }, { type: 'text', text: 'do you want?' }]),
      assistantMessage(1, 4, [{ type: 'tool-call', id: 'c', name: 'bash', arguments: '{}' }]),
      turnEnd(1, 8, { kind: 'aborted', reason: { kind: 'user' } }),
    ])
    expect(turn).toMatchObject({ phase: 'no-generation', callIds: [], reply: 'Which aspect\ndo you want?', endReason: 'aborted' })
    // A message with no text leaves the last text standing; a turn with none stays empty.
    expect(foldTurn([turnStart(1, 2), turnEnd(1, 3)])).toMatchObject({ phase: 'no-generation', reply: '' })
  })

  it('keeps the failure of a turn the provider refused', () => {
    // Such a turn carries no assistant message at all, so the message is the
    // only thing the grid can show in place of a tile.
    const turn = foldTurn([
      turnStart(1, 2),
      turnEnd(1, 3, { kind: 'error', error: { message: 'Failed to extract accountId from token', code: 'PI_AI_ERROR' } }),
    ])
    expect(turn).toMatchObject({ phase: 'no-generation', reply: '', endReason: 'error', error: 'Failed to extract accountId from token' })
    // Every other ending leaves it absent, so the view can switch on it.
    expect(foldTurn([turnStart(1, 2), turnEnd(1, 3)])).not.toHaveProperty('error')
  })

  it('leaves the turn unchanged for an update it does not read', () => {
    // The engine only hands a Definition the matches it asked for; the
    // fallthrough exists for the type system, and the generation Definition
    // has the same one.
    const started = foldTurn([turnStart(1, 2)])!
    const stray = { event: event('tool/result', 5, { turn: 1 }), role: 'update', location: { kind: 'unresolved' } } as unknown as ConversationMatch
    const context = { key: 'gallery-turn:1', kind: 'gallery-turn', id: '1', matches: [stray], start: undefined, state: started, current: new Map() } as unknown as ConversationNodeContext<GalleryTurn> & { readonly state: GalleryTurn }
    expect(galleryTurnDefinition.update(context, stray)).toBe(started)
    const row = fold([toolCall()])!
    const rowContext = { ...context, key: 'gallery:c', kind: 'gallery-generation', id: CALL, state: row } as unknown as ConversationNodeContext<GalleryRow> & { readonly state: GalleryRow }
    expect(galleryDefinition.update(rowContext, { ...stray, event: event('turn/end', 9, { turn: 1, reason: { kind: 'completed' } }) })).toBe(row)
  })

  it('publishes its turn, and nothing before it has started', () => {
    const started = { key: 'gallery-turn:1', kind: 'gallery-turn', id: '1', matches: [], start: undefined, state: foldTurn([turnStart(1, 2)]), current: new Map() } as unknown as ConversationNodeContext<GalleryTurn>
    expect(galleryTurnDefinition.buildViewNode?.(started)).toMatchObject({ key: 'gallery-turn:1', kind: 'gallery-turn', target: 'gallery', data: { turn: 1 } })
    expect(galleryTurnDefinition.buildViewNode?.({ ...started, state: undefined })).toBeNull()
  })
})

describe('the prompt Definition', () => {
  it('publishes what the person typed, and no injected context', () => {
    expect(foldWith(galleryPromptDefinition, [userMessage('u1', 3, 'a paper boat')])).toEqual({ messageId: 'u1', seq: 3, text: 'a paper boat' })
    expect(galleryPromptDefinition.match(userMessage('u2', 4, 'AGENTS.md says…', { kind: 'plugin', plugin: 'agents-md' }))).toBeNull()
    expect(galleryPromptDefinition.match(event('assistant/message', 5, {}))).toBeNull()
    // Attachments only: an empty text, still a prompt.
    expect(foldWith(galleryPromptDefinition, [event('user/message', 6, { id: 'u3', role: 'user', content: [{ type: 'image', mediaType: 'image/png', data: 'x' }], source: { kind: 'user' } })]))
      .toEqual({ messageId: 'u3', seq: 6, text: '' })
    const started = { key: 'gallery-prompt:u1', kind: 'gallery-prompt', id: 'u1', matches: [], start: undefined, state: { messageId: 'u1', seq: 3, text: 'x' }, current: new Map() } as unknown as ConversationNodeContext<GalleryPrompt>
    expect(galleryPromptDefinition.buildViewNode?.(started)).toMatchObject({ kind: 'gallery-prompt', target: 'gallery', data: { text: 'x' } })
    expect(galleryPromptDefinition.buildViewNode?.({ ...started, state: undefined })).toBeNull()
    expect(galleryPromptDefinition.update({ ...started, state: { messageId: 'u1', seq: 3, text: 'x' } }, {} as ConversationMatch)).toEqual({ messageId: 'u1', seq: 3, text: 'x' })
  })
})

describe('joinPrompts', () => {
  const turn = (number: number, startSeq: number): GalleryTurn => ({ turn: number, startSeq, startedAt: 0, prompt: '', phase: 'thinking', callIds: [], reply: '' })

  it('gives each turn the first user message after its start and before the next, newest first', () => {
    const joined = joinPrompts(
      [turn(1, 2), turn(3, 20), turn(2, 10)],
      [{ messageId: 'b', seq: 11, text: 'second' }, { messageId: 'a', seq: 3, text: 'first' }, { messageId: 'c', seq: 12, text: 'steering' }],
    )
    expect(joined.map(entry => [entry.turn, entry.prompt])).toEqual([[3, ''], [2, 'second'], [1, 'first']])
    // A message before any turn belongs to none.
    expect(joinPrompts([turn(1, 5)], [{ messageId: 'z', seq: 1, text: 'early' }])[0]?.prompt).toBe('')
  })
})

describe('the Gallery view target', () => {
  function node(callId: string, startSeq: number): GalleryGenerationViewNode {
    return {
      key: `gallery:${callId}`,
      kind: 'gallery-generation',
      id: callId,
      target: 'gallery',
      data: { ...(fold([toolCall()]) as GalleryRow), callId, startSeq },
    }
  }

  it('starts empty', () => {
    expect(galleryViewDefinition.create().empty).toBe(EMPTY_GALLERY_SNAPSHOT)
    expect(EMPTY_GALLERY_SNAPSHOT).toEqual({ rows: [], turns: [] })
  })

  it('publishes turns newest first with their prompts joined, beside the rows', () => {
    const builder = galleryViewDefinition.create()
    const turnNode = (number: number, startSeq: number, phase: GalleryTurn['phase'] = 'thinking'): GalleryConversationViewNode => ({
      key: `gallery-turn:${String(number)}`, kind: 'gallery-turn', id: String(number), target: 'gallery',
      data: { turn: number, startSeq, startedAt: 0, prompt: '', phase, callIds: [], reply: '' },
    })
    const promptNode = (id: string, seq: number, text: string): GalleryConversationViewNode => ({
      key: `gallery-prompt:${id}`, kind: 'gallery-prompt', id, target: 'gallery', data: { messageId: id, seq, text },
    })
    const replaced = builder.replace({ nodes: [turnNode(1, 2), promptNode('a', 3, 'a boat'), node('c1', 4), turnNode(2, 10), promptNode('b', 11, 'a kite')], timeline: { turnOrder: [], turns: new Map() } })
    expect(replaced.turns.map(turn => [turn.turn, turn.prompt, turn.phase])).toEqual([[2, 'a kite', 'thinking'], [1, 'a boat', 'thinking']])
    expect(replaced.rows.map(row => row.callId)).toEqual(['c1'])
    const updated = builder.apply({ upserts: [turnNode(2, 10, 'no-generation')], timeline: { turnOrder: [], turns: new Map() } })
    expect(updated.turns[0]).toMatchObject({ turn: 2, prompt: 'a kite', phase: 'no-generation' })
    expect(() => builder.apply({ upserts: [{ key: 'x', kind: 'other', id: 'x', target: 'gallery', data: {} } as unknown as GalleryConversationViewNode], timeline: { turnOrder: [], turns: new Map() } }))
      .toThrow('unexpected gallery node')
  })

  it('publishes rows newest first and updates one row in place', () => {
    const builder = galleryViewDefinition.create()
    const replaced = builder.replace({ nodes: [node('a', 2), node('b', 9)], timeline: { turnOrder: [], turns: new Map() } })
    expect(replaced.rows.map(row => row.callId)).toEqual(['b', 'a'])

    const updated = builder.apply({
      upserts: [{ ...node('a', 2), data: { ...node('a', 2).data, status: 'done' } }],
      timeline: { turnOrder: [], turns: new Map() },
    })
    expect(updated.rows.map(row => row.callId)).toEqual(['b', 'a'])
    expect(updated.rows.find(row => row.callId === 'a')?.status).toBe('done')
  })

  it('drops rows a replacement no longer carries', () => {
    const builder = galleryViewDefinition.create()
    builder.replace({ nodes: [node('a', 2), node('b', 9)], timeline: { turnOrder: [], turns: new Map() } })
    const next = builder.replace({ nodes: [node('b', 9)], timeline: { turnOrder: [], turns: new Map() } })
    expect(next.rows.map(row => row.callId)).toEqual(['b'])
  })
})
