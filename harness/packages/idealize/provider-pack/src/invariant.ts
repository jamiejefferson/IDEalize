/* jscpd:ignore-start */
/**
 * Package-owned invariant companion for `@idealize/provider-pack`.
 * @module @idealize/provider-pack/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@idealize/provider-pack'

/** Cordis companion plugin name. */
export const name = 'idealize-provider-pack-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the OAuth credential store is a durable file checked at its parser boundary;
 * sign-in endpoints hold no mutable in-process state beyond it.
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
