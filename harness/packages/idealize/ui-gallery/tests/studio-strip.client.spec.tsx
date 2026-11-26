// @vitest-environment jsdom
// The Studio chat box: an Image, Video, Sound toggle that moves the chat
// between the three media views, and a model picker for the kind showing.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import {
  GenerationSettings, groupByService, loadStudioModels, MEDIA_PRESET_BY_VIEW, STUDIO_KIND_EVENT, STUDIO_KINDS, storeStudioModel,
  type StudioKindDetail,
} from '../src/client/GenerationSettings.tsx'

const FLUX = { backend: 'fal', model: { id: 'fal-ai/flux', name: 'Flux Pro', price: { unitPrice: 0.04, unit: 'image', currency: 'USD', perOutput: { amount: 0.04, output: 'image' } } } }
const IMAGEN = { backend: 'openrouter', model: { id: 'google/imagen', name: 'Imagen' } }
const SECONDS = { backend: 'fal', model: { id: 'fal-ai/veo', name: 'Veo', price: { unitPrice: 0.5, unit: 'second', currency: 'USD' } } }
const FREE = { backend: 'fal', model: { id: 'fal-ai/free', name: '', price: { unitPrice: 0, unit: 'image', currency: 'USD' } } }

interface Preset { id: string; model?: unknown; candidates?: unknown }

/** The media route over a mutable preset list; the inputs route answers 404. */
function stubMedia(presets: Preset[], post: () => Response = () => new Response('{}', { status: 200 })) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url.includes('?space=')) return Promise.resolve(new Response('no', { status: 404 }))
    if (init?.method === 'POST') {
      const sent = JSON.parse(init.body as string) as { id: string; model: unknown }
      const answer = post()
      const row = presets.find(preset => preset.id === sent.id)
      if (answer.ok && row !== undefined) row.model = sent.model
      return Promise.resolve(answer)
    }
    return Promise.resolve(new Response(JSON.stringify({ presets }), { status: 200 }))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function strip(view: string | null) {
  const setView = vi.fn()
  const element = (active: string | null) => (
    <GenerationSettings
      useStore={selector => selector({ view: active })}
      useInput={selector => selector({ draft: '' })}
      inputActions={{ setDraft: vi.fn() }}
      actions={{ setView }}
      sessionId="s1"
      t={(key: string) => key}
    />
  )
  const rendered = render(element(view))
  return { setView, rerender: (next: string | null) => { rendered.rerender(element(next)) } }
}

