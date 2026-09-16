/**
 * Package-owned invariant companion for `@idealize/cron`.
 * @module @idealize/cron/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type {} from './index.ts'

const PACKAGE_NAME = '@idealize/cron'

/** Cordis companion plugin name. */
export const name = 'idealize-cron-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Owned relation: every `idealize/cron-run` event describes a run the
 * scheduler finished. A run that actually executed (`ok` or `error`) carries
 * the wall time it took; a run skipped because the task was still busy never
 * started, so it carries none. A payload breaking that pairing means the
 * scheduler emitted before it finished bookkeeping, and the calendar page and
 * host bridge would show a duration that was never measured (or hide one that was).
 */
const install: InvariantInstaller = (ctx, fail) => {
  ctx.on('idealize/cron-run', (run, task) => {
    const executed = run.status !== 'skipped-busy'
    if (executed && run.durationMs === undefined) {
      fail(`cron task ${task.id} emitted a ${run.status} run without durationMs`)
    }
    if (!executed && run.durationMs !== undefined) {
      fail(`cron task ${task.id} emitted a skipped-busy run carrying durationMs`)
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
