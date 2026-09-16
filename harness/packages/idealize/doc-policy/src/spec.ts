/**
 * Durable storage-domain declaration for scan history (DOC-04/07): each scan
 * or maintenance job records its findings and the policy-package version it
 * applied.
 * @module @idealize/doc-policy/src/spec
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

/** Runtime schema of one recorded finding. */
export const docFindingSchema = z.object({
  path: z.string(),
  rule: z.string(),
  severity: z.union([z.literal('error'), z.literal('warning')]),
  message: z.string(),
})

/** Runtime schema of one recorded scan. */
export const docScanRecordSchema = z.object({
  /** Scan time (ISO). */
  at: z.string(),
  /** The policy-package version the scan applied (DOC-07). */
  policyVersion: z.string(),
  /** Documents indexed by the scan. */
  docCount: z.number().int().nonnegative(),
  /** Every finding the scan raised. */
  findings: z.array(docFindingSchema),
})

/** One recorded scan, inferred from its durable schema. */
export type DocScanRecord = z.infer<typeof docScanRecordSchema>

/** Recorded scans kept before the oldest are pruned. */
export const SCAN_HISTORY_CAP = 20

/** Scan-history domain: one record per scan, keyed by scan time + nonce. */
export const docPolicyDomainSpec = defineDomain({
  name: 'idealize_docs',
  version: 0,
  tables: {
    scans: domainTable<string, DocScanRecord>(docScanRecordSchema),
  },
})
