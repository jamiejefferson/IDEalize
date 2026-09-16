/**
 * Package-owned invariant companion for `@idealize/spaces`.
 * @module @idealize/spaces/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { isSpaceId, SPACE_IDS } from './space-table.ts'

const PACKAGE_NAME = '@idealize/spaces'

/** Cordis companion plugin name. */
export const name = 'idealize-spaces-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * Owned relation: every `idealize/space` event in the log names a space this
 * build declares. The id is durable and drives the view ring, the sidebar lane
 * and the availability read, so an undeclared id would leave a chat with a
 * space no surface can render — and the derivation ladder would silently show
 * it as Chat instead of failing. The route validates its own body; this catches
 * any other writer of the event.
 */
const install: InvariantInstaller = (ctx, fail) => {
  ctx.on('session/event', (_session, event) => {
    if (event.type !== 'idealize/space') return
    const { space } = event.data
    if (!isSpaceId(space)) {
      fail(`idealize/space recorded '${String(space)}', which is not one of the declared spaces: ${SPACE_IDS.join(', ')}`)
    }
  }, { global: true })
}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
