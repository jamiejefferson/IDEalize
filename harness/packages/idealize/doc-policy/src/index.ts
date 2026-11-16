/**
 * @idealize/doc-policy — the canonical documentation policy as product
 * behaviour (`ctx.docPolicy`).
 *
 * The service initialises from the packaged, versioned ruleset (derived from
 * JJ's canonical repository — see `src/policy/ruleset.ts` and the README pin)
 * plus the configured documentation folder (settings section `idealize-docs`,
 * field `documentationFolder`). With a folder configured the plugin:
 *
 * - scaffolds the canonical structure additively (existing files kept);
 * - scans the folder against the canonical structure on init, on settings
 *   change, on demand (`ctx.docPolicy.scan()` — vault calls it after
 *   appending commit evidence), and throttled on `session/flush`;
 * - records each scan's findings and applied `policyVersion` to the
 *   `idealize_docs` storage domain when the storage-domain form is composed;
 * - rebuilds an in-memory FTS5 index from every scan and serves it through
 *   the `docs_search` tool;
 * - contributes the standing `idealize:documentation` system-prompt section:
 *   where documentation goes, the folder's layout, and how to find a note,
 *   for every chat (it says so when no folder is set);
 * - stamps `generated` on a Markdown file an agent's file tool writes inside
 *   the folder (`src/stamp.ts`), and adds the user to `verified` on request
 *   (`ctx.docPolicy.markChecked`);
 * - injects a map of the matching project's
 *   notes (`src/session-context.ts`) as model-facing context on
 *   `agent/session-start`, or the way to create the project's note when the
 *   repository has none;
 * - serves `GET /idealize/docs/state` (loopback only): folder + scan state
 *   for the settings surface (DOC-08).
 *
 * @module @idealize/doc-policy
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
// Type-only: merges the agent lifecycle events (agent/session-start) into Events.
import type {} from '@deepseek-ai/dsh-agent'
// Type-only: the fs/observed event the generated stamp listens to, and ctx.fs.
import type {} from '@deepseek-ai/dsh-fs'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-host-webserver'
// Type-only: the prompt registry's Context merge (ctx.systemPrompt).
import type {} from '@deepseek-ai/dsh-system-prompt'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { RULESET_VERSION } from './policy/ruleset.ts'
import type { RulesetVersion } from './policy/ruleset.ts'
import { conventionsText, scaffoldVault } from './scaffold.ts'
import { fingerprintFolder, scanFolder } from './scan.ts'
import { DOCS_MATCH_MODES, DocsIndex } from './search.ts'
import type { DocsMatch, DocsSearchHit } from './search.ts'
import { noteForCwd, projectDocsFolder } from './notes-lookup.ts'
import type { ProjectDocsFolder } from './notes-lookup.ts'
import { DOCUMENTATION_SECTION_NAME, DOCUMENTATION_SECTION_ORDER, documentationGuidance, missingNoteNotice, terminalDocumentationGuidance } from './guidance.ts'
import { SCAN_HISTORY_CAP, docPolicyDomainSpec } from './spec.ts'
import { DEFAULT_STAMP_EXCLUDE, applyGeneratedStamp, markChecked } from './stamp.ts'
import type { MarkCheckedResult } from './stamp.ts'
import type { DocScanRecord } from './spec.ts'
import { conventionsExcerpt, projectNotice, terminalProjectMap } from './session-context.ts'

export {
  CANONICAL_DIRS,
  CANONICAL_ROOT_FILES,
  DECISION_FILE_RE,
  DECISION_HEADING_RE,
  ISO_DATE_RE,
  NOTE_OPTIONAL_FIELDS,
  PROJECT_INDEX_REQUIRED_FIELDS,
  PROJECT_INDEX_OPTIONAL_FIELDS,
  PROJECT_INDEX_TEMPLATE,
  CONVENTIONS_SOURCE,
  RULESET_VERSION,
  STALE_ACTIVE_DAYS,
  STATUS_VOCABULARY,
} from './policy/ruleset.ts'
export type { RulesetVersion } from './policy/ruleset.ts'
export { parseFrontmatter } from './frontmatter.ts'
export type { Frontmatter } from './frontmatter.ts'
export { classifyPath, validateDoc } from './classify.ts'
export type { DocKind, Finding } from './classify.ts'
export { INDEX_OVERSIZE_CHARS, fingerprintFolder, scanFolder } from './scan.ts'
export { addVerified, isActor, isStale, parseInstant, readTrust, stampGenerated, validateTrust } from './trust.ts'
export type { NoteTrust, TrustEvent } from './trust.ts'
export { DEFAULT_STAMP_EXCLUDE, USER_ACTOR, agentActor, applyGeneratedStamp, isStampExcluded, markChecked, mutatingAgent, pathWithin } from './stamp.ts'
export type { MarkCheckedResult, StampSource } from './stamp.ts'
export type { IndexedDoc, ScanResult } from './scan.ts'
export { DOCS_MATCH_MODES, DocsIndex } from './search.ts'
export type { DocsMatch, DocsSearchHit } from './search.ts'
export { agentsText, conventionsText, projectNoteFor, scaffoldVault } from './scaffold.ts'
export { gitToplevel, noteForCwd, noteForRepo, parseNotePointers, projectDocsFolder, projectNotes, repoPaths } from './notes-lookup.ts'
export type { CwdNote } from './notes-lookup.ts'
export { DOCUMENTATION_SECTION_NAME, DOCUMENTATION_SECTION_ORDER, documentationGuidance, missingNoteNotice, terminalDocumentationGuidance } from './guidance.ts'
export type { ProjectNote } from './notes-lookup.ts'
export {
  CONVENTIONS_LIMIT,
  NOTICE_CEILING,
  TERMINAL_MAP_LIMIT,
  conventionsExcerpt,
  describeNote,
  firstLines,
  noteDataBlock,
  projectMap,
  projectNotice,
  readNeighbours,
  splitIndex,
  terminalProjectMap,
} from './session-context.ts'
export { PROJECT_LOG_FILE } from './project-log.ts'
export type { IndexParts, IndexSection, NeighbourFolder, NeighbourNote, Neighbours, ProjectMapInput } from './session-context.ts'
export { SCAN_HISTORY_CAP, docPolicyDomainSpec, docScanRecordSchema } from './spec.ts'
export type { DocScanRecord } from './spec.ts'

export const name = 'idealize-doc-policy'

const NS = settingsNamespace('idealize-docs')

/** Plugin configuration: the one user-facing choice (DOC-08). */
export interface DocPolicyConfig {
  /** Absolute path of the user's documentation folder (their vault). */
  documentationFolder?: string
  /**
   * Folders inside the documentation folder whose notes never gain a
   * `generated` stamp. Each entry names a folder at any depth (`sessions/`,
   * `Projects/acme/drafts/`). Unset means {@link DEFAULT_STAMP_EXCLUDE}.
   */
  stampExclude?: string[]
}

