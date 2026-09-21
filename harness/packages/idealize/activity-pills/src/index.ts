/**
 * @idealize/activity-pills — host half: seeds the five activity agents
 * (Coding, Design, Writing, Admin, Free) into the user preset root the first
 * time a deployment runs without any of them, so the welcome card's brain
 * step and the composer's brain switcher have brains to offer in Chat and
 * Terminal.
 *
 * Each seeded composition is the shipped `standard` preset with its persona
 * replaced ({@link deriveComposition}); metadata carries the brain's name,
 * description, and roster order. Seeding never overwrites: a root that holds
 * any of the five ids is left as it is, so a user who deletes one brain's
 * preset keeps that deletion.
 *
 * It also serves four loopback routes:
 * - `GET /idealize/activity/models` — per activity brain, the model it selects
 *   on a started chat (a started chat keeps its preset, so there the selection
 *   changes the model only) and its availability ({@link assessPills}). Free
 *   resolves to the first model of the free-tokens route; every other brain
 *   resolves to the deployment default model; `config.models` overrides either
 *   per brain.
 * - `POST /idealize/activity/surface` `{kind, provider?}` — the shell reports
 *   which surface the user is on (chat, or the desktop terminal running a
 *   subscription agent), which turns cross-provider brains into confirmations.
 * - `GET /idealize/activity/agents` — every editable agent (the presets under
 *   the user root): name, description, the model it selects, its special
 *   instructions (the composition's persona text), whether it is one of the
 *   activity brains, whether the free-tokens route pins its model (so a surface
 *   states the model rather than offering a picker), which spaces it works
 *   in ({@link presetSpaces} over the `spaces` map, so an entry the user never
 *   set reads as the computed default rather than as no spaces at all), its
 *   `access` and, for a subscription route, the route's display name.
 * - `POST /idealize/activity/agent` `{id?, name, model, instructions, spaces?}`
 *   — edit one agent, or create one when `id` is absent: the name lands in
 *   `preset.yml`, the instructions replace the persona row, the model (or null
 *   for the default) lands in this plugin's `models` setting, and `spaces`
 *   lands in its `spaces` sibling. An absent `spaces` leaves the stored list
 *   untouched, so saving a name or a model never moves a brain between spaces.
 *
 * The space owns the tools; the brain owns the model and the instructions
 * (JJ, 7 Sep 2026). A brain whose every space generates (Images, Sounds,
 * Video) composes the generation toolset only — `mediaCompositionFor` from
 * `@idealize/gen-tools` — and a brain that works in Chat or Terminal derives
 * from the shipped `standard` preset. The create and save routes apply the
 * rule to the brain's resulting spaces, and {@link repairGeneratingBrains}
 * applies it at startup to every preset under the user root that predates it,
 * keeping each preset's persona.
 *
 * `models` is a settings section (`idealize-activity-pills`) over the
 * composition config, so the Brains pane's edits persist without a restart.
 * `spaces` is its sibling in the same section: which spaces each brain works
 * in, read through `presetSpaces` (`@idealize/spaces`).
 * @module @idealize/activity-pills
 */

import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  COMPOSITION_FILE, METADATA_FILE, readComposition, renderPresetMetadata,
} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-agent-presets'
import { execFile } from 'node:child_process'
import { AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE, type AgentDefaultModelSettings } from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { dshHomePath, expandHomePath } from '@deepseek-ai/dsh-home-paths'
import { isSpaceId, LAUNCHABLE_SPACE_IDS, presetSpaces, RETIRED_ROLE_PRESETS, type SpaceId } from '@idealize/spaces'
import { isGenerationOnlyComposition, mediaCompositionFor } from '@idealize/gen-tools'
import { ACTIVITIES, ACTIVITY_IDS, FREE_ACTIVITY_ID, deriveComposition, hasActivityPresets, personaOf } from './seed.ts'
import { assessPills, type ActivityModel, type PillAvailability, type Surface } from './availability.ts'

export { assessPills, terminalRestarts } from './availability.ts'
export type {
  ActivityModel, AvailabilityFacts, PillAvailability, PillReason, Surface, TerminalRun,
} from './availability.ts'

