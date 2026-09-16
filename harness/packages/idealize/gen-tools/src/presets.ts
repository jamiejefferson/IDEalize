/**
 * The media agent presets (Gallery, Sound Stage, Video), the composition each
 * one is seeded with, and the rule every brain confined to generating spaces
 * follows. Unlike the activity agents — whose compositions derive from the
 * shipped `standard` preset and carry its full tool set — a media agent
 * composes ONLY the generation toolset (AC-06): its persona, the
 * `@idealize/gen-tools/tools` row, and the background-job controls.
 *
 * The space owns the tools and the brain owns the model and the instructions
 * (JJ, 7 Sep 2026). {@link mediaCompositionFor} is that rule as a function: a
 * brain whose every space generates gets this composition whatever its name,
 * so a custom brain placed in Images composes `generate_image` and nothing
 * that could reach for a shell.
 * @module @idealize/gen-tools/presets
 */

import { dump, load } from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { spaceById, SPACES, type SpaceId } from '@idealize/spaces'

/** One media agent's identity and the preset it seeds. */
export interface MediaAgentDefinition {
  /** Preset id (and directory name) under the user root. */
  id: string
  /** Roster display name. */
  name: string
  /** Roster description. */
  description: string
  /** Roster sort position, after the activity agents. */
  order: number
  /** The generating space this agent serves; the space table's `agentPreset` names this agent back. */
  space: SpaceId
  /**
   * What the agent does, stated without its name and ending in a full stop:
   * the tool it uses and where the result lands. A custom brain in the same
   * space inherits this sentence in its default persona.
   */
  duty: string
  /** Persona text the seeded composition carries: {@link mediaPersona} over the name and the duty. */
  persona: string
}

const VOICE = 'Explain engineering plainly and without jargon; your user directs the work and learns from how you narrate it.'

const REPORT = 'Report each artefact id when you finish, and describe what was generated.'

/**
 * The persona a generating brain carries: its name, its duties in space order,
 * the reporting line, and the shared voice line.
 * @param name - the brain's display name.
 * @param duties - one {@link MediaAgentDefinition.duty} sentence per space the brain works in.
 * @returns the persona text, with the `{{model}}` and `{{cwd}}` placeholders the persona plugin fills.
 */
export function mediaPersona(name: string, duties: readonly string[]): string {
  return [
    `You are the IDEalize ${name} agent powered by the {{model}} model. Your working directory is {{cwd}}.`,
    ...duties,
    REPORT,
    VOICE,
  ].join(' ')
}

function defineMediaAgent(agent: Omit<MediaAgentDefinition, 'persona'>): MediaAgentDefinition {
  return { ...agent, persona: mediaPersona(agent.name, [agent.duty]) }
}

/** The three media agents, in roster order. */
export const MEDIA_AGENTS: readonly MediaAgentDefinition[] = [
  defineMediaAgent({
    id: 'gallery',
    name: 'Gallery',
    description: 'Creates still images from prompts; every result lands in the project gallery as an artefact.',
    order: -44,
    space: 'gallery',
    duty: 'You create still images from the user\'s prompts with the generate_image tool; every result is stored as a project artefact and appears in the gallery.',
  }),
  defineMediaAgent({
    id: 'soundstage',
    name: 'Sound Stage',
    description: 'Creates audio from prompts; every result lands on the project sound stage as an artefact.',
    order: -43,
    space: 'soundstage',
    duty: 'You create audio from the user\'s prompts with the generate_audio tool; every result is stored as a project artefact and appears on the sound stage.',
  }),
  defineMediaAgent({
    id: 'video',
    name: 'Video',
    description: 'Creates video from prompts; every result lands in the project\'s Video grid as an artefact.',
    order: -42,
    space: 'motion',
    duty: 'You create video from the user\'s prompts with the generate_video tool; every result is stored as a project artefact and appears in the Video grid.',
  }),
]

/** The media agent ids in roster order. */
export const MEDIA_AGENT_IDS: readonly string[] = MEDIA_AGENTS.map(agent => agent.id)

/**
 * The plugin names a generation-only composition may carry: the persona, the
 * generation tools, the background-job controls, and the per-project
 * instructions reader. Anything else (a shell, the filesystem, the web,
 * delegation) makes the composition a standard one.
 */
export const GENERATION_ONLY_PLUGINS: ReadonlySet<string> = new Set([
  '@deepseek-ai/dsh-persona',
  '@idealize/gen-tools/tools',
  '@deepseek-ai/dsh-tool-jobs',
  '@deepseek-ai/dsh-agent-instructions',
])

/** The row that puts the generation tools in a session's catalogue. */
const GENERATION_TOOLS_PLUGIN = '@idealize/gen-tools/tools'

