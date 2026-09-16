/**
 * The package's invariant companion reserves its name on a real registry.
 * Seeding writes the durable preset root once and the loopback routes answer
 * from it, so the companion registers no check and only reserves the name.
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'

const PACKAGE_NAME = '@idealize/activity-pills'

describe('@idealize/activity-pills’s invariant companion', () => {
  it('holds the package name against a second registration', async () => {
    const ctx = new Context()
    // Any root plugin starts the global test host, which mounts the invariant
    // service and this package's companion before the fiber becomes active.
    await ctx.plugin(() => {}).await()

    expect(() => ctx.invariants.register(PACKAGE_NAME, () => {})).toThrow('already registered')
    expect(() => ctx.invariants.register(`${PACKAGE_NAME}-other`, () => {})).not.toThrow()

    await ctx.fiber.dispose()
  })
})