export { ACTIVITIES, ACTIVITY_IDS, FREE_ACTIVITY_ID, deriveComposition, hasActivityPresets, personaOf } from './seed.ts'
export type { ActivityDefinition } from './seed.ts'

/** Plugin config. */
export interface Config {
  /**
   * The preset root the activity agents are written to. Defaults to the
   * roster's own user root (`$DSH_HOME/.agent-presets`), which is where
   * `dsh-agent-presets` reads locally authored presets from.
   */
  root?: string
  /** The shipped preset each activity composition derives from. */
  source?: string
  /**
   * Per-brain model for started chats, keyed by activity id. Absent brains
   * resolve to the free-tokens route (Free) or the deployment default model.
   */
  models?: Record<string, ActivityModel>
  /**
   * Which spaces each brain works in, keyed by agent preset id — the sibling
   * of {@link Config.models} in the same settings section, so one document
   * holds every per-preset decision the Brains pane makes. `settings.update`
   * merges, so writing `models` alone leaves this key intact and vice versa.
   *
   * Values are plain strings because a settings document is a file boundary:
   * `presetSpaces` (`@idealize/spaces`) narrows a stored list to the declared
   * space ids and computes the default for a preset with no entry.
   */
  spaces?: Record<string, string[]>
  /**
   * Routes that only a terminal agent serves on subscription here (no chat
   * credential path), so a pill targeting one is refused in the chat with a
   * pointer to the terminal. Anthropic by default: Claude on subscription runs
   * as Claude Code in the desktop terminal.
   */
  terminalOnlyProviders?: string[]
  /**
   * The command-line agent that serves each terminal-only route, keyed by
   * provider (Anthropic → `claude`, Claude Code). The agents route reports
   * whether the user's login shell can find it, so the Brains pane can say
   * which brains run as a CLI in the terminal and whether that CLI is there.
   */
  terminalCliByProvider?: Record<string, string>
  /** Environment variables holding a route's API key when the settings profile names none. */
  apiKeyEnvByProvider?: Record<string, string>
}


/** Runtime schema for {@link Config}. */
export const Config: z<Config> = z.object({
  root: z.string(),
  source: z.string().default('standard'),
  models: z.dict(z.object({
    provider: z.string().required(),
    model: z.string().required(),
  })).default({}),
  spaces: z.dict(z.array(z.string())).default({}),
  terminalOnlyProviders: z.array(z.string()).default(['anthropic']),
  terminalCliByProvider: z.dict(z.string()).default({ anthropic: 'claude' }),
  apiKeyEnvByProvider: z.dict(z.string()).default({
    'deepseek-official': 'DEEPSEEK_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
  }),
})

/** One terminal-only route and the command-line agent that serves it, as `GET /idealize/activity/agents` reports it. */
export interface TerminalCli {
  provider: string
  /** The executable a fresh shell types (`claude`). */
  cli: string
  /** Whether the login shell finds it; null where the probe cannot run. */
  installed: boolean | null
}

/** The shells tried, in order, when SHELL names none that exists. */
const FALLBACK_SHELLS = ['/bin/zsh', '/bin/bash', '/bin/sh']

/**
 * The shell a CLI probe runs in: the login shell SHELL names when it exists,
 * else the first of zsh, bash and sh present; null where nothing can probe
 * (Windows, a bare image).
 * @param shell - the SHELL variable's value.
 * @param exists - whether a path exists; the file system by default.
 * @returns an absolute shell path, or null.
 */
export function probeShell(shell = process.env.SHELL, exists: (path: string) => boolean = existsSync): string | null {
  if (process.platform === 'win32') return null
  if (shell !== undefined && shell !== '' && exists(shell)) return shell
  return FALLBACK_SHELLS.find(exists) ?? null
}

/**
 * The flags that run one command in `shell` as a login shell: interactive too
 * for zsh and bash, whose rc files add to PATH; plain login for sh.
 * @param shell - an absolute shell path.
 * @returns the flag argument.
 */
export function probeFlags(shell: string): string {
  return shell.endsWith('/sh') ? '-lc' : '-lic'
}

/**
 * Whether the user's login shell resolves `cli`, or null when no shell can
 * probe (Windows, no shell present, or a shell that exits abnormally).
 * @param cli - the executable name, a single path component.
 * @returns true/false from `command -v`, null when the probe itself failed.
 */
