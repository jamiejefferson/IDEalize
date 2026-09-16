/* jscpd:ignore-start */
/**
 * Package-owned invariant companion for `@idealize/ui-bar`.
 * @module @idealize/ui-bar/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@idealize/ui-bar'

/** Cordis companion plugin name. */
export const name = 'idealize-ui-bar-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the toggle bar is client-only presentation over services other packages own;
 * no server-side event stream or mutable data lives here.
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
