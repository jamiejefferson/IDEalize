/**
 * @idealize/setup — first-run setup, host half: the `idealize-setup` settings
 * section (component seeds + the two captured folders), the workspace-alias
 * seam (`ctx.workspaceAliases`), and the `/idealize/setup` routes.
 *
 * First-run captures exactly two folders (SET-02, JJ's revision of OQ-01):
 * the PROJECTS ROOT — the folder holding every project — and the
 * DOCUMENTATION folder (the vault). The current project is not asked as a
 * folder: it is created or selected UNDER the projects root through
 * `ctx.workspaceRegistry`. Orientation probes both folders (stat + read +
 * write) and explains failures in plain sentences (SET-04); on success it
 * stores the aliases, seeds `@idealize/doc-policy`'s `idealize-docs` section
 * and `@idealize/vault`'s `idealize-vault` section, and kicks the
 * documentation scan (SET-06).
 *
 * Routes (loopback-fenced; mutations demand the `x-idealize-auth` header):
 * - `GET  /idealize/setup/state` — component seeds + live-probed aliases.
 * - `POST /idealize/setup/orientation` — `{projectsFolder, documentationFolder,
 *   projectName?}`: probe, persist, seed, scan, and create the first project.
 * - `POST /idealize/setup/alias` — `{name, path}`: the later Reconnect flow's
 *   alias mutation; re-probes and re-seeds the dependent section.
 *
 * @module @idealize/setup
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-host-webserver'
// Type-only: the `workspaceRegistry` Context merge and the WorkspaceId brand.
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
// Type-only: the `docPolicy` Context merge (the scan the orientation kicks).
import type {} from '@idealize/doc-policy'
import { probeFolder } from './probe.ts'
import type { AliasAccessState } from './probe.ts'

export { probeFolder } from './probe.ts'
export type { AliasAccessState, FolderProbe } from './probe.ts'

/** Cordis plugin name. */
export const name = 'idealize-setup'

/** The settings namespace both halves share. */
export const SETUP_SETTINGS_NAMESPACE = 'idealize-setup'

const NS = settingsNamespace(SETUP_SETTINGS_NAMESPACE)
/** `@idealize/doc-policy`'s section: seeded with the documentation alias. */
const DOCS_NS = settingsNamespace('idealize-docs')
/** `@idealize/vault`'s section: seeded with the projects-root alias. */
const VAULT_NS = settingsNamespace('idealize-vault')
/** `@idealize/skills`' section: seeded with the skills alias. */
const SKILLS_NS = settingsNamespace('idealize-skills')

/**
 * The durable `idealize-setup` section: one seed per setup component (flat,
 * so the browser half can mark its own component done with a single-field
 * write that cannot clobber a sibling) plus the captured folder aliases.
 */
export interface SetupSettings {
  /** True once the orientation component stored both folders. */
  orientationDone?: boolean
  /** When orientation completed (ISO). */
  orientationAt?: string
  /** True once the model-connection component completed or was skipped. */
  modelsDone?: boolean
  /** The captured folders, by alias name. */
  aliases?: {
    /** The folder holding ALL projects; the current project lives under it. */
    projectsRoot?: string
    /** The documentation folder (the user's vault). */
    documentation?: string
    /** The skills folder: one subfolder per skill, each holding a SKILL.md. */
    skills?: string
  }
}

/** Runtime schema for {@link SetupSettings}. */
export const SetupSettingsSchema: z<SetupSettings> = z.object({
  orientationDone: z.boolean(),
  orientationAt: z.string(),
  modelsDone: z.boolean(),
  aliases: z.object({
    projectsRoot: z.string(),
    documentation: z.string(),
    skills: z.string(),
  }),
})

/**
 * The alias names the seam resolves: the two orientation folders (JJ's OQ-01
 * revision) plus the skills folder (JJ, 15 Sep 2026), which orientation never
 * asks for and only the alias route captures.
 */
