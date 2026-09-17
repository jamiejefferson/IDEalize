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
 * - injects the canonical conventions and the matching project's `_index.md`
 *   as model-facing context on `agent/session-start`, or the way to create
 *   that note when the repository has none;
 * - serves `GET /idealize/docs/state` (loopback only): folder + scan state
 *   for the settings surface (DOC-08).
 *
 * @module @idealize/doc-policy
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
// Type-only: merges the agent lifecycle events (agent/session-start) into Events.
import type {} from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-host-webserver'
// Type-only: the prompt registry's Context merge (ctx.systemPrompt).
import type {} from '@deepseek-ai/dsh-system-prompt'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { RULESET_VERSION } from './policy/ruleset.ts'
import type { RulesetVersion } from './policy/ruleset.ts'
import { conventionsText, scaffoldVault } from './scaffold.ts'
import { scanFolder } from './scan.ts'
import { DocsIndex } from './search.ts'
import type { DocsSearchHit } from './search.ts'
import { gitToplevel, noteForRepo } from './notes-lookup.ts'
import { DOCUMENTATION_SECTION_NAME, DOCUMENTATION_SECTION_ORDER, documentationGuidance, missingNoteNotice, terminalDocumentationGuidance } from './guidance.ts'
import { SCAN_HISTORY_CAP, docPolicyDomainSpec } from './spec.ts'
import type { DocScanRecord } from './spec.ts'

