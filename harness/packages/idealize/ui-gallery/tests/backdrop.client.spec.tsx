// @vitest-environment jsdom
/**
 * The Studio backdrop behind the media Studio chat: the layers the
 * `studioBackdrop` service offers are drawn into the chat column, outside the
 * scrolling view, and go again when the service leaves.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { GALLERY_SHEET } from './sheet.client.ts'
import { act, cleanup, render } from '@testing-library/react'
import { GalleryBackdrop, setBackdropLayers } from '../src/client/backdrop.tsx'

const Layers = () => <div data-testid="layers" />

afterEach(() => {
  act(() => { setBackdropLayers(undefined) })
  cleanup()
})

describe('the media Studio chat\'s backdrop', () => {
  it('draws nothing until the Studio offers its layers', () => {
    const { container } = render(<div data-idealize-surface="chat"><div data-view=""><GalleryBackdrop /></div></div>)
    expect(container.querySelector('[data-gallery-backdrop]')).toBeNull()
  })

  it('seats the layers in the chat column, beside the view and not inside it', () => {
    const { container } = render(<div data-idealize-surface="chat"><div data-view=""><GalleryBackdrop /></div></div>)
    act(() => { setBackdropLayers(Layers) })
    const column = container.querySelector('[data-idealize-surface="chat"]') as HTMLElement
    const seat = container.querySelector('[data-gallery-backdrop]') as HTMLElement
    expect(seat.parentElement).toBe(column)
    expect(seat.querySelector('[data-testid="layers"]')).not.toBeNull()
    expect(container.querySelector('[data-view] [data-gallery-backdrop]')).toBeNull()
    act(() => { setBackdropLayers(undefined) })
    expect(container.querySelector('[data-gallery-backdrop]')).toBeNull()
  })

  it('draws a second copy in the message box\'s seat, so tiles scrolling under the box stay hidden', () => {
    const { container } = render(
      <div data-idealize-surface="chat"><div data-view=""><GalleryBackdrop /></div><div data-composer-seat="" /></div>,
    )
    act(() => { setBackdropLayers(Layers) })
    const seat = container.querySelector('[data-composer-seat]') as HTMLElement
    const copy = seat.querySelector('[data-gallery-backdrop-under-box]') as HTMLElement
    expect(copy.querySelector('[data-testid="layers"]')).not.toBeNull()
    // The frame is placed over the column's box, so the copy lines up with the column's layers.
    expect((copy.firstElementChild as HTMLElement).style.width).toBe('0px')
    act(() => { setBackdropLayers(undefined) })
    expect(seat.querySelector('[data-gallery-backdrop-under-box]')).toBeNull()
  })

  it('draws nothing outside a chat column', () => {
    const { container } = render(<GalleryBackdrop />)
    act(() => { setBackdropLayers(Layers) })
    expect(container.querySelector('[data-gallery-backdrop]')).toBeNull()
  })
})

describe('the backdrop styles', () => {
  const block = (needle: string): string => new RegExp(`[^{}]*${needle}[^{}]*\\{([^}]*)\\}`).exec(GALLERY_SHEET)?.[1] ?? ''

  it('drop the seat\'s fade to the app ground and keep the stats line readable on the floor', () => {
    const seat = block('data-composer-seat')
    expect(seat).toContain('background: none')
    expect(seat).toContain('--dsw-alias-label-tertiary: var(--idealize-backdrop-foot-ink)')
  })

  it('show the seat\'s copy only on a backdrop, while the seat is docked, and fade its top edge', () => {
    expect(block('\\.backdropUnderBox\\s')).toContain('display: none')
    expect(block('\\.backdropUnderBox\\s')).toContain('mask-image: linear-gradient(180deg, transparent 0, rgb(0 0 0 / 0.6) 140px, rgb(0 0 0 / 0.9) 100%)')
    const shown = [...GALLERY_SHEET.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(match => /backdropUnderBox/.test(match[1] ?? '') && /display: block/.test(match[2] ?? ''))
    expect(shown?.[1]).toContain(':root[data-idealize-backdrop]')
    expect(shown?.[1]).toContain("[data-phase='active']")
  })

  it('give the title the backdrop\'s ink over the Title card\'s colour', () => {
    expect(block('data-session-title')).toContain('--dsh-session-title-color: var(--idealize-backdrop-title-ink)')
  })

  it('reach the column only under the page mark and only around this view', () => {
    const selectors = [...GALLERY_SHEET.matchAll(/([^{}]+)\{[^{}]*\}/g)].map(match => (match[1] ?? '').trim())
    const outside = selectors.filter(value => /data-composer-(seat|card)|header\[data-view\]/.test(value))
    expect(outside.length).toBeGreaterThan(0)
    for (const value of outside) {
      expect(value).toContain(':root[data-idealize-backdrop]')
      expect(value).toContain(':has(.root)')
    }
  })
})

describe('a panel on a backdrop', () => {
  const rule = /([^{}]*data-composer-card[^{}]*\.chatRow[^{}]*)\{([^}]*)\}/.exec(GALLERY_SHEET)

  it('rebinds text, raised fills, washes and lines together for the message box, rows and tiles', () => {
    expect(rule).not.toBeNull()
    const [, selectors = '', body = ''] = rule ?? []
    for (const panel of ['data-composer-card', '.chatRow', '.grid .tile', '.archived .tile']) expect(selectors).toContain(panel)
    for (const line of [
      '--dsw-alias-label-primary: var(--idealize-backdrop-panel-ink)',
      '--dsw-alias-label-caption: var(--idealize-backdrop-panel-ink-2)',
      '--dsw-alias-bg-layer-1: var(--idealize-backdrop-panel-raised)',
      '--dsw-alias-bg-layer-2: var(--idealize-backdrop-panel-wash)',
      '--dsw-alias-border-l2: var(--idealize-backdrop-panel-line)',
      '--dsw-alias-state-error-primary: var(--idealize-backdrop-panel-error)',
    ]) expect(body).toContain(line)
  })

  it('never draws the unchecked text colour', () => {
    expect(GALLERY_SHEET).not.toMatch(/var\(--idealize-backdrop-ink(-2)?\)/)
  })
})
