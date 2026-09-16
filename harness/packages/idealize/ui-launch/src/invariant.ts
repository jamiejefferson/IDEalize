/* jscpd:ignore-start */
/**
 * Package-owned invariant companion for `@idealize/ui-launch`.
 * @module @idealize/ui-launch/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@idealize/ui-launch'

/** Cordis companion plugin name. */
export const name = 'idealize-ui-launch-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the package is browser-only, its slot occupant and
 * stylesheet injection are effects, and the park/play machine's only shared
 * state is the `data-idealize-launch` body attribute it sets and removes
 * itself — no in-process relationship can drift.
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