const picker = (): HTMLSelectElement | null => document.querySelector<HTMLSelectElement>('[data-studio-model]')

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('the Image, Video, Sound toggle', () => {
  it('shows the three kinds with the active one checked', () => {
    stubMedia([])
    strip('motion')
    const kinds = [...document.querySelectorAll('[data-studio-kind]')]
    expect(kinds.map(kind => kind.getAttribute('data-studio-kind'))).toEqual(['gallery', 'motion', 'soundstage'])
    expect(kinds.map(kind => kind.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false'])
    expect(kinds.map(kind => kind.textContent)).toEqual(STUDIO_KINDS.map(kind => kind.label))
  })

  it('moves the chat to the kind pressed and says so for the record', () => {
    stubMedia([])
    const heard: StudioKindDetail[] = []
    const listener = (event: Event): void => { heard.push((event as CustomEvent<StudioKindDetail>).detail) }
    document.addEventListener(STUDIO_KIND_EVENT, listener)
    const { setView } = strip('gallery')
    fireEvent.click(document.querySelector('[data-studio-kind="soundstage"]')!)
    expect(heard).toEqual([{ sessionId: 's1', space: 'soundstage' }])
    expect(setView).toHaveBeenCalledWith('soundstage')
    // The kind already showing is not a move.
    fireEvent.click(document.querySelector('[data-studio-kind="gallery"]')!)
    expect(heard).toHaveLength(1)
    expect(setView).toHaveBeenCalledTimes(1)
    document.removeEventListener(STUDIO_KIND_EVENT, listener)
  })

  it('is absent outside the media views', () => {
    stubMedia([])
    strip('chat')
    expect(document.querySelector('[data-studio-kinds]')).toBeNull()
  })
})

describe('the model picker', () => {
  it('lists the kind\'s models by name with the published price, and Auto first', async () => {
    stubMedia([{ id: 'images', model: null, candidates: [IMAGEN, FLUX, FREE, null, { backend: 7 }, { backend: 'x', model: {} }] }])
    strip('gallery')
    await waitFor(() => { expect(picker()).not.toBeNull() })
    expect([...picker()!.options].map(option => [option.value, option.textContent])).toEqual([
      ['', 'gallery.settings.auto'],
      ['fal/fal-ai/free', 'fal-ai/free'],
      ['fal/fal-ai/flux', 'Flux Pro · 0.04 USD / image'],
      ['openrouter/google/imagen', 'Imagen'],
    ])
    expect(picker()!.value).toBe('')
  })

  it('stores a pick, tells the rest of the app, and shows it after the reload', async () => {
    const presets: Preset[] = [{ id: 'motion', model: null, candidates: [SECONDS] }]
    const fetchMock = stubMedia(presets)
    const changed = vi.fn()
    document.addEventListener('idealize:brains-changed', changed)
    strip('motion')
    await waitFor(() => { expect(picker()).not.toBeNull() })
    expect(picker()!.options[1]?.textContent).toBe('Veo · 0.5 USD / second')
    fireEvent.change(picker()!, { target: { value: 'fal/fal-ai/veo' } })
    await waitFor(() => { expect(changed).toHaveBeenCalledTimes(1) })
    const post = fetchMock.mock.calls.find(call => call[1]?.method === 'POST')!
    expect(JSON.parse(post[1]!.body as string)).toEqual({ id: 'motion', model: { backend: 'fal', model: 'fal-ai/veo' } })
    expect((post[1]!.headers as Record<string, string>)['x-idealize-auth']).toBe('1')
    await waitFor(() => { expect(picker()!.value).toBe('fal/fal-ai/veo') })
    // Auto clears the stored choice.
    fireEvent.change(picker()!, { target: { value: '' } })
    await waitFor(() => { expect(picker()!.value).toBe('') })
    expect(presets[0]?.model).toBeNull()
    document.removeEventListener('idealize:brains-changed', changed)
  })

  it('keeps a stored model that left the catalogue on show by its id', async () => {
    stubMedia([{ id: 'sound', model: { backend: 'fal', model: 'gone' }, candidates: [SECONDS] }])
    strip('soundstage')
    await waitFor(() => { expect(picker()).not.toBeNull() })
    expect(picker()!.value).toBe('fal/gone')
    expect([...picker()!.options].map(option => option.textContent)).toContain('gone')
  })

  it('says nothing changed when the host refuses the pick', async () => {
    stubMedia([{ id: 'images', model: null, candidates: [FLUX] }], () => new Response('no', { status: 400 }))
    const changed = vi.fn()
    document.addEventListener('idealize:brains-changed', changed)
    strip('gallery')
    await waitFor(() => { expect(picker()).not.toBeNull() })
    fireEvent.change(picker()!, { target: { value: 'fal/fal-ai/flux' } })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(changed).not.toHaveBeenCalled()
    document.removeEventListener('idealize:brains-changed', changed)
  })

  it('is absent while the kind has no models, and drops an answer for a view already left', async () => {
    stubMedia([{ id: 'images', model: null, candidates: [] }, { id: 'motion', model: null, candidates: [SECONDS] }])
    const { rerender } = strip('gallery')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(picker()).toBeNull()
    rerender('motion')
    await waitFor(() => { expect(picker()).not.toBeNull() })
    rerender('chat')
    expect(picker()).toBeNull()
  })

  it('groups the models by service and shows one row per name', async () => {
    const twin = { backend: 'fal', model: { id: 'fal-ai/flux-2', name: 'Flux Pro' } }
    stubMedia([{ id: 'images', model: null, candidates: [IMAGEN, FLUX, twin] }])
    strip('gallery')
    await waitFor(() => { expect(picker()).not.toBeNull() })
    expect([...picker()!.querySelectorAll('optgroup')].map(group => [group.label, group.querySelectorAll('option').length]))
      .toEqual([['fal', 1], ['OpenRouter', 1]])
    expect(groupByService([{ backend: 'local', model: 'a', name: 'A' }])).toEqual([{ backend: 'local', models: [{ backend: 'local', model: 'a', name: 'A' }] }])
  })

  it('reads the route defensively', async () => {
    expect(MEDIA_PRESET_BY_VIEW).toEqual({ gallery: 'images', motion: 'motion', soundstage: 'sound' })
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('no', { status: 500 }))))
    expect(await loadStudioModels('gallery')).toEqual({ chosen: null, models: [] })
    expect(await storeStudioModel('gallery', null)).toBe(false)
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
    expect(await loadStudioModels('gallery')).toEqual({ chosen: null, models: [] })
    expect(await storeStudioModel('gallery', null)).toBe(false)
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ presets: 'odd' }), { status: 200 }))))
    expect(await loadStudioModels('gallery')).toEqual({ chosen: null, models: [] })
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ presets: [{ id: 'images', candidates: 'odd' }] }), { status: 200 }))))
    expect(await loadStudioModels('gallery')).toEqual({ chosen: null, models: [] })
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      presets: [{ id: 'images', candidates: [{ backend: 'fal', model: { id: 'a', name: 'A', price: { currency: 'USD' } } }, { backend: 'fal', model: { id: 'b', price: 3 } }] }],
    }), { status: 200 }))))
    expect((await loadStudioModels('gallery')).models).toEqual([
      { backend: 'fal', model: 'a', name: 'A' },
      { backend: 'fal', model: 'b', name: 'b' },
    ])
  })
})
