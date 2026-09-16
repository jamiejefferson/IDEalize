/**
 * @idealize/artefacts — the common artefact engine (spec MOD-03/MOD-06), the
 * complete capability seam in one package: the `ctx.artefacts` Service
 * Definition with its local file+domain provider, the loopback raw route, and
 * the `artefacts_get` tool Consumer.
 *
 * - Records live in the `idealize-artefacts` storage domain (schema version
 *   1); bytes live per project under a visible folder per kind
 *   (`<projectRoot>/Images/<yyyy-mm-dd>_<id8>.<ext>` by default; the folders
 *   are the `idealize-artefacts` settings section) with no automatic retention
 *   in V1. Each record keeps the path it was written with, so changing a
 *   folder moves nothing.
 * - `setDisposition()` keeps or archives one artefact: archiving moves the
 *   file into the kind folder's `Archive/` subfolder, keeping moves it back;
 *   the record's path follows, then `artefact/disposition` is appended to the
 *   producing session when it is live, so the Gallery fold follows it.
 * - `create()` streams bytes to the owning workspace, hashes them, commits
 *   the record, and only then appends `artefact/created` to the producing
 *   session (publish at the commit point); a failed write appends
 *   `artefact/failed` with the cause. Both events carry the envelope's
 *   `ignorable` marker: the store is the source of truth, so a build without
 *   this vocabulary may still read the log.
 * - `GET /idealize/artefacts/raw?id=` serves a record's bytes to the Web
 *   Client (same loopback fence as the other /idealize routes; the resolved
 *   path must realpath inside the workspace root).
 * - `POST /idealize/artefacts/disposition` `{id, disposition}` (loopback +
 *   `x-idealize-auth`) is the Gallery's Keep / Archive.
 * - `artefacts_get(id)` resolves a record into model-visible context so any
 *   mode can address another mode's artefact by id.
 *
 * @module @idealize/artefacts
 */

import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, realpath, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, join, posix, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-workspace'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-settings'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-session/types'
import type { CallId } from '@deepseek-ai/dsh-llm/brand'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { artefactDomainSpec } from './spec.ts'
import {
  ARTEFACT_FOLDER_DEFAULTS, ARTEFACT_SETTINGS_NAMESPACE, ArtefactFolderSettingsSchema, folderFor,
  type ArtefactFolderSettings,
} from './settings.ts'
import type { ArtefactDisposition, ArtefactId, ArtefactRecord } from './types.ts'
// Type-only: the prompt registry's Context merge (ctx.systemPrompt).
import type {} from '@deepseek-ai/dsh-system-prompt'

export type * from './types.ts'
export { artefactDomainSpec, artefactRecord } from './spec.ts'
export {
  ARTEFACT_FOLDER_DEFAULTS, ARTEFACT_SETTINGS_NAMESPACE, ArtefactFolderSettingsSchema, FOLDER_PATTERN, folderFor,
} from './settings.ts'
export type { ArtefactFolderSettings } from './settings.ts'

/**
 * Brand a string as an {@link ArtefactId}.
 * @param id - Raw artefact id string.
 * @returns the same string, branded at compile time.
 */
export function ArtefactId(id: string): ArtefactId {
  return id as ArtefactId
}

/** The loopback route serving artefact bytes to the Web Client. */
export const RAW_ROUTE = '/idealize/artefacts/raw'

/** The loopback route the Gallery's Keep / Archive posts to. */
export const DISPOSITION_ROUTE = '/idealize/artefacts/disposition'

/** The settings namespace as the settings service keys it. */
const SETTINGS_NS = settingsNamespace(ARTEFACT_SETTINGS_NAMESPACE)

/** Media types must be `type/subtype`; the value flows into an HTTP content-type header. */
const MEDIA_TYPE_PATTERN = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i

/** File extensions for the media types V1 generates; everything else stores as `.bin`. */
const EXTENSION_BY_MEDIA_TYPE: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/flac': 'flac',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
}

/** One artefact creation request; the store stamps id, timestamps, and storage facts. */
export interface ArtefactCreateRequest {
  /** The producing session; `artefact/created` / `artefact/failed` land in its log. */
  session: Session
  /** Canonical `type/subtype` media type of the bytes. */
  mediaType: string
  /** The generated bytes, whole or streamed. */
  bytes: Uint8Array | AsyncIterable<Uint8Array>
  /** Generation settings exactly as the task ran them. */
  settings: JsonValue
  /** Producing call coordinates; the session id is derived from `session`. */
  sourceTask: { turnSeq: number; callId: CallId; toolName: string }
  /** Generation provenance; `workspaceId` names the project that owns the bytes. */
  provenance: { provider: string; model: string; workspaceId: WorkspaceId }
}

