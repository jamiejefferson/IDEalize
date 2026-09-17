// @vitest-environment jsdom
/**
 * The appearance paint path: the ANSI slot mapping, the module-level paint
 * hand-off, and the plugin's subscription to the appearance service.
 */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TerminalPaint } from '@idealize/appearance/client'
import { apply, applyTerminalPaint, counterZoom, currentTerminalPaint, reservedGutter, withAlpha, xtermTheme } from '../src/client/index.ts'

const PAINT: TerminalPaint = {
  background: '#F7F5F0',
  foreground: '#2A2A27',
  cursor: '#B67A12',
  selection: '#E7E0D1',
  ansi: [
    '#000000', '#110000', '#001100', '#111100', '#000011', '#110011', '#001111', '#111111',
    '#220000', '#330000', '#003300', '#333300', '#000033', '#330033', '#003333', '#333333',
  ],
  fontFamily: '"DM Mono", monospace',
  fontSize: 14,
  lineHeight: 1,
  margin: 36,
}

afterEach(() => {
  applyTerminalPaint(undefined)
  vi.unstubAllGlobals()
})

describe('withAlpha', () => {
  it('adds an alpha byte to hex, an alpha channel to rgb(), and leaves other forms alone', () => {
    // The page's brand-primary arrives as hex from the appearance layer or rgb() from design-platform's statics.
    expect(withAlpha('#0969DA', 0.35)).toBe('#0969DA59')
    expect(withAlpha(' rgb(15, 17, 21) ', 0.35)).toBe('rgba(15, 17, 21, 0.35)')
    expect(withAlpha('var(--x)', 0.35)).toBe('var(--x)')
    expect(withAlpha('', 0.35)).toBe('')
  })
})

describe('xtermTheme', () => {
  it('maps the surface colours and every ANSI slot by name', () => {
    const theme = xtermTheme(PAINT)
    expect(theme.background).toBe('#F7F5F0')
    expect(theme.foreground).toBe('#2A2A27')
    expect(theme.cursor).toBe('#B67A12')
    expect(theme.selectionBackground).toBe('#E7E0D1')
    expect(theme.black).toBe('#000000')
    expect(theme.white).toBe('#111111')
    expect(theme.brightBlack).toBe('#220000')
    expect(theme.brightWhite).toBe('#333333')
  })
})

describe('applyTerminalPaint', () => {
  it('holds the active paint for new grids and clears back to the fallback', () => {
    expect(currentTerminalPaint()).toBeUndefined()
    applyTerminalPaint(PAINT)
    expect(currentTerminalPaint()).toBe(PAINT)
    applyTerminalPaint(undefined)
    expect(currentTerminalPaint()).toBeUndefined()
  })
})

describe('appearance subscription', () => {
  it('adopts the service paint, follows store changes, and clears on dispose', async () => {
    // The probe stays quiet: no embedded terminal here.
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ embedded: false })))))
    const ctx = new Context()
    ctx.provide('slots', { inject: () => {}, entries: () => [], subscribe: () => () => {}, register: () => () => {} } as never)
    ctx.provide('locale', { register: () => () => {}, bind: () => (key: string) => key } as never)
    ctx.provide('sessions', { list: { getSnapshot: () => ({ byId: {} }) } } as never)
    ctx.provide('workspaces', { list: { getSnapshot: () => ({ items: [], archivedSessionIds: [] }), subscribe: () => () => {} } } as never)
    let paint: TerminalPaint = PAINT
    const listeners = new Set<() => void>()
    ctx.provide('appearance', {
      terminalPaint: () => paint,
      store: { subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } } },
    } as never)
    const fiber = ctx.plugin({ inject: ['slots', 'locale', 'sessions', 'workspaces'], apply })
    await fiber.await()
    expect(currentTerminalPaint()).toBe(PAINT)
    const next = { ...PAINT, background: '#17181A' }
    paint = next
    for (const fn of listeners) fn()
    expect(currentTerminalPaint()).toBe(next)
    await fiber.dispose()
    expect(currentTerminalPaint()).toBeUndefined()
  })
})

describe('reservedGutter', () => {
  // The ground reaches across the scroller's stable scrollbar gutter; without
  // the measurement it stopped short and left a pale strip down the right
  // (JJ, 1 Sep 2026: "rogue margin to the right").
  const scroller = (overflowY: string, offsetWidth: number, clientWidth: number): HTMLElement => {
    const el = document.createElement('div')
    el.style.overflowY = overflowY
    Object.defineProperty(el, 'offsetWidth', { value: offsetWidth, configurable: true })
    Object.defineProperty(el, 'clientWidth', { value: clientWidth, configurable: true })
    return el
  }

  it('is the width the nearest scrolling ancestor holds back', () => {
    const outer = scroller('auto', 400, 392)
    const inner = document.createElement('div')
    const root = document.createElement('div')
    outer.append(inner)
    inner.append(root)
    document.body.append(outer)
    expect(reservedGutter(root)).toBe(8)
    outer.remove()
  })

  it('is nothing when no ancestor scrolls', () => {
    const outer = scroller('visible', 400, 400)
    const root = document.createElement('div')
    outer.append(root)
    document.body.append(outer)
    expect(reservedGutter(root)).toBe(0)
    outer.remove()
  })

  it('stops at the first scrolling ancestor, gutter or none', () => {
    const outer = scroller('scroll', 400, 380)
    const middle = scroller('scroll', 400, 400)
    const root = document.createElement('div')
    outer.append(middle)
    middle.append(root)
    document.body.append(outer)
    expect(reservedGutter(root)).toBe(0)
    outer.remove()
  })
})

describe('counterZoom', () => {
  const zoomed = (zoom: number): HTMLElement => {
    const parent = document.createElement('div')
    Object.defineProperty(parent, 'currentCSSZoom', { value: zoom })
    return parent
  }

  it('undoes the chat surface at 20pt, whose zoom of 1.25 put a selection 200px below the pointer', () => {
    expect(counterZoom(zoomed(1.25))).toBe('0.8')
  })

  it('multiplies out nested zooms, which the browser reports as one effective value', () => {
    expect(counterZoom(zoomed(1.25 * 1.154))).toBe('0.6932')
  })

  it('leaves the root unzoomed when no ancestor zooms, or there is no parent', () => {
    expect(counterZoom(zoomed(1))).toBe('')
    expect(counterZoom(null)).toBe('')
  })

  it('measures past a box-less wrapper, which reports 1 under any zoom (the chat view wraps the root in one)', () => {
    const surface = zoomed(1.25)
    const wrapper = document.createElement('div')
    wrapper.style.display = 'contents'
    Object.defineProperty(wrapper, 'currentCSSZoom', { value: 1 })
    surface.append(wrapper)
    expect(counterZoom(wrapper)).toBe('0.8')
  })

  it('falls back to the rendered-over-layout width where the browser has no currentCSSZoom', () => {
    const parent = document.createElement('div')
    Object.defineProperty(parent, 'offsetWidth', { value: 400 })
    parent.getBoundingClientRect = () => ({ width: 500 }) as DOMRect
    expect(counterZoom(parent)).toBe('0.8')
  })
})