export const Config: z<DocPolicyConfig> = z.object({
  documentationFolder: z.string(),
  stampExclude: z.array(z.string()).default([...DEFAULT_STAMP_EXCLUDE]),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    docPolicy: DocPolicy
  }
}

/** Folder + scan state as the settings surface reads it (DOC-08). */
export interface DocsState {
  /** Whether a documentation folder is configured. */
  configured: boolean
  /** The configured folder, when present. */
  folder?: string
  /** The packaged policy version this build applies. */
  policyVersion: string
  /** The most recent scan, when one has run. */
  lastScan?: DocScanRecord
}

/**
 * The canonical documentation service. Scans are serialized on one chain;
 * reads (`state`, `search`) are safe at any time.
 */
export class DocPolicy extends Service {
  private source: () => DocPolicyConfig
  private readonly index = new DocsIndex()
  private chain: Promise<unknown> = Promise.resolve()
  private scans: KvTable<string, DocScanRecord> | undefined
  private last: DocScanRecord | undefined
  private lastRecorded = false
  private scanCounter = 0
  /** Folder and fingerprint the last completed scan covered, and the instant a note in it next turns stale. */
  private lastScanned: { folder: string; fingerprint: string; nextStaleAt?: number } | undefined

  constructor(ctx: Context, config: DocPolicyConfig) {
    super(ctx, 'docPolicy')
    const entry = config
    this.source = () => entry
    installSettingsSection(ctx, NS, Config, entry, {
      setSource: (source) => {
        this.source = source
      },
      onChange: () => {
        void this.scanLogged()
      },
    })
    ctx.effect(() => () => {
      this.index.close()
    }, 'idealize-doc-policy: docs index')
    void this.scanLogged()
  }