/**
 * Render the generation-only composition around one persona: the persona
 * plus the generation toolset, and nothing else — no shell, filesystem, web,
 * or delegation rows. `tool-jobs` joins because generations may run as
 * background jobs and the agent must be able to collect and stop them.
 * @param persona - the persona text the composition carries.
 * @returns the `agent.cordis.yml` text.
 */
function renderMediaComposition(persona: string): string {
  return dump([
    { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { text: persona } },
    { id: 'generation-tools', name: GENERATION_TOOLS_PLUGIN },
    { id: 'tool-jobs', name: '@deepseek-ai/dsh-tool-jobs' },
  ], { lineWidth: -1, noRefs: true })
}

/**
 * Build one media agent's composition text ({@link renderMediaComposition}
 * over the agent's own persona).
 * @param agent - the media agent whose persona the composition carries.
 * @returns the `agent.cordis.yml` text to seed.
 */
export function buildMediaComposition(agent: MediaAgentDefinition): string {
  return renderMediaComposition(agent.persona)
}

/**
 * Whether every space in a list generates: non-empty, and each row of the
 * space table declares the `media` composition.
 * @param spaces - the spaces a brain works in.
 * @returns true for a brain confined to Images, Sounds and Video in any mix.
 */
export function generatesOnly(spaces: readonly SpaceId[]): boolean {
  return spaces.length > 0 && spaces.every(id => spaceById(id).composition === 'media')
}

/**
 * The composition a brain confined to generating spaces composes.
 *
 * When `spaces` is non-empty and every one declares the `media` composition,
 * the result is the generation-only composition whose persona is
 * `instructions` when non-empty, else {@link mediaPersona} over `name` and the
 * duties of the media agents serving those spaces, in table order. A brain
 * that works in Chat or Terminal, or in no space, gets `undefined`: it derives
 * from the shipped `standard` preset instead.
 * @param spaces - the launchable spaces the brain works in.
 * @param name - the brain's display name, for the default persona.
 * @param instructions - the persona the user wrote; empty for the default.
 * @returns the `agent.cordis.yml` text, or undefined when the spaces do not all generate.
 */
export function mediaCompositionFor(spaces: readonly SpaceId[], name: string, instructions: string): string | undefined {
  if (!generatesOnly(spaces)) return undefined
  const duties = MEDIA_AGENTS.filter(agent => spaces.includes(agent.space)).map(agent => agent.duty)
  return renderMediaComposition(instructions === '' ? mediaPersona(name, duties) : instructions)
}

/**
 * Whether a composition carries the generation toolset and nothing outside it:
 * a top-level row list whose plugin names are all in
 * {@link GENERATION_ONLY_PLUGINS}, with the `@idealize/gen-tools/tools` row
 * among them. Text the loader's YAML dialect cannot parse, or that is not a
 * row list, is not generation-only.
 * @param text - the `agent.cordis.yml` text.
 * @returns true for a composition {@link mediaCompositionFor} would produce, or one reduced to the same rows by hand.
 */
export function isGenerationOnlyComposition(text: string): boolean {
  let rows: unknown
  try {
    rows = load(text, { schema: entryListSchema })
  } catch {
    // A composition the loader cannot parse composes nothing; the repair that
    // follows this read writes a well-formed one.
    return false
  }
  if (!Array.isArray(rows)) return false
  const names = rows.map(row => (typeof row === 'object' && row !== null ? (row as { name?: unknown }).name : undefined))
  return names.includes(GENERATION_TOOLS_PLUGIN)
    && names.every(name => typeof name === 'string' && GENERATION_ONLY_PLUGINS.has(name))
}

/**
 * Whether a roster already carries any media agent.
 * @param ids - the preset ids the roster reports.
 * @returns true when at least one media agent id is present.
 */
export function hasMediaAgentPresets(ids: Iterable<string>): boolean {
  const present = new Set(ids)
  return MEDIA_AGENT_IDS.some(id => present.has(id))
}

/**
 * The media agent a generating space seeds, read back from the space table so
 * the two tables cannot drift: every `media` space names one of
 * {@link MEDIA_AGENTS}, and every media agent's `space` names it back.
 * @returns one agent per generating space, in table order.
 * @throws when a generating space names no media agent, or a media agent names a space that does not name it.
 */
export function mediaAgentsBySpace(): Map<SpaceId, MediaAgentDefinition> {
  const bySpace = new Map<SpaceId, MediaAgentDefinition>()
  for (const space of SPACES) {
    if (space.composition !== 'media') continue
    const agent = MEDIA_AGENTS.find(candidate => candidate.id === space.agentPreset && candidate.space === space.id)
    /* v8 ignore next 3 -- a test asserts the two tables agree; the throw names a drift a future edit would add. */
    if (agent === undefined) {
      throw new Error(`@idealize/gen-tools: generating space '${space.id}' names agent preset '${String(space.agentPreset)}', which no media agent serves`)
    }
    bySpace.set(space.id, agent)
  }
  return bySpace
}
