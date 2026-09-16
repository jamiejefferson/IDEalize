/* jscpd:ignore-start */
/**
 * Package-owned invariant companion for `@idealize/comm`.
 * @module @idealize/comm/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@idealize/comm'

/** Cordis companion plugin name. */
export const name = 'idealize-comm-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the mailbox document under `$DSH_HOME/idealize` is
 * authoritative — the store re-reads it per command — and the CLI shim lives
 * across a process boundary, so no in-process relationship can drift.
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
