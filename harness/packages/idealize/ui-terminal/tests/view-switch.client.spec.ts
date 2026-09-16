// @vitest-environment jsdom
/**
 * The view switch other plugins drive (the welcome card's Terminal pill):
 * `openTerminalView` resolves the chat entry's per-session store through the
 * framework's instance cache and writes the Terminal view.
 */
import { describe, expect, it, vi } from 'vitest'
import { openTerminalView, type ErasedSlots } from '../src/client/index.ts'

function slotsWith(options: {
  chatStore?: unknown
  instance?: { actions: { setView: (view: string) => void } } | undefined
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
