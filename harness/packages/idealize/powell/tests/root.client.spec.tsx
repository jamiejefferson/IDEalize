// @vitest-environment jsdom
// The owl window: one tap on the project tag lists the projects open in
// IDEalize and switches with a second tap; a message that never reaches the
// host says so and resends; a dropped stream shows on the tag.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { PowellRoot } from '../src/client/PowellRoot.tsx'
import type { PowellStore } from '../src/client/store.ts'
import type { Mouth } from '../src/client/voice.ts'
import type { PowellView } from '../src/types.ts'

const VIEW: PowellView = { mood: 'idle', status: '', project: { name: 'DocLeaf', path: '/vault/Projects/DocLeaf' }, bubble: null, busy: false, voiceConsent: false, muted: false }

function fakeStore(view: PowellView = VIEW): PowellStore & { drop(): void } {
  const listeners = new Set<() => void>()
  let live = true
  return {
    getSnapshot: () => view,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    connected: () => live,
    stop: () => undefined,
    drop: () => { live = false; for (const listener of listeners) listener() },
  }
}

const mouth = {
  hush: vi.fn(), say: vi.fn(), has: () => false, preload: async () => undefined, setMuted: vi.fn(), onSpeaking: () => () => undefined,
} as unknown as Mouth

function stubFetch(say: { ok: boolean }) {
  // jsdom has neither; the window measures itself and plays the owl on frames.
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} })
  vi.stubGlobal('requestAnimationFrame', (run: () => void) => setTimeout(run, 0))
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { clearTimeout(id) })
  const calls: { path: string; body?: unknown }[] = []
  vi.stubGlobal('fetch', vi.fn((path: string, init?: RequestInit) => {
    calls.push({ path, ...init?.body === undefined ? {} : { body: JSON.parse(init.body as string) as unknown } })
    if (path === '/idealize/powell/project' && init === undefined) {
      return Promise.resolve({ ok: true, json: async () => ({
        project: VIEW.project,
        open: [{ name: 'IDEalize', path: '/dev/idealize' }, { name: 'DocLeaf', path: '/vault/Projects/DocLeaf' }],
        projects: [{ name: 'DocLeaf' }, { name: 'Hatch' }, { name: 'IDEalize' }, { name: 'JACQ' }],
      }) })
    }
    if (path === '/idealize/powell/say') return Promise.resolve({ ok: say.ok, json: async () => ({}) })
    return Promise.resolve({ ok: true, json: async () => [] })
  }))
  return calls
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('PowellRoot', () => {
  it('switches project in two taps from the tag, listing only the open projects', async () => {
    const calls = stubFetch({ ok: true })
    const view = render(<PowellRoot store={fakeStore()} mouth={mouth} />)
    fireEvent.click(view.getByLabelText('Project: DocLeaf. Switch project'))
    await waitFor(() => { expect(view.getByRole('menuitemradio', { name: 'IDEalize' })).toBeTruthy() })
    expect(view.getAllByRole('menuitemradio').map(item => item.textContent)).toEqual(['IDEalize', 'DocLeaf'])
    expect(view.getByRole('menuitemradio', { name: 'DocLeaf' }).getAttribute('aria-checked')).toBe('true')
    expect(view.queryByText('Hide Powell')).toBeNull()
    fireEvent.click(view.getByRole('menuitemradio', { name: 'IDEalize' }))
    await waitFor(() => { expect(calls.some(call => call.path === '/idealize/powell/project' && JSON.stringify(call.body) === '{"name":"/dev/idealize"}')).toBe(true) })
    expect(view.queryByRole('menu')).toBeNull()
  })

  it('says when a message never reached Powell, and resends it', async () => {
    const calls = stubFetch({ ok: false })
    const view = render(<PowellRoot store={fakeStore()} mouth={mouth} />)
    act(() => { fireEvent.keyDown(view.getByLabelText(/^Powell\./), { key: 'Enter' }) })
    fireEvent.change(view.getByLabelText('Ask Powell'), { target: { value: 'Hide the arrange icons' } })
    fireEvent.submit(view.getByLabelText('Ask Powell').closest('form') as HTMLFormElement)
    await waitFor(() => { expect(view.getByText('That didn\'t reach me. Try again?')).toBeTruthy() })
    fireEvent.click(view.getByRole('button', { name: 'Try again' }))
    await waitFor(() => { expect(calls.filter(call => call.path === '/idealize/powell/say')).toHaveLength(2) })
    expect(calls.filter(call => call.path === '/idealize/powell/say').map(call => (call.body as { text: string }).text)).toEqual(['Hide the arrange icons', 'Hide the arrange icons'])
  })

  it('shows a dropped connection on the tag', () => {
    stubFetch({ ok: true })
    const store = fakeStore()
    const view = render(<PowellRoot store={store} mouth={mouth} />)
    act(() => { store.drop() })
    expect(view.getByText('Reconnecting…')).toBeTruthy()
  })
})