  /**
   * The configured documentation folder, or `undefined` before setup.
   * @returns the absolute folder path, or `undefined` when unconfigured.
   */
  folder(): string | undefined {
    const path = this.source().documentationFolder
    return path === undefined || path === '' ? undefined : path
  }

  /**
   * The folders whose notes never gain a `generated` stamp.
   * @returns the `stampExclude` setting, or its default when unset.
   */
  stampExclude(): readonly string[] {
    return this.source().stampExclude ?? DEFAULT_STAMP_EXCLUDE
  }

  /**
   * Add the user to one note's `verified` list, dated now ("Mark as checked").
   * The caller confines the path to a folder the user chose; this method
   * writes only a Markdown file and changes only its `verified` field.
   * @param path - absolute path of the note.
   * @returns who and when was recorded, or why nothing was written.
   */
  markChecked(path: string): Promise<MarkCheckedResult> {
    return markChecked(path)
  }

  /**
   * The packaged ruleset version this build applies.
   * @returns the pinned ruleset version.
   */
  rulesetVersion(): RulesetVersion {
    return RULESET_VERSION
  }

  /**
   * The canonical conventions text (the DOC-05 authority).
   * @returns the ruleset's conventions text.
   */
  conventions(): string {
    return conventionsText()
  }

  /**
   * The documentation rule for a command-line agent the built-in terminal
   * launches in `cwd`. `@idealize/ui-terminal` probes for this method and
   * appends the text to the agent's prompt, because such an agent reads no
   * harness prompt and no session-start notice.
   * @param cwd - the shell's working directory.
   * @returns the guidance; when the folder holds the project's note, it names the note and ends with the project's map.
   */
  async terminalKnowledge(cwd: string): Promise<string> {
    const folder = this.folder()
    if (folder === undefined) return terminalDocumentationGuidance(undefined)
    const found = await noteForCwd(folder, cwd)
    if (found.notePath === undefined && found.repoToplevel === undefined) return terminalDocumentationGuidance(folder)
    const rule = terminalDocumentationGuidance(folder, { repoToplevel: found.repoToplevel ?? cwd, notePath: found.notePath })
    return found.notePath === undefined ? rule : `${rule}\n\n${await terminalProjectMap(found.notePath)}`
  }

  /**
   * The folder holding one project's documentation inside the configured
   * documentation folder: the folder of the note whose `repo:` names the
   * project, else `Projects/<project folder name>` when it exists.
   * @param projectPath - absolute path of the project's own folder.
   * @returns the folder and how it was found, or `undefined` with no documentation folder or no match.
   */
  async projectFolder(projectPath: string): Promise<ProjectDocsFolder | undefined> {
    const folder = this.folder()
    return folder === undefined ? undefined : projectDocsFolder(folder, projectPath)
  }

