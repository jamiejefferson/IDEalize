/**
 * Agent naming: a project takes one of the twelve pools on its first chat and
 * every chat in it draws a random unused name from that pool. Pure functions
 * over the store's view of what is taken; the service owns persistence.
 */

import { NAME_POOLS } from './name-pools.ts'

/** One pool by rotating index. */
function poolAt(index: number): readonly string[] {
  /* v8 ignore next -- NAME_POOLS is a non-empty module constant; the guard only types the indexed read. */
  return NAME_POOLS[index % NAME_POOLS.length] ?? []
}

/**
 * The pool a project should draw from: its recorded pool, else the least-used
 * pool so projects spread across the twelve before any pool repeats.
 * @param projectPath - the project's canonical folder.
 * @param pools - every project's recorded pool index.
 * @returns the pool index in `[0, NAME_POOLS.length)`.
 */
export function poolFor(projectPath: string, pools: Readonly<Record<string, number>>): number {
  const recorded = pools[projectPath]
  if (recorded !== undefined) return recorded
  const taken = Object.values(pools)
  const counts = NAME_POOLS.map((_pool, index) => taken.filter(recorded => recorded === index).length)
  let best = 0
  let fewest = Number.POSITIVE_INFINITY
  for (const [index, count] of counts.entries()) {
    if (count < fewest) {
      best = index
      fewest = count
    }
  }
  return best
}

/**
 * Draw an unused name from a pool, spilling into the following pools when one
 * is exhausted; with all 496 taken, a numbered form of a name from the home
 * pool keeps the chat addressable.
 * @param pool - the project's pool index.
 * @param taken - every name currently held by a session.
 * @param random - a [0,1) source; injected so tests are deterministic.
 * @returns a name absent from `taken`.
 */
export function pickName(pool: number, taken: ReadonlySet<string>, random: () => number = Math.random): string {
  for (let offset = 0; offset < NAME_POOLS.length; offset += 1) {
    const candidates = poolAt(pool + offset).filter(name => !taken.has(name))
    const drawn = candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))]
    if (drawn !== undefined) return drawn
  }
  const home = poolAt(pool)
  /* v8 ignore next -- every pool is a non-empty module constant; the guard only types the indexed read. */
  const base = home[Math.min(home.length - 1, Math.floor(random() * home.length))] ?? 'Agent'
  for (let suffix = 2; ; suffix += 1) {
    const numbered = `${base} ${suffix}`
    if (!taken.has(numbered)) return numbered
  }
}
