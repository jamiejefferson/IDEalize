/**
 * Package-owned invariant companion for `@idealize/ui-studio`.
 * @module @idealize/ui-studio/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@idealize/ui-studio'

/** Cordis companion plugin name. */
export const name = 'idealize-ui-studio-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the host half owns no data and appends no events, the
 * timeline and its fold belong to `@idealize/studio`, and the browser half's
 * `studioSection` provision is a Context effect whose disposal Cordis itself
 * reverses.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
