// Askbar geometry and placement: the docked full-height ASKBAR_WIDTH column, the
// remembered drag position taking over while its display is attached, and
// the window class placing before every show, remembering a drag, and
// staying quiet about its own placements.
import { afterEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => {
  const windows: FakeWindow[] = []
  const options: unknown[] = []
  class FakeWindow {
    readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>()
    bounds: { x: number, y: number, width: number, height: number }
    visible = false
    destroyed = false
    readonly show = vi.fn(() => { this.visible = true })
    readonly showInactive = vi.fn(() => { this.visible = true })
    readonly focus = vi.fn()
    readonly blur = vi.fn()
    readonly hide = vi.fn(() => { this.visible = false })
    readonly setAlwaysOnTop = vi.fn()
    readonly setVisibleOnAllWorkspaces = vi.fn()
    readonly loadURL = vi.fn(async () => {})
    readonly destroy = vi.fn(() => { this.destroyed = true })
    readonly isDestroyed = vi.fn(() => this.destroyed)
    readonly isVisible = vi.fn(() => this.visible)
    readonly getBounds = vi.fn(() => ({ ...this.bounds }))
    readonly setBounds = vi.fn((bounds: { x: number, y: number, width: number, height: number }) => { this.bounds = { ...bounds } })
    constructor(init: { x: number, y: number, width: number, height: number }) {
      options.push(init)
      this.bounds = { x: init.x, y: init.y, width: init.width, height: init.height }
      windows.push(this)
    }

    on(event: string, listener: (...args: unknown[]) => void): this {
      this.listeners.set(event, [...this.listeners.get(event) ?? [], listener])
      return this
    }

    once(event: string, listener: (...args: unknown[]) => void): this {
      return this.on(event, listener)
    }

    emit(event: string, ...args: unknown[]): void {
      for (const listener of this.listeners.get(event) ?? []) listener(...args)
    }
  }
  const displays = [
    { id: 1, workArea: { x: 0, y: 25, width: 1512, height: 917 } },
    { id: 2, workArea: { x: 1512, y: 0, width: 1920, height: 1080 } },
  ]
  const screen = {
    displays,
    getAllDisplays: vi.fn(() => screen.displays),
    getDisplayNearestPoint: vi.fn(() => screen.displays[0]),
    getDisplayMatching: vi.fn((bounds: { x: number }) => screen.displays.find(d => bounds.x >= d.workArea.x && bounds.x < d.workArea.x + d.workArea.width) ?? screen.displays[0]),
    getCursorScreenPoint: vi.fn(() => ({ x: 10, y: 10 })),
  }
  const app = { hide: vi.fn() }
  return { windows, options, screen, FakeWindow, app }
})

vi.mock('electron', () => ({
  app: electron.app,
  BrowserWindow: electron.FakeWindow,
  nativeImage: { createFromPath: vi.fn(() => ({})) },
  screen: electron.screen,
}))

const { ASKBAR_MOVE_SETTLE_MS, ASKBAR_WIDTH, AskbarWindow, askbarBounds, askbarPlacement } = await import('../src/askbar-window.ts')

const WORK_AREA = { x: 0, y: 25, width: 1512, height: 917 }
const LAPTOP = { id: 1, workArea: WORK_AREA }
const EXTERNAL = { id: 2, workArea: { x: 1512, y: 0, width: 1920, height: 1080 } }

afterEach(() => {
  electron.windows.length = 0
  electron.options.length = 0
  electron.screen.displays = [LAPTOP, EXTERNAL]
  vi.useRealTimers()
})

describe('askbarBounds', () => {
  it('docks a full-height column at the bar width to the right edge', () => {
    expect(askbarBounds(WORK_AREA, 'right')).toEqual({ x: 1512 - ASKBAR_WIDTH, y: 25, width: ASKBAR_WIDTH, height: 917 })
  })

  it('docks to the left edge at the work area origin', () => {
    expect(askbarBounds(WORK_AREA, 'left')).toEqual({ x: 0, y: 25, width: ASKBAR_WIDTH, height: 917 })
  })

  it('respects a secondary display offset', () => {
    expect(askbarBounds(EXTERNAL.workArea, 'right')).toEqual({ x: 1512 + 1920 - ASKBAR_WIDTH, y: 0, width: ASKBAR_WIDTH, height: 1080 })
  })

  it('never exceeds the work area width', () => {
    expect(askbarBounds({ x: 0, y: 0, width: 40, height: 500 }, 'right')).toEqual({ x: 0, y: 0, width: 40, height: 500 })
  })
})

