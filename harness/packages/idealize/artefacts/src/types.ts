/**
 * Shared type vocabulary of the IDEalize artefact engine: the `ArtefactId`
 * brand, the durable artefact record (schema version 1), and the
 * `artefact/created` / `artefact/failed` session-event payloads. Types only —
 * the `ArtefactId` factory lives in `index.ts` (this file carries no runtime
 * code), so the Client half can import it without loading Host services.
 * @module @idealize/artefacts/src/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { JsonValue, SessionId } from '@deepseek-ai/dsh-session/types'
import type { CallId } from '@deepseek-ai/dsh-llm/brand'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'

/**
 * Identifies one artefact record. A generated uuid shared across modes
 * (MOD-06): a Gallery artefact stays addressable from Regular Chat by this id.
 */
export type ArtefactId = Branded<'ArtefactId'>

/** The record format this build writes; readers reject other values at the durable boundary. */
export const ARTEFACT_SCHEMA_VERSION = 1

/**
 * Where one artefact's bytes live: a file under the owning project root at
 * `<projectRoot>/<relPath>`, with `relPath` using `/` separators
 * (`Images/<yyyy-mm-dd>_<id8>.<ext>` under the default folders; an archived
 * file sits in its folder's `Archive/`). `bytes` and `sha256` describe the
 * complete written content, so consumers can detect truncation or drift.
 */
export interface ArtefactStorage {
  readonly kind: 'file'
  readonly relPath: string
  readonly bytes: number
  readonly sha256: string
}

/** The task call that produced one artefact, for provenance and transcript correlation. */
export interface ArtefactSourceTask {
  readonly sessionId: SessionId
  /** The session turn the producing call ran in. */
  readonly turnSeq: number
  readonly callId: CallId
  readonly toolName: string
}

/** Who and what generated the artefact, and which workspace owns its bytes. */
export interface ArtefactProvenance {
  readonly provider: string
  readonly model: string
  /** ISO-8601 creation instant, stamped by the store at create. */
  readonly createdAt: string
  readonly workspaceId: WorkspaceId
}

/** The user's verdict on one artefact: kept (the default, unrecorded) or archived into the folder's `Archive/`. */
export type ArtefactDisposition = 'kept' | 'archived'

/**
 * One durable artefact record: the shared contract every mode reads
 * (spec §7.2). `settings` is the generation-settings JSON exactly as the
 * producing task supplied it.
 */
export interface ArtefactRecord {
  readonly schemaVersion: typeof ARTEFACT_SCHEMA_VERSION
  readonly id: ArtefactId
  readonly mediaType: string
  readonly storage: ArtefactStorage
  readonly sourceTask: ArtefactSourceTask
  readonly settings: JsonValue
  readonly provenance: ArtefactProvenance
  /** Present only while archived; a kept record carries no field (the durable schema reads it optional). */
  readonly disposition?: 'archived' | undefined
}

/** Payload of `artefact/created`: the whole committed record. */
export interface ArtefactCreatedData {
  readonly record: ArtefactRecord
}

/**
 * Payload of `artefact/disposition`: the verdict, the path the bytes now sit
 * at, and the producing call (the Gallery keys its rows by it).
 */
export interface ArtefactDispositionData {
  readonly artefactId: ArtefactId
  readonly disposition: ArtefactDisposition
  /** The record's project-relative path after the move. */
  readonly relPath: string
  readonly sourceTask: ArtefactSourceTask
}

/** Payload of `artefact/failed`: the identity that failed and the provider-reported cause. */
export interface ArtefactFailedData {
  readonly artefactId: ArtefactId
  readonly mediaType: string
  readonly workspaceId: WorkspaceId
  readonly sourceTask: ArtefactSourceTask
  readonly error: string
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Records one artefact committed to the artefact store: the whole durable
     * record (id, media type, storage location and hash, source task,
     * settings, provenance), appended after the record write succeeds. The
     * transcript renders each event as one artefact node. Informational and
     * whole-value: the store is the source of truth, so a reader that does
     * not know this type may skip it (the envelope marks it ignorable).
     */
    'artefact/created': ArtefactCreatedData
    /**
     * Records one artefact generation that failed after submission: the
     * reserved id, media type, workspace, source task, and the error message
     * (MOD-05 requires the provider cause to be visible). Informational; the
     * envelope marks it ignorable for readers without this vocabulary.
     */
    'artefact/failed': ArtefactFailedData
    /**
     * Records the user keeping or archiving one artefact after the store has
     * moved its file and updated its record: the id, the verdict and the new
     * project-relative path. Informational and ignorable like the other two;
     * the Gallery fold reads it to mark and move the tile.
     */
    'artefact/disposition': ArtefactDispositionData
  }
}
