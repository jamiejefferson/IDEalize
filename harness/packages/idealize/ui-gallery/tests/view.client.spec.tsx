// @vitest-environment jsdom
/**
 * What the Gallery grid shows: image-only artefact tiles pointing at the raw
 * route with their controls hidden at rest, a silent video preview that opens
 * the player in the enlarged view, the enlarged view with the copy and the
 * verdict in a column that scrolls, archived tiles under their fold, the
 * chat-like rows for a turn still thinking, a task running and a turn that
 * made nothing, the provider's own cause with a Retry that resubmits, and the
 * empty state before anything is generated. The generation settings strip is
 * proved beside it: it appears on the three media spaces, renders the fields
 * the inputs route publishes for the active model or that space's fallback
 * vocabulary, keeps the count control to Images, and writes every choice into
 * the draft.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { GenerationSettings, loadInputs } from '../src/client/GenerationSettings.tsx'
import { GalleryView, rawUrl, retryMessage } from '../src/client/GalleryView.tsx'
import type { GalleryViewProps } from '../src/client/GalleryView.tsx'
import type { GalleryRow, GalleryTurn } from '../src/client/contract.ts'

afterEach(cleanup)

const t = ((key: string) => key) as GalleryViewProps['t']

function row(overrides: Partial<GalleryRow> = {}): GalleryRow {
  return {
    callId: 'call-1',
    toolName: 'generate_image',
    artefactKind: 'image',
    prompt: 'a paper boat',
    settings: { aspect: '16:9' },
    status: 'done',
    startedAt: 1_700_000_000_000,
    startSeq: 4,
    turn: 1,
    artefacts: [{ id: 'artefact-1', mediaType: 'image/png', bytes: 2048, relPath: 'Images/2026-08-24_artefact-1.png', archived: false }],
    ...overrides,
  }
}

function turn(overrides: Partial<GalleryTurn> = {}): GalleryTurn {
  return { turn: 2, startSeq: 9, startedAt: 1_700_000_000_009, prompt: 'a kite over a beach', phase: 'thinking', callIds: [], reply: '', ...overrides }
}

function view(
  rows: readonly GalleryRow[],
  retry: GalleryViewProps['retry'] = vi.fn(async () => null),
  setDisposition: GalleryViewProps['setDisposition'] = vi.fn(async () => null),
  kind: 'image' | 'video' | 'audio' = 'image',
  turns: readonly GalleryTurn[] = [],
) {
  const useSession = (<T,>(selector: (state: { views: { get: (target: string) => unknown } }) => T): T =>
    selector({ views: { get: () => ({ rows, turns }) } })) as unknown as GalleryViewProps['useSession']
  render(<GalleryView {...({ useSession, retry, setDisposition, kind, t } as unknown as GalleryViewProps)} />)
  return retry
}

/** The view's stylesheet, for the layout contracts jsdom cannot lay out. */
const stylesheet = readFileSync(resolve('packages/idealize/ui-gallery/src/client/GalleryView.module.css'), 'utf8')