describe('askbarPlacement', () => {
  it('docks by side when nothing is remembered', () => {
    expect(askbarPlacement(undefined, [LAPTOP, EXTERNAL], LAPTOP, 'left')).toEqual(askbarBounds(WORK_AREA, 'left'))
  })

  it('uses the remembered position while its display is attached, at full work-area height', () => {
    expect(askbarPlacement({ displayId: 2, x: 2000, y: 300 }, [LAPTOP, EXTERNAL], LAPTOP, 'left'))
      .toEqual({ x: 2000, y: 0, width: ASKBAR_WIDTH, height: 1080 })
  })

  it('clamps a remembered position into the display work area', () => {
    expect(askbarPlacement({ displayId: 1, x: -30, y: 25 }, [LAPTOP], LAPTOP, 'right').x).toBe(0)
    expect(askbarPlacement({ displayId: 1, x: 5000, y: 25 }, [LAPTOP], LAPTOP, 'left').x).toBe(1512 - ASKBAR_WIDTH)
  })

  it('docks by side on the cursor display when the remembered display is gone', () => {
    expect(askbarPlacement({ displayId: 2, x: 2000, y: 0 }, [LAPTOP], LAPTOP, 'right')).toEqual(askbarBounds(WORK_AREA, 'right'))
  })
})

function mountBar(stored: { displayId: number, x: number, y: number } | undefined = undefined) {
  let position = stored
  const savePosition = vi.fn(async (next: { displayId: number, x: number, y: number }) => { position = next })
  const bar = new AskbarWindow({
    url: 'http://127.0.0.1:1/?dsh-desktop-mode=askbar',
    iconPath: '/tmp/icon.png',
    preloadPath: '/tmp/preload.js',
    readSide: () => 'left',
    readPosition: () => position,
    savePosition,
    isQuitting: () => false,
    logError: vi.fn(),
  })
  bar.mount()
  const window = electron.windows[0]
  if (window === undefined) throw new Error('no window created')
  return { bar, window, savePosition }
}

