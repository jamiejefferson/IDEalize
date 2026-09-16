/**
 * Package-owned invariant companion for `@idealize/doc-policy`.
 * @module @idealize/doc-policy/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { DomainChanged } from '@deepseek-ai/dsh-storage-domain'
import { RULESET_VERSION } from './policy/ruleset.ts'

const PACKAGE_NAME = '@idealize/doc-policy'

/** Cordis companion plugin name. */
export const name = 'idealize-doc-policy-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * DOC-07 as a runtime relation: every scan record this package writes to the
 * `idealize_docs` domain carries the packaged policy version — a build can
 * only ever stamp the ruleset it ships.
 */
const install: InvariantInstaller = (ctx: Context, fail: InvariantFailure) => {
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'domain/changed') return
    const change = (args as [DomainChanged])[0]
    if (change.domain !== 'idealize_docs' || change.table !== 'scans' || change.operation !== 'put') return
    const record = change.value as { policyVersion?: unknown }
    if (record.policyVersion !== RULESET_VERSION.id) {
      fail(`idealize_docs scan record must carry the packaged policy version ${RULESET_VERSION.id}`)
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