export {
  CANONICAL_DIRS,
  CANONICAL_ROOT_FILES,
  DECISION_FILE_RE,
  DECISION_HEADING_RE,
  ISO_DATE_RE,
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
export { scanFolder } from './scan.ts'
export type { IndexedDoc, ScanResult } from './scan.ts'
export { DocsIndex } from './search.ts'
export type { DocsSearchHit } from './search.ts'
export { agentsText, conventionsText, projectNoteFor, scaffoldVault } from './scaffold.ts'
export { gitToplevel, noteForRepo, parseNotePointers, projectNotes, repoPaths } from './notes-lookup.ts'
export { DOCUMENTATION_SECTION_NAME, DOCUMENTATION_SECTION_ORDER, documentationGuidance, missingNoteNotice, terminalDocumentationGuidance } from './guidance.ts'
export type { ProjectNote } from './notes-lookup.ts'
export { SCAN_HISTORY_CAP, docPolicyDomainSpec, docScanRecordSchema } from './spec.ts'
export type { DocScanRecord } from './spec.ts'

export const name = 'idealize-doc-policy'

const NS = settingsNamespace('idealize-docs')

/** Plugin configuration: the one user-facing choice (DOC-08). */
export interface DocPolicyConfig {
  /** Absolute path of the user's documentation folder (their vault). */
  documentationFolder?: string
}

export const Config: z<DocPolicyConfig> = z.object({
  documentationFolder: z.string(),
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

/** Today's clip guard so a large vault file cannot flood the prompt. */
function clip(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}\n… (clipped)`
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
   * @returns the guidance, naming the project's note when the folder holds one.
   */
  async terminalKnowledge(cwd: string): Promise<string> {
    const folder = this.folder()
    if (folder === undefined) return terminalDocumentationGuidance(undefined)
    const repoToplevel = await gitToplevel(cwd)
    if (repoToplevel === undefined) return terminalDocumentationGuidance(folder)
    const note = await noteForRepo(folder, repoToplevel)
    return terminalDocumentationGuidance(folder, { repoToplevel, notePath: note?.path })
  }

  /**
   * Scaffold and scan the configured folder, rebuild the retrieval index,
   * and record the scan to the storage domain when attached (DOC-04/06/07).
   * Serialized: concurrent calls run one at a time in order.
   * @returns the scan record, or `undefined` when no folder is configured.
   */
  scan(): Promise<DocScanRecord | undefined> {
    return this.enqueue(async () => {
      const folder = this.folder()
      if (folder === undefined) {
        this.last = undefined
        await this.index.replaceAll([])
        return undefined
      }
      const created = await scaffoldVault(folder)
      if (created.length > 0) {
        this.ctx.logger.info(`idealize-doc-policy: scaffolded ${created.join(', ')} in ${folder}`)
      }
      const result = await scanFolder(folder)
      await this.index.replaceAll(result.docs)
      const record: DocScanRecord = {
        at: result.at,
        policyVersion: result.policyVersion,
        docCount: result.docs.length,
        findings: result.findings,
      }
      this.last = record
      this.lastRecorded = false
      await this.record(record)
      return record
    })
  }

  /**
   * Phrase-search the indexed documentation.
   * @param query - caller text, matched as one literal phrase.
   * @param limit - maximum hits.
   * @returns best-first hits (empty when no folder is configured).
   */
  async search(query: string, limit: number): Promise<DocsSearchHit[]> {
    if (this.folder() === undefined) return []
    return this.index.search(query, limit)
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

export function apply(ctx: Context, config: DocPolicyConfig): void {
  ctx.plugin(DocPolicy, config)

  // The docs_search Consumer: retrieval over the scanned folder (DOC-04).
  ctx.inject(['docPolicy', 'tools'], (toolCtx) => {
    toolCtx.tools.register(defineTool({
      name: 'docs_search',
      description:
        'Search the user\'s documentation folder (their project vault: project index notes, '
        + 'decisions, traps, reference material, people). Full-text match — the query is '
        + 'treated as one literal phrase. Returns matching documents with their vault path, '
        + 'kind, title, and a snippet; read the file at the returned path for the full note. '
        + 'Use it to recall project state, past decisions, and reference material before '
        + 'asking the user or re-deriving an answer.',
      parameters: {
        query: {
          type: 'string',
          required: true,
          description: 'Words to find, matched as one literal phrase.',
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
            : value.hits.map(hit => `${hit.path} — ${hit.snippet}`).join('\n'),
        }],
      },
      async execute(args) {
        const service = toolCtx.docPolicy
        if (service.folder() === undefined) {
          return { hits: [], note: 'No documentation folder is configured yet.' }
        }
        const limit = Math.min(25, Math.max(1, args.limit ?? 8))
        const hits = await service.search(args.query, limit)
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
    // Canonical conventions + the project note as model-facing context.
    policyCtx.on('agent/session-start', ({ agent }) => {
      const inject = async (): Promise<void> => {
        const service = policyCtx.docPolicy
        const folder = service.folder()
        const cwd = agent.session.header.cwd
        if (folder === undefined || cwd === undefined) return
        const toplevel = await gitToplevel(cwd)
        if (toplevel === undefined) return
        const note = await noteForRepo(folder, toplevel)
        // A repository with no note yet: say how to create one, or no chat
        // ever does and the project stays outside the folder for good.
        const text = note === undefined
          ? `${missingNoteNotice(folder, toplevel)}\n\n---\n\n${clip(service.conventions(), 2_000)}`
          : 'Documentation context for this project (the canonical conventions, then '
            + `the project's _index note at ${note.path} — update it as work lands):\n\n`
            + [clip(service.conventions(), 2_000), clip(await readFile(note.path, 'utf8'), 6_000)].join('\n\n---\n\n')
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
    // repeatedly, so the rescan is throttled per session; vault additionally
    // calls scan() directly after appending commit evidence.
    const lastChecked = new WeakMap<Session, number>()
    // The flush is the durability barrier a turn's first step waits on; a
    // folder scan is bookkeeping, so it runs detached and is awaited at
    // disposal instead of holding the barrier.
    const inflight = new Set<Promise<void>>()
    policyCtx.on('session/flush', (session) => {
      if (policyCtx.docPolicy.folder() === undefined) return
      const now = Date.now()
      const prior = lastChecked.get(session)
      if (prior !== undefined && now - prior < 15_000) return
      lastChecked.set(session, now)
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