/** The declarations of one rule, by its selector text. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(stylesheet)
  if (match === null) throw new Error(`no rule ${selector}`)
  return match[1]!
}

describe('the Gallery grid', () => {
  it('shows each committed artefact over the artefact store\'s raw route, the image alone on the tile', () => {
    view([row()])
    const image = document.querySelector('[data-gallery-image="artefact-1"]')
    expect(image?.getAttribute('src')).toBe(rawUrl('artefact-1'))
    expect(image?.getAttribute('alt')).toBe('a paper boat')
    expect(document.querySelector('[data-gallery-tile="done"]')).not.toBeNull()
    // The copy waits for the enlarged view (JJ, 2 Sep 2026).
    expect(screen.queryByText('2.0 KB')).toBeNull()
    expect(screen.queryByText('a paper boat')).toBeNull()
    expect(document.querySelector('[data-gallery-verdict="archived"]')).not.toBeNull()
  })

  it('enlarges a tile to its copy, path and verdict, and closes on Escape', () => {
    view([row()])
    fireEvent.click(document.querySelector('[data-gallery-open="artefact-1"]')!)
    const enlarged = document.querySelector('[data-gallery-enlarged="artefact-1"]')
    expect(enlarged).not.toBeNull()
    expect(document.querySelector('[data-gallery-detail="prompt"]')?.textContent).toBe('a paper boat')
    expect(document.querySelector('[data-gallery-detail="type"]')?.textContent).toBe('image/png')
    expect(document.querySelector('[data-gallery-detail="size"]')?.textContent).toBe('2.0 KB')
    expect(document.querySelector('[data-gallery-detail="aspect"]')?.textContent).toBe('16:9')
    expect(document.querySelector('[data-gallery-detail="path"]')?.textContent).toBe('Images/2026-08-24_artefact-1.png')
    expect(enlarged?.querySelector('[data-gallery-verdict="archived"]')).not.toBeNull()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(document.querySelector('[data-gallery-enlarged]')).toBeNull()
  })

  it('posts the verdict from the tile and folds archived tiles under the grid with a Keep', async () => {
    const setDisposition = vi.fn(async () => null)
    const archived = { id: 'artefact-2', mediaType: 'image/png', bytes: 4096, relPath: 'Images/Archive/2026-08-24_artefact-2.png', archived: true }
    view([row({ artefacts: [row().artefacts[0]!, archived] })], undefined, setDisposition)
    fireEvent.click(document.querySelector('[data-gallery-tile="done"]:not([data-gallery-archived]) [data-gallery-verdict="archived"]')!)
    expect(setDisposition).toHaveBeenCalledWith('artefact-1', 'archived')
    await vi.waitFor(() => { expect(document.querySelector('[data-gallery-verdict="archived"]:disabled')).toBeNull() })
    const fold = document.querySelector('[data-gallery-archived-fold]')
    expect(fold?.getAttribute('data-gallery-archived-fold')).toBe('1')
    expect(screen.getByText('gallery.archived.fold')).toBeTruthy()
    // The archived tile lives only in the fold, and offers Keep.
    expect(document.querySelectorAll('[data-gallery-image="artefact-2"]')).toHaveLength(1)
    expect(fold?.querySelector('[data-gallery-image="artefact-2"]')).not.toBeNull()
    fireEvent.click(fold!.querySelector('[data-gallery-verdict="kept"]')!)
    expect(setDisposition).toHaveBeenCalledWith('artefact-2', 'kept')
  })

  it('previews a video silently on the tile and plays it, with the native controls, only in the enlarged view', () => {
    // Until 8 Sep 2026 the tile held a native player inside the enlarge button:
    // play, scrub and the overflow menu each opened the enlarged view too, and
    // the menu drew where the browser put it (JJ: "the 3-dot nav is not styled
    // or positioned correctly").
    view(
      [row({ callId: 'c-video', artefactKind: 'video', artefacts: [{ id: 'v1', mediaType: 'video/mp4', bytes: 24, relPath: 'x.mp4', archived: false }] })],
      undefined,
      undefined,
      'video',
    )
    const preview = document.querySelector<HTMLVideoElement>('[data-gallery-video="v1"]')!
    expect(preview.getAttribute('src')).toBe(rawUrl('v1'))
    expect(preview.hasAttribute('controls')).toBe(false)
    expect(preview.muted).toBe(true)
    expect(preview.closest('[data-gallery-open="v1"]')).not.toBeNull()
    expect(document.querySelector('[data-gallery-open="v1"] [data-gallery-play]')).not.toBeNull()

    fireEvent.click(document.querySelector('[data-gallery-open="v1"]')!)
    const player = document.querySelector<HTMLVideoElement>('[data-gallery-enlarged="v1"] [data-gallery-player]')!
    expect(player.getAttribute('src')).toBe(rawUrl('v1'))
    expect(player.hasAttribute('controls')).toBe(true)
    expect(player.autoplay).toBe(true)
    // A click on the player stays in the sheet: only the backdrop closes it.
    fireEvent.click(player)
    expect(document.querySelector('[data-gallery-enlarged]')).not.toBeNull()
    fireEvent.click(document.querySelector('[data-gallery-enlarged]')!)
    expect(document.querySelector('[data-gallery-enlarged]')).toBeNull()
  })

  it('keeps the tile controls hidden at rest and reachable on hover or focus', () => {
    // jsdom lays nothing out, so the contract is the stylesheet's: the actions
    // block exists on the tile, rests at visibility hidden with no pointer
    // events, and comes back on hover, focus-within, or where hovering is not
    // possible (JJ, 8 Sep 2026: "hide ui elements on assets until hover").
    view([row()])
    const actions = document.querySelector('[data-gallery-tile="done"] [data-gallery-actions]')!
    expect(actions.querySelector('[data-gallery-reveal="artefact-1"]')).not.toBeNull()
    expect(actions.querySelector('[data-gallery-verdict="archived"]')).not.toBeNull()
    const rest = rule('.tileActions')
    expect(rest).toContain('visibility: hidden')
    expect(rest).toContain('pointer-events: none')
    const shown = rule('.tile:hover .tileActions,\n.tile:focus-within .tileActions')
    expect(shown).toContain('visibility: visible')
    expect(shown).toContain('pointer-events: auto')
    expect(stylesheet).toMatch(/@media \(hover: none\) \{\s*\.tileActions \{[^}]*visibility: visible/)
    // Bigger tiles, the media covering its frame.
    expect(rule('.grid')).toContain('minmax(320px, 1fr)')
    expect(rule('.grid')).toContain('gap: 16px')
    expect(rule('.image,\n.video')).toContain('object-fit: cover')
  })

  it('lets the enlarged view\'s details column scroll inside the sheet', () => {
    // The chain the cropping needs (JJ, 8 Sep 2026: "right hand column doesn't
    // scroll so the bottom of the prompt and actions are cropped"): a fixed
    // sheet, one grid row bounded by minmax(0, 1fr), a column with min-height 0
    // and overflow-y auto, the actions inside that column.
    view([row()])
    fireEvent.click(document.querySelector('[data-gallery-open="artefact-1"]')!)
    const details = document.querySelector('[data-gallery-enlarged] [data-gallery-details]')!
    expect(details.querySelector('[data-gallery-detail="prompt"]')).not.toBeNull()
    expect(details.querySelector('[data-gallery-detail-actions] [data-gallery-close]')).not.toBeNull()
    expect(rule('.enlarged')).toContain('position: fixed')
    expect(rule('.enlargedBody')).toContain('grid-template-rows: minmax(0, 1fr)')
    expect(rule('.enlargedBody')).toContain('max-height: 100%')
    const column = rule('.details')
    expect(column).toContain('min-height: 0')
    expect(column).toContain('overflow-y: auto')
    expect(rule('.largeVideo')).toContain('max-height: 80vh')
  })

  it('shows only its own kind: one chat\'s log carries every generation it ran', () => {
    // The same chat made an image, a video and a sound; the Images grid shows
    // the image, and the other two belong to Video and the Sound Stage.
    const rows = [
      row(),
      row({ callId: 'c-video', artefactKind: 'video', artefacts: [{ id: 'v1', mediaType: 'video/mp4', bytes: 24, relPath: 'x.mp4', archived: false }] }),
      row({ callId: 'c-audio', artefactKind: 'audio', artefacts: [{ id: 'a1', mediaType: 'audio/wav', bytes: 44, relPath: 'x.wav', archived: false }] }),
    ]
    view(rows)
    expect(document.querySelector('[data-gallery-image="artefact-1"]')).not.toBeNull()
    expect(document.querySelector('[data-gallery-video="v1"]')).toBeNull()
    expect(document.querySelector('[data-gallery-audio="a1"]')).toBeNull()
    cleanup()
    view(rows, undefined, undefined, 'video')
    expect(document.querySelector('[data-gallery-video="v1"]')).not.toBeNull()
    expect(document.querySelector('[data-gallery-image="artefact-1"]')).toBeNull()
  })

  it('shows a running task as a chat row: the prompt beside Generating…', () => {
    view([row({ status: 'running', artefacts: [] })])
    const running = document.querySelector('[data-gallery-tile="running"]')!
    expect(running.querySelector('[data-gallery-prompt]')?.textContent).toBe('a paper boat')
    expect(running.querySelector('[data-gallery-working="generating"]')).not.toBeNull()
    expect(screen.getByText('gallery.status.running')).toBeTruthy()
  })

  it('shows a turn still thinking and a turn that made nothing as chat rows, newest first among the tiles', () => {
    // JJ, 8 Sep 2026: "when you post a message it looks like it's not working".
    view([row()], undefined, undefined, 'image', [
      turn(),
      turn({ turn: 1, startSeq: 2, prompt: 'make me a boat', phase: 'no-generation', reply: 'Which colour should the boat be?' }),
    ])
    const rows = [...document.querySelectorAll('[data-gallery-turn], [data-gallery-tile]')].map(node => node.getAttribute('data-gallery-turn') ?? node.getAttribute('data-gallery-tile'))
    expect(rows).toEqual(['thinking', 'done', 'no-generation'])
    const thinking = document.querySelector('[data-gallery-turn="thinking"]')!
    expect(thinking.querySelector('[data-gallery-prompt]')?.textContent).toBe('a kite over a beach')
    expect(thinking.querySelector('[data-gallery-working="thinking"]')).not.toBeNull()
    expect(screen.getByText('gallery.status.thinking')).toBeTruthy()
    const silent = document.querySelector('[data-gallery-turn="no-generation"]')!
    expect(silent.querySelector('[data-gallery-prompt]')?.textContent).toBe('make me a boat')
    expect(silent.querySelector('[data-gallery-reply]')?.textContent).toBe('Which colour should the boat be?')
    // A turn without a tile is not an empty grid.
    expect(document.querySelector('[data-gallery-empty]')).toBeNull()
  })

  it("prints the provider's refusal where a silent turn would say nothing was generated", () => {
    // A route that answers with an error leaves no reply at all; naming the
    // failure points at the account rather than the generator.
    view([], undefined, undefined, 'video', [
      turn({ turn: 1, startSeq: 10, phase: 'no-generation', endReason: 'error', error: 'Failed to extract accountId from token' }),
    ])
    expect(document.querySelector('[data-gallery-turn-failed]')?.textContent).toBe('gallery.turn.failed')
    expect(document.body.textContent).not.toContain('gallery.turn.nothing')
  })

  it('names a stopped turn and a silent one when the model left no text', () => {
    view([], undefined, undefined, 'video', [
      turn({ turn: 3, startSeq: 30, phase: 'no-generation', endReason: 'aborted' }),
      turn({ turn: 2, startSeq: 20, phase: 'no-generation', endReason: 'completed' }),
    ])
    expect([...document.querySelectorAll('[data-gallery-reply]')].map(node => node.textContent)).toEqual(['gallery.turn.stopped', 'gallery.turn.nothing'])
    // A turn that reached a generation is told by its row, not repeated here.
    cleanup()
    view([], undefined, undefined, 'video', [turn({ phase: 'generating' }), turn({ turn: 1, startSeq: 1, phase: 'generated' })])
    expect(document.querySelector('[data-gallery-turn]')).toBeNull()
    expect(document.querySelector('[data-gallery-empty]')).not.toBeNull()
  })

  it('shows the provider\'s own cause on a failed row', () => {
    view([row({ status: 'failed', artefacts: [], error: 'openrouter: 402 insufficient credits' })])
    const cause = document.querySelector('[data-gallery-cause]')
    expect(cause?.textContent).toBe('openrouter: 402 insufficient credits')
    expect(document.querySelector('[role="alert"]')).not.toBeNull()
  })

  it('resubmits the failed task\'s own prompt and settings from Retry', async () => {
    const failed = row({ status: 'failed', artefacts: [], error: 'openrouter: 402 insufficient credits' })
    const retry = view([failed])
    fireEvent.click(screen.getByText('gallery.retry'))
    expect(retry).toHaveBeenCalledWith(failed)
    await vi.waitFor(() => {
      expect(screen.queryByText('gallery.retry')).toBeTruthy()
    })
  })

  it('reports a retry the host refused without losing the row', async () => {
    const retry = vi.fn(async () => 'the session is unavailable')
    view([row({ status: 'failed', artefacts: [], error: 'boom' })], retry)
    fireEvent.click(screen.getByText('gallery.retry'))
    await vi.waitFor(() => {
      expect(screen.getByText('gallery.retry.failed')).toBeTruthy()
    })
    expect(document.querySelector('[data-gallery-cause]')?.textContent).toBe('boom')
  })

  it('explains the empty grid in the words of the kind it shows', () => {
    view([])
    expect(document.querySelector('[data-gallery-empty]')).not.toBeNull()
    expect(screen.getByText('gallery.empty.image.title')).toBeTruthy()
    expect(document.querySelector('[data-gallery-tile]')).toBeNull()
    cleanup()
    view([], undefined, undefined, 'video')
    expect(screen.getByText('gallery.empty.video.title')).toBeTruthy()
  })
})

describe('retryMessage', () => {
  it('states the request in plain words and names no model or provider', () => {
    expect(retryMessage(row({ status: 'failed' })))
      .toBe('Generate a image: a paper boat, aspect 16:9')
    expect(retryMessage(row({ artefactKind: 'audio', settings: { durationSeconds: 8 } })))
      .toBe('Generate audio: a paper boat, 8 seconds long')
    expect(retryMessage(row({ settings: {} }))).toBe('Generate a image: a paper boat')
  })
})

describe('the generation settings strip', () => {
  const select = (name: string) => document.querySelector<HTMLSelectElement>(`[data-gen-setting="${name}"]`)
  const options = (name: string) => [...select(name)?.options ?? []].map(option => option.value)

  /** The inputs route, answering per space; `null` answers 404. */
  // The strip makes two requests per load: its field schema, and the media
  // route behind the Generator control. `inputCalls` counts the first alone,
  // so the field tests stay about fields.
  type Presets = { presets: { id: string; model?: unknown; candidates?: unknown[] }[] }
  function stubInputs(answers: Record<string, { fields: unknown[] } | null>, generators: Presets = { presets: [] }) {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (!url.includes('?space=')) {
        // The media route answers with what it holds, and a POST moves it, so
        // the reload the strip triggers afterwards agrees with the pick.
        if (init?.method === 'POST') {
          const sent = JSON.parse(init.body as string) as { id: string; model: unknown }
          const row = generators.presets.find(preset => preset.id === sent.id)
          if (row !== undefined) row.model = sent.model
          return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))
        }
        return Promise.resolve(new Response(JSON.stringify(generators), { status: 200, headers: { 'content-type': 'application/json' } }))
      }
      const space = new URL(url, 'http://host').searchParams.get('space') ?? ''
      const answer = answers[space]
      return Promise.resolve(answer === null || answer === undefined
        ? new Response('not found', { status: 404 })
        : new Response(JSON.stringify({ model: { provider: 'fal', model: 'seedance' }, ...answer }), { status: 200, headers: { 'content-type': 'application/json' } }))
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  /** How many times the strip has asked for its field schema. */
  const inputCalls = (mock: { mock: { calls: unknown[][] } }): number =>
    mock.mock.calls.filter(call => String(call[0]).includes('?space=')).length

  afterEach(() => { vi.unstubAllGlobals() })

  function strip(activeView: string | null, draft = 'a paper boat') {
    const setDraft = vi.fn()
    const element = (view: string | null) => (
      <GenerationSettings
        useStore={selector => selector({ view })}
        useInput={selector => selector({ draft })}
        inputActions={{ setDraft }}
        t={(key: string, params?: Record<string, unknown>) => params === undefined ? key : `${key}:${String(params.seconds)}`}
      />
    )
    const rendered = render(element(activeView))
    return { setDraft, rerender: (view: string | null) => { rendered.rerender(element(view)) } }
  }

  it('stays hidden while a non-media view is active', () => {
    stubInputs({})
    strip('chat')
    expect(document.querySelector('[data-gen-settings-space]')).toBeNull()
    cleanup()
    strip(null)
    expect(document.querySelector('[data-gen-settings-space]')).toBeNull()
  })

  it('appears on Images with the fallback aspect and the count at their default when the route is absent', async () => {
    const fetchMock = stubInputs({})
    strip('gallery')
    await waitFor(() => { expect(fetchMock).toHaveBeenCalledWith('/idealize/generate/inputs?space=gallery') })
    const root = document.querySelector('[data-gallery-settings]')
    expect(root?.getAttribute('data-gen-settings-space')).toBe('gallery')
    expect(document.querySelector<HTMLSelectElement>('[data-gallery-aspect]')?.value).toBe('auto')
    expect(select('aspect_ratio')?.hasAttribute('data-gallery-aspect')).toBe(true)
    expect(options('aspect_ratio')).toEqual(['auto', '1:1', '4:3', '3:2', '16:9', '9:16'])
    expect(document.querySelector<HTMLSelectElement>('[data-gallery-count]')?.value).toBe('1')
    expect(select('count')?.hasAttribute('data-gallery-count')).toBe(true)
  })

  it('gives Video a duration that starts unset and an aspect, and no count', async () => {
    stubInputs({ motion: { fields: [] } })
    strip('motion')
    await waitFor(() => { expect(select('duration')).not.toBeNull() })
    expect(document.querySelector('[data-gallery-settings]')).toBeNull()
    expect(document.querySelector('[data-gen-settings-space]')?.getAttribute('data-gen-settings-space')).toBe('motion')
    expect(select('duration')?.value).toBe('')
    expect(options('duration')).toEqual(['', '5', '8', '10'])
    expect(screen.getByText('gallery.settings.duration')).toBeTruthy()
    expect(screen.getByText('gallery.settings.unset')).toBeTruthy()
    expect(screen.getByText('gallery.settings.seconds:8')).toBeTruthy()
    expect(options('aspect_ratio')).toEqual(['auto', '16:9', '9:16', '1:1'])
    expect(document.querySelector('[data-gallery-aspect]')).not.toBeNull()
    expect(select('count')).toBeNull()
  })

  it('gives the Sound Stage one length select and nothing else', async () => {
    stubInputs({})
    strip('soundstage')
    await waitFor(() => { expect(select('duration')).not.toBeNull() })
    expect(document.querySelectorAll('[data-gen-setting]')).toHaveLength(1)
    expect(options('duration')).toEqual(['auto', '5', '15', '30'])
    expect(select('duration')?.value).toBe('auto')
    expect(screen.getByText('gallery.settings.length')).toBeTruthy()
  })

  it('renders the fields the route publishes for the active model, keeping the count on Images', async () => {
    stubInputs({
      motion: { fields: [
        { name: 'duration', label: 'Duration', kind: 'enum', values: ['5', '10'] },
        { name: 'resolution', label: 'Resolution', kind: 'enum', values: ['480p', '720p', '1080p'], default: '1080p' },
        { name: 'aspect_ratio', label: 'Aspect', kind: 'enum', values: ['16:9', '9:16'], default: '16:9' },
        { name: 'camera_fixed', label: 'Fixed camera', kind: 'enum', values: ['true', 'false'], default: 'false' },
        { name: 'broken', kind: 'enum', values: [1] },
      ] },
      gallery: { fields: [{ name: 'output_format', label: 'Format', kind: 'enum', values: ['png', 'jpeg'], default: 'png' }] },
    })
    const { setDraft, rerender } = strip('motion')
    await waitFor(() => { expect(select('resolution')).not.toBeNull() })
    expect([...document.querySelectorAll('[data-gen-setting]')].map(node => node.getAttribute('data-gen-setting')))
      .toEqual(['duration', 'resolution', 'aspect_ratio', 'camera_fixed'])
    expect(options('duration')).toEqual(['', '5', '10'])
    expect(select('resolution')?.value).toBe('1080p')
    expect(select('aspect_ratio')?.value).toBe('16:9')
    // Known names translate; the route's own label stands for the rest.
    expect(screen.getByText('gallery.settings.resolution')).toBeTruthy()
    expect(screen.getByText('Fixed camera')).toBeTruthy()
    fireEvent.change(select('duration')!, { target: { value: '5' } })
    expect(setDraft).toHaveBeenCalledWith('a paper boat [duration 5]')

    // The view moves to Images: that space's schema replaces the fields, and the count arrives.
    rerender('gallery')
    await waitFor(() => { expect(select('output_format')).not.toBeNull() })
    expect(select('duration')).toBeNull()
    expect(select('count')).not.toBeNull()
    expect(document.querySelector('[data-gallery-settings]')).not.toBeNull()
  })

  it('renders a number input and a checkbox for the route\'s number and boolean fields, and writes what they say', async () => {
    stubInputs({
      soundstage: { fields: [
        { name: 'duration', label: 'Duration', kind: 'number', integer: false, min: 1, max: 300, default: 60 },
        { name: 'takes', label: 'Takes', kind: 'number', integer: true },
        { name: 'instrumental', label: 'Instrumental', kind: 'boolean' },
        { name: 'master', label: 'Master', kind: 'boolean', default: true },
        { name: 'bad_number', label: 'Bad', kind: 'number', integer: 'yes' },
        { name: 'bad_bool', label: 'Bad', kind: 'boolean', default: 'true' },
        { name: 'bad_kind', label: 'Bad', kind: 'colour' },
      ] },
    })
    const { setDraft } = strip('soundstage')
    const input = (name: string) => document.querySelector<HTMLInputElement>(`[data-gen-setting="${name}"]`)
    await waitFor(() => { expect(input('duration')).not.toBeNull() })
    expect([...document.querySelectorAll('[data-gen-setting]')].map(node => node.getAttribute('data-gen-setting')))
      .toEqual(['duration', 'takes', 'instrumental', 'master'])
    expect([...document.querySelectorAll('[data-gen-setting-kind]')].map(node => node.getAttribute('data-gen-setting-kind')))
      .toEqual(['number', 'number', 'boolean', 'boolean'])
    // The number input carries the model's bounds and default, the unit follows a duration.
    const duration = input('duration')!
    expect([duration.type, duration.min, duration.max, duration.step, duration.value, duration.placeholder]).toEqual(['number', '1', '300', 'any', '60', '60'])
    expect(screen.getByText('gallery.settings.length')).toBeTruthy()
    expect(screen.getByText('gallery.settings.secondsUnit')).toBeTruthy()
    expect([input('takes')!.step, input('takes')!.value, input('takes')!.getAttribute('inputmode')]).toEqual(['1', '', 'numeric'])
    // The switches start at their defaults.
    expect([input('instrumental')!.type, input('instrumental')!.checked, input('master')!.checked]).toEqual(['checkbox', false, true])
    // A switch reads box then word, and the word is not a hideable label: a bare box says nothing.
    expect([input('master')!.previousElementSibling, input('master')!.nextElementSibling?.textContent]).toEqual([null, 'Master'])
    expect(input('master')!.nextElementSibling?.className).not.toContain('label')
    // Both switches share one box after the other controls.
    expect([...document.querySelectorAll('[data-gen-switches] [data-gen-setting]')].map(node => node.getAttribute('data-gen-setting'))).toEqual(['instrumental', 'master'])

    fireEvent.change(duration, { target: { value: '45' } })
    expect(setDraft).toHaveBeenLastCalledWith('a paper boat [duration 45]')
    fireEvent.click(input('instrumental')!)
    expect(setDraft).toHaveBeenLastCalledWith('a paper boat [instrumental true]')
    fireEvent.click(input('master')!)
    expect(setDraft).toHaveBeenLastCalledWith('a paper boat [master false]')

    // A draft carrying both kinds reads back into the controls.
    cleanup()
    strip('soundstage', 'rain [duration 120, takes 2, master false]')
    await waitFor(() => { expect(input('duration')?.value).toBe('120') })
    expect([input('takes')!.value, input('master')!.checked, input('instrumental')!.checked]).toEqual(['2', false, false])
  })

  it('writes the chosen aspect into the draft and reads its values back out of the draft it wrote', async () => {
    stubInputs({})
    const { setDraft } = strip('gallery')
    await waitFor(() => { expect(select('aspect_ratio')).not.toBeNull() })
    fireEvent.change(document.querySelector('[data-gallery-aspect]')!, { target: { value: '16:9' } })
    expect(setDraft).toHaveBeenCalledWith('a paper boat [aspect 16:9]')
    fireEvent.change(document.querySelector('[data-gallery-count]')!, { target: { value: '3' } })
    expect(setDraft).toHaveBeenLastCalledWith('a paper boat [3 images]')
    cleanup()
    strip('gallery', 'a paper boat [aspect 4:3, 3 images]')
    await waitFor(() => { expect(select('aspect_ratio')).not.toBeNull() })
    expect(document.querySelector<HTMLSelectElement>('[data-gallery-aspect]')?.value).toBe('4:3')
    expect(document.querySelector<HTMLSelectElement>('[data-gallery-count]')?.value).toBe('3')
  })

  it('shows a value the user typed into the tag even when the menu lacks it', async () => {
    stubInputs({})
    strip('motion', 'a slow pan [duration 12]')
    await waitFor(() => { expect(select('duration')).not.toBeNull() })
    expect(select('duration')?.value).toBe('12')
    expect(options('duration')).toEqual(['', '5', '8', '10', '12'])
  })

  it('ignores a route answer that arrives after the strip has gone', async () => {
    const answers: ((response: Response) => void)[] = []
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { answers.push(resolve) }))
    vi.stubGlobal('fetch', fetchMock)
    const { rerender } = strip('motion')
    await waitFor(() => { expect(inputCalls(fetchMock)).toBe(1) })
    rerender('chat')
    for (const answer of answers) {
      answer(new Response(JSON.stringify({ model: null, presets: [], fields: [{ name: 'duration', label: 'Duration', kind: 'enum', values: ['5'] }] }), { status: 200 }))
    }
    await act(async () => { await Promise.resolve() })
    expect(document.querySelector('[data-gen-settings-space]')).toBeNull()
    rerender('motion')
    // The late answer was dropped: the strip fetches afresh and shows the fallback meanwhile.
    await waitFor(() => { expect(inputCalls(fetchMock)).toBe(2) })
    expect(options('duration')).toEqual(['', '5', '8', '10'])
  })

  it('names no model: the strip is the creation variables alone', async () => {
    // The space's generation model belongs to its brain and is chosen in the
    // Brains pane; a picker here stated it a second time beside the composer's
    // chat-model seat, and the two disagreed (JJ, 13 Sep 2026).
    stubInputs({ gallery: { fields: [{ name: 'aspect_ratio', label: 'Aspect', kind: 'enum', values: ['auto', '1:1'], default: 'auto' }] } }, { presets: [{
      id: 'images',
      model: { backend: 'fal', model: 'fal-ai/nano-banana-2' },
      candidates: [{ backend: 'fal', model: { id: 'fal-ai/nano-banana-2', name: 'Nano Banana 2' } }],
    }] })
    strip('gallery')
    await waitFor(() => { expect(document.querySelector('[data-gen-settings-space]')).not.toBeNull() })
    expect(select('generator')).toBeNull()
    // The creation variables stay: the space's fields, plus Images' count.
    expect(select('aspect_ratio')).not.toBeNull()
    expect(select('count')).not.toBeNull()
  })

  it('refetches the fields when the Brains pane reports a model change', async () => {
    const fetchMock = stubInputs({ motion: { fields: [{ name: 'duration', label: 'Duration', kind: 'enum', values: ['5'] }] } })
    strip('motion')
    await waitFor(() => { expect(inputCalls(fetchMock)).toBe(1) })
    document.dispatchEvent(new Event('idealize:brains-changed'))
    await waitFor(() => { expect(inputCalls(fetchMock)).toBe(2) })
    cleanup()
    document.dispatchEvent(new Event('idealize:brains-changed'))
    expect(inputCalls(fetchMock)).toBe(2)
  })
})

