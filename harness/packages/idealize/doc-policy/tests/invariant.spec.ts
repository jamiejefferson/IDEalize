/**
 * The package's invariant companion (DOC-07 as a runtime relation): every
 * scan record written to the `idealize_docs` domain carries the packaged
 * policy version. This suite owns its service topology (the file name opts
 * out of the global invariant host), so the reporter records instead of
 * throwing.
 */

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import * as DocPolicyInvariant from '../src/invariant.ts'
import { RULESET_VERSION } from '../src/policy/ruleset.ts'

const contexts: Context[] = []

/**
 * Dispatch one event the way the runtime does. `internal/dispatch` is cordis's
 * own channel and carries no public payload type, so the emit is widened here
 * rather than at every call.
 * @param ctx - the root the companion is mounted on.
 * @param event - the event name the dispatch carries.
 * @param payload - that event's arguments.
 */
function dispatch(ctx: Context, event: string, payload: unknown[]): void {
  ;(ctx.emit as (...args: unknown[]) => unknown)('internal/dispatch', 'emit', event, payload)
}

afterEach(async () => {
  for (const context of contexts.splice(0)) await context.fiber.dispose()
})

/** The registered installer, run against a reporter that records. */
async function installed() {
  const ctx = new Context()
  contexts.push(ctx)
  let installer: ((child: Context, fail: (message: string) => never) => void) | undefined
  ctx.provide('invariants', {
    register(_name: string, install: (child: Context, fail: (message: string) => never) => void) {
      installer = install
      return () => {}
    },
  })
  await ctx.plugin(DocPolicyInvariant)
  await ctx.fiber.await()
  const reported: string[] = []
  installer?.(ctx, ((message: string) => { reported.push(message) }) as (message: string) => never)
  const change = (patch: Record<string, unknown>) => {
    dispatch(ctx, 'domain/changed', [{
      domain: 'idealize_docs',
      table: 'scans',
      operation: 'put',
      value: { policyVersion: RULESET_VERSION.id },
      ...patch,
    }] as never)
  }
  return { ctx, reported, change }
}

describe('the doc-policy invariant companion', () => {
  it('says nothing about a scan record stamped with the packaged ruleset', async () => {
    const { reported, change } = await installed()
    change({})
    expect(reported).toEqual([])
  })

  it('watches its own domain, table and operation alone', async () => {
    const { ctx, reported, change } = await installed()
    change({ domain: 'idealize_artefacts', value: { policyVersion: 'stale' } })
    change({ table: 'notes', value: { policyVersion: 'stale' } })
    change({ operation: 'delete', value: { policyVersion: 'stale' } })
    // Any other dispatched event is somebody else's business.
    dispatch(ctx, 'session/event', [{}])
    expect(reported).toEqual([])
  })

  it('names a scan record carrying a ruleset this build does not ship', async () => {
    const { reported, change } = await installed()
    change({ value: { policyVersion: 'doc-policy-1999-01-01' } })
    expect(reported).toEqual([`idealize_docs scan record must carry the packaged policy version ${RULESET_VERSION.id}`])
  })
})
