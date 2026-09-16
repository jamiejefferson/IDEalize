/* jscpd:ignore-start */
/**
 * Package-owned invariant companion for `@idealize/activity-pills`.
 * @module @idealize/activity-pills/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@idealize/activity-pills'

/** Cordis companion plugin name. */
export const name = 'idealize-activity-pills-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: seeding runs once against the durable preset root and
 * never overwrites (its specs drive a real preset root), and the loopback
 * routes answer each request from that root — no in-process relationship can
 * drift.
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
