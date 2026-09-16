// @vitest-environment jsdom
/**
 * createLayoutStore unit account: init shape, the action write set (clamp
 * inside actions), and browser persistence limited to the drawer width. Uses the
 * test-sanctioned path: factory self-call + .create() gives the
 * real engine instance (same create path as production).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createLayoutStore, DRAWER_WIDTH_KEY, rememberedDrawerWidth } from '@deepseek-ai/dsh-client-ui-layout/src/client/stores.ts'
import {
  DETAILS_DEFAULT, DETAILS_MAX, DETAILS_MIN, DRAWER_DEFAULT, DRAWER_MAX, DRAWER_MIN,
  SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN,
} from '@deepseek-ai/dsh-client-ui-layout/src/client/columns.ts'

const PERSIST_KEY = 'dsh.layout.panels'

beforeEach(() => { localStorage.clear() })

describe('createLayoutStore', () => {
  it('initializes the sidebar at its default width, details closed, wide viewport assumed', () => {
    const { store } = createLayoutStore().create()
    expect(store.getSnapshot()).toEqual({ sidebar: SIDEBAR_DEFAULT, details: 0, deck: 0, drawer: 0, narrow: false, narrowExpanded: false })
  })

  it('each create() is an independent instance (factory is not a singleton)', () => {
    const a = createLayoutStore().create()
    const b = createLayoutStore().create()
    a.actions.setSidebar(400)
    expect(b.store.getSnapshot().sidebar).toBe(SIDEBAR_DEFAULT)
  })

  it('setSidebar/setDetails clamp into the contract ranges', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setSidebar(1)
    expect(store.getSnapshot().sidebar).toBe(SIDEBAR_MIN)
    actions.setSidebar(9999)
    expect(store.getSnapshot().sidebar).toBe(SIDEBAR_MAX)
    actions.setDetails(1)
    expect(store.getSnapshot().details).toBe(DETAILS_MIN)
    actions.setDetails(9999)
    expect(store.getSnapshot().details).toBe(DETAILS_MAX)
  })

  it('toggleSidebar flips closed <-> contract default (drag width forgotten)', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setSidebar(400)
    actions.toggleSidebar()
    expect(store.getSnapshot().sidebar).toBe(0)
    actions.toggleSidebar()
    expect(store.getSnapshot().sidebar).toBe(SIDEBAR_DEFAULT)
  })

  it('narrow toggleSidebar flips only the re-expand override; the width preference survives', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setSidebar(400)
    actions.setNarrow(true)
    actions.toggleSidebar()
    expect(store.getSnapshot()).toEqual({ sidebar: 400, details: 0, deck: 0, drawer: 0, narrow: true, narrowExpanded: true })
    actions.toggleSidebar()
    expect(store.getSnapshot().narrowExpanded).toBe(false)
    expect(store.getSnapshot().sidebar).toBe(400)
  })

  it('crossing the breakpoint drops the override; a same-value setNarrow keeps it', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setNarrow(true)
    actions.toggleSidebar()
    expect(store.getSnapshot().narrowExpanded).toBe(true)
    actions.setNarrow(true)
    expect(store.getSnapshot().narrowExpanded).toBe(true)
    actions.setNarrow(false)
    expect(store.getSnapshot()).toMatchObject({ narrow: false, narrowExpanded: false })
    actions.setNarrow(true)
    expect(store.getSnapshot().narrowExpanded).toBe(false)
  })

  it('openDetails uses the contract default, preserves an open width, and closeDetails zeroes', () => {
    const { store, actions } = createLayoutStore().create()
    actions.openDetails()
    expect(store.getSnapshot().details).toBe(DETAILS_DEFAULT)
    actions.setDetails(500)
    actions.openDetails()
    expect(store.getSnapshot().details).toBe(500)
    actions.closeDetails()
    expect(store.getSnapshot().details).toBe(0)
  })

  it('the drawer reopens at its last dragged width, across close and across a fresh store', () => {
    const { store, actions } = createLayoutStore().create()
    actions.openDrawer()
    expect(store.getSnapshot().drawer).toBe(DRAWER_DEFAULT)
    actions.setDrawer(600)
    actions.closeDrawer()
    expect(store.getSnapshot().drawer).toBe(0)
    actions.openDrawer()
    expect(store.getSnapshot().drawer).toBe(600)
    expect(localStorage.getItem(DRAWER_WIDTH_KEY)).toBe('600')
    const next = createLayoutStore().create()
    next.actions.openDrawer()
    expect(next.store.getSnapshot().drawer).toBe(600)
  })

  it('rememberedDrawerWidth clamps stored widths and falls back to the default on nonsense or blocked storage', () => {
    localStorage.setItem(DRAWER_WIDTH_KEY, '9999')
    expect(rememberedDrawerWidth()).toBe(DRAWER_MAX)
    localStorage.setItem(DRAWER_WIDTH_KEY, '1')
    expect(rememberedDrawerWidth()).toBe(DRAWER_MIN)
    localStorage.setItem(DRAWER_WIDTH_KEY, 'wide')
    expect(rememberedDrawerWidth()).toBe(DRAWER_DEFAULT)
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    expect(rememberedDrawerWidth()).toBe(DRAWER_DEFAULT)
    const { store, actions } = createLayoutStore().create()
    actions.setDrawer(500)
    expect(store.getSnapshot().drawer).toBe(500)
    getItem.mockRestore()
    setItem.mockRestore()
  })

  it('does not persist the other panels\' geometry', () => {
    const first = createLayoutStore().create()
    first.actions.setSidebar(400)
    first.actions.openDetails()
    first.actions.setDetails(500)
    expect(localStorage.getItem(PERSIST_KEY)).toBeNull()

    const second = createLayoutStore().create()
    expect(second.store.getSnapshot()).toEqual({
      sidebar: SIDEBAR_DEFAULT,
      details: 0,
      deck: 0, drawer: 0,
      narrow: false,
      narrowExpanded: false,
    })
  })
})
