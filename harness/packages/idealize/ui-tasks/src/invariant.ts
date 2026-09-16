/**
 * Package-owned invariant companion for `@idealize/ui-tasks`.
 * @module @idealize/ui-tasks/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@idealize/ui-tasks'

/** Cordis companion plugin name. */
export const name = 'idealize-ui-tasks-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the host face registers nothing, and the client half's
 * one slot registration is an effect the slot ledger specs cover. The list the
 * column renders is the `todos` projection owned by
 * `@deepseek-ai/dsh-tool-todo`, whose companion proves it. This package owns no
 * durable data and no event stream of its own.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