  /**
   * Scaffold and scan the configured folder, rebuild the retrieval index,
   * and record the scan to the storage domain when attached (DOC-04/06/07).
   * Serialized: concurrent calls run one at a time in order. A call that
   * finds the folder's {@link fingerprintFolder} unchanged since the last
   * scan returns that scan's record and neither re-reads, re-indexes nor
   * records: sessions flush every few seconds, and the index rebuild runs
   * synchronously on the Host thread.
   * @returns the scan record, or `undefined` when no folder is configured.
   */
  scan(): Promise<DocScanRecord | undefined> {
    return this.enqueue(async () => {
      const folder = this.folder()
      if (folder === undefined) {
        this.last = undefined
        this.lastScanned = undefined
        await this.index.replaceAll([])
        return undefined
      }
      const created = await scaffoldVault(folder)
      if (created.length > 0) {
        this.ctx.logger.info(`idealize-doc-policy: scaffolded ${created.join(', ')} in ${folder}`)
      }
      const fingerprint = await fingerprintFolder(folder)
      if (
        this.last !== undefined
        && this.lastScanned?.folder === folder
        && this.lastScanned.fingerprint === fingerprint
        // A note passing its `stale_after` changes the findings with no file changing.
        && (this.lastScanned.nextStaleAt === undefined || Date.now() < this.lastScanned.nextStaleAt)
      ) return this.last
      const result = await scanFolder(folder)
      await this.index.replaceAll(result.docs)
      const record: DocScanRecord = {
        at: result.at,
        policyVersion: result.policyVersion,
        docCount: result.docs.length,
        findings: result.findings,
      }
      this.last = record
      // The fingerprint predates the scan: an edit that lands during the scan
      // makes the next fingerprint differ, so that edit is scanned then.
      this.lastScanned = { folder, fingerprint, ...result.nextStaleAt === undefined ? {} : { nextStaleAt: result.nextStaleAt } }
      this.lastRecorded = false
      await this.record(record)
      return record
    })
  }

  /**
   * Search the indexed documentation.
   * @param query - caller text; never read as query syntax.
   * @param limit - maximum hits.
   * @param match - `phrase` for the words together in order, `all` for every word in any order, `any` for at least one word.
   * @returns best-first hits (empty when no folder is configured).
   */
  async search(query: string, limit: number, match: DocsMatch = 'phrase'): Promise<DocsSearchHit[]> {
    if (this.folder() === undefined) return []
    return this.index.search(query, limit, { match })
  }

  /**
   * Folder + scan state for the settings surface and the state route.
   * @returns the current configuration and last scan snapshot.
   */
  state(): DocsState {
    const folder = this.folder()
    return {
      configured: folder !== undefined,
      ...folder === undefined ? {} : { folder },
      policyVersion: RULESET_VERSION.id,
      ...this.last === undefined ? {} : { lastScan: this.last },
    }
  }

  /**
   * Attach the durable scan-history table; a scan that ran before attachment
   * is recorded now so a late-mounting storage form loses nothing.
   * @param table - the opened `scans` table.
   */
  attachScans(table: KvTable<string, DocScanRecord>): void {
    this.scans = table
    if (this.last !== undefined && !this.lastRecorded) {
      const pending = this.last
      this.record(pending).catch((error: unknown) => {
        this.ctx.logger.warn('idealize-doc-policy: recording scan history failed')
        this.ctx.logger.warn(error)
      })
    }
  }

  /** Detach the scan-history table ahead of its domain closing. */
  detachScans(): void {
    this.scans = undefined
  }

  private async record(record: DocScanRecord): Promise<void> {
    const table = this.scans
    if (table === undefined) return
    const key = `${record.at}#${String(this.scanCounter++).padStart(4, '0')}`
    await table.put(key, record)
    const keys = [...table.keys()].sort()
    for (const stale of keys.slice(0, Math.max(0, keys.length - SCAN_HISTORY_CAP))) {
      await table.delete(stale)
    }
    this.lastRecorded = true
  }

  private async scanLogged(): Promise<void> {
    try {
      await this.scan()
    } catch (error) {
      this.ctx.logger.warn('idealize-doc-policy: scan failed')
      this.ctx.logger.warn(error)
    }
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const next = this.chain.then(job, job)
    this.chain = next.catch(() => undefined)
    return next
  }
}

/**
 * One `docs_search` hit as the model reads it: the path, the labels the note
 * carries, its description, and the snippet.
 * @param hit - the hit.
 * @returns one line.
 */
export function renderHit(hit: DocsSearchHit): string {
  const labels = [
    hit.type === undefined ? undefined : `type: ${hit.type}`,
    hit.status === undefined ? undefined : `status: ${hit.status}`,
    hit.stale === true ? 'stale' : undefined,
  ].filter(label => label !== undefined)
  return `${hit.path}${labels.length === 0 ? '' : ` [${labels.join('; ')}]`} — `
    + `${hit.description === undefined ? '' : `${hit.description} — `}${hit.snippet}`
}

