/**
 * Package-owned invariant companion for `@idealize/askbar`.
 * @module @idealize/askbar/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@idealize/askbar'

/** Cordis companion plugin name. */
export const name = 'idealize-askbar-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the package owns no event stream or mutable store —
 * the roster route is a pure join over comm's and studio's authoritative
 * state (pinned by the roster/chip-state specs), and the transform route
 * only forwards to the desktop shell's own service.
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
