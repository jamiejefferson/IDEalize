/* jscpd:ignore-start */
/**
 * Package-owned invariant companion for `@idealize/services`.
 * @module @idealize/services/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@idealize/services'

/** Cordis companion plugin name. */
export const name = 'idealize-services-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package owns no event stream and no durable data.
 * Its list is derived on each read from the LLM directory and the generation
 * registry, and the keys it stores are owned by the credentials seam, whose
 * own companion proves their resolution.
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
