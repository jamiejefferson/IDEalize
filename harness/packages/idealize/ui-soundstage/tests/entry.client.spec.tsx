// @vitest-environment jsdom
/**
 * The Sound Stage ring entry: it renders this chat's own audio generations out
 * of the conversation snapshot, shows nothing another chat made and nothing of
 * another kind, follows the snapshot when a later generation lands, and sends
 * a retried prompt through the composer.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { GalleryRow, GallerySnapshot } from '@idealize/ui-gallery/client'
import { SoundstageEntry } from '../src/client/SoundstageEntry.tsx'
import { en } from '../src/client/locales.ts'
import type { SoundstageKey } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: SoundstageKey, params?: Record<string, unknown>): string =>
  en[key].replace(/\{(\w+)\}/g, (_whole, name: string) => {
    const value = params?.[name]
    return typeof value === 'number' || typeof value === 'string' ? String(value) : ''
  })

const row = (over: Partial<GalleryRow> & Pick<GalleryRow, 'callId' | 'artefactKind'>): GalleryRow => ({
  toolName: 'generate_audio',
  prompt: 'rain on a tin roof',
  settings: {},
  status: 'done',
  startedAt: Date.UTC(2026, 7, 24, 9, 0, 0),
  startSeq: 4,
  turn: 1,
  artefacts: [{
    id: `${over.callId}-art`,
    mediaType: 'audio/wav',
    bytes: 1024,
    relPath: `Sounds/${over.callId}.wav`,
    archived: false,
  }],
  ...over,
})

/** A snapshot carrying only what the Sound Stage reads: the gallery target. */
function snapshotOf(rows: readonly GalleryRow[]): ConversationSnapshot {
  const views = new Map<string, GallerySnapshot>([['gallery', { rows, turns: [] }]])
  return { views } as unknown as ConversationSnapshot
}

function mount(snapshot: ConversationSnapshot, inputActions = { setDraft: vi.fn(), submit: vi.fn() }) {
  const element = (state: ConversationSnapshot) => (
    <SoundstageEntry
      sessionId="session-1"
      useSession={selector => selector(state)}
      inputActions={inputActions}
      setDisposition={async () => null}
      t={t}
    />
  )
  const rendered = render(element(snapshot))
  return {
    ...rendered,
    inputActions,
    /** Re-render with a later snapshot, the way the selector hook would. */
    advance: (next: ConversationSnapshot) => { rendered.rerender(element(next)) },
  }
}

describe('the Sound Stage ring entry', () => {
  it("renders this chat's sounds from the snapshot, with no listing to read", () => {
    const { container } = mount(snapshotOf([row({ callId: 'c1', artefactKind: 'audio' })]))
    expect(container.querySelector('[data-soundstage-sound="c1-art"]')).not.toBeNull()
    expect(screen.getByText('rain on a tin roof')).toBeTruthy()
  })

  it('shows only audio: the images and video this same chat made belong to their own spaces', () => {
    const { container } = mount(snapshotOf([
      row({ callId: 'c1', artefactKind: 'audio' }),
      row({ callId: 'c2', artefactKind: 'image', toolName: 'generate_image' }),
      row({ callId: 'c3', artefactKind: 'video', toolName: 'generate_video' }),
    ]))
    expect(container.querySelectorAll('[data-soundstage-sound]')).toHaveLength(1)
    expect(container.querySelector('[data-soundstage-sound="c1-art"]')).not.toBeNull()
  })

  it('says the chat is empty before it has generated anything', () => {
    mount(snapshotOf([]))
    expect(screen.getByText('No sounds in this chat yet.')).toBeTruthy()
  })

  it('treats a session with no gallery target as an empty chat rather than failing', () => {
    mount({ views: new Map() } as unknown as ConversationSnapshot)
    expect(screen.getByText('No sounds in this chat yet.')).toBeTruthy()
  })

  it('follows the snapshot when a later generation lands', () => {
    const view = mount(snapshotOf([row({ callId: 'c1', artefactKind: 'audio' })]))
    expect(view.container.querySelectorAll('[data-soundstage-sound]')).toHaveLength(1)
    view.advance(snapshotOf([
      row({ callId: 'c1', artefactKind: 'audio' }),
      row({ callId: 'c2', artefactKind: 'audio', prompt: 'a doorbell' }),
    ]))
    expect(view.container.querySelectorAll('[data-soundstage-sound]')).toHaveLength(2)
    expect(screen.getByText('a doorbell')).toBeTruthy()
  })

  it('sends a retried prompt through the composer', () => {
    const inputActions = { setDraft: vi.fn(), submit: vi.fn() }
    mount(snapshotOf([row({
      callId: 'c1',
      artefactKind: 'audio',
      status: 'failed',
      artefacts: [],
      error: 'the provider refused',
    })]), inputActions)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(inputActions.setDraft).toHaveBeenCalledWith('rain on a tin roof')
    expect(inputActions.submit).toHaveBeenCalled()
  })
})