export type WorkspaceAliasName = 'projectsRoot' | 'documentation' | 'skills'

/** Every alias name, for wire validation and iteration. */
export const WORKSPACE_ALIAS_NAMES: readonly WorkspaceAliasName[] = ['projectsRoot', 'documentation', 'skills']

/**
 * One resolved alias: the stored path plus its live-probed access state.
 * `reason` is present exactly when `accessState` is not `ok` and is a plain
 * sentence fit to show the user verbatim.
 */
export interface WorkspaceAlias {
  /** Which alias this is. */
  name: WorkspaceAliasName
  /** The stored absolute path. */
  path: string
  /** Live probe verdict for the stored path. */
  accessState: AliasAccessState
  /** Plain-language failure explanation; absent when `accessState` is `ok`. */
  reason?: string
}

/**
 * An alias write refused because the folder failed its probe. Carries the
 * probe verdict and the plain-language reason so the Reconnect flow can show
 * both without re-probing.
 */
export class AliasProbeError extends Error {
  /**
   * @param alias - the alias being written.
   * @param path - the refused path.
   * @param accessState - the probe verdict (never `ok`).
   * @param reason - the plain-language explanation, used as the message.
   */
  constructor(
    readonly alias: WorkspaceAliasName,
    readonly path: string,
    readonly accessState: AliasAccessState,
    reason: string,
  ) {
    super(reason)
    this.name = 'AliasProbeError'
  }
}

/** What `POST /idealize/setup/orientation` carries (SET-02 + the first project). */
export interface OrientationRequest {
  /** The projects root: the folder that holds every project. */
  projectsFolder: string
  /** The documentation folder (the vault). */
  documentationFolder: string
  /**
   * Optional first-project name, created as a directory under the projects
   * root and registered as a workspace. One path segment; omitted skips
   * project creation (an existing project is selected in the client).
   */
  projectName?: string
}

/** One refused orientation field with its plain-language reason (SET-04). */
export interface OrientationFailure {
  /** Which request field failed. */
  field: 'projectsFolder' | 'documentationFolder' | 'projectName'
  /** Plain-language explanation, shown to the user verbatim. */
  reason: string
  /** The probe verdict, for the two folder fields. */
  accessState?: AliasAccessState
}

/**
 * Orientation outcome: either everything persisted (with the created first
 * project when one was requested), or the per-field failures and nothing
 * persisted.
 */
export type OrientationResult =
  | { ok: true; project?: { workspaceId: WorkspaceId; path: string } }
  | { ok: false; failures: OrientationFailure[] }

/** Component seeds + live-probed aliases, as `GET /idealize/setup/state` reports. */
export interface SetupState {
  /** Per-component completion seeds. */
  components: {
    /** The orientation component (folders captured). */
    orientation: { done: boolean; at?: string }
    /** The model-connection component (completed or skipped). */
    models: { done: boolean }
  }
  /** The stored aliases with their live access state; absent until captured. */
  aliases: {
    projectsRoot?: WorkspaceAlias
    documentation?: WorkspaceAlias
    skills?: WorkspaceAlias
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    workspaceAliases: WorkspaceAliases
  }
}

/**
 * The workspace-alias seam (`ctx.workspaceAliases`) plus the orientation
 * flow behind the `/idealize/setup` routes.
 *
 * Contract for consumers (the Files tabs, the Reconnect flow):
 * - {@link resolve} never throws for a known alias: an unset alias returns
 *   `undefined`, a set-but-broken one returns its stored path with a non-`ok`
 *   `accessState` and a plain `reason` — render the path with a Reconnect
 *   affordance rather than dropping it.
 * - {@link set} validates before it persists: a failing folder rejects with
 *   {@link AliasProbeError} and stores nothing, so a stored alias was valid
 *   at the moment it was written (it may still die later — resolve re-probes
 *   on every call).
 * - Writing `documentation` re-seeds `@idealize/doc-policy`'s folder and
 *   re-scans; writing `projectsRoot` re-seeds `@idealize/vault`'s root.
 *   A missing dependent settings section fails loud naming the plugin.
 */
