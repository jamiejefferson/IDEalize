// @vitest-environment jsdom
/**
 * The session-id-to-agent-name projection holds its reference while the names
 * stand, so the Studio view does not re-render on a session update that
 * renames nobody, and hands on a new map the moment a name changes.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { createNameProjection } from '../src/client/index.ts'

afterEach(cleanup)

interface Summary { title?: string; projectionValues?: { agentName?: { name: string } } }
interface Snapshot { byId: Record<string, Summary> }

/** A bare observable session list a test can replace wholesale. */
function sessionList(initial: Snapshot) {
  let snapshot = initial
  const listeners = new Set<() => void>()
  return {
    subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } },
    getSnapshot: () => snapshot,
    set(next: Snapshot) { snapshot = next; for (const fn of listeners) fn() },
  }
}

const named = (name: string, title?: string): Summary => ({
  ...title === undefined ? {} : { title },
  projectionValues: { agentName: { name } },
})

describe('the agent name projection', () => {
  it('keeps its reference across an unrelated update and changes it with a name', () => {
    const project = createNameProjection()
    const first = project({ byId: { a: named('Ada'), b: named('Bo'), c: {} } })
    expect(first).toEqual({ a: 'Ada', b: 'Bo' })

    // A new snapshot, a retitled chat, an unnamed chat arriving: same names.
    expect(project({ byId: { a: named('Ada', 'Retitled'), b: named('Bo'), c: {}, d: {} } })).toBe(first)

    const renamed = project({ byId: { a: named('Ava'), b: named('Bo') } })
    expect(renamed).not.toBe(first)
    expect(renamed).toEqual({ a: 'Ava', b: 'Bo' })

    // Same size, different ids; then one more, then one fewer.
    const swapped = project({ byId: { a: named('Ava'), z: named('Bo') } })
    expect(swapped).toEqual({ a: 'Ava', z: 'Bo' })
    expect(swapped).not.toBe(renamed)
    const grown = project({ byId: { a: named('Ava'), z: named('Bo'), y: named('Cy') } })
    expect(grown).not.toBe(swapped)
    expect(project({ byId: { a: named('Ava') } })).toEqual({ a: 'Ava' })
  })

  it('re-renders a reader only when a name changes', () => {
    const list = sessionList({ byId: { a: named('Ada') } })
    const useList = bindSnapshotSelector(list)
    const project = createNameProjection()
    const seen: Record<string, string>[] = []
    function Reader() {
      seen.push(useList(snapshot => project(snapshot)))
      return null
    }
    render(<Reader />)
    const renders = seen.length

    act(() => { list.set({ byId: { a: named('Ada', 'Retitled'), b: {} } }) })
    expect(seen.length).toBe(renders)

    act(() => { list.set({ byId: { a: named('Ava') } }) })
    expect(seen.length).toBe(renders + 1)
    expect(seen.at(-1)).toEqual({ a: 'Ava' })
  })
})
