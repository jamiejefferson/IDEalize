// @vitest-environment jsdom
// The file viewer's section-title outline: headings from the rendered DOM in
// document order, jump-to-heading, the manual toggle with its persisted
// preference, auto-collapse at narrow deck widths, and the markdown-only gate.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { en } from '../src/client/locales.ts'
import { clampOutlineWidth, FileViewer } from '../src/client/FileViewer.tsx'
// Type-only: the locale-namespace merge the props type reads.
import type {} from '../src/client/index.ts'

const t = makeTranslate(en, commonEn)

// Three heading levels plus a fenced block whose `# comment` must never
// become an outline entry (the renderer already parses fences into CodeBlock).
const MARKDOWN = [
  '# Alpha',
  '',
  'Intro paragraph.',
  '',
  '## Beta section',
  '',
  '```sh',
  '# not a heading',
  '```',
  '',
  '### Gamma deep',
  '',
  'Tail paragraph.',
].join('\n')

/** Stub fetch to answer /idealize/bar/file with one envelope. */
function stubFile(name: string, kind: 'text' | 'image' | 'binary', text?: string): void {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ name, kind, size: text?.length ?? 0, text }),
  })))
}

/** The last ResizeObserver callback, so a test can drive width crossings. */
let resizeCallback: ResizeObserverCallback | undefined

/** Fire the captured ResizeObserver with one measured width. */
function resizeTo(width: number): void {
  if (resizeCallback === undefined) throw new Error('no ResizeObserver mounted')
  const observer = resizeCallback
  act(() => {
    observer([{ contentRect: { width } } as ResizeObserverEntry], undefined as unknown as ResizeObserver)
  })
}

function mount(path = '/tmp/doc.md') {
  return render(<FileViewer path={path} canReveal={false} onClose={() => {}} onAddToChat={() => true} t={t} />)
}

/** The outline nav, waited into existence after the async envelope lands. */
async function findOutline(view: ReturnType<typeof mount>) {
  return await view.findByRole('navigation', { name: 'Outline' })
}

beforeEach(() => {
  resizeCallback = undefined
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { resizeCallback = callback }
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  })
  window.HTMLElement.prototype.scrollIntoView = vi.fn()
})

/**
 * Place the headings and the scroller jsdom lays out at zero height. The map
 * is read by text, so a test moves one heading by naming it.
 * @param tops - each heading's viewport top, by heading text; the scroller's
 *   own top stays 0, so these read as offsets from it.
 */
function placeHeadings(tops: Record<string, number>): void {
  window.HTMLElement.prototype.getBoundingClientRect = function rect(this: HTMLElement) {
    const top = tops[(this.textContent ?? '').trim()] ?? 0
    return { top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) }
  }
}

