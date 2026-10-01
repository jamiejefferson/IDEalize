// @vitest-environment jsdom
/**
 * The view switch other plugins drive (the welcome card's Terminal pill):
 * `openTerminalView` resolves the chat entry's per-session store through the
 * framework's instance cache and writes the Terminal view.
 */
import { describe, expect, it, vi } from 'vitest'
import { addPathsToTerminal, openTerminalView, type ErasedSlots } from '../src/client/index.ts'

function slotsWith(options: {
  chatStore?: unknown
  instance?: { actions: { setView: (view: string) => void }; getSnapshot?: () => unknown } | undefined
}): { slots: ErasedSlots; storeOf: ReturnType<typeof vi.fn> } {
  const storeOf = vi.fn(() => options.instance)
  const entries = options.chatStore === undefined
    ? []
    : [{ options: { id: 'chat' }, store: options.chatStore }]
  const slots = {
    entries: () => entries,
    subscribe: () => () => {},
    register: () => () => {},
    inject: () => {},
    hostFace: () => ({ storeOf }),
  } as unknown as ErasedSlots
  return { slots, storeOf }
}

describe('openTerminalView', () => {
  it('writes the Terminal view through the session\'s cached store instance', () => {
    const setView = vi.fn()
    const handle = { spec: {} }
    const { slots, storeOf } = slotsWith({ chatStore: handle, instance: { actions: { setView } } })
    expect(openTerminalView(slots, 's1')).toBe(true)
    expect(storeOf).toHaveBeenCalledWith(expect.objectContaining({ store: handle }), 's1')
    expect(setView).toHaveBeenCalledWith('terminal')
  })

  it('reports false before the chat entry (and its store) exists', () => {
    const { slots } = slotsWith({})
    expect(openTerminalView(slots, 's1')).toBe(false)
  })

  it('reports false when the framework holds no instance for the entry', () => {
    const { slots } = slotsWith({ chatStore: { spec: {} }, instance: undefined })
    expect(openTerminalView(slots, 's1')).toBe(false)
  })
})

describe('addPathsToTerminal', () => {
  const instance = (view: string | null) => ({ actions: { setView: vi.fn() }, getSnapshot: () => ({ view }) })

  it('types the paths when the chat shows its Terminal view', () => {
    const type = vi.fn(() => true)
    const { slots } = slotsWith({ chatStore: { spec: {} }, instance: instance('terminal') })
    expect(addPathsToTerminal(slots, 's1', ['/w/a.md'], type)).toBe(true)
    expect(type).toHaveBeenCalledWith('s1', ['/w/a.md'])
  })

  it('leaves the paths for the composer when the chat shows another view', () => {
    const type = vi.fn(() => true)
    for (const view of ['chat', null]) {
      const { slots } = slotsWith({ chatStore: { spec: {} }, instance: instance(view) })
      expect(addPathsToTerminal(slots, 's1', ['/w/a.md'], type)).toBe(false)
    }
    expect(type).not.toHaveBeenCalled()
  })

  it('reports false when the shell is not running, and before the chat entry exists', () => {
    const { slots } = slotsWith({ chatStore: { spec: {} }, instance: instance('terminal') })
    expect(addPathsToTerminal(slots, 's1', ['/w/a.md'], () => false)).toBe(false)
    expect(addPathsToTerminal(slotsWith({}).slots, 's1', ['/w/a.md'])).toBe(false)
  })
})