export function apply(ctx: Context, config: DocPolicyConfig): void {
  ctx.plugin(DocPolicy, config)

  // The `generated` stamp: a post-write listener on the file tools' fs/observed event.
  ctx.inject(['docPolicy', 'fs'], (stampCtx) => {
    applyGeneratedStamp(stampCtx, stampCtx.docPolicy)
  })

  // The docs_search Consumer: retrieval over the scanned folder (DOC-04).
  ctx.inject(['docPolicy', 'tools'], (toolCtx) => {
    toolCtx.tools.register(defineTool({
      name: 'docs_search',
      description:
        'Search the user\'s documentation folder (their project vault: project index notes, '
        + 'decisions, traps, reference material, people). Full-text match. By default the query '
        + 'is one literal phrase; set match to "all" to find notes that hold every word in any '
        + 'order, or "any" for at least one of the words. Returns matching documents with their vault path, '
        + 'kind, title, and a snippet, plus the note\'s type, status and one-line description when it '
        + 'carries them; read the file at the returned path for the full note. Notes marked deprecated '
        + 'or archived, and notes past their stale_after date, come last and are labelled: check them '
        + 'against the project before relying on them. '
        + 'Use it to recall project state, past decisions, and reference material before '
        + 'asking the user or re-deriving an answer.',
      parameters: {
        query: {
          type: 'string',
          required: true,
          description: 'Words to find. Quotes, operators and wildcards are searched for as text.',
        },
        match: {
          type: 'string',
          enum: [...DOCS_MATCH_MODES],
          description: 'phrase: the words together, in order (default). all: every word, in any order. any: at least one word.',
        },
        limit: {
          type: 'integer',
          description: 'Maximum documents to return (1-25). Defaults to 8.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            hits: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  path: { type: 'string', required: true, description: 'Vault-relative path of the document.' },
                  kind: { type: 'string', required: true, description: 'Canonical document kind.' },
                  title: { type: 'string', required: true },
                  snippet: { type: 'string', required: true, description: 'Excerpt around the first match.' },
                  type: { type: 'string', description: 'The note\'s frontmatter type, as its writer wrote it.' },
                  status: { type: 'string', description: 'The note\'s frontmatter status, as its writer wrote it.' },
                  description: { type: 'string', description: 'The note\'s one-sentence description.' },
                  stale: { type: 'boolean', description: 'True when the note is past its stale_after date.' },
                },
              },
            },
            note: { type: 'string', description: 'Present when there is nothing to search or no match.' },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: value.hits.length === 0
            ? value.note ?? 'No matching documentation.'
            : value.hits.map(renderHit).join('\n'),
        }],
      },
      async execute(args) {
        const service = toolCtx.docPolicy
        if (service.folder() === undefined) {
          return { hits: [], note: 'No documentation folder is configured yet.' }
        }
        const limit = Math.min(25, Math.max(1, args.limit ?? 8))
        const hits = await service.search(args.query, limit, args.match ?? 'phrase')
        return { hits, ...hits.length === 0 ? { note: 'No documents matched.' } : {} }
      },
      presentCall: args => ({ card: 'generic', title: 'Search documentation', kind: 'other', rawInput: args }),
    }))
  })

  // Durable scan history (DOC-04/07) when the storage-domain form is composed.
  ctx.inject(['docPolicy', 'storageDomain'], (domainCtx) => {
    domainCtx.effect(() => {
      let disposed = false
      let opened: Domain<typeof docPolicyDomainSpec> | undefined
      const opening = domainCtx.storageDomain.open(docPolicyDomainSpec).then((domain) => {
        if (disposed) return
        opened = domain
        domainCtx.docPolicy.attachScans(domain.table('scans'))
      }).catch((error: unknown) => {
        domainCtx.logger.warn('idealize-doc-policy: scan-history domain unavailable')
        domainCtx.logger.warn(error)
      })
      return async () => {
        disposed = true
        await opening
        domainCtx.docPolicy.detachScans()
        await opened?.close()
      }
    }, 'idealize-doc-policy: scans domain')
  })

  // Folder + scan state for the settings surface (DOC-08).
  ctx.inject(['docPolicy', 'webServer'], (webCtx) => {
    webCtx.effect(
      () => webCtx.webServer.register({
        kind: 'exact',
        path: '/idealize/docs/state',
        handler: (req: IncomingMessage, res: ServerResponse): void => {
          const host = (req.headers.host ?? '').replace(/:\d+$/, '')
          if (host !== '127.0.0.1' && host !== 'localhost' && host !== '[::1]') {
            res.writeHead(403, { 'content-type': 'text/plain' }).end('loopback only')
            return
          }
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(webCtx.docPolicy.state()))
        },
      }),
      'idealize-doc-policy: state endpoint',
    )
  })

  // The standing rule in every agent's prompt: where documentation goes and
  // how the folder is laid out. The text follows the folder setting in force.
  ctx.inject(['docPolicy', 'systemPrompt'], (promptCtx) => {
    promptCtx.effect(() => promptCtx.systemPrompt.section({
      name: DOCUMENTATION_SECTION_NAME,
      order: DOCUMENTATION_SECTION_ORDER,
      text: () => documentationGuidance(promptCtx.docPolicy.folder()),
    }), 'idealize-doc-policy: prompt section')
  })

  ctx.inject(['docPolicy'], (policyCtx) => {
    // The project's map as model-facing context; a repository with no note gets the conventions.
    policyCtx.on('agent/session-start', ({ agent }) => {
      const inject = async (): Promise<void> => {
        const service = policyCtx.docPolicy
        const folder = service.folder()
        const cwd = agent.session.header.cwd
        if (folder === undefined || cwd === undefined) return
        const found = await noteForCwd(folder, cwd)
        const note = found.notePath === undefined ? undefined : { path: found.notePath }
        // A repository with no note yet: say how to create one, or no chat
        // ever does and the project stays outside the folder for good. A chat
        // inside the documentation folder, or outside any repository, with no
        // note gets nothing: there is no repository to name.
        if (note === undefined && (found.inFolder || found.repoToplevel === undefined)) return
        const text = note === undefined
          ? `${missingNoteNotice(folder, found.repoToplevel ?? cwd)}\n\n---\n\n${conventionsExcerpt(service.conventions())}`
          : await projectNotice(note.path)
        agent.inject(createUserMessage({
          content: [{ type: 'text', text }],
          source: {
            kind: 'plugin',
            plugin: 'idealize-doc-policy',
            form: 'notice',
            summary: note === undefined ? 'Documentation folder has no note for this project' : 'Documentation context injected',
          },
        }))
      }
      inject().catch((error: unknown) => {
        policyCtx.logger.warn('idealize-doc-policy: context injection failed (session start unaffected)')
        policyCtx.logger.warn(error)
      })
    })

    // Refresh when managed documentation changes (DOC-06): sessions flush
    // repeatedly, so the rescan is throttled; vault additionally calls scan()
    // directly after appending commit evidence. One clock serves every
    // session: the scan walks the one documentation folder whoever flushed,
    // and a clock per session walked it once per open chat per window.
    let lastChecked: number | undefined
    // The flush is the durability barrier a turn's first step waits on; a
    // folder scan is bookkeeping, so it runs detached and is awaited at
    // disposal instead of holding the barrier.
    const inflight = new Set<Promise<void>>()
    policyCtx.on('session/flush', () => {
      if (policyCtx.docPolicy.folder() === undefined) return
      const now = Date.now()
      if (lastChecked !== undefined && now - lastChecked < 15_000) return
      lastChecked = now
      const work = policyCtx.docPolicy.scan()
        .then(() => undefined, (error: unknown) => {
          policyCtx.logger.warn('idealize-doc-policy: rescan on session flush failed')
          policyCtx.logger.warn(error)
        })
        .finally(() => { inflight.delete(work) })
      inflight.add(work)
    })
    policyCtx.effect(() => () => Promise.allSettled([...inflight]).then(() => undefined), 'idealize-doc-policy: settle detached rescans')
  })
}
