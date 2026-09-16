/* jscpd:ignore-start */
/**
 * Package-owned invariant companion for `@idealize/setup`.
 * @module @idealize/setup/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@idealize/setup'

/** Cordis companion plugin name. */
export const name = 'idealize-setup-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the two aliases live in the durable settings section,
 * every write goes through one probe-then-persist step that stores nothing on
 * a failed probe, and `resolve` re-probes on each call rather than trusting a
 * cached verdict — so no in-process relation survives a write to check.
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
