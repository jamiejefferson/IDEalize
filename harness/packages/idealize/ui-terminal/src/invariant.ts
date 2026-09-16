/**
 * Package-owned invariant companion for `@idealize/ui-terminal`.
 * @module @idealize/ui-terminal/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@idealize/ui-terminal'

/** Cordis companion plugin name. */
export const name = 'idealize-ui-terminal-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the host half registers plain web routes whose
 * disposal the web server's own specs observe, and the client half's slot
 * registrations are effects the slot ledger specs cover.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
