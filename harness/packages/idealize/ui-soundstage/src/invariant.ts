/**
 * Package-owned invariant companion for `@idealize/ui-soundstage`.
 * @module @idealize/ui-soundstage/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@idealize/ui-soundstage'

/** Cordis companion plugin name. */
export const name = 'idealize-ui-soundstage-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the host face registers nothing, and the client half's
 * slot registrations are effects the slot ledger specs cover. The rows the
 * view renders are owned by `@idealize/ui-gallery`'s Definition and the
 * artefact events it reads, whose companions prove them. This package owns no
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