export function cliInstalled(cli: string, platform: NodeJS.Platform = process.platform): Promise<boolean | null> {
  // Windows has no login shell to ask; `where.exe` searches PATH and PATHEXT,
  // so it finds claude.exe and an npm claude.cmd alike, and exits 1 for a
  // name it cannot find. Without this every CLI read "Could not check" there.
  if (platform === 'win32') {
    if (!/^[\w.-]+$/.test(cli)) return Promise.resolve(null)
    return new Promise((resolve) => {
      execFile('where.exe', [cli], { timeout: 5_000, windowsHide: true }, (error) => {
        if (error === null) { resolve(true); return }
        resolve(typeof error.code === 'number' && error.code === 1 ? false : null)
      })
    })
  }
  const shell = probeShell()
  if (shell === null || !/^[\w.-]+$/.test(cli)) return Promise.resolve(null)
  return new Promise((resolve) => {
    execFile(shell, [probeFlags(shell), `command -v ${cli}`], { timeout: 5_000 }, (error) => {
      if (error === null) { resolve(true); return }
      // `command -v` exits 1 when the name is unknown; anything else is the probe failing.
      resolve(typeof error.code === 'number' && error.code === 1 ? false : null)
    })
  })
}

/** Required services. */
export const inject = ['agentPresets']

/** This plugin's settings section: the `models` overrides the Brains pane edits. */
const NS = settingsNamespace('idealize-activity-pills')

/** The llm-pi-ai settings section (restated; that plugin owns the schema). */
const LLM_NS = settingsNamespace('llm-pi-ai')

/** A preset id: lowercase words joined by hyphens. */
const PRESET_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** A wire `model` field: `{provider, model}`, null for the default, undefined when malformed. */
function parseSelection(value: unknown): ActivityModel | null | undefined {
  if (value === null || value === undefined) return null
  if (typeof value !== 'object') return undefined
  const { provider, model } = value as { provider?: unknown; model?: unknown }
  if (typeof provider !== 'string' || provider === '' || typeof model !== 'string' || model === '') return undefined
  return { provider, model }
}

/**
 * A wire `spaces` field: the spaces a brain works in.
 *
 * Absent is not the same as empty. Absent means the caller is saying nothing
 * about spaces, so the stored list stands; `[]` means the brain works in none,
 * which is what an agent role is. Accepted lists are normalized to the declared
 * table order, the order {@link presetSpaces} reads a stored list back in. Only
 * launchable spaces are accepted: a brain is never assigned to Studio.
 * @param value - the raw field (wire boundary: untrusted).
 * @returns `spaces` absent for "leave it alone", present for a list to store, or the refusal.
 */
export function parseSpaces(value: unknown): { ok: true; spaces?: SpaceId[] } | { ok: false } {
  if (value === undefined || value === null) return { ok: true }
  if (!Array.isArray(value) || !value.every(entry => isSpaceId(entry) && LAUNCHABLE_SPACE_IDS.includes(entry))) {
    return { ok: false }
  }
  return { ok: true, spaces: LAUNCHABLE_SPACE_IDS.filter(id => value.includes(id)) }
}

/**
 * The preset ids the deployment maps to agent roles — the brains that answer to
 * the person and to no space. Both coordinators qualify: the project one and
 * the Studio one (JJ, 11 Sep 2026: "put studio and project coordinator
 * together in the brains section"). Empty while `@idealize/comm` is not composed.
 * @param ctx - a context to probe for the command service.
 * @returns the role preset ids.
 */
function rolePresets(ctx: Context): string[] {
  // ctx.get() is the sanctioned probe for a service this plugin does not
  // depend on: @idealize/comm ships in the app and not in every composition.
  const comm = (ctx as unknown as { get(name: string): unknown }).get('idealizeComm') as
    { config?: () => { projectAgentPreset?: string; studioAgentPreset?: string } } | undefined
  const roles = comm?.config?.()
  // An untyped `ctx.get` probe: a composition may carry an older settings
  // shape, so each id is taken only when it is there.
  const named = [roles?.projectAgentPreset, roles?.studioAgentPreset]
  return [...named.filter(id => id !== undefined), ...RETIRED_ROLE_PRESETS]
}

