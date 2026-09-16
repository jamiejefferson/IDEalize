/**
 * Package-owned invariant companion for `@idealize/host-bridge`.
 * @module @idealize/host-bridge/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type {} from '@idealize/cron'
import type {} from './index.ts'

const PACKAGE_NAME = '@idealize/host-bridge'

/** Cordis companion plugin name. */
export const name = 'idealize-host-bridge-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Owned relation: every `idealize/cron-run` event the host observes must be
 * forwarded into the bridge buffer as a `cron-run` notification before the
 * emit returns to its caller. The bridge listener is synchronous, so the
 * forward has landed one microtask later; the check reads the events recorded
 * after this emit began rather than only the newest, because two tasks
 * finishing in one tick are two forwards and neither is a violation. A missing
 * one means the shell's toast feed silently dropped a finished schedule.
 */
const install: InvariantInstaller = (ctx, fail) => {
  ctx.on('idealize/cron-run', (run, task) => {
    const bridge = ctx.get('idealizeBridge')
    if (bridge === undefined) return
    const before = bridge.buffer.recent(0).at(-1)?.seq ?? 0
    queueMicrotask(() => {
      const forwarded = bridge.buffer.recent(before)
        .some(event => event.kind === 'cron-run' && event.title.startsWith(task.name))
      if (!forwarded) {
        fail(`cron task ${task.id} finished (${run.status}) but the bridge buffer holds no matching cron-run event`)
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
