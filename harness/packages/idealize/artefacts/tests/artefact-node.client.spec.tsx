// @vitest-environment jsdom
// The artefact chat node: the Definition folds artefact/created and
// artefact/failed events into keyed nodes, and the renderer picks the image,
// audio, or generic presentation by media type.
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type {
  ConversationMatch, ConversationNodeContext,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatNode, ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { artefactDefinition, ArtefactNodeView, onArtefactLanded } from '../src/client/index.ts'
import type { ArtefactChatData } from '../src/client/index.ts'
import type { ArtefactRecord } from '../src/types.ts'

const record = {
  schemaVersion: 1,
  id: 'art-1',
  mediaType: 'image/png',
  storage: { kind: 'file', relPath: 'Images/2026-08-24_art-1.png', bytes: 2048, sha256: 'abc' },
  sourceTask: { sessionId: 'session-1', turnSeq: 1, callId: 'call-1', toolName: 'gallery_generate' },
  settings: { prompt: 'a fish' },
  provenance: { provider: 'openrouter', model: 'm', createdAt: '2026-08-24T00:00:00.000Z', workspaceId: 'w1' },
} as unknown as ArtefactRecord

const createdEvent = {
  type: 'artefact/created', seq: 7, time: 0, data: { record },
} as SessionEvent<'artefact/created'>

const failedEvent = {
  type: 'artefact/failed',
  seq: 9,
  time: 0,
  data: {
    artefactId: record.id,
    mediaType: 'audio/mpeg',
    workspaceId: record.provenance.workspaceId,
    sourceTask: record.sourceTask,
    error: 'provider quota exhausted',
  },
} as SessionEvent<'artefact/failed'>

/** Fold one event through match/start/buildViewNode as the assembler would. */
function nodeFor(event: SessionEvent): ChatNode<'artefact'> {
  const matched = artefactDefinition.match(event)
  if (matched === null) throw new Error('event did not match')
  const match = { event, role: matched.role, location: { kind: 'unresolved' } } as unknown as ConversationMatch
  const base = {
    key: `8:artefact${matched.id}`,
    kind: 'artefact',
    id: matched.id,
    matches: [match],
    start: match,
    state: undefined,
    current: new Map(),
  } as unknown as ConversationNodeContext<ArtefactChatData>
  const state = artefactDefinition.start(base, match, { previous: () => undefined })
  const node = artefactDefinition.buildViewNode?.({ ...base, state })
  if (node === null || node === undefined) throw new Error('definition built no node')
  return node as ChatNode<'artefact'>
}

function mount(node: ChatNode<'artefact'>) {
  return render(<ArtefactNodeView {...({ node } as ChatNodeViewProps<'artefact'>)} />)
}

afterEach(cleanup)

describe('artefact conversation node', () => {
  it('ignores unrelated events', () => {
    expect(artefactDefinition.match({ type: 'turn/start', seq: 1, time: 0, data: { turn: 1 } })).toBeNull()
  })

  it('announces a created artefact once its node is in the transcript, and never a failed one', () => {
    const heard: string[] = []
    const dispose = onArtefactLanded((relPath) => { heard.push(relPath) })
    const view = mount(nodeFor(createdEvent))
    expect(heard).toEqual([record.storage.relPath])
    view.rerender(<ArtefactNodeView {...({ node: nodeFor(createdEvent) } as ChatNodeViewProps<'artefact'>)} />)
    expect(heard).toHaveLength(1)
    mount(nodeFor(failedEvent))
    expect(heard).toHaveLength(1)
    dispose()
  })

  it('folds artefact/created into a keyed node anchored on the event', () => {
    const node = nodeFor(createdEvent)
    expect(node.anchorSeq).toBe(7)
    expect(node.data).toEqual({
      status: 'created',
      id: 'art-1',
      mediaType: 'image/png',
      bytes: 2048,
      relPath: 'Images/2026-08-24_art-1.png',
    })
  })

  it('renders an image artefact as a thumbnail served by the raw route', () => {
    const view = mount(nodeFor(createdEvent))
    const img = view.container.querySelector('img')
    expect(img?.getAttribute('src')).toBe('/idealize/artefacts/raw?id=art-1')
  })

  it('renders an audio artefact as an audio element', () => {
    const node = nodeFor(createdEvent)
    const audioNode = { ...node, data: { ...node.data, mediaType: 'audio/mpeg' } } as ChatNode<'artefact'>
    const view = mount(audioNode)
    expect(view.container.querySelector('audio')?.getAttribute('src')).toBe('/idealize/artefacts/raw?id=art-1')
  })

  it('renders other media types as a generic card', () => {
    const node = nodeFor(createdEvent)
    const videoNode = { ...node, data: { ...node.data, mediaType: 'video/mp4' } } as ChatNode<'artefact'>
    const view = mount(videoNode)
    expect(view.container.querySelector('img')).toBeNull()
    expect(view.container.querySelector('[data-artefact-card="video/mp4"]')).not.toBeNull()
  })

  it('folds artefact/failed into an error card carrying the provider cause', () => {
    const node = nodeFor(failedEvent)
    expect(node.id).toBe('failed:art-1')
    const view = mount(node)
    expect(view.getByRole('alert').textContent).toContain('provider quota exhausted')
  })
})
