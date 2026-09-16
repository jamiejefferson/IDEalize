/**
 * The durable boundary: what the artefact record schema accepts, and what a
 * record another build wrote fails on.
 */

import { describe, expect, it } from 'vitest'
import { artefactRecord } from '../src/spec.ts'

const record = {
  schemaVersion: 1,
  id: 'a-1',
  mediaType: 'image/png',
  storage: { kind: 'file', relPath: 'artefacts/a-1.png', bytes: 2048, sha256: 'abc' },
  sourceTask: { sessionId: 's-1', turnSeq: 3, callId: 'call-1', toolName: 'generate_image' },
  settings: { prompt: 'an owl' },
  provenance: { provider: 'fal', model: 'flux', createdAt: '2026-09-10T09:00:00.000Z', workspaceId: 'ws-1' },
}

describe('the artefact record schema', () => {
  it('validates a whole record and carries every branded id through', () => {
    expect(artefactRecord.parse(record)).toEqual(record)
    expect(artefactRecord.parse({ ...record, disposition: 'archived' }).disposition).toBe('archived')
  })

  it('refuses a record another build wrote', () => {
    expect(() => artefactRecord.parse({ ...record, schemaVersion: 2 })).toThrow()
    expect(() => artefactRecord.parse({ ...record, storage: { ...record.storage, bytes: -1 } })).toThrow()
    expect(() => artefactRecord.parse({ ...record, disposition: 'kept' })).toThrow()
  })
})
