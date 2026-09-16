/**
 * The bar reads the sidebar's persisted row order from the view store's
 * localStorage entry, and keeps the account order when nothing usable is there.
 */
import { describe, expect, it } from 'vitest'
import { CURRENT_SESSION_KEY, readCurrentSession, readSidebarOrder, SIDEBAR_VIEW_KEY } from '../src/client/sidebar-order.ts'

const storageOf = (value: string | null) => ({ getItem: (key: string) => key === SIDEBAR_VIEW_KEY ? value : null })

describe('readSidebarOrder', () => {
  it('reads the ordering, each account’s persisted order and the activity it last saw', () => {
    const view = { groupBy: 'workspace', orderBy: 'manual', sessionOrderByAccount: { 'ws-1': ['s-b', 's-a'], '': ['s-loose'] }, sessionUpdatedAtByAccount: { 'ws-1': { 's-a': 3, 's-b': 'x' } } }
    expect(readSidebarOrder(storageOf(JSON.stringify(view)))).toEqual({
      orderBy: 'manual',
      sessionOrderByAccount: { 'ws-1': ['s-b', 's-a'], '': ['s-loose'] },
      sessionUpdatedAtByAccount: { 'ws-1': { 's-a': 3 } },
    })
  })

  it('is empty without storage, without an entry, or with a value that is not the view store’s', () => {
    expect(readSidebarOrder(undefined)).toEqual({})
    expect(readSidebarOrder(storageOf(null))).toEqual({})
    expect(readSidebarOrder(storageOf('{not json'))).toEqual({})
    expect(readSidebarOrder(storageOf('"a string"'))).toEqual({})
    expect(readSidebarOrder(storageOf(JSON.stringify({ orderBy: 'sideways', sessionOrderByAccount: 3, sessionUpdatedAtByAccount: 'no' })))).toEqual({})
    expect(readSidebarOrder({ getItem: () => { throw new Error('denied') } })).toEqual({})
  })

  it('skips an account whose entry is not a list of ids or a map of times', () => {
    const view = { sessionOrderByAccount: { 'ws-1': ['s-a', 2], 'ws-2': 's-a', 'ws-3': ['s-c'] }, sessionUpdatedAtByAccount: { 'ws-1': 4, 'ws-3': { 's-c': 1 } } }
    expect(readSidebarOrder(storageOf(JSON.stringify(view)))).toEqual({ sessionOrderByAccount: { 'ws-3': ['s-c'] }, sessionUpdatedAtByAccount: { 'ws-3': { 's-c': 1 } } })
  })
})

describe('readCurrentSession', () => {
  const storageOf = (value: string | null) => ({ getItem: (key: string) => key === CURRENT_SESSION_KEY ? value : null })

  it('reads the persisted selection', () => {
    expect(readCurrentSession(storageOf(JSON.stringify({ sessionId: 's-a' })))).toBe('s-a')
  })

  it('names no chat without storage, without an entry, or with a value that is not a selection', () => {
    expect(readCurrentSession(undefined)).toBeUndefined()
    expect(readCurrentSession(storageOf(null))).toBeUndefined()
    expect(readCurrentSession(storageOf('{'))).toBeUndefined()
    expect(readCurrentSession(storageOf(JSON.stringify({})))).toBeUndefined()
    expect(readCurrentSession(storageOf(JSON.stringify({ sessionId: 4 })))).toBeUndefined()
    expect(readCurrentSession({ getItem: () => { throw new Error('denied') } })).toBeUndefined()
  })
})
