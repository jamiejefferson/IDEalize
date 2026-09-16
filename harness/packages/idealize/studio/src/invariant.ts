/**
 * Package-owned invariant companion for `@idealize/studio`.
 * @module @idealize/studio/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type {} from './index.ts'

const PACKAGE_NAME = '@idealize/studio'

/** Cordis companion plugin name. */
export const name = 'idealize-studio-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Owned relation: `idealize/studio-event` announces a committed timeline
 * record, so by the time the emit's listeners have run, the store must retain
 * that event's seq for its project. An emit the store cannot account for
 * means a consumer was told about a record that a restart would not replay.
 */
const install: InvariantInstaller = (ctx, fail) => {
  ctx.on('idealize/studio-event', (event) => {
    queueMicrotask(() => {
      const studio = ctx.get('idealizeStudio')
      if (studio === undefined) return
      if (studio.lastSeq(event.project) < event.seq) {
        fail(`studio event ${event.id} (seq ${event.seq}) was announced but ${event.project}'s timeline ends at ${studio.lastSeq(event.project)}`)
      }
    })
  }, { global: true })
}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
