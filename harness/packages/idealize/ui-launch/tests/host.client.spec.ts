/**
 * The opening sequence's host half. The whole feature is the browser half's
 * shell.overlay occupant, so mounting this one must add nothing to the host.
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { apply } from '@idealize/ui-launch'

const PACKAGE_NAME = '@idealize/ui-launch'

describe('the launch host face', () => {
  it('mounts, serves no route, and leaves its invariant name reserved', async () => {
    const ctx = new Context()
    const paths: string[] = []
    ctx.provide('webServer', { register: (route: { path: string }) => { paths.push(route.path); return () => {} } } as never)

    const fiber = ctx.plugin({ name: PACKAGE_NAME, inject: [], apply })
    await fiber.await()
    expect(paths).toEqual([])
    expect(() => ctx.invariants.register(PACKAGE_NAME, () => {})).toThrow('already registered')

    await fiber.dispose()
    await ctx.fiber.dispose()
  })
})
