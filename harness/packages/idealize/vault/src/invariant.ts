/* jscpd:ignore-start */
/**
 * Package-owned invariant companion for `@idealize/vault`.
 * @module @idealize/vault/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@idealize/vault'

/** Cordis companion plugin name. */
export const name = 'idealize-vault-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: vault scaffolding and session-close documentation are file writes on
 * session/flush; the durable file is checked at its parser boundary and no in-process relation
 * outlives a flush.
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