afterEach(() => {
  // placeHeadings writes an own property over Element.prototype's; deleting
  // it hands every rect back to jsdom's own (all-zero) layout.
  delete (window.HTMLElement.prototype as Partial<HTMLElement>).getBoundingClientRect
  cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('FileViewer outline', () => {
  it('highlights the section the reader is in, and follows the scroll', async () => {
    // JJ, 10 Sep 2026: "add a highlight for which section you're in".
    placeHeadings({ 'Alpha': 0, 'Beta section': 300, 'Gamma deep': 700 })
    stubFile('doc.md', 'text', MARKDOWN)
    const view = mount()
    const outline = await findOutline(view)
    await waitFor(() => { expect(outline.querySelectorAll('button').length).toBe(3) })
    const active = () => [...outline.querySelectorAll('button')]
      .filter(entry => entry.hasAttribute('data-outline-active'))
      .map(entry => entry.textContent)
    await waitFor(() => { expect(active()).toEqual(['Alpha']) })
    expect(view.getByRole('button', { name: 'Alpha' }).getAttribute('aria-current')).toBe('location')
    // Scrolled past Beta's top: the reader is in Beta until Gamma passes too.
    placeHeadings({ 'Alpha': -320, 'Beta section': -20, 'Gamma deep': 380 })
    fireEvent.scroll(view.container.querySelector('[data-viewer-body]')!)
    await waitFor(() => { expect(active()).toEqual(['Beta section']) })
  })

  it('lists rendered headings in document order, indented per level, fenced comments excluded', async () => {
    stubFile('doc.md', 'text', MARKDOWN)
    const view = mount()
    const outline = await findOutline(view)
    await waitFor(() => { expect(outline.querySelectorAll('button').length).toBe(3) })
    const entries = [...outline.querySelectorAll('button')]
    expect(entries.map(entry => entry.textContent)).toEqual(['Alpha', 'Beta section', 'Gamma deep'])
    // V0's ramp: 12px indent per level over an 8px base, font 10 + (6 - level).
    expect(entries.map(entry => entry.style.paddingLeft)).toEqual(['8px', '20px', '32px'])
    expect(entries.map(entry => entry.style.fontSize)).toEqual(['15px', '14px', '13px'])
    expect(entries.some(entry => entry.textContent?.includes('not a heading'))).toBe(false)
  })

  it('jump scrolls the picked heading to the scroller top', async () => {
    stubFile('doc.md', 'text', MARKDOWN)
    const view = mount()
    const outline = await findOutline(view)
    await waitFor(() => { expect(outline.querySelectorAll('button').length).toBe(3) })
    fireEvent.click(view.getByRole('button', { name: 'Gamma deep' }))
    const scrolled = (window.HTMLElement.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mock
    expect(scrolled.calls).toEqual([[{ block: 'start' }]])
    expect((scrolled.instances[0] as HTMLElement).tagName).toBe('H3')
    expect((scrolled.instances[0] as HTMLElement).textContent).toBe('Gamma deep')
  })

  it('toggle closes the outline, persists, and a remount honours the preference', async () => {
    stubFile('doc.md', 'text', MARKDOWN)
    const view = mount()
    await findOutline(view)
    const toggle = view.getByRole('button', { name: 'Outline' })
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(toggle)
    expect(view.queryByRole('navigation', { name: 'Outline' })).toBeNull()
    expect(localStorage.getItem('idealize.viewer.outline')).toBe('closed')
    cleanup()
    const second = mount()
    const secondToggle = await second.findByRole('button', { name: 'Outline' })
    expect(secondToggle.getAttribute('aria-pressed')).toBe('false')
    expect(second.queryByRole('navigation', { name: 'Outline' })).toBeNull()
    fireEvent.click(secondToggle)
    expect(await findOutline(second)).toBeTruthy()
    expect(localStorage.getItem('idealize.viewer.outline')).toBe('open')
  })

  it('auto-collapses under 520px and restores the preference once wide again', async () => {
    stubFile('doc.md', 'text', MARKDOWN)
    const view = mount()
    await findOutline(view)
    resizeTo(360)
    expect(view.queryByRole('navigation', { name: 'Outline' })).toBeNull()
    // The toggle still opens it manually at the narrow width.
    fireEvent.click(view.getByRole('button', { name: 'Outline' }))
    expect(view.queryByRole('navigation', { name: 'Outline' })).not.toBeNull()
    resizeTo(360)
    resizeTo(800)
    expect(view.queryByRole('navigation', { name: 'Outline' })).not.toBeNull()
  })

  it('shows the no-headings note for markdown without headings', async () => {
    stubFile('doc.md', 'text', 'plain paragraph only\n')
    const view = mount()
    const outline = await findOutline(view)
    await waitFor(() => { expect(outline.textContent).toBe('No headings') })
  })

  it('covers V0\u2019s whole markdown extension set', async () => {
    for (const name of ['doc.md', 'doc.markdown', 'doc.mdown', 'doc.mkd', 'doc.mdx']) {
      stubFile(name, 'text', MARKDOWN)
      const view = mount(`/tmp/${name}`)
      const outline = await findOutline(view)
      await waitFor(() => { expect(outline.querySelectorAll('button').length).toBe(3) })
      cleanup()
    }
  })

  it('resizes the outline from its own border and remembers the width', async () => {
    // The outline is a column like any other; its border is the handle
    // (JJ, 1 Sep 2026: every column, the viewer's menu included).
    stubFile('doc.md', 'text', MARKDOWN)
    const view = mount()
    const outline = await findOutline(view)
    expect(outline.style.width).toBe('176px')
    const handle = view.container.querySelector<HTMLElement>('[data-viewer-outline-handle]')!
    handle.setPointerCapture = vi.fn()
    act(() => {
      fireEvent.pointerDown(handle, { clientX: 800, pointerId: 1 })
      document.dispatchEvent(Object.assign(new Event('pointermove'), { clientX: 740 }))
    })
    // Dragging left widens it: the outline's border is its LEFT edge.
    expect(outline.style.width).toBe('236px')
    act(() => { document.dispatchEvent(new Event('pointerup')) })
    expect(localStorage.getItem('idealize.viewer.outlineWidth')).toBe('236')
    cleanup()
    // The remembered width is what the next open starts from.
    stubFile('doc.md', 'text', MARKDOWN)
    expect((await findOutline(mount())).style.width).toBe('236px')
    localStorage.removeItem('idealize.viewer.outlineWidth')
  })

  it('holds the outline width inside its range', () => {
    expect(clampOutlineWidth(40)).toBe(120)
    expect(clampOutlineWidth(9000)).toBe(420)
    expect(clampOutlineWidth(200.4)).toBe(200)
  })

  it('renders neither outline nor toggle for non-markdown files', async () => {
    stubFile('index.ts', 'text', 'const x = 1\n// # not markdown\n')
    const view = mount('/tmp/index.ts')
    await view.findByText('index.ts')
    await waitFor(() => { expect(view.container.querySelector('pre, code')).not.toBeNull() })
    expect(view.queryByRole('navigation', { name: 'Outline' })).toBeNull()
    expect(view.queryByRole('button', { name: 'Outline' })).toBeNull()
  })
})
