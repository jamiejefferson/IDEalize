// @vitest-environment jsdom
/**
 * Grid size: every cause that moves the host's box or the cell ends in one fit
 * per frame, and the PTY hears each change of cols/rows from the grid itself.
 * Layout is the headless proof's (`proof/resize-proof.mts`); jsdom has none, so
 * the fit addon here is a stand-in that reports whatever size the test names.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import type { TerminalPaint } from '@idealize/appearance/client'
import { applyTerminalPaint, disposeTerminals, TerminalView, type StreamEvent, type TerminalTransport } from '../src/client/TerminalView.tsx'

const grid = vi.hoisted(() => ({
  /** The size the next fit lands on. */
  next: { cols: 80, rows: 24 },
  fits: 0,
  families: [] as string[],
}))

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80
    rows = 24
    element: HTMLElement | undefined
    private readonly sizeListeners = new Set<(size: { cols: number; rows: number }) => void>()
    private family = 'monospace'
    options = Object.defineProperty<Record<string, unknown>>({}, 'fontFamily', {
      get: () => this.family,
      set: (value: string) => {
        this.family = value
        grid.families.push(value)
      },
    })

    constructor(options: { fontFamily: string }) { this.family = options.fontFamily }

    loadAddon(addon: { terminal?: unknown }): void { addon.terminal = this }
    open(host: HTMLElement): void { this.element = host.appendChild(document.createElement('div')) }
    focus(): void {}
    write(): void {}
    dispose(): void {}
    onData(): { dispose: () => void } { return { dispose: () => {} } }
    onResize(listener: (size: { cols: number; rows: number }) => void): { dispose: () => void } {
      this.sizeListeners.add(listener)
      return { dispose: () => { this.sizeListeners.delete(listener) } }
    }

    /** xterm's contract: `onResize` fires only when cols or rows change. */
    resize(cols: number, rows: number): void {
      if (cols === this.cols && rows === this.rows) return
      this.cols = cols
      this.rows = rows
      for (const listener of this.sizeListeners) listener({ cols, rows })
    }
  },
}))
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    terminal: { resize: (cols: number, rows: number) => void } | undefined
    fit(): void {
      grid.fits += 1
      this.terminal?.resize(grid.next.cols, grid.next.rows)
    }
  },
}))

const PAINT: TerminalPaint = {
  background: '#F7F5F0',
  foreground: '#2A2A27',
  cursor: '#B67A12',
  selection: '#E7E0D1',
  selectionForeground: '#2A2A27',
  ansi: [],
  fontFamily: '"DM Mono", monospace',
  fontSize: 14,
  lineHeight: 1,
  margin: 36,
}

let reportResize: () => void = () => {}
let frames: (() => void)[] = []
let box = { width: 800, height: 600 }
let fontListeners: (() => void)[] = []

/** Run the animation frames queued so far. */
function frame(): void {
  const due = frames
  frames = []
  for (const callback of due) callback()
}

beforeEach(() => {
  grid.next = { cols: 80, rows: 24 }
  grid.fits = 0
  grid.families = []
  frames = []
  box = { width: 800, height: 600 }
  fontListeners = []
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { reportResize = callback }
    observe(): void {}
    disconnect(): void {}
  })
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => frames.push(callback))
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => { frames[handle - 1] = () => {} })
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => box.width)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => box.height)
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: {
      addEventListener: (_type: string, listener: () => void) => { fontListeners.push(listener) },
      removeEventListener: (_type: string, listener: () => void) => { fontListeners = fontListeners.filter(l => l !== listener) },
    },
  })
})

afterEach(() => {
  cleanup()
  disposeTerminals()
  applyTerminalPaint(undefined)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(document, 'fonts')
})

function recorder() {
  const resizes: { cols: number; rows: number }[] = []
  let emit: (event: StreamEvent) => void = () => {}
  const transport: TerminalTransport = {
    open: () => Promise.resolve({ id: 't1' }),
    stream: (_id, onEvent) => {
      emit = onEvent
      return () => {}
    },
    input: () => {},
    resize: (_id, cols, rows) => { resizes.push({ cols, rows }) },
    close: () => Promise.resolve(),
  }
  return { transport, resizes, exit: () => { emit({ kind: 'exit', exitCode: 0 }) } }
}

async function mount(transport: TerminalTransport) {
  const view = await act(async () => render(<TerminalView sessionId="s1" cwd={undefined} transport={transport} t={key => key} />))
  return view
}

describe('grid size', () => {
  it('fits once per frame however many box changes are reported, and tells the PTY the new size', async () => {
    const { transport, resizes } = recorder()
    await mount(transport)
    const mounted = grid.fits
    resizes.length = 0

    grid.next = { cols: 60, rows: 18 }
    reportResize()
    reportResize()
    reportResize()
    expect(grid.fits).toBe(mounted)
    frame()
    expect(grid.fits).toBe(mounted + 1)
    expect(resizes).toEqual([{ cols: 60, rows: 18 }])
  })

  it('says nothing to the PTY when a refit lands on the same size', async () => {
    const { transport, resizes } = recorder()
    await mount(transport)
    resizes.length = 0
    reportResize()
    frame()
    expect(resizes).toEqual([])
  })

  it('refits on the frame after a paint change, and the PTY hears the size the new font gives', async () => {
    const { transport, resizes } = recorder()
    await mount(transport)
    const mounted = grid.fits
    resizes.length = 0

    grid.next = { cols: 52, rows: 15 }
    act(() => { applyTerminalPaint({ ...PAINT, fontSize: 20 }) })
    expect(grid.fits).toBe(mounted)
    frame()
    expect(grid.fits).toBe(mounted + 1)
    expect(resizes).toEqual([{ cols: 52, rows: 15 }])
  })

  it('leaves the grid alone while its host has no box, and fits when the box returns', async () => {
    const { transport, resizes } = recorder()
    await mount(transport)
    const mounted = grid.fits
    resizes.length = 0

    box = { width: 0, height: 0 }
    grid.next = { cols: 2, rows: 1 }
    reportResize()
    frame()
    expect(grid.fits).toBe(mounted)
    expect(resizes).toEqual([])

    box = { width: 640, height: 400 }
    grid.next = { cols: 70, rows: 20 }
    reportResize()
    frame()
    expect(resizes).toEqual([{ cols: 70, rows: 20 }])
  })

  it('measures the cell again when a web font finishes loading', async () => {
    const { transport, resizes } = recorder()
    act(() => { applyTerminalPaint(PAINT) })
    await mount(transport)
    const mounted = grid.fits
    grid.families = []
    resizes.length = 0

    grid.next = { cols: 76, rows: 24 }
    for (const listener of fontListeners) listener()
    // Away to an equivalent stack and back: the option change is what makes xterm measure.
    expect(grid.families).toEqual(['"DM Mono", monospace, monospace', '"DM Mono", monospace'])
    frame()
    expect(grid.fits).toBe(mounted + 1)
    expect(resizes).toEqual([{ cols: 76, rows: 24 }])
  })

  it('stops telling a shell that has exited', async () => {
    const { transport, resizes, exit } = recorder()
    await mount(transport)
    act(() => { exit() })
    resizes.length = 0
    grid.next = { cols: 40, rows: 10 }
    reportResize()
    frame()
    expect(resizes).toEqual([])
  })

  it('drops a queued fit when the grid is disposed', async () => {
    const { transport } = recorder()
    await mount(transport)
    const mounted = grid.fits
    reportResize()
    disposeTerminals()
    frame()
    expect(grid.fits).toBe(mounted)
  })
})
