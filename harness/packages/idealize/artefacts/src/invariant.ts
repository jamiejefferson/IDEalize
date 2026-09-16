/**
 * Package-owned invariant companion for `@idealize/artefacts`.
 * @module @idealize/artefacts/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { ArtefactRecord } from './types.ts'

const PACKAGE_NAME = '@idealize/artefacts'

/** Cordis companion plugin name. */
export const name = 'idealize-artefacts-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * Owned relation: `artefact/created` publishes only at the commit point — by
 * the time the event reaches session observers, the artefact store must
 * already resolve the record durably. An event without a resolvable record
 * would let the transcript reference an artefact no mode can address (the
 * MOD-06 shared-identifier contract).
 */
const install: InvariantInstaller = (ctx, fail) => {
  ctx.on('session/event', (_session, event) => {
    if (event.type !== 'artefact/created') return
    const record = (event.data as { record: ArtefactRecord }).record
    const store = ctx.get('artefacts') as { get(id: ArtefactRecord['id']): ArtefactRecord | undefined } | undefined
    if (store === undefined) {
      fail(`artefact/created for '${record.id}' was appended with no mounted artefact store`)
      return
    }
    if (store.get(record.id) === undefined) {
      fail(`artefact/created for '${record.id}' has no durable artefact record — events must publish at the commit point`)
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
