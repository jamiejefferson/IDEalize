/* jscpd:ignore-start */
/**
 * Package-owned invariant companion for `@idealize/skills`.
 * @module @idealize/skills/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@idealize/skills'

/** Cordis companion plugin name. */
export const name = 'idealize-skills-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the plugin mounts one filesystem skill provider for the
 * stored folder and nothing else; which skills that folder holds is the
 * provider's own discovery, and the settings value is validated at its schema.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
