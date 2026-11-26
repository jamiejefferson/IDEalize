// @vitest-environment jsdom
/**
 * The Studio backdrop's layers, which this package draws for the media Studio
 * chat: the stack the paint asks for, the text and panel values and the mark
 * published on the page root, and the coordination chat left on the app theme.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { resolveStudioPaint } from '@idealize/appearance/src/appearance-settings.ts'
import { StudioView } from '../src/client/StudioView.tsx'
import { applyStudioBackdrop, StudioBackdropLayers } from '../src/client/backdrop.tsx'
import { createStudioStore } from '../src/client/store.ts'
import type { StudioTranslate } from '../src/client/studio-model.ts'
import { en } from '../src/client/locales.ts'

const t: StudioTranslate = makeTranslate(en, commonEn)

const layers = (container: HTMLElement): (string | null)[] =>
  [...container.querySelectorAll('[data-testid="idealize-studio-backdrop"] [data-layer]')].map(layer => layer.getAttribute('data-layer'))

afterEach(() => {
  act(() => { applyStudioBackdrop(undefined) })
  cleanup()
})

describe('the Studio backdrop layers', () => {
  it('are absent on the app theme, with nothing published', () => {
    const { container } = render(<StudioBackdropLayers />)
    expect(container.firstChild).toBeNull()
    expect(document.documentElement.style.getPropertyValue('--idealize-backdrop-ink')).toBe('')
    expect(document.documentElement.hasAttribute('data-idealize-backdrop')).toBe(false)
  })

  it('draw the tuned stack on the wall and publish the text and panel values', () => {
    const { container } = render(<StudioBackdropLayers />)
    act(() => { applyStudioBackdrop(resolveStudioPaint({ backdrop: 'grey', fontName: '', tweaks: {} })) })
    expect(layers(container)).toEqual(['light', 'seam', 'floor', 'streaks', 'vignette', 'mottle', 'grain'])
    const backdrop = container.querySelector('[data-testid="idealize-studio-backdrop"]') as HTMLElement
    expect(backdrop.getAttribute('aria-hidden')).toBe('true')
    // The stack holds the wall itself, so the clouding and grain blend against it.
    expect(backdrop.style.backgroundColor).toBe('rgb(36, 36, 36)')
    expect((backdrop.querySelector('[data-layer="floor"]') as HTMLElement).style.top).toBe('80%')
    expect((backdrop.querySelector('[data-layer="mottle"]') as HTMLElement).style.backgroundSize).toBe('1080px 1080px')
    const page = document.documentElement.style
    expect(page.getPropertyValue('--idealize-backdrop-ink')).toBe('#FFFFFF')
    expect(page.getPropertyValue('--idealize-backdrop-size')).toBe('11px')
    expect(page.getPropertyValue('--idealize-backdrop-panel-blur')).toBe('6px')
    // The page is marked, so the media Studio chat can style itself for the backdrop.
    expect(document.documentElement.hasAttribute('data-idealize-backdrop')).toBe(true)
  })

  it('follow a new paint and clear everything when the paint goes', () => {
    const { container } = render(<StudioBackdropLayers />)
    act(() => { applyStudioBackdrop(resolveStudioPaint({ backdrop: 'white', fontName: 'Optima', tweaks: { white: { floor: false, mottle: 0 } } })) })
    expect(layers(container)).toEqual(['light', 'vignette', 'grain'])
    expect(document.documentElement.style.getPropertyValue('--idealize-backdrop-font')).toContain('Optima')
    // A backdrop without a font drops the font property the last one published.
    act(() => { applyStudioBackdrop(resolveStudioPaint()) })
    expect(document.documentElement.style.getPropertyValue('--idealize-backdrop-font')).toBe('')
    act(() => { applyStudioBackdrop(undefined) })
    expect(container.firstChild).toBeNull()
    expect(document.documentElement.style.getPropertyValue('--idealize-backdrop-ink')).toBe('')
    expect(document.documentElement.hasAttribute('data-idealize-backdrop')).toBe(false)
  })
})

describe('the coordination chat', () => {
  it('stays on the app theme while a backdrop is drawn (JJ, 26 Nov 2026)', () => {
    const store = createStudioStore()
    store.state.update((draft) => {
      draft.loading = false
      draft.loaded = true
    })
    const { container } = render(
      <StudioView
        useStudio={bindSnapshotSelector(store.state)}
        sync={vi.fn(async () => {})}
        openThread={vi.fn()}
        takeFocus={store.takeFocus}
        markRead={vi.fn()}
        useNames={selector => selector({})}
        address={vi.fn()}
        t={t}
      />,
    )
    act(() => { applyStudioBackdrop(resolveStudioPaint()) })
    const root = container.querySelector('[data-studio-pane]') as HTMLElement
    expect(root.hasAttribute('data-backdrop')).toBe(false)
    expect(root.style.backgroundColor).toBe('')
    expect(container.querySelector('[data-testid="idealize-studio-backdrop"]')).toBeNull()
  })
})
