// @vitest-environment jsdom
/**
 * The mode shortcut: it renders nothing, flips the chat store's view on ⌘J
 * (capture phase, so it wins over the grid), and the probe hides the feature
 * wherever the host has no embedded terminal.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { isToggleShortcut, ModeShortcut, toggledView } from '../src/client/ModeShortcut.tsx'
import { probeCapabilities } from '../src/client/index.ts'

afterEach(cleanup)

function harness(initial: string | null) {
  let view = initial
  const listeners = new Set<() => void>()
  const useStore = <T,>(selector: (state: { view: string | null }) => T): T => selector({ view })
  const actions = {
    setView: vi.fn((next: string) => {
      view = next
      for (const listener of listeners) listener()
    }),
  }
  return { useStore, actions, current: () => view }
}

describe('toggledView / isToggleShortcut', () => {
  it('moves chat→terminal and anything else→chat', () => {
    expect(toggledView(null)).toBe('terminal')
    expect(toggledView('chat')).toBe('terminal')
    expect(toggledView('trajectory')).toBe('terminal')
    expect(toggledView('terminal')).toBe('chat')
  })

  it('matches ⌘J / Ctrl+J only', () => {
    expect(isToggleShortcut({ key: 'j', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false })).toBe(true)
    expect(isToggleShortcut({ key: 'J', metaKey: false, ctrlKey: true, altKey: false, shiftKey: false })).toBe(true)
    expect(isToggleShortcut({ key: 'j', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false })).toBe(false)
    expect(isToggleShortcut({ key: 'j', metaKey: true, ctrlKey: false, altKey: false, shiftKey: true })).toBe(false)
    expect(isToggleShortcut({ key: 'k', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false })).toBe(false)
  })
})

describe('ModeShortcut', () => {
  it('renders nothing: the view ring\'s tabs are the visible control', () => {
    const { useStore, actions } = harness(null)
    const { container } = render(<ModeShortcut useStore={useStore} actions={actions} />)
    expect(container.innerHTML).toBe('')
  })

  it('flips on ⌘J from anywhere and swallows the key', () => {
    const { useStore, actions } = harness('chat')
    render(<ModeShortcut useStore={useStore} actions={actions} />)
    const event = new KeyboardEvent('keydown', { key: 'j', metaKey: true, bubbles: true, cancelable: true })
    document.body.dispatchEvent(event)
    expect(actions.setView).toHaveBeenCalledWith('terminal')
    expect(event.defaultPrevented).toBe(true)
    const plain = new KeyboardEvent('keydown', { key: 'j', bubbles: true, cancelable: true })
    document.body.dispatchEvent(plain)
    expect(actions.setView).toHaveBeenCalledTimes(1)
  })

  it('flips back to chat from the terminal', () => {
    const { useStore, actions } = harness('terminal')
    render(<ModeShortcut useStore={useStore} actions={actions} />)
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'J', ctrlKey: true, bubbles: true, cancelable: true }))
    expect(actions.setView).toHaveBeenCalledWith('chat')
  })
})

describe('probeCapabilities', () => {
  it('reads the host answer and treats failures as no terminal', async () => {
    const yes = vi.fn(async () => new Response(JSON.stringify({ embedded: true }), { status: 200 }))
    expect(await probeCapabilities(yes as unknown as typeof fetch)).toEqual({ embedded: true })
    const no = vi.fn(async () => new Response(JSON.stringify({ embedded: false }), { status: 200 }))
    expect(await probeCapabilities(no as unknown as typeof fetch)).toEqual({ embedded: false })
    const missing = vi.fn(async () => new Response('nope', { status: 404 }))
    expect(await probeCapabilities(missing as unknown as typeof fetch)).toEqual({ embedded: false })
    const down = vi.fn(async () => { throw new Error('offline') })
    expect(await probeCapabilities(down as unknown as typeof fetch)).toEqual({ embedded: false })
  })
})
