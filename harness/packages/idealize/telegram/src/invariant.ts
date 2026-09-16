/* jscpd:ignore-start */
/**
 * Package-owned invariant companion for `@idealize/telegram`.
 * @module @idealize/telegram/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@idealize/telegram'

/** Cordis companion plugin name. */
export const name = 'idealize-telegram-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this plugin emits no event and owns no durable data
 * beyond its settings section, which the settings service validates. Its
 * inputs are other packages' streams (Studio events, the bridge feed, the
 * API proxy's mux), whose own companions assert them.
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