/** An optional record filter for {@link ArtefactStore.list}. */
export interface ArtefactListFilter {
  workspaceId?: WorkspaceId
  mediaType?: string
}

/** `<yyyy-mm-dd>` file-name prefix for one creation instant (local date), so Finder sorts a folder by day. */
function daySegment(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${String(date.getFullYear())}-${month}-${day}`
}

/** Stream `bytes` into `path` (refusing to overwrite), hashing and counting as it writes. */
async function writeHashed(
  path: string,
  bytes: Uint8Array | AsyncIterable<Uint8Array>,
): Promise<{ bytes: number; sha256: string }> {
  const hash = createHash('sha256')
  let total = 0
  async function* chunks(): AsyncGenerator<Uint8Array> {
    if (bytes instanceof Uint8Array) yield bytes
    else yield* bytes
  }
  async function* counted(): AsyncGenerator<Uint8Array> {
    for await (const chunk of chunks()) {
      hash.update(chunk)
      total += chunk.byteLength
      yield chunk
    }
  }
  await pipeline(counted(), createWriteStream(path, { flags: 'wx' }))
  return { bytes: total, sha256: hash.digest('hex') }
}

/** Refuse a request whose Host header is not loopback (same fence as the other /idealize routes). */
function refuseNonLoopback(req: IncomingMessage, res: ServerResponse): boolean {
  const hostname = (req.headers.host ?? '').replace(/:\d+$/, '')
  if (hostname !== '127.0.0.1' && hostname !== 'localhost' && hostname !== '[::1]') {
    res.writeHead(403, { 'content-type': 'text/plain' }).end('loopback only')
    return true
  }
  return false
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

/** Parse one disposition request; the wire is where the fields are checked. */
function parseDisposition(body: unknown): { ok: true; id: ArtefactId; disposition: ArtefactDisposition } | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false, error: 'body must be a JSON object' }
  const { id, disposition } = body as Record<string, unknown>
  if (typeof id !== 'string' || id === '') return { ok: false, error: 'id is required' }
  if (disposition !== 'kept' && disposition !== 'archived') return { ok: false, error: 'disposition must be "kept" or "archived"' }
  return { ok: true, id: ArtefactId(id), disposition }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    artefacts: ArtefactStore
  }
}

/** The prompt variable naming the folders in force; interpolated into {@link FOLDERS_SECTION}. */
export const FOLDERS_VARIABLE = 'idealize_artefact_folders'

/**
 * The standing guidance every agent's prompt carries about the project's
 * generated files (order 121, the tool-guidance band, after the `idealize`
 * command section). The folder names come from the settings in force.
 */
export const FOLDERS_SECTION = {
  name: 'idealize:artefacts',
  order: 121,
  text: `Files generated in this project are saved under its root: {{${FOLDERS_VARIABLE}}}. `
    + 'Each is named <yyyy-mm-dd>_<id8>.<ext>, newest last by name, and an archived file moves into that folder\'s Archive subfolder. '
    + 'Another chat\'s images, sounds and video are there too: list the folder or call artefacts_get with the id rather than searching transcripts.',
} as const

/**
 * The folder settings as one prompt phrase.
 * @param folders - the settings in force.
 * @returns `images in Images/, sounds in Sounds/, video in Video/, anything else in Artefacts/`, with the archive subfolder named.
 */
export function describeFolders(folders: ArtefactFolderSettings): string {
  return `images in ${folders.images}/, sounds in ${folders.sounds}/, video in ${folders.video}/, anything else in ${folders.other}/ (archived files under each folder's ${folders.archive}/)`
}

/**
 * The artefact engine service (`ctx.artefacts`): durable records over the
 * storage domain, per-project byte storage, session-event publication, the
 * raw route, and the `artefacts_get` tool.
 */
export class ArtefactStore extends Service {
  static inject = ['storageDomain', 'workspaceRegistry']

  private table?: KvTable<ArtefactId, ArtefactRecord>

  /**
   * @param ctx - Cordis context; the service registers as `artefacts`.
   */
  constructor(ctx: Context) {
    super(ctx, 'artefacts')
  }

  /** Open the artefact domain, then mount the settings section, the routes and the tool when their services exist. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(artefactDomainSpec)
    this.ctx.effect(() => () => domain.close(), 'idealize-artefacts.domainClose')
    this.table = domain.table('artefacts')

    this.ctx.inject(['settings'], (settingsCtx) => {
      settingsCtx.settings.register(SETTINGS_NS, ArtefactFolderSettingsSchema)
    })

    this.ctx.inject(['webServer'], (webCtx) => {
      webCtx.effect(
        () => webCtx.webServer.register({
          kind: 'exact',
          path: RAW_ROUTE,
          handler: async (req, res) => {
            try {
              await this.serveRaw(req, res)
            } catch (error) {
              sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
            }
          },
        }),
        `idealize-artefacts: ${RAW_ROUTE}`,
      )
      webCtx.effect(
        () => webCtx.webServer.register({
          kind: 'exact',
          path: DISPOSITION_ROUTE,
          handler: async (req, res) => {
            try {
              await this.serveDisposition(req, res)
            } catch (error) {
              sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
            }
          },
        }),
        `idealize-artefacts: ${DISPOSITION_ROUTE}`,
      )
    })

    this.ctx.inject(['tools'], (toolCtx) => {
      toolCtx.effect(() => toolCtx.tools.register(createArtefactsGetTool(this)), 'idealize-artefacts: artefacts_get')
    })

    // Every agent is told where the project's generated files live, from the
    // folder settings in force at each assembly: an agent asked about a file
    // another chat made had searched transcripts for it (JJ, 8 Sep 2026).
    this.ctx.inject(['systemPrompt'], (promptCtx) => {
      promptCtx.effect(() => promptCtx.systemPrompt.section(FOLDERS_SECTION), 'idealize-artefacts: prompt section')
      promptCtx.effect(() => promptCtx.systemPrompt.variable(FOLDERS_VARIABLE, () => describeFolders(this.folders())), `idealize-artefacts: {{${FOLDERS_VARIABLE}}}`)
    })
  }

  private requireTable(): KvTable<ArtefactId, ArtefactRecord> {
    if (this.table === undefined) throw new Error('artefact store is not initialized')
    return this.table
  }

  /**
   * The folder settings in force: the registered section, or the schema
   * defaults without a settings provider.
   * @returns the resolved folders.
   */
  folders(): ArtefactFolderSettings {
    const settings = this.ctx.get('settings')
    if (settings === undefined) return ARTEFACT_FOLDER_DEFAULTS
    return { ...ARTEFACT_FOLDER_DEFAULTS, ...settings.get(SETTINGS_NS) as Partial<ArtefactFolderSettings> | undefined }
  }

  /**
   * Create one artefact: stream the bytes into the owning project, hash them,
   * commit the durable record, then append `artefact/created` to the
   * producing session. A failure after acceptance appends `artefact/failed`
   * with the cause, removes any partial file, and rethrows.
   * @param request - the artefact content, source task, and provenance.
   * @returns the committed record.
   */
  async create(request: ArtefactCreateRequest): Promise<ArtefactRecord> {
    const table = this.requireTable()
    const workspace = this.ctx.workspaceRegistry.get(request.provenance.workspaceId)
    if (workspace === undefined) {
      throw new Error(`cannot store artefact: unknown workspace '${request.provenance.workspaceId}'`)
    }
    if (!MEDIA_TYPE_PATTERN.test(request.mediaType)) {
      throw new Error(`cannot store artefact: invalid media type '${request.mediaType}'`)
    }
    const id = ArtefactId(randomUUID())
    const createdAt = new Date()
    const extension = EXTENSION_BY_MEDIA_TYPE[request.mediaType.toLowerCase()] ?? 'bin'
    // Date first so the folder sorts by day in a file browser; eight id
    // characters keep two same-day files apart while the name stays readable.
    const relPath = `${folderFor(this.folders(), request.mediaType)}/${daySegment(createdAt)}_${id.slice(0, 8)}.${extension}`
    const absolute = join(workspace.path, relPath)
    const sourceTask = { sessionId: request.session.header.id, ...request.sourceTask }
    try {
      await mkdir(dirname(absolute), { recursive: true })
      const written = await writeHashed(absolute, request.bytes)
      const record: ArtefactRecord = {
        schemaVersion: 1,
        id,
        mediaType: request.mediaType,
        storage: { kind: 'file', relPath, bytes: written.bytes, sha256: written.sha256 },
        sourceTask,
        settings: request.settings,
        provenance: { ...request.provenance, createdAt: createdAt.toISOString() },
      }
      await table.put(id, record)
      request.session.append('artefact/created', { record }, { ignorable: true })
      return record
    } catch (error) {
      try {
        await rm(absolute, { force: true })
        request.session.append('artefact/failed', {
          artefactId: id,
          mediaType: request.mediaType,
          workspaceId: request.provenance.workspaceId,
          sourceTask,
          error: error instanceof Error ? error.message : String(error),
        }, { ignorable: true })
      } catch {
        // Swallows cleanup/log-append failures (disposed session, read-only
        // disk) so the original creation error stays the reported cause.
      }
      throw error
    }
  }

  /**
   * Look up one artefact record.
   * @param id - Artefact id.
   * @returns the record, or `undefined` when unknown.
   */
  get(id: ArtefactId): ArtefactRecord | undefined {
    return this.requireTable().get(id)
  }

  /**
   * List records, newest creation first.
   * @param filter - optional workspace and media-type constraints; a
   * `mediaType` of `image` matches every `image/*` subtype, a full
   * `type/subtype` matches exactly.
   * @returns the matching records.
   */
  list(filter: ArtefactListFilter = {}): ArtefactRecord[] {
    const records: ArtefactRecord[] = []
    for (const [, record] of this.requireTable().entries()) {
      if (filter.workspaceId !== undefined && record.provenance.workspaceId !== filter.workspaceId) continue
      if (filter.mediaType !== undefined
        && record.mediaType !== filter.mediaType
        && !record.mediaType.startsWith(`${filter.mediaType}/`)) continue
      records.push(record)
    }
    return records.sort((a, b) => b.provenance.createdAt.localeCompare(a.provenance.createdAt))
  }

  /**
   * Keep or archive one artefact. Archiving moves the file into the `archive`
   * subfolder beside it; keeping moves it back up one folder. The record's
   * path follows the file, then `artefact/disposition` is appended to the
   * producing session when it is live (an archived chat's record still
   * updates; its log catches up with nothing, because the store is the
   * source of truth). Asking for the disposition a record already has moves
   * nothing and appends nothing.
   * @param id - the artefact.
   * @param disposition - `kept` or `archived`.
   * @returns the updated record.
   * @throws when the id is unknown, its workspace is gone, or the move fails.
   */
  async setDisposition(id: ArtefactId, disposition: ArtefactDisposition): Promise<ArtefactRecord> {
    const table = this.requireTable()
    const record = this.get(id)
    if (record === undefined) throw new Error(`unknown artefact '${id}'`)
    const current: ArtefactDisposition = record.disposition ?? 'kept'
    if (current === disposition) return record
    const workspace = this.ctx.workspaceRegistry.get(record.provenance.workspaceId)
    if (workspace === undefined) {
      throw new Error(`artefact '${id}' references unknown workspace '${record.provenance.workspaceId}'`)
    }
    const from = record.storage.relPath
    const parent = posix.dirname(from)
    const relPath = disposition === 'archived'
      ? posix.join(parent, this.folders().archive, basename(from))
      : posix.join(posix.dirname(parent), basename(from))
    const target = join(workspace.path, relPath)
    await mkdir(dirname(target), { recursive: true })
    await rename(join(workspace.path, from), target)
    const { disposition: _dropped, ...rest } = record
    const next: ArtefactRecord = {
      ...rest,
      storage: { ...record.storage, relPath },
      ...disposition === 'archived' ? { disposition } : {},
    }
    await table.put(id, next)
    const session = this.ctx.get('sessions')?.get(record.sourceTask.sessionId)
    session?.append('artefact/disposition', {
      artefactId: id, disposition, relPath, sourceTask: record.sourceTask,
    }, { ignorable: true })
    return next
  }

  /**
   * Resolve one artefact to its servable absolute path.
   * @param id - Artefact id.
   * @returns the absolute path under the owning workspace root.
   * @throws when the id is unknown or its workspace is no longer registered.
   */
  resolve(id: ArtefactId): string {
    const record = this.get(id)
    if (record === undefined) throw new Error(`unknown artefact '${id}'`)
    const workspace = this.ctx.workspaceRegistry.get(record.provenance.workspaceId)
    if (workspace === undefined) {
      throw new Error(`artefact '${id}' references unknown workspace '${record.provenance.workspaceId}'`)
    }
    return join(workspace.path, record.storage.relPath)
  }

  /** Serve one record's bytes: loopback only, record required, path fenced to the artefact dir. */
  private async serveRaw(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (refuseNonLoopback(req, res)) return
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const raw = url.searchParams.get('id')
    if (raw === null || raw === '') {
      sendJson(res, 400, { error: 'missing id' })
      return
    }
    const record = this.get(ArtefactId(raw))
    if (record === undefined) {
      sendJson(res, 404, { error: 'unknown artefact' })
      return
    }
    const workspace = this.ctx.workspaceRegistry.get(record.provenance.workspaceId)
    if (workspace === undefined) {
      sendJson(res, 404, { error: 'artefact workspace is no longer registered' })
      return
    }
    // The fence (ui-bar's fencedPath pattern): the record's resolved path must
    // realpath inside the project root, so a crafted or stale record cannot
    // read outside it through symlinks or dot segments.
    let resolved: string
    let fenceRoot: string
    try {
      resolved = await realpath(join(workspace.path, record.storage.relPath))
      fenceRoot = await realpath(workspace.path)
    } catch {
      // realpath fails when the file or the project is gone: report the
      // artefact missing rather than a server fault.
      sendJson(res, 404, { error: 'artefact bytes are missing' })
      return
    }
    if (resolved === fenceRoot || !resolved.startsWith(fenceRoot + sep)) {
      sendJson(res, 403, { error: 'artefact path escapes the project' })
      return
    }
    const info = await stat(resolved)
    if (!info.isFile()) {
      sendJson(res, 404, { error: 'artefact bytes are missing' })
      return
    }
    res.writeHead(200, {
      'content-type': record.mediaType,
      'content-length': info.size,
      // Bytes are immutable per id, but the store is local and small: keep
      // responses uncacheable so a re-created project never serves stale bytes.
      'cache-control': 'no-store',
    })
    await pipeline(createReadStream(resolved), res)
  }

  /** Keep or archive: loopback + the mutating-request header, a JSON body naming the record and the disposition. */
  private async serveDisposition(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'content-type': 'text/plain', allow: 'POST' }).end('POST only')
      return
    }
    if (refuseNonLoopback(req, res)) return
    if (req.headers['x-idealize-auth'] !== '1') {
      res.writeHead(403, { 'content-type': 'text/plain' }).end('missing x-idealize-auth header')
      return
    }
    let body: unknown
    try {
      body = JSON.parse(await readBody(req))
    } catch {
      sendJson(res, 400, { error: 'body is not JSON' })
      return
    }
    const parsed = parseDisposition(body)
    if (!parsed.ok) {
      sendJson(res, 400, { error: parsed.error })
      return
    }
    if (this.get(parsed.id) === undefined) {
      sendJson(res, 404, { error: 'unknown artefact' })
      return
    }
    const record = await this.setDisposition(parsed.id, parsed.disposition)
    sendJson(res, 200, { ok: true, record })
  }
}

