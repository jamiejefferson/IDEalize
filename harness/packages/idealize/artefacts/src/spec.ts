/**
 * The artefact domain declaration: the zod record schema validating the
 * durable boundary and the `defineDomain` spec the store opens through
 * `ctx.storageDomain` (pattern: `dsh-workspace`'s `src/spec.ts`).
 * @module @idealize/artefacts/src/spec
 */

import { z } from 'zod'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { ArtefactId, ArtefactRecord } from './types.ts'

/** Artefact id schema at the durable boundary; branding has no runtime representation. */
const artefactId = z.string().transform(value => value as ArtefactId)

/**
 * Durable shape of one artefact record. Field semantics live on
 * {@link ArtefactRecord}; this schema is the read-side validator, so a record
 * another build wrote with a different `schemaVersion` fails loud at open.
 */
export const artefactRecord = z.object({
  schemaVersion: z.literal(1),
  id: artefactId,
  mediaType: z.string(),
  storage: z.object({
    kind: z.literal('file'),
    relPath: z.string(),
    bytes: z.number().int().nonnegative(),
    sha256: z.string(),
  }),
  sourceTask: z.object({
    sessionId: z.string().transform(SessionId),
    turnSeq: z.number().int().nonnegative(),
    callId: z.string().transform(value => value as ArtefactRecord['sourceTask']['callId']),
    toolName: z.string(),
  }),
  settings: z.json(),
  provenance: z.object({
    provider: z.string(),
    model: z.string(),
    createdAt: z.string(),
    workspaceId: z.string().transform(value => value as ArtefactRecord['provenance']['workspaceId']),
  }),
  disposition: z.literal('archived').optional(),
})

/**
 * The artefact domain spec: one `artefacts` table keyed by {@link ArtefactId}.
 * No global singleton — the table is the complete durable state.
 */
export const artefactDomainSpec = defineDomain({
  name: 'idealize_artefacts',
  version: 1,
  tables: { artefacts: domainTable<ArtefactId, ArtefactRecord>(artefactRecord) },
})