export class WorkspaceAliases extends Service {
  private scope: SettingsScope<SetupSettings> | undefined

  /**
   * @param ctx - the plugin context; the settings section registers when a
   * settings provider is composed and detaches with it.
   */
  constructor(ctx: Context) {
    super(ctx, 'workspaceAliases')
    ctx.inject(['settings'], (sctx) => {
      const scope = sctx.settings.register(NS, SetupSettingsSchema)
      this.scope = scope
      sctx.effect(() => () => {
        this.scope = undefined
      }, 'idealize-setup: settings detach')
    })
  }

  /** The current section, `{}` while no settings provider is composed. */
  private section(): SetupSettings {
    return this.scope?.get() ?? {}
  }

  /** The owner scope; writing without a settings provider fails loud. */
  private requireScope(): SettingsScope<SetupSettings> {
    if (this.scope === undefined) {
      throw new Error('idealize-setup: no settings provider is composed, so setup state cannot be stored')
    }
    return this.scope
  }

  /**
   * Resolve one alias to its stored path and live-probed access state.
   * @param aliasName - which alias to resolve.
   * @returns the alias with its probe verdict, or `undefined` while unset.
   */
  async resolve(aliasName: WorkspaceAliasName): Promise<WorkspaceAlias | undefined> {
    const path = this.section().aliases?.[aliasName]
    if (path === undefined || path === '') return undefined
    const probe = await probeFolder(path)
    return {
      name: aliasName,
      path,
      accessState: probe.state,
      ...probe.reason === undefined ? {} : { reason: probe.reason },
    }
  }

  /**
   * Point one alias at a folder: probe it, persist it, and re-seed the
   * dependent settings section (the Reconnect flow's write path).
   * @param aliasName - which alias to write.
   * @param path - absolute folder path.
   * @returns the stored alias (`accessState` is `ok` by construction).
   * @throws {AliasProbeError} when the folder fails its probe; nothing is stored.
   */
  async set(aliasName: WorkspaceAliasName, path: string): Promise<WorkspaceAlias> {
    const probe = await probeFolder(path)
    if (probe.state !== 'ok') {
      throw new AliasProbeError(aliasName, path, probe.state, probe.reason ?? 'The folder failed its access check.')
    }
    await this.requireScope().update({ aliases: { [aliasName]: path } })
    await this.seed(aliasName, path)
    return { name: aliasName, path, accessState: 'ok' }
  }

  /**
   * Component seeds + live-probed aliases for the state route and, later,
   * the settings surface.
   * @returns the current setup state.
   */
  async state(): Promise<SetupState> {
    const section = this.section()
    const [projectsRoot, documentation, skills] = await Promise.all([
      this.resolve('projectsRoot'),
      this.resolve('documentation'),
      this.resolve('skills'),
    ])
    return {
      components: {
        orientation: {
          done: section.orientationDone === true,
          ...section.orientationAt === undefined ? {} : { at: section.orientationAt },
        },
        models: { done: section.modelsDone === true },
      },
      aliases: {
        ...projectsRoot === undefined ? {} : { projectsRoot },
        ...documentation === undefined ? {} : { documentation },
        ...skills === undefined ? {} : { skills },
      },
    }
  }

