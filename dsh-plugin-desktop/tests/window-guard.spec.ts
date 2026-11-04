import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({ openExternal: vi.fn(async () => undefined) }))
vi.mock('electron', () => ({ shell: { openExternal: electron.openExternal } }))

const { guardNavigation } = await import('../src/window-guard.ts')

const ORIGIN = 'http://127.0.0.1:52899'

function fakeWindow() {
  const webContents = new EventEmitter() as EventEmitter & { setWindowOpenHandler: ReturnType<typeof vi.fn> }
  webContents.setWindowOpenHandler = vi.fn()
  return { webContents } as never as Electron.BrowserWindow & { webContents: typeof webContents }
}

beforeEach(() => { electron.openExternal.mockClear() })

describe('navigation guard', () => {
  it('holds the main frame to the app origin, and lets frames inside it alone', () => {
    const window = fakeWindow()
    guardNavigation(window, ORIGIN, { logError: vi.fn() })
    const attempt = (url: string, isMainFrame = true): boolean => {
      const event = { url, isMainFrame, preventDefault: vi.fn() }
      window.webContents.emit('will-frame-navigate', event)
      return event.preventDefault.mock.calls.length > 0
    }
    expect(attempt(`${ORIGIN}/chat`)).toBe(false)
    expect(attempt('https://attacker.example/')).toBe(true)
    expect(attempt('file:///etc/passwd')).toBe(true)
    expect(attempt('not a url')).toBe(true)
    expect(attempt('https://attacker.example/', false)).toBe(false)
  })

  it('stops a redirect off the origin', () => {
    const window = fakeWindow()
    guardNavigation(window, ORIGIN, { logError: vi.fn() })
    const event = { preventDefault: vi.fn() }
    window.webContents.emit('will-redirect', event, 'https://attacker.example/', false, true)
    expect(event.preventDefault).toHaveBeenCalledOnce()
  })

  it('sends web links to the browser, drops other schemes and keeps every remote page out of the app', () => {
    const window = fakeWindow()
    guardNavigation(window, ORIGIN, { logError: vi.fn() })
    const open = window.webContents.setWindowOpenHandler.mock.calls[0]?.[0] as (details: { url: string }) => { action: string }
    expect(open({ url: 'https://example.com/a' })).toEqual({ action: 'deny' })
    expect(electron.openExternal).toHaveBeenCalledWith('https://example.com/a')
    electron.openExternal.mockClear()
    expect(open({ url: 'file:///tmp/x.command' })).toEqual({ action: 'deny' })
    expect(open({ url: 'javascript:alert(1)' })).toEqual({ action: 'deny' })
    expect(electron.openExternal).not.toHaveBeenCalled()
    expect(open({ url: `${ORIGIN}/sign-in` }).action).toBe('allow')
  })

  it('guards a same-origin child with the same rules, and releases its listeners', () => {
    const window = fakeWindow()
    const release = guardNavigation(window, ORIGIN, { logError: vi.fn() })
    const child = fakeWindow()
    window.webContents.emit('did-create-window', child)
    expect(child.webContents.listenerCount('will-frame-navigate')).toBe(1)
    release()
    expect(window.webContents.listenerCount('will-frame-navigate')).toBe(0)
    expect(window.webContents.listenerCount('will-redirect')).toBe(0)
    expect(window.webContents.listenerCount('did-create-window')).toBe(0)
  })
})
