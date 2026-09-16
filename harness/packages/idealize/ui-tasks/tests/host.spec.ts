/**
 * the task column host face contributes no host behaviour and serves no route.
 * The column renders the `todos` projection `@deepseek-ai/dsh-tool-todo`
 * already computes, so this half must add nothing to the host.
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { apply } from '../src/index.ts'

const PACKAGE_NAME = '@idealize/ui-tasks'

describe('the task column host face', () => {
  it('mounts, serves no route, and leaves its invariant name reserved', async () => {
    const ctx = new Context()
    const paths: string[] = []
    ctx.provide('webServer', { register: (route: { path: string }) => { paths.push(route.path); return () => {} } } as never)

    const fiber = ctx.plugin({ name: PACKAGE_NAME, inject: [], apply })
    await fiber.await()
    expect(paths).toEqual([])
    // The companion the global test host mounted holds the package's name;
    // a second registration under it is what proves the reservation landed.
    expect(() => ctx.invariants.register(PACKAGE_NAME, () => {})).toThrow('already registered')

    await fiber.dispose()
    await ctx.fiber.dispose()
  })
})