  /**
   * The orientation component (SET-02/04/06): probe both folders, create and
   * register the first project under the projects root when a name is given,
   * persist the aliases + the orientation seed, seed the documentation and
   * vault sections, and kick the documentation scan. Field failures return in
   * `failures` with nothing persisted; a missing dependent plugin throws.
   * @param request - the two folders and the optional first-project name.
   * @returns the outcome; on `ok` the created project when one was requested.
   */
  async orient(request: OrientationRequest): Promise<OrientationResult> {
    const failures: OrientationFailure[] = []
    const [projects, docs] = await Promise.all([
      probeFolder(request.projectsFolder),
      probeFolder(request.documentationFolder),
    ])
    if (projects.state !== 'ok') {
      failures.push({ field: 'projectsFolder', reason: projects.reason ?? '', accessState: projects.state })
    }
    if (docs.state !== 'ok') {
      failures.push({ field: 'documentationFolder', reason: docs.reason ?? '', accessState: docs.state })
    }
    const projectName = request.projectName?.trim()
    if (projectName !== undefined && projectName !== '') {
      if (/[/\\]/.test(projectName) || projectName === '.' || projectName === '..') {
        failures.push({ field: 'projectName', reason: 'A project name is a single folder name; it cannot contain / or \\.' })
      }
    }
    if (failures.length > 0) return { ok: false, failures }

    // Create the first project before persisting anything, so a failed
    // creation leaves setup incomplete and plainly retriable.
    let project: { workspaceId: WorkspaceId; path: string } | undefined
    if (projectName !== undefined && projectName !== '') {
      const registry = this.ctx.get('workspaceRegistry')
      if (registry === undefined) {
        throw new Error('idealize-setup: ctx.workspaceRegistry is not composed — orientation creates the first project through it')
      }
      const dir = join(request.projectsFolder, projectName)
      await mkdir(dir, { recursive: true })
      const workspace = await registry.create(dir)
      project = { workspaceId: workspace.id, path: dir }
    }

    await this.requireScope().update({
      orientationDone: true,
      orientationAt: new Date().toISOString(),
      aliases: {
        projectsRoot: request.projectsFolder,
        documentation: request.documentationFolder,
      },
    })
    await this.seed('projectsRoot', request.projectsFolder)
    await this.seed('documentation', request.documentationFolder)
    return { ok: true, ...project === undefined ? {} : { project } }
  }

  /**
   * Re-seed the settings section that depends on one alias, failing loud when
   * its owning plugin is not composed; a `documentation` write also awaits a
   * documentation scan so the vault is scaffolded before the caller proceeds
   * (SET-06). Scan failures are logged, never thrown: the alias write stood.
   */
  private async seed(aliasName: WorkspaceAliasName, path: string): Promise<void> {
    const settings = this.ctx.get('settings')
    if (settings === undefined) {
      throw new Error('idealize-setup: no settings provider is composed, so folder seeds cannot be stored')
    }
    if (aliasName === 'projectsRoot') {
      if (settings.get(VAULT_NS) === undefined) {
        throw new Error('idealize-setup: the idealize-vault settings section is not registered — is @idealize/vault composed?')
      }
      await settings.update(VAULT_NS, { projectsRoot: path })
      return
    }
    if (aliasName === 'skills') {
      if (settings.get(SKILLS_NS) === undefined) {
        throw new Error('idealize-setup: the idealize-skills settings section is not registered — is @idealize/skills composed?')
      }
      await settings.update(SKILLS_NS, { skillsFolder: path })
      return
    }
    if (settings.get(DOCS_NS) === undefined) {
      throw new Error('idealize-setup: the idealize-docs settings section is not registered — is @idealize/doc-policy composed?')
    }
    await settings.update(DOCS_NS, { documentationFolder: path })
    const docPolicy = this.ctx.get('docPolicy')
    if (docPolicy !== undefined) {
      try {
        await docPolicy.scan()
      } catch (error) {
        this.ctx.logger.warn('idealize-setup: the kicked documentation scan failed (the folder seed stood)')
        this.ctx.logger.warn(error)
      }
    }
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
}

function refuse(req: IncomingMessage, res: ServerResponse, mutating = false): boolean {
  const hostname = (req.headers.host ?? '').replace(/:\d+$/, '')
  if (hostname !== '127.0.0.1' && hostname !== 'localhost' && hostname !== '[::1]') {
    res.writeHead(403, { 'content-type': 'text/plain' }).end('loopback only')
    return true
  }
  if (mutating && req.headers['x-idealize-auth'] !== '1') {
    res.writeHead(403, { 'content-type': 'text/plain' }).end('missing x-idealize-auth header')
    return true
  }
  return false
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

/** A parsed JSON object body, or a wire-boundary refusal line. */
function parseObjectBody(text: string): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: 'body is not JSON' }
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, error: 'body must be a JSON object' }
  return { ok: true, value: raw as Record<string, unknown> }
}

