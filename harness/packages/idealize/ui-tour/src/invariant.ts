/* jscpd:ignore-start */
/**
 * Package-owned invariant companion for `@idealize/ui-tour`.
 * @module @idealize/ui-tour/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@idealize/ui-tour'

/** Cordis companion plugin name. */
export const name = 'idealize-ui-tour-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the host half only registers the `idealize-tour`
 * settings section (every write is schema-validated), and the browser half's
 * slot and keybind registrations are effects whose disposal the slot ledger
 * and keybind registry specs already observe.
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
