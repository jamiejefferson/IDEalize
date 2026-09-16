/**
 * @idealize/gen-tools — host half: seeds the three media agent presets
 * (Gallery, Sound Stage, Video) into the user preset root the first time a
 * deployment runs without any of them, so the welcome card's Images, Sounds
 * and Video choices have presets to select. Each seeded composition carries
 * ONLY the generation toolset — its persona, the `@idealize/gen-tools/tools`
 * row, and the background-job controls — so a generating session composes no
 * shell, filesystem, web, or delegation tools (AC-06). Seeding never
 * overwrites: a root that holds any media agent id is left as it is, so a
 * user who deletes one keeps that deletion (the `@idealize/activity-pills`
 * seeding rule).
 *
 * The same composition is what every brain confined to generating spaces
 * gets, seeded or not: `mediaCompositionFor` builds it for
 * `@idealize/activity-pills`, which applies it when a brain is created or
 * saved into Images, Sounds or Video and repairs presets that predate the
 * rule at startup.
 *
 * The tools themselves live at `@idealize/gen-tools/tools`, registered from
 * the preset compositions rather than here — a host-plane registration would
 * put the generation tools in every session's catalogue.
 * @module @idealize/gen-tools
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { COMPOSITION_FILE, METADATA_FILE, renderPresetMetadata } from '@deepseek-ai/dsh-agent-presets'
import { dshHomePath, expandHomePath } from '@deepseek-ai/dsh-home-paths'
import { MEDIA_AGENTS, buildMediaComposition, hasMediaAgentPresets } from './presets.ts'

export {
  GENERATION_ONLY_PLUGINS, MEDIA_AGENTS, MEDIA_AGENT_IDS, buildMediaComposition, generatesOnly, hasMediaAgentPresets,
  isGenerationOnlyComposition, mediaAgentsBySpace, mediaCompositionFor, mediaPersona,
} from './presets.ts'
export type { MediaAgentDefinition } from './presets.ts'
export type { GenerationReroutedData } from './types.ts'

/** Plugin config. */
export interface Config {
  /**
   * The preset root the media agents are written to. Defaults to the
   * roster's own user root (`$DSH_HOME/.agent-presets`), which is where
   * `dsh-agent-presets` reads locally authored presets from.
   */
  root?: string
}

/** Runtime schema for {@link Config}. */
export const Config: z<Config> = z.object({
  root: z.string(),
})

/** Cordis plugin name. */
export const name = 'idealize-gen-tools'
/** Required services. */
export const inject = ['agentPresets']

/**
 * Seed the media agent presets unless the roster already carries one.
 * @param ctx - the host plugin context (its `agentPresets` roster is consulted).
 * @param root - the preset root directory the agents are written into.
 * @returns resolves once seeding finished or was skipped.
 */
export async function seedMediaAgents(ctx: Context, root: string): Promise<void> {
  const roster = await ctx.agentPresets.list()
  if (hasMediaAgentPresets(roster.map(preset => preset.id))) return
  for (const agent of MEDIA_AGENTS) {
    const directory = join(root, agent.id)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await writeFile(join(directory, COMPOSITION_FILE), buildMediaComposition(agent), { mode: 0o600 })
    const metadata = renderPresetMetadata({ name: agent.name, description: agent.description, order: agent.order })
    /* v8 ignore next -- every media agent is a module constant carrying a name, a description and an order, so metadata always renders. */
    if (metadata !== undefined) await writeFile(join(directory, METADATA_FILE), metadata, { mode: 0o600 })
  }
  ctx.logger.info(`gen-tools: seeded ${String(MEDIA_AGENTS.length)} media agents (${MEDIA_AGENTS.map(agent => agent.id).join(', ')}) into ${root}`)
}

/**
 * Seed the media agents once the roster service is up.
 * @param ctx - the host plugin context.
 * @param config - the seeding root.
 */
export function apply(ctx: Context, config: Config): void {
  const root = config.root === undefined || config.root === ''
    ? dshHomePath('.agent-presets')
    : expandHomePath(config.root)
  seedMediaAgents(ctx, root).catch((error: unknown) => {
    ctx.logger.warn(`gen-tools: seeding failed: ${error instanceof Error ? error.message : String(error)}`)
  })
}