/**
 * Validate one orientation body at the wire boundary.
 * @param body - the parsed JSON object.
 * @returns the request, or an error line naming the offending field.
 */
export function parseOrientationRequest(body: Record<string, unknown>): OrientationRequest | { error: string } {
  const { projectsFolder, documentationFolder, projectName } = body
  if (typeof projectsFolder !== 'string' || projectsFolder === '') return { error: 'projectsFolder must be a non-empty string' }
  if (typeof documentationFolder !== 'string' || documentationFolder === '') return { error: 'documentationFolder must be a non-empty string' }
  if (projectName !== undefined && typeof projectName !== 'string') return { error: 'projectName must be a string' }
  return {
    projectsFolder,
    documentationFolder,
    ...projectName === undefined ? {} : { projectName },
  }
}

/**
 * Plugin body: the `ctx.workspaceAliases` service plus the `/idealize/setup`
 * routes while a web server is composed.
 * @param ctx - host plugin context.
 */
export function apply(ctx: Context): void {
  ctx.plugin(WorkspaceAliases)

  ctx.inject(['workspaceAliases', 'webServer'], (webCtx) => {
    const aliases = webCtx.workspaceAliases

    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: '/idealize/setup/state',
      handler: async (req, res) => {
        if (refuse(req, res)) return
        sendJson(res, 200, await aliases.state())
      },
    }), 'idealize-setup: state route')

    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: '/idealize/setup/orientation',
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          res.writeHead(405, { 'content-type': 'text/plain', allow: 'POST' }).end('POST only')
          return
        }
        if (refuse(req, res, true)) return
        const body = parseObjectBody(await readBody(req))
        if (!body.ok) {
          sendJson(res, 400, { ok: false, error: body.error })
          return
        }
        const request = parseOrientationRequest(body.value)
        if ('error' in request) {
          sendJson(res, 400, { ok: false, error: request.error })
          return
        }
        try {
          const result = await aliases.orient(request)
          sendJson(res, result.ok ? 200 : 400, result)
        } catch (error) {
          sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    }), 'idealize-setup: orientation route')

    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: '/idealize/setup/alias',
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          res.writeHead(405, { 'content-type': 'text/plain', allow: 'POST' }).end('POST only')
          return
        }
        if (refuse(req, res, true)) return
        const body = parseObjectBody(await readBody(req))
        if (!body.ok) {
          sendJson(res, 400, { ok: false, error: body.error })
          return
        }
        const aliasName = body.value.name
        const path = body.value.path
        if (typeof aliasName !== 'string' || !(WORKSPACE_ALIAS_NAMES as readonly string[]).includes(aliasName)) {
          sendJson(res, 400, { ok: false, error: `name must be one of ${WORKSPACE_ALIAS_NAMES.join(', ')}` })
          return
        }
        if (typeof path !== 'string' || path === '') {
          sendJson(res, 400, { ok: false, error: 'path must be a non-empty string' })
          return
        }
        try {
          const alias = await aliases.set(aliasName as WorkspaceAliasName, path)
          sendJson(res, 200, { ok: true, alias })
        } catch (error) {
          if (error instanceof AliasProbeError) {
            sendJson(res, 400, { ok: false, failure: { accessState: error.accessState, reason: error.message } })
            return
          }
          sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    }), 'idealize-setup: alias route')
  })
}
