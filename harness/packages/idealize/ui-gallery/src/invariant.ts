/**
 * Package-owned invariant companion for `@idealize/ui-gallery`.
 * @module @idealize/ui-gallery/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@idealize/ui-gallery'

/** Cordis companion plugin name. */
export const name = 'idealize-ui-gallery-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the host half owns no data and appends no events, and
 * the browser half's slot, Definition, and view-target registrations are
 * effects whose disposal the slot ledger and conversation registry specs
 * already observe.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
