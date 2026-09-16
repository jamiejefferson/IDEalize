/* jscpd:ignore-start */
/**
 * Package-owned invariant companion for `@idealize/generate`.
 * @module @idealize/generate/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@idealize/generate'

/** Cordis companion plugin name. */
export const name = 'idealize-generate-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the backend registry's owned relation (register
 * returns the disposer that removes the backend) is proven by this package's
 * disposal tests, and no event stream or durable data crosses its boundary.
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