describe('AskbarWindow', () => {
  it('is created movable at the docked column, as a panel on macOS, and places before the deferred first show', () => {
    const { bar, window } = mountBar()
    expect(electron.options[0]).toEqual(expect.objectContaining({ movable: true, frame: false, x: 0, y: 25, width: ASKBAR_WIDTH }))
    // Transparent and without an OS shadow: macOS keeps a shadow computed from
    // earlier pixels, which drew a stale rim behind a panel that had slid in.
    expect(electron.options[0]).toEqual(expect.objectContaining({ transparent: true, hasShadow: false }))
    // An NSPanel sits outside Stage Manager and never keeps the app active on its own.
    expect((electron.options[0] as { type?: string }).type).toBe(process.platform === 'darwin' ? 'panel' : undefined)
    // A collapse before the page loads waits; ready-to-show places, then shows.
    bar.show()
    expect(window.show).not.toHaveBeenCalled()
    window.bounds = { x: 600, y: 400, width: ASKBAR_WIDTH, height: 917 } // what a cascade would leave
    window.emit('ready-to-show')
    expect(window.setBounds).toHaveBeenLastCalledWith(askbarBounds(WORK_AREA, 'left'))
    const order = window.setBounds.mock.invocationCallOrder.at(-1) ?? 0
    expect(window.show.mock.invocationCallOrder[0]).toBeGreaterThan(order)
    expect(bar.isShown()).toBe(true)
  })

  it('shows at the remembered position when its display is attached, and re-docks once it is gone', () => {
    const { bar, window } = mountBar({ displayId: 2, x: 2000, y: 0 })
    window.emit('ready-to-show')
    bar.show()
    expect(window.getBounds()).toEqual({ x: 2000, y: 0, width: ASKBAR_WIDTH, height: 1080 })
    bar.hide()
    electron.screen.displays = [LAPTOP]
    bar.show()
    expect(window.getBounds()).toEqual(askbarBounds(WORK_AREA, 'left'))
  })

  it('remembers where a drag left the bar, keyed by the display it landed on', () => {
    vi.useFakeTimers()
    const { window, savePosition } = mountBar()
    window.emit('ready-to-show')
    vi.advanceTimersByTime(ASKBAR_MOVE_SETTLE_MS * 2)
    window.bounds = { x: 1700, y: 0, width: ASKBAR_WIDTH, height: 1080 }
    window.emit('moved')
    expect(savePosition).toHaveBeenCalledWith({ displayId: 2, x: 1700, y: 0 })
    // The settings echo re-places the bar where it already is and saves nothing more.
    window.emit('show')
    window.emit('moved')
    expect(savePosition).toHaveBeenCalledOnce()
  })

  it('puts a placement back when the OS moves it at show, and saves nothing for it', () => {
    vi.useFakeTimers()
    const { bar, window, savePosition } = mountBar()
    window.emit('ready-to-show')
    bar.show()
    // macOS cascaded the bar onto the frontmost window's corner right after
    // our placement: the column goes back to its edge and no position is kept.
    window.bounds = { x: 221, y: 25, width: ASKBAR_WIDTH, height: 917 }
    window.emit('moved')
    expect(window.getBounds()).toEqual(askbarBounds(WORK_AREA, 'left'))
    expect(savePosition).not.toHaveBeenCalled()
  })

  it('grows for a panel and gives back exactly the column it grew from', () => {
    vi.useFakeTimers()
    const { bar, window, savePosition } = mountBar()
    window.emit('ready-to-show')
    bar.show()
    bar.widen(420)
    expect(window.getBounds()).toEqual({ x: 0, y: 25, width: 420, height: 917 })
    window.emit('moved')
    // The OS nudged the wider window; the column still comes back where it was.
    window.bounds = { x: 6, y: 25, width: 420, height: 917 }
    bar.widen(108)
    expect(window.getBounds()).toEqual(askbarBounds(WORK_AREA, 'left'))
    window.emit('moved')
    vi.advanceTimersByTime(ASKBAR_MOVE_SETTLE_MS * 2)
    expect(savePosition).not.toHaveBeenCalled()
  })

  it('gives a panel’s width back when it hides, so the next show is the column', () => {
    const { bar, window } = mountBar()
    window.emit('ready-to-show')
    bar.show()
    bar.widen(420)
    bar.hide()
    expect(window.getBounds()).toEqual(askbarBounds(WORK_AREA, 'left'))
    expect(window.hide).toHaveBeenCalled()
  })

  it('hands activation to the app behind on macOS and keeps the bar on screen without taking it back', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    const { bar, window } = mountBar()
    window.emit('ready-to-show')
    bar.show()
    bar.yieldActivation()
    expect(electron.app.hide).toHaveBeenCalledOnce()
    expect(window.showInactive).toHaveBeenCalledOnce()
    // Other platforms have no app-level hide; the bar stays as it is.
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    bar.yieldActivation()
    expect(electron.app.hide).toHaveBeenCalledOnce()
    expect(window.showInactive).toHaveBeenCalledOnce()
  })

  it('takes the keyboard for a panel and gives it back, only while on screen', () => {
    const { bar, window } = mountBar()
    bar.focus(true)
    expect(window.focus).not.toHaveBeenCalled()
    window.emit('ready-to-show')
    bar.show()
    bar.focus(true)
    expect(window.focus).toHaveBeenCalledOnce()
    bar.focus(false)
    expect(window.blur).toHaveBeenCalledOnce()
  })

  it('settles a continuous move stream into one save, and saves nothing for its own placement', () => {
    vi.useFakeTimers()
    const { bar, window, savePosition } = mountBar()
    window.emit('ready-to-show')
    bar.show()
    window.emit('move')
    vi.advanceTimersByTime(ASKBAR_MOVE_SETTLE_MS)
    expect(savePosition).not.toHaveBeenCalled()
    vi.advanceTimersByTime(ASKBAR_MOVE_SETTLE_MS)
    window.bounds = { x: 300, y: 25, width: ASKBAR_WIDTH, height: 917 }
    window.emit('move')
    window.bounds = { x: 320, y: 25, width: ASKBAR_WIDTH, height: 917 }
    window.emit('move')
    vi.advanceTimersByTime(ASKBAR_MOVE_SETTLE_MS)
    expect(savePosition).toHaveBeenCalledOnce()
    expect(savePosition).toHaveBeenCalledWith({ displayId: 1, x: 320, y: 25 })
    bar.release()
    expect(window.destroy).toHaveBeenCalled()
  })

  it('logs a failed save instead of throwing', async () => {
    const logError = vi.fn()
    const bar = new AskbarWindow({
      url: 'http://127.0.0.1:1/', iconPath: '/tmp/icon.png', preloadPath: '/tmp/preload.js',
      readSide: () => 'left', readPosition: () => undefined,
      savePosition: async () => { throw new Error('disk full') },
      isQuitting: () => false, logError,
    })
    bar.mount()
    const window = electron.windows[0]!
    await new Promise(resolve => setTimeout(resolve, ASKBAR_MOVE_SETTLE_MS * 2 + 10))
    window.bounds = { x: 300, y: 25, width: ASKBAR_WIDTH, height: 917 }
    window.emit('moved')
    await vi.waitFor(() => { expect(logError).toHaveBeenCalledWith(expect.stringContaining('disk full')) })
  })
})
