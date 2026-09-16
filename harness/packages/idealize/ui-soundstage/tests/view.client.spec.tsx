// @vitest-environment jsdom
/**
 * The Sound Stage list: what each generation status renders, that a sound
 * plays from the artefact raw route, that Keep / Archive moves a sound into and
 * out of the fold, and that Retry re-sends the failed prompt through the
 * composer.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { GalleryArtefact, GalleryRow, GalleryTurn } from '@idealize/ui-gallery/client'
import { formatBytes, formatWhen, rawUrl, SoundstageView } from '../src/client/SoundstageView.tsx'
import { en } from '../src/client/locales.ts'
import type { SoundstageKey } from '../src/client/locales.ts'

afterEach(cleanup)

/** The English dictionary as the components' copy face, with the same interpolation the locale service does. */
const t = (key: SoundstageKey, params?: Record<string, unknown>): string =>
  en[key].replace(/\{(\w+)\}/g, (_whole, name: string) => {
    const value = params?.[name]
    return typeof value === 'number' || typeof value === 'string' ? String(value) : ''
  })

const artefact = (over: Partial<GalleryArtefact> = {}): GalleryArtefact => ({
  id: 'art-1',
  mediaType: 'audio/wav',
  bytes: 88244,
  relPath: 'Sounds/2026-08-24_art-1.wav',
  archived: false,
  ...over,
})

const row = (over: Partial<GalleryRow> = {}): GalleryRow => ({
  callId: 'call-1',
  toolName: 'generate_audio',
  artefactKind: 'audio',
  prompt: 'rain on a tin roof',
  settings: { durationSeconds: 5 },
  status: 'done',
  startedAt: Date.UTC(2026, 7, 24, 9, 0, 0),
  startSeq: 4,
  turn: 1,
  artefacts: [artefact()],
  ...over,
})

const turn = (over: Partial<GalleryTurn> = {}): GalleryTurn => ({
  turn: 2, startSeq: 9, startedAt: Date.UTC(2026, 7, 24, 9, 5, 0), prompt: 'wind through pines', phase: 'thinking', callIds: [], reply: '', ...over,
})

function view(rows: readonly GalleryRow[], extra: {
  onRetry?: (prompt: string) => void
  setDisposition?: (id: string, disposition: 'kept' | 'archived') => Promise<string | null>
  turns?: readonly GalleryTurn[]
} = {}) {
  return render(
    <SoundstageView
      rows={rows}
      {...extra.turns === undefined ? {} : { turns: extra.turns }}
      t={t}
      onRetry={extra.onRetry ?? (() => {})}
      setDisposition={extra.setDisposition ?? (async () => null)}
    />,
  )
}

