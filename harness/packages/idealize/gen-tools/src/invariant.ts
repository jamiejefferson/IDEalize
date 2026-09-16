/**
 * Package-owned invariant companion for `@idealize/gen-tools`.
 * @module @idealize/gen-tools/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { GenerationReroutedData } from './types.ts'

const PACKAGE_NAME = '@idealize/gen-tools'

/** Cordis companion plugin name. */
export const name = 'idealize-gen-tools-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * Owned relation: `generation/rerouted` records an actual fallback — the
 * stored and used models must differ. An event naming the same model both
 * ways would make the transcript claim a reroute that never happened.
 */
const install: InvariantInstaller = (ctx, fail) => {
  ctx.on('session/event', (_session, event) => {
    if (event.type !== 'generation/rerouted') return
    const data: GenerationReroutedData = event.data
    if (data.stored.backend === data.used.backend && data.stored.model === data.used.model) {
      fail(`generation/rerouted for preset '${data.presetId}' names the same stored and used model — the notice exists only for actual fallbacks`)
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
