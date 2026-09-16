// @vitest-environment jsdom
// The deck viewer's fetch states: loading while the envelope is in flight,
// the error notice on failure, and a surfaced reveal failure.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { en } from '../src/client/locales.ts'
import { FileViewer } from '../src/client/FileViewer.tsx'
// Type-only: the locale-namespace merge the props type reads.
import type {} from '../src/client/index.ts'

type Props = ComponentProps<typeof FileViewer>
const t: Props['t'] = makeTranslate(en, commonEn)

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response
}

function mount(overrides: Partial<Props> = {}) {
  const props: Props = {
    path: '/w/proj/archive.zip',
    canReveal: true,
    onClose: vi.fn(),
    onAddToChat: vi.fn(() => true),
    t,
    ...overrides,
  }
  return render(<FileViewer {...props} />)
}

// The viewer watches its own width to auto-collapse the outline; jsdom ships
// no ResizeObserver, so every mount needs one before the effect runs.
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('FileViewer', () => {
  it('shows the loading notice while the envelope is in flight', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {
      // Kept pending: the assertion is about the in-flight state.
    })))
    const view = mount()
    expect(view.getByText('Opening…')).toBeTruthy()
  })

  it('shows the error notice when the envelope fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse({ error: 'gone' }, 403))))
    const view = mount()
    expect(await view.findByText('Couldn’t open this file')).toBeTruthy()
  })

  it('renders the envelope and surfaces a reveal failure', async () => {
    vi.stubGlobal('fetch', vi.fn((input: string) => {
      const url = input
      if (url.startsWith('/idealize/bar/file?')) {
        return Promise.resolve(jsonResponse({ name: 'archive.zip', kind: 'binary', size: 10 }))
      }
      if (url === '/idealize/bar/reveal') return Promise.resolve(jsonResponse({ error: 'nope' }, 500))
      throw new Error(`unrouted fetch: ${url}`)
    }))
    const view = mount()
    expect(await view.findByText('No preview for this kind of file')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Reveal in Finder' }))
    expect(await view.findByText('Couldn’t reveal in Finder')).toBeTruthy()
    // No Edit on a file that is not text.
    expect(view.queryByRole('button', { name: 'Edit' })).toBeNull()
  })

  it('hands the file to the chat from its header icon and confirms', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse({ name: 'archive.zip', kind: 'binary', size: 10 }))))
    const onAddToChat = vi.fn(() => true)
    const view = mount({ onAddToChat })
    await view.findByText('No preview for this kind of file')
    fireEvent.click(view.getByRole('button', { name: 'Add to chat' }))
    expect(onAddToChat).toHaveBeenCalledWith('/w/proj/archive.zip')
    expect(await view.findByText('Path added to the composer')).toBeTruthy()
  })

  it('edits a text file and saves it through the fenced write route', async () => {
    const calls: { url: string; body?: unknown }[] = []
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, body: typeof init?.body === 'string' ? JSON.parse(init.body) as unknown : undefined })
      if (url.startsWith('/idealize/bar/file?')) return Promise.resolve(jsonResponse({ name: 'notes.txt', kind: 'text', size: 5, text: 'hello' }))
      if (url === '/idealize/bar/write') return Promise.resolve(jsonResponse({ ok: true, size: 11 }))
      throw new Error(`unrouted fetch: ${url}`)
    }))
    const view = mount({ path: '/w/proj/notes.txt' })
    fireEvent.click(await view.findByRole('button', { name: 'Edit' }))
    const editor = view.getByRole('textbox', { name: 'Edit' }) as HTMLTextAreaElement
    expect(editor.value).toBe('hello')
    fireEvent.change(editor, { target: { value: 'hello world' } })
    // ⌘S saves; the loaded size rides along so a file changed on disk is refused.
    fireEvent.keyDown(editor, { key: 's', metaKey: true })
    await waitFor(() => { expect(calls.find(call => call.url === '/idealize/bar/write')?.body).toEqual({ path: '/w/proj/notes.txt', text: 'hello world', expectedSize: 5 }) })
    expect(await view.findByText('Saved')).toBeTruthy()
    expect(view.queryByRole('textbox')).toBeNull()
    expect(view.getByText('hello world')).toBeTruthy()
  })

  it('keeps the editor up when the file changed on disk, and Cancel discards', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url.startsWith('/idealize/bar/file?')) return Promise.resolve(jsonResponse({ name: 'notes.txt', kind: 'text', size: 5, text: 'hello' }))
      if (url === '/idealize/bar/write') return Promise.resolve(jsonResponse({ error: 'moved', size: 9 }, 409))
      throw new Error(`unrouted fetch: ${url}`)
    }))
    const view = mount({ path: '/w/proj/notes.txt' })
    fireEvent.click(await view.findByRole('button', { name: 'Edit' }))
    fireEvent.change(view.getByRole('textbox'), { target: { value: 'hello there' } })
    fireEvent.click(view.getByRole('button', { name: 'Save' }))
    expect(await view.findByText('The file changed on disk. Close the editor to reload it.')).toBeTruthy()
    expect((view.getByRole('textbox') as HTMLTextAreaElement).value).toBe('hello there')
    fireEvent.click(view.getByRole('button', { name: 'Cancel' }))
    expect(view.queryByRole('textbox')).toBeNull()
    expect(view.getByText('hello')).toBeTruthy()
  })

  it('offers no Edit on a truncated read, which would save a truncated file', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse({ name: 'big.log', kind: 'text', size: 900000, text: 'head', truncated: true }))))
    const view = mount({ path: '/w/proj/big.log' })
    await view.findByText('head')
    expect(view.queryByRole('button', { name: 'Edit' })).toBeNull()
  })
})