/**
 * Derive a preset id from a display name.
 * @param name - the agent's name.
 * @returns the hyphenated lowercase id, empty when nothing survives.
 */
export function slugOf(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

/** The route whose first model the Free pill selects. */
const FREE_PROVIDER = 'freetokens'

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

/** The llm-pi-ai providers section, as far as reachability reads it. */
interface LlmProvidersSection {
  providers?: Record<string, { apiKeyEnv?: unknown; models?: { id?: unknown }[] }>
}

/**
 * Resolve the model each pill selects on a started chat.
 * @param overrides - `config.models`.
 * @param llm - the llm-pi-ai settings section, for the free-tokens route.
 * @param fallback - the agent-default-model settings section.
 * @returns one selection per activity id, null when nothing resolves.
 */
export function resolveActivityModels(
  overrides: Readonly<Record<string, ActivityModel>>,
  llm: LlmProvidersSection | undefined,
  fallback: AgentDefaultModelSettings | undefined,
): Record<string, ActivityModel | null> {
  const freeModel = llm?.providers?.[FREE_PROVIDER]?.models?.find(entry => typeof entry.id === 'string')?.id
  const free: ActivityModel | null = typeof freeModel === 'string' ? { provider: FREE_PROVIDER, model: freeModel } : null
  const standard: ActivityModel | null = fallback === undefined ? null : { provider: fallback.provider, model: fallback.model }
  const resolved: Record<string, ActivityModel | null> = {}
  for (const activity of ACTIVITIES) {
    resolved[activity.id] = overrides[activity.id] ?? (activity.id === FREE_ACTIVITY_ID ? free : standard)
  }
  return resolved
}

/** The persona a brain with no written instructions carries outside the generating spaces. */
function standardPersona(name: string): string {
  return `You are the IDEalize ${name} agent powered by the {{model}} model. Your working directory is {{cwd}}.`
}

/** What {@link repairGeneratingBrains} reads and writes. */
export interface RepairFacts {
  /** The usable presets under the user root, each with its composition text. */
  presets: readonly { id: string; name: string; path: string; composition: string }[]
  /** Preset ids carrying agent roles ({@link presetSpaces}' second argument). */
  rolePresets: readonly string[]
  /** The `spaces` map of the settings section, keyed by preset id. */
  storedSpaces: Readonly<Record<string, readonly string[] | undefined>>
}

/**
 * The presets whose composition contradicts their spaces: every space
 * generates, yet the composition is not generation-only. Each is returned with
 * the composition to write — `mediaCompositionFor` over the brain's spaces,
 * keeping the persona the composition carries (the default media persona when
 * it carries none). A preset already generation-only, or working in Chat or
 * Terminal, is not returned, so applying the result twice writes nothing the
 * second time.
 * @param facts - the presets, the roles, and the stored space map.
 * @returns one entry per preset to rewrite, in roster order.
 */
export function repairGeneratingBrains(
  facts: RepairFacts,
): { id: string; path: string; spaces: SpaceId[]; composition: string }[] {
  const repairs: { id: string; path: string; spaces: SpaceId[]; composition: string }[] = []
  for (const preset of facts.presets) {
    if (isGenerationOnlyComposition(preset.composition)) continue
    const spaces = presetSpaces(preset.id, facts.rolePresets, facts.storedSpaces[preset.id])
    const composition = mediaCompositionFor(spaces, preset.name, personaOf(preset.composition) ?? '')
    if (composition === undefined) continue
    repairs.push({ id: preset.id, path: preset.path, spaces, composition })
  }
  return repairs
}

/** What {@link retiredRolePresetsToRemove} reads. */
export interface RetirementFacts {
  /** Ids of the usable presets under the user root. */
  presetIds: readonly string[]
  /** The `spaces` map of the settings section, keyed by preset id. */
  storedSpaces: Readonly<Record<string, readonly string[] | undefined>>
}

/**
 * The retired role presets to delete: each id on `RETIRED_ROLE_PRESETS` that
 * sits in the roster with no stored space list. A stored list means the person
 * placed the preset in a space after its role was retired, so it stays as an
 * ordinary brain of theirs.
 * @param facts - the roster ids and the stored space map.
 * @returns the ids to remove, in roster order.
 */
export function retiredRolePresetsToRemove(facts: RetirementFacts): string[] {
  return facts.presetIds.filter(id => RETIRED_ROLE_PRESETS.includes(id) && facts.storedSpaces[id] === undefined)
}

/**
 * Seed the activity agents once the roster service is up, remove a retired
 * role's preset nobody placed in a space, then repair the presets whose
 * composition contradicts their spaces.
 * @param ctx - the host plugin context.
 * @param config - the seeding root and source preset.
 */
export function apply(ctx: Context, config: Config): void {
  const root = config.root === undefined || config.root === ''
    ? dshHomePath('.agent-presets')
    : expandHomePath(config.root)
  const sourceId = config.source ?? 'standard'
  let current: () => Config = () => config
  installSettingsSection(ctx, NS, Config, config, {
    setSource: (source: () => Config) => {
      current = source
    },
    onChange: () => {},
  })

  /** Whether a preset's composition file sits under the user root (the editable set). */
  const editable = (path: string): boolean => resolve(path).startsWith(`${resolve(root)}${sep}`)

  /**
   * The shipped composition every Chat / Terminal brain derives from.
   * @returns its text, or undefined with the reason when the roster does not carry it.
   */
  const standardSource = async (): Promise<{ text: string } | { error: string }> => {
    const roster = await ctx.agentPresets.list()
    const source = roster.find(preset => preset.id === sourceId && preset.broken === undefined)
    if (source === undefined) return { error: `source preset "${sourceId}" is not in the roster` }
    return { text: await readComposition(source) }
  }

  ctx.inject(['webServer', 'settings', 'credentials'], (webCtx) => {
    // The shell's last surface report; chat until told otherwise.
    let surface: Surface = { kind: 'chat' }
    const overrides = (): Readonly<Record<string, ActivityModel>> => current().models ?? {}

    const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
    }

    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: '/idealize/activity/agents',
      handler: async (req, res) => {
        if (refuse(req, res)) return
        const llm = webCtx.settings.get(LLM_NS) as LlmProvidersSection | undefined
        const fallback = webCtx.settings.get(AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE) as AgentDefaultModelSettings | undefined
        const resolved = resolveActivityModels(overrides(), llm, fallback)
        const storedSpaces = current().spaces ?? {}
        const roles = rolePresets(webCtx)
        const roster = (await ctx.agentPresets.list()).filter(preset => preset.broken === undefined && editable(preset.path))
        const standard: ActivityModel | null = fallback === undefined ? null : { provider: fallback.provider, model: fallback.model }
        // An activity's resolution stands even when it is null: Free resolves to
        // the free-tokens route or to nothing, and falling through to the
        // composed default here reported the default route's missing key for
        // Free on a fresh install (walked 14 Sep 2026). Roles and other presets
        // outside the activity table take their override or the default.
        const modelOf = (id: string): ActivityModel | null => {
          const activity = resolved[id]
          return activity === undefined ? (overrides()[id] ?? standard) : activity
        }
        const access = await assess(Object.fromEntries(roster.map(preset => [preset.id, modelOf(preset.id)])), llm)
        const offered = await subscriptions()
        const agents = await Promise.all(roster.map(async (preset) => {
          let instructions = ''
          try {
            instructions = personaOf(await readComposition(preset)) ?? ''
          } catch {
            // A composition that cannot be read lists with empty instructions; saving rewrites it.
          }
          const override = overrides()[preset.id]
          // The route's display name where the sign-in surface knows it, so a
          // note about a subscription can say "OpenAI (ChatGPT)" rather than
          // its route id.
          const providerName = offered.find(row => row.id === modelOf(preset.id)?.provider)?.name
          return {
            id: preset.id,
            name: preset.name ?? preset.id,
            ...preset.description === undefined ? {} : { description: preset.description },
            ...preset.order === undefined ? {} : { order: preset.order },
            activity: ACTIVITY_IDS.includes(preset.id),
            // The free-tokens route resolves this brain's model, so a surface
            // states the resolved model rather than offering a picker over it.
            modelPinned: preset.id === FREE_ACTIVITY_ID,
            // Which spaces the brain works in: the user's stored list, or the
            // computed default for a brain they never placed by hand.
            spaces: presetSpaces(preset.id, roles, storedSpaces[preset.id]),
            model: modelOf(preset.id),
            // Whether a chat on this brain can open its first request now: the
            // launcher and the Brains pane mark a brain whose route has no key
            // or no sign-in instead of starting a chat that fails at turn one.
            access: access[preset.id],
            ...providerName === undefined ? {} : { providerName },
            overridden: override !== undefined,
            instructions,
          }
        }))
        sendJson(res, 200, { agents, terminal: await terminalClis() })
      },
    }), 'activity-pills: /idealize/activity/agents')

    /**
     * The terminal-only routes with the CLI that serves each and whether the
     * user's login shell finds it (`command -v` in an interactive login zsh,
     * because the packaged app's own PATH is launchd's and misses Homebrew).
     * `installed` is null where the probe cannot run (no zsh). Cached for a
     * minute: the pane re-reads the route after every save.
     */
    let cliProbe: { at: number; value: TerminalCli[] } | undefined
    const terminalClis = async (): Promise<TerminalCli[]> => {
      if (cliProbe !== undefined && Date.now() - cliProbe.at < 60_000) return cliProbe.value
      const entries = Object.entries(config.terminalCliByProvider ?? {})
        .filter(([provider]) => (config.terminalOnlyProviders ?? []).includes(provider))
      const value = await Promise.all(entries.map(async ([provider, cli]) => ({ provider, cli, installed: await cliInstalled(cli) })))
      cliProbe = { at: Date.now(), value }
      return value
    }

    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: '/idealize/activity/agent',
      handler: async (req, res) => {
        if (refuse(req, res, true)) return
        let body: { id?: unknown; name?: unknown; model?: unknown; instructions?: unknown; spaces?: unknown }
        try {
          body = JSON.parse(await readBody(req)) as typeof body
        } catch {
          sendJson(res, 400, { error: 'invalid JSON' })
          return
        }
        const name = typeof body.name === 'string' ? body.name.trim() : ''
        if (name === '') {
          sendJson(res, 400, { error: 'name is required' })
          return
        }
        const selection = parseSelection(body.model)
        if (selection === undefined) {
          sendJson(res, 400, { error: 'model must be {provider, model} or null' })
          return
        }
        const instructions = typeof body.instructions === 'string' ? body.instructions.trim() : ''
        const placement = parseSpaces(body.spaces)
        if (!placement.ok) {
          sendJson(res, 400, { error: `spaces must be an array of: ${LAUNCHABLE_SPACE_IDS.join(', ')}` })
          return
        }
        const id = typeof body.id === 'string' ? body.id : slugOf(name)
        if (!PRESET_ID.test(id)) {
          sendJson(res, 400, { error: 'the name must contain a letter or digit' })
          return
        }
        const roster = await ctx.agentPresets.list()
        const existing = roster.find(preset => preset.id === id)
        // The spaces the brain works in once this save lands: the new placement,
        // else the stored one, else the computed default. They decide the
        // composition: generating spaces compose the generation toolset only,
        // and a brain in Chat or Terminal derives from the shipped source.
        const spaces = placement.spaces ?? presetSpaces(id, rolePresets(webCtx), (current().spaces ?? {})[id])
        const generating = mediaCompositionFor(spaces, name, instructions)
        let composition: string
        let metadata: { description?: string; order?: number } = {}
        if (existing !== undefined) {
          if (!editable(existing.path)) {
            sendJson(res, 400, { error: `"${id}" is a shipped preset; copy it before editing` })
            return
          }
          composition = await readComposition(existing)
          metadata = {
            ...existing.description === undefined ? {} : { description: existing.description },
            ...existing.order === undefined ? {} : { order: existing.order },
          }
          if (generating !== undefined) {
            if (!isGenerationOnlyComposition(composition)) composition = generating
          } else if (isGenerationOnlyComposition(composition)) {
            // Moving out of the generating spaces: the brain needs the tools
            // Chat and Terminal run on, so it derives from the source again.
            const source = await standardSource()
            if ('error' in source) {
              sendJson(res, 500, { error: source.error })
              return
            }
            composition = source.text
          }
        } else {
          if (generating === undefined) {
            const source = await standardSource()
            if ('error' in source) {
              sendJson(res, 500, { error: source.error })
              return
            }
            composition = source.text
          } else {
            composition = generating
          }
          const orders = roster.map(preset => preset.order ?? 0)
          metadata = { order: Math.max(0, ...orders) + 1 }
        }
        // Empty instructions take the default persona for the brain's spaces:
        // the generating composition already carries its own, built from the
        // name and the spaces' duties.
        const persona = instructions !== ''
          ? instructions
          : generating !== undefined ? personaOf(generating) ?? standardPersona(name) : standardPersona(name)
        const directory = join(root, id)
        await mkdir(directory, { recursive: true, mode: 0o700 })
        await writeFile(join(directory, COMPOSITION_FILE), deriveComposition(composition, {
          id, name, description: metadata.description ?? '', order: metadata.order ?? 0, persona,
        }), { mode: 0o600 })
        const rendered = renderPresetMetadata({ name, ...metadata })
        if (rendered !== undefined) await writeFile(join(directory, METADATA_FILE), rendered, { mode: 0o600 })
        const models = Object.fromEntries([
          ...Object.entries(overrides()).filter(([key]) => key !== id),
          ...selection === null ? [] : [[id, selection] as const],
        ])
        // Both maps are written whole rather than patched key by key: the
        // section merge replaces a named key's value, so a partial map would
        // drop every other brain's entry.
        await webCtx.settings.update(NS, {
          models,
          ...placement.spaces === undefined
            ? {}
            : { spaces: { ...current().spaces, [id]: placement.spaces } },
        })
        sendJson(res, 200, { ok: true, id })
      },
    }), 'activity-pills: /idealize/activity/agent')

    /**
     * Whether the chat can open a request on the route: a sign-in, or a
     * resolvable API key. The deployment default's route gets no shortcut: a
     * default with no stored key fails the first turn with a credential error,
     * and a brain that would land there has to read as unavailable.
     */
    const reachable = async (provider: string, llm: LlmProvidersSection | undefined, signedIn: readonly string[]): Promise<boolean> => {
      if (signedIn.includes(provider)) return true
      const profile = llm?.providers?.[provider]
      const env = typeof profile?.apiKeyEnv === 'string' ? profile.apiKeyEnv : config.apiKeyEnvByProvider?.[provider]
      if (env === undefined) return false
      return (await webCtx.credentials.resolve(credentialRef(env)).catch(() => undefined)) !== undefined
    }

    /**
     * The subscription routes: every provider the sign-in surface offers, with
     * its display name, and which of them hold a sign-in. Empty while the
     * provider pack is not composed.
     */
    const subscriptions = async (): Promise<{ id: string; name: string; stored: boolean }[]> => {
      // ctx.get() is the sanctioned probe for a service this plugin does not
      // depend on: the OAuth surface ships in the app and not in every composition.
      const oauth = webCtx.get('idealizeOAuth') as
        { status?: () => Promise<{ id: string; name: string; stored: boolean }[]> } | undefined
      return oauth?.status === undefined ? [] : await oauth.status().catch(() => [])
    }

    /**
     * Availability per brain id for the given resolved models, with each
     * provider's reachability read once.
     */
    const assess = async (
      models: Readonly<Record<string, ActivityModel | null>>, llm: LlmProvidersSection | undefined,
    ): Promise<Record<string, PillAvailability>> => {
      const offered = await subscriptions()
      const signedIn = offered.filter(row => row.stored).map(row => row.id)
      const providers = [...new Set(Object.values(models).flatMap(model => model === null ? [] : [model.provider]))]
      const reach = new Map(await Promise.all(
        providers.map(async provider => [provider, await reachable(provider, llm, signedIn)] as const),
      ))
      return assessPills(models, {
        reachable: provider => reach.get(provider) ?? false,
        subscription: provider => offered.some(row => row.id === provider),
        surface,
        terminalAvailable: terminalAvailable(),
        terminalOnlyProviders: config.terminalOnlyProviders ?? [],
      })
    }

    const terminalAvailable = (): boolean => {
      // ctx.get() is the sanctioned probe for a service this plugin does not
      // depend on: the desktop shell's action service exists only in the app.
      const maybe = (webCtx as unknown as { get(name: string): unknown }).get('desktopActions')
      return typeof (maybe as { openTerminal?: unknown } | undefined)?.openTerminal === 'function'
    }

    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: '/idealize/activity/models',
      handler: async (req, res) => {
        if (refuse(req, res)) return
        const llm = webCtx.settings.get(LLM_NS) as LlmProvidersSection | undefined
        const fallback = webCtx.settings.get(AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE) as AgentDefaultModelSettings | undefined
        const models = resolveActivityModels(overrides(), llm, fallback)
        const pills = await assess(models, llm)
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ models, pills, surface }))
      },
    }), 'activity-pills: /idealize/activity/models')

    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: '/idealize/activity/surface',
      handler: async (req, res) => {
        if (refuse(req, res, true)) return
        let body: { kind?: unknown; provider?: unknown }
        try {
          body = JSON.parse(await readBody(req)) as { kind?: unknown; provider?: unknown }
        } catch {
          res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'invalid JSON' }))
          return
        }
        if (body.kind !== 'chat' && body.kind !== 'terminal') {
          res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: "kind must be 'chat' or 'terminal'" }))
          return
        }
        surface = { kind: body.kind, ...typeof body.provider === 'string' ? { provider: body.provider } : {} }
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, surface }))
      },
    }), 'activity-pills: /idealize/activity/surface')
  })
  const seed = async (): Promise<void> => {
    const roster = await ctx.agentPresets.list()
    if (hasActivityPresets(roster.map(preset => preset.id))) return
    const source = await standardSource()
    if ('error' in source) {
      ctx.logger.warn(`activity-pills: ${source.error}; the activity agents were not seeded`)
      return
    }
    for (const activity of ACTIVITIES) {
      const directory = join(root, activity.id)
      await mkdir(directory, { recursive: true, mode: 0o700 })
      await writeFile(join(directory, COMPOSITION_FILE), deriveComposition(source.text, activity), { mode: 0o600 })
      const metadata = renderPresetMetadata({
        name: activity.name, description: activity.description, order: activity.order,
      })
      if (metadata !== undefined) await writeFile(join(directory, METADATA_FILE), metadata, { mode: 0o600 })
    }
    ctx.logger.info(`activity-pills: seeded ${String(ACTIVITIES.length)} activity agents into ${root}`)
  }

  /**
   * Rewrite every editable preset whose spaces all generate but whose
   * composition is not generation-only ({@link repairGeneratingBrains}). This
   * is what fixes a brain created into Video before the rule existed, without
   * a hand edit; a second run finds nothing to write.
   */
  const repair = async (): Promise<void> => {
    const roster = (await ctx.agentPresets.list()).filter(preset => preset.broken === undefined && editable(preset.path))
    const presets = await Promise.all(roster.map(async preset => ({
      id: preset.id, name: preset.name ?? preset.id, path: preset.path, composition: await readComposition(preset),
    })))
    const repairs = repairGeneratingBrains({ presets, rolePresets: rolePresets(ctx), storedSpaces: current().spaces ?? {} })
    for (const entry of repairs) {
      await writeFile(entry.path, entry.composition, { mode: 0o600 })
      ctx.logger.info(
        `activity-pills: repaired preset "${entry.id}": it works in ${entry.spaces.join(', ')} only, so its composition now carries the generation toolset alone`,
      )
    }
  }

  /**
   * Delete a retired role's preset the person never placed in a space (JJ,
   * 7 Sep 2026: "remove the lead agent row"). One with a stored space list is
   * theirs and stays; a second run finds nothing to remove.
   */
  const retire = async (): Promise<void> => {
    const roster = (await ctx.agentPresets.list()).filter(preset => preset.broken === undefined && editable(preset.path))
    const removals = retiredRolePresetsToRemove({ presetIds: roster.map(preset => preset.id), storedSpaces: current().spaces ?? {} })
    for (const id of removals) {
      await ctx.agentPresets.remove(id)
      ctx.logger.info(`activity-pills: removed the retired role preset "${id}": its role went to the group chat and nobody placed it in a space`)
    }
  }

  void (async () => {
    await seed()
    await retire()
    await repair()
  })().catch((error: unknown) => {
    ctx.logger.warn(`activity-pills: seeding failed: ${error instanceof Error ? error.message : String(error)}`)
  })
}
