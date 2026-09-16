/**
 * Package-owned invariant companion for `@idealize/notify`.
 * @module @idealize/notify/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
// Type-only: the ctx.idealizeBridge Context merge whose feed this checks.
import type {} from '@idealize/host-bridge'
import { AttentionStore, attentionLedgerPath } from './attention-store.ts'

const PACKAGE_NAME = '@idealize/notify'

/** Cordis companion plugin name. */
export const name = 'idealize-notify-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Owned relation, announce after commit: an `attention` event reaches the
 * window only after its delivery record is on disk. A window told to alert
 * about a Studio event the ledger does not hold would report `opened` or
 * `dismissed` against nothing, so the person's answer would vanish. Each
 * check reads the ledger file afresh, because the store this companion holds
 * is not the one the plugin writes through.
 */
const install: InvariantInstaller = (ctx, fail) => {
  ctx.effect(() => {
    const bridge = ctx.get('idealizeBridge')
    if (bridge === undefined) return () => {}
    return bridge.buffer.subscribe((event) => {
      if (event.kind !== 'attention') return
      const named = event.studioEvent
      if (named === undefined) {
        fail(`an attention alert titled "${event.title}" names no Studio event`)
        return
      }
      void new AttentionStore(attentionLedgerPath(resolveDshHome())).load().then((ledger) => {
        if (!ledger.notifications.some(record => record.event === named)) {
          fail(`attention alert for Studio event ${named} reached the feed with no delivery record`)
        }
      }, (error: unknown) => {
        fail(`the attention ledger could not be read while checking ${named}: ${String(error)}`)
      })
    })
  }, 'idealize-notify-invariant: attention alerts announce after commit')
}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