describe('loadInputs', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  const answer = (body: unknown) => vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })))

  it('keeps the well-formed fields of the route body and drops the rest', async () => {
    vi.stubGlobal('fetch', answer({ fields: [null, 7, { name: 'duration', label: 'Duration', kind: 'enum', values: ['4', '5'], default: '5' }, { name: 'bad', kind: 'enum', values: [1] }] }))
    expect(await loadInputs('motion')).toEqual([{ name: 'duration', label: 'Duration', kind: 'enum', values: ['4', '5'], default: '5' }])
  })

  it('reads no fields from a body without a list, and none when the request fails', async () => {
    vi.stubGlobal('fetch', answer({ model: null }))
    expect(await loadInputs('gallery')).toEqual([])
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
    expect(await loadInputs('soundstage')).toEqual([])
  })
})

describe('the strip on a narrow tool row', () => {
  const observers: { callback: () => void; observed: Element[] }[] = []
  class FakeResizeObserver {
    observed: Element[] = []
    constructor(readonly callback: () => void) { observers.push(this) }
    observe(element: Element) { this.observed.push(element) }
    disconnect() { /* nothing to release: the fake holds no platform handle */ }
  }

  afterEach(() => {
    vi.unstubAllGlobals()
    observers.length = 0
  })

  function widths(element: Element, scrollWidth: number, clientWidth: number) {
    Object.defineProperty(element, 'scrollWidth', { configurable: true, value: scrollWidth })
    Object.defineProperty(element, 'clientWidth', { configurable: true, value: clientWidth })
  }

  /** Render the strip into a tool row that already holds a mode chip beside it. */
  function renderStrip() {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('not found', { status: 404 }))))
    // jsdom lays nothing out, so the tool row is given a width by hand before
    // the strip mounts; the slot wrapper between them keeps jsdom's zero, the
    // way the real slot renderer's wrapper has no width of its own.
    const toolRow = document.body.appendChild(document.createElement('div'))
    widths(toolRow, 300, 300)
    render(
      <>
        <div data-mode-chip="">Workspace Write</div>
        <div data-slot-wrapper="">
          <GenerationSettings
            useStore={selector => selector({ view: 'motion' })}
            useInput={selector => selector({ draft: '' })}
            inputActions={{ setDraft: vi.fn() }}
            t={(key: string) => key}
          />
        </div>
      </>,
      { container: toolRow },
    )
    const row = document.querySelector<HTMLElement>('[data-gen-settings-space="motion"]')
    const chip = document.querySelector<HTMLElement>('[data-mode-chip]')
    if (row === null || chip === null) throw new Error('the strip did not render inside a row')
    return { row, parent: toolRow, chip }
  }

  const latest = () => {
    const observer = observers[observers.length - 1]
    if (observer === undefined) throw new Error('the strip observed nothing')
    return observer
  }

  it('drops its labels once the row overflows, and brings them back only when the row regains the width it asked for', () => {
    // Walk of 7 Sep 2026 at 1280px: the mode chip and the strip's labels
    // overlapped, because the row's leading half shrinks and its trailing half
    // does not.
    const { row, parent, chip } = renderStrip()
    expect(row.hasAttribute('data-gen-settings-compact')).toBe(false)
    expect(latest().observed).toEqual([row, parent, chip])

    // The row keeps its width; the chip's box shrinks under its text.
    widths(chip, 300, 100)
    act(() => { latest().callback() })
    expect(row.hasAttribute('data-gen-settings-compact')).toBe(true)
    expect(document.querySelector('[data-gen-setting="duration"]')?.getAttribute('aria-label')).toBe('gallery.settings.duration')

    // Compact, everything fits, yet the labels stay hidden while the row is
    // narrower than the 500px the labelled strip asked for.
    widths(chip, 300, 300)
    widths(parent, 450, 450)
    act(() => { latest().callback() })
    expect(row.hasAttribute('data-gen-settings-compact')).toBe(true)

    widths(parent, 520, 520)
    act(() => { latest().callback() })
    expect(row.hasAttribute('data-gen-settings-compact')).toBe(false)

    // The row itself overflowing counts the same way.
    widths(parent, 700, 520)
    act(() => { latest().callback() })
    expect(row.hasAttribute('data-gen-settings-compact')).toBe(true)
  })

  it('waits for the row to be laid out, then measures it on the strip\'s own resize', () => {
    // Before layout every ancestor reads zero (jsdom's default), and a document
    // element with a width is not a row either.
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('not found', { status: 404 }))))
    const toolRow = document.body.appendChild(document.createElement('div'))
    const chip = toolRow.appendChild(document.createElement('div'))
    render(
      <GenerationSettings
        useStore={selector => selector({ view: 'motion' })}
        useInput={selector => selector({ draft: '' })}
        inputActions={{ setDraft: vi.fn() }}
        t={(key: string) => key}
      />,
      { container: toolRow.appendChild(document.createElement('div')) },
    )
    const row = document.querySelector<HTMLElement>('[data-gen-settings-space="motion"]')
    if (row === null) throw new Error('no strip')
    expect(latest().observed).toEqual([row])

    widths(document.documentElement, 1280, 1280)
    act(() => { latest().callback() })
    expect(latest().observed).toEqual([row])
    expect(row.hasAttribute('data-gen-settings-compact')).toBe(false)
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 0 })

    widths(toolRow, 300, 300)
    widths(chip, 200, 100)
    act(() => { latest().callback() })
    expect(latest().observed).toEqual([row, toolRow, chip])
    expect(row.hasAttribute('data-gen-settings-compact')).toBe(true)
  })

  it('starts watching when the ring moves onto a media view after mounting on Chat', () => {
    // The packaged walk of 7 Sep 2026 found no observer at all: the strip had
    // mounted on the Chat view, rendering nothing, and the effect never re-ran.
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('not found', { status: 404 }))))
    const setDraft = vi.fn()
    const element = (view: string) => (
      <GenerationSettings
        useStore={selector => selector({ view })}
        useInput={selector => selector({ draft: '' })}
        inputActions={{ setDraft }}
        t={(key: string) => key}
      />
    )
    const rendered = render(element('chat'))
    expect(observers).toHaveLength(0)
    rendered.rerender(element('motion'))
    const row = document.querySelector<HTMLElement>('[data-gen-settings-space="motion"]')
    expect(row).not.toBeNull()
    expect(latest().observed).toEqual([row])
  })

  it('never compacts where no ResizeObserver exists', () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('not found', { status: 404 }))))
    vi.stubGlobal('ResizeObserver', undefined)
    render(
      <GenerationSettings
        useStore={selector => selector({ view: 'motion' })}
        useInput={selector => selector({ draft: '' })}
        inputActions={{ setDraft: vi.fn() }}
        t={(key: string) => key}
      />,
    )
    expect(document.querySelector('[data-gen-settings-compact]')).toBeNull()
  })
})

describe('Reveal', () => {
  it('asks the Files pane for the artefact\'s file from the tile and from the enlarged view', () => {
    const heard: string[] = []
    const listener = (event: Event): void => { heard.push((event as CustomEvent<{ relPath: string }>).detail.relPath) }
    document.addEventListener('idealize:reveal-artefact', listener)
    view([row()])
    fireEvent.click(document.querySelector('[data-gallery-tile="done"] [data-gallery-reveal="artefact-1"]')!)
    expect(heard).toEqual(['Images/2026-08-24_artefact-1.png'])
    // The tile behind the button stays closed: Reveal is not an enlarge.
    expect(document.querySelector('[data-gallery-enlarged]')).toBeNull()
    fireEvent.click(document.querySelector('[data-gallery-open="artefact-1"]')!)
    fireEvent.click(document.querySelector('[data-gallery-enlarged] [data-gallery-reveal="artefact-1"]')!)
    expect(heard).toHaveLength(2)
    expect(document.querySelector('[data-gallery-reveal="artefact-1"]')?.getAttribute('aria-label')).toBe('gallery.reveal')
    document.removeEventListener('idealize:reveal-artefact', listener)
  })
})