describe('the Sound Stage list', () => {
  it('plays a stored sound from the artefact raw route, with its own provenance', () => {
    const { container } = view([row()])
    const player = container.querySelector('[data-soundstage-player="art-1"]') as HTMLAudioElement
    expect(player.getAttribute('src')).toBe(rawUrl('art-1'))
    expect(screen.getByText('rain on a tin roof')).toBeTruthy()
    // The line names where the file actually sits in the project.
    expect(container.textContent).toContain('Sounds/2026-08-24_art-1.wav')
    expect(container.textContent).toContain('5s')
  })

  it('shows a generation with no artefact yet as still running', () => {
    const { container } = view([row({ status: 'running', artefacts: [] })])
    expect(container.querySelector('[data-soundstage-generating="call-1"]')).not.toBeNull()
    expect(screen.getByText('Generating…')).toBeTruthy()
    expect(container.querySelector('[role="progressbar"]')).not.toBeNull()
  })

  it('shows a turn still thinking with its prompt and a bar, and a turn that made nothing with the model\'s reply', () => {
    // JJ, 8 Sep 2026: posting a message "looks like it's not working".
    const { container } = view([row()], { turns: [
      turn(),
      turn({ turn: 1, startSeq: 2, prompt: 'a hum', phase: 'no-generation', reply: 'How long should it be?' }),
    ] })
    const order = [...container.querySelectorAll('li')].map(node => node.getAttribute('data-soundstage-turn') ?? 'sound')
    expect(order).toEqual(['thinking', 'sound', 'no-generation'])
    const thinking = container.querySelector('[data-soundstage-turn="thinking"]')!
    expect(thinking.textContent).toContain('wind through pines')
    expect(thinking.textContent).toContain('Thinking…')
    expect(thinking.querySelector('[role="progressbar"]')).not.toBeNull()
    const silent = container.querySelector('[data-soundstage-turn="no-generation"]')!
    expect(silent.textContent).toContain('a hum')
    expect(silent.querySelector('[data-soundstage-reply]')?.textContent).toBe('How long should it be?')
    expect(container.querySelector('[data-soundstage-empty]')).toBeNull()
  })

  it('names a stopped turn and a silent one when the model left no text, and hides turns a sound already tells', () => {
    const { container } = view([], { turns: [
      turn({ turn: 3, startSeq: 30, phase: 'no-generation', endReason: 'aborted' }),
      turn({ turn: 2, startSeq: 20, phase: 'no-generation', prompt: '' }),
      turn({ turn: 1, startSeq: 10, phase: 'generated' }),
    ] })
    expect([...container.querySelectorAll('[data-soundstage-reply]')].map(node => node.textContent)).toEqual(['Stopped.', 'Nothing was generated this turn.'])
    expect(container.querySelectorAll('li')).toHaveLength(2)
    expect(screen.getByText('Untitled sound')).toBeTruthy()
  })

  it('prints the provider\'s refusal where a silent turn would say nothing was generated', () => {
    // A route that answers with an error leaves no reply at all; naming the
    // failure points at the account rather than the generator.
    const { container } = view([], { turns: [
      turn({ turn: 1, startSeq: 10, phase: 'no-generation', endReason: 'error', error: 'Failed to extract accountId from token' }),
    ] })
    const failed = container.querySelector('[data-soundstage-turn-failed]')!
    expect(failed.textContent).toBe('This turn failed: Failed to extract accountId from token')
    expect(container.textContent).not.toContain('Nothing was generated this turn.')
  })

  it("prints the provider's own cause on a failure and re-sends its prompt on Retry", () => {
    const onRetry = vi.fn()
    view([row({ status: 'failed', artefacts: [], error: 'the provider refused: quota' })], { onRetry })
    expect(screen.getByRole('alert').textContent).toBe('the provider refused: quota')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledWith('rain on a tin roof')
  })

  it('offers Archive on a kept sound and asks the store for that verdict', () => {
    const setDisposition = vi.fn(async () => null)
    view([row()], { setDisposition })
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
    expect(setDisposition).toHaveBeenCalledWith('art-1', 'archived')
  })

  it('folds an archived sound out of the list and offers Keep on it there', () => {
    const setDisposition = vi.fn(async () => null)
    const { container } = view([row({ artefacts: [artefact({ archived: true })] })], { setDisposition })
    // Out of the main list, into the fold, and countable.
    expect(container.querySelector('ul [data-soundstage-sound="art-1"]')).toBeTruthy()
    expect(container.querySelector('[data-soundstage-archived-fold="1"]')).not.toBeNull()
    expect(screen.getByText('1 archived')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }))
    expect(setDisposition).toHaveBeenCalledWith('art-1', 'kept')
  })

  it('says the chat has no sounds, not the project', () => {
    view([])
    expect(screen.getByText('No sounds in this chat yet.')).toBeTruthy()
  })

  it('has no Refresh: the rows come from the live snapshot, so there is nothing to re-read', () => {
    view([row()])
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull()
  })

  it('asks the Files pane for the sound\'s file from Reveal', () => {
    const heard: string[] = []
    const listener = (event: Event): void => { heard.push((event as CustomEvent<{ relPath: string }>).detail.relPath) }
    document.addEventListener('idealize:reveal-artefact', listener)
    const { container } = view([row()])
    fireEvent.click(screen.getByRole('button', { name: 'Reveal' }))
    expect(heard).toEqual(['Sounds/2026-08-24_art-1.wav'])
    expect(container.querySelector('[data-soundstage-reveal="art-1"]')).not.toBeNull()
    document.removeEventListener('idealize:reveal-artefact', listener)
  })
})

describe('the row formatters', () => {
  it('prints bytes at the scale a person reads', () => {
    expect(formatBytes(900)).toBe('900 B')
    expect(formatBytes(88244)).toBe('86.2 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
  })

  it('prints an epoch instant as a short local date and time', () => {
    expect(formatWhen(Date.UTC(2026, 7, 24, 9, 0, 0))).toMatch(/24 Aug/)
  })

  it('prints nothing for an instant it cannot read', () => {
    expect(formatWhen(Number.NaN)).toBe('')
  })
})
