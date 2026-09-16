/* jscpd:ignore-start */
/**
 * Package-owned invariant companion for `@idealize/transcribe`.
 * @module @idealize/transcribe/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@idealize/transcribe'

/** Cordis companion plugin name. */
export const name = 'idealize-transcribe-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the provider registry's owned relation (register
 * returns the disposer that removes the provider) is proven by this package's
 * disposal tests, and the one durable thing this package writes — the model
 * cache — is the library's own directory, not data this seam owns.
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
