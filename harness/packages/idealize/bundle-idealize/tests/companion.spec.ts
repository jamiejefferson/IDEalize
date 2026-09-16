/**
 * The package's invariant companion reserves its name on a real registry.
 * The profile bundle's substance is `cordis.patch.yml`; the package owns no
 * runtime API, so its companion registers no check and only reserves the name.
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'

const PACKAGE_NAME = '@idealize/bundle-idealize'

describe('@idealize/bundle-idealize’s invariant companion', () => {
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
