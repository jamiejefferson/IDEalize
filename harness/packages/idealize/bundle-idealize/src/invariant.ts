/* jscpd:ignore-start */
/**
 * Package-owned invariant companion for `@idealize/bundle-idealize`.
 * @module @idealize/bundle-idealize/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@idealize/bundle-idealize'

/** Cordis companion plugin name. */
export const name = 'idealize-bundle-idealize-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this composition bundle owns no independent event stream or mutable data; the
 * profile Loader tests cover its rows.
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