/**
 * Build the `artefacts_get` tool: resolves an artefact id into model-visible
 * facts (media type, size, hash, settings, provenance, absolute path).
 * @param store - the artefact store the tool reads.
 * @returns the registry-ready tool definition.
 */
export function createArtefactsGetTool(store: ArtefactStore): ToolDefinition {
  return defineTool({
    name: 'artefacts_get',
    description: 'Look up a generated artefact by id. Returns its media type, byte size, sha256, '
      + 'generation settings, provenance, and the absolute file path holding the bytes. Artefact '
      + 'ids come from artefact/created events and stay valid across chats and modes.',
    parameters: {
      id: { type: 'string', required: true, description: 'The artefact id to resolve.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          mediaType: { type: 'string', required: true },
          path: { type: 'string', required: true, description: 'Absolute file path of the bytes.' },
          bytes: { type: 'integer', required: true },
          sha256: { type: 'string', required: true },
          settings: { type: 'json', required: true },
          provider: { type: 'string', required: true },
          model: { type: 'string', required: true },
          createdAt: { type: 'string', required: true },
          workspaceId: { type: 'string', required: true },
          sessionId: { type: 'string', required: true },
          turnSeq: { type: 'integer', required: true },
          callId: { type: 'string', required: true },
          toolName: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `${value.mediaType} artefact ${value.id} (${String(value.bytes)} bytes, `
          + `${value.provider}/${value.model}) at ${value.path}`,
      }],
    },
    presentCall: args => ({ card: 'generic', title: `artefact ${args.id}`, kind: 'read' }),
    execute(args) {
      const record = store.get(ArtefactId(args.id))
      if (record === undefined) throw new Error(`unknown artefact '${args.id}'`)
      const path = store.resolve(record.id)
      return Promise.resolve({
        id: String(record.id),
        mediaType: record.mediaType,
        path,
        bytes: record.storage.bytes,
        sha256: record.storage.sha256,
        settings: record.settings,
        provider: record.provenance.provider,
        model: record.provenance.model,
        createdAt: record.provenance.createdAt,
        workspaceId: String(record.provenance.workspaceId),
        sessionId: String(record.sourceTask.sessionId),
        turnSeq: record.sourceTask.turnSeq,
        callId: String(record.sourceTask.callId),
        toolName: record.sourceTask.toolName,
      })
    },
  })
}

export default ArtefactStore
