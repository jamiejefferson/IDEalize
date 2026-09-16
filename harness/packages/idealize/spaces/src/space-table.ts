/**
 * The declared space table and the pure reads over it.
 *
 * A space is what a chat IS: Chat, Terminal, Gallery, Sound Stage, Motion, and
 * the Studio, a project's one group chat. The table is DECLARED here rather
 * than derived from the `conversation.view` ring, so the chooser offers every
 * space as an ordinary tile whatever the ring happens to carry. Every id equals
 * the ring entry id that renders it, so the ring can be seeded from a space
 * without a translation table. Studio is declared but not
 * launchable: the chooser, the roster and a brain's space list never offer it;
 * the pinned Studio card opens a project's Studio chat itself.
 *
 * Browser-safe: no imports, so a client face can share these ids with the host
 * without dragging host code into a bundle.
 * @module @idealize/spaces/space-table
 */

/** Every declared space id, in chooser order; the unlaunchable `studio` last. */
export const SPACE_IDS = ['chat', 'terminal', 'gallery', 'soundstage', 'motion', 'studio'] as const

/** One declared space's id. Durable: it is written into session logs. */
export type SpaceId = typeof SPACE_IDS[number]

/**
 * Which composition a brain in this space is built from: the shipped
 * `standard` preset (the full tool set the activity agents derive from), or
 * the generation-only media composition `@idealize/gen-tools` builds.
 */
export type SpaceComposition = 'standard' | 'media'

/** One row of the declared space table. */
export interface SpaceDefinition {
  /**
   * The space id, which is also the `conversation.view` ring entry id that
   * renders the space. Every space has one: `motion` gained its Video grid on
   * 4 Sep 2026 (`@idealize/ui-gallery` registers both `gallery` and `motion`
   * over the same per-chat source), so a chat can no longer sit in a space
   * that cannot show it what it made.
   */
  id: SpaceId
  /** Locale key for the space's display name, resolved by whichever surface shows it. */
  labelKey: string
  /**
   * Glyph name for the space, in its own namespace rather than reusing the id:
   * a space may take a new glyph without changing the id its session logs carry.
   */
  iconKey: string
  /** The composition source a brain in this space implies. */
  composition: SpaceComposition
  /**
   * The seeded agent preset this space runs, where one exists. Each generating
   * space has one (`@idealize/gen-tools`' media agents: `gallery`,
   * `soundstage`, `video`); Chat and Terminal run whichever brain the user
   * picks.
   */
  agentPreset?: string
  /**
   * The `MEDIA_PRESETS` id (`@idealize/generate`) whose capability requirement
   * the availability read uses. Chat and Terminal need no generation capability
   * and carry none.
   */
  capability?: string
  /**
   * Whether the space needs the desktop shell, which only the packaged app
   * supplies. The chooser still offers the tile in a plain browser — a declared
   * roster does not hide rows — and the brain step states where the space runs.
   */
  requiresDesktopShell?: boolean
  /**
   * `false` for a space no chooser offers and no brain is assigned to. Studio
   * is the only one: a project has exactly one Studio chat, opened from the
   * pinned Studio card, so a launch tile or a roster row would mint a second.
   */
  launchable?: false
}

/** The six declared spaces, in chooser order. */
export const SPACES: readonly SpaceDefinition[] = [
  { id: 'chat', labelKey: 'launcher.chat', iconKey: 'space-chat', composition: 'standard' },
  {
    id: 'terminal',
    labelKey: 'launcher.terminal',
    iconKey: 'space-terminal',
    composition: 'standard',
    requiresDesktopShell: true,
  },
  {
    id: 'gallery',
    labelKey: 'launcher.gallery',
    iconKey: 'space-gallery',
    composition: 'media',
    agentPreset: 'gallery',
    capability: 'images',
  },
  {
    id: 'soundstage',
    labelKey: 'launcher.soundstage',
    iconKey: 'space-soundstage',
    composition: 'media',
    agentPreset: 'soundstage',
    capability: 'sound',
  },
  {
    id: 'motion',
    labelKey: 'launcher.motion',
    iconKey: 'space-motion',
    composition: 'media',
    agentPreset: 'video',
    capability: 'motion',
  },
  { id: 'studio', labelKey: 'launcher.studio', iconKey: 'space-studio', composition: 'standard', launchable: false },
]

/** The spaces a chooser may offer and a brain may be assigned to, in chooser order. */
export const LAUNCHABLE_SPACES: readonly SpaceDefinition[] = SPACES.filter(space => space.launchable !== false)

/** The ids of {@link LAUNCHABLE_SPACES}. */
export const LAUNCHABLE_SPACE_IDS: readonly SpaceId[] = LAUNCHABLE_SPACES.map(space => space.id)

/** The space every chat falls back to: the one needing no capability and no desktop shell. */
export const DEFAULT_SPACE: SpaceId = 'chat'

/**
 * Preset ids that once carried a retired agent role (the lead agent, retired
 * 1 Sep for the group chat). A preset on this list defaults to no space, and
 * `@idealize/activity-pills` deletes it at startup while no space list is
 * stored for it (JJ, 7 Sep 2026: "remove the lead agent row"); one the user
 * placed in a space is an ordinary preset they keep and can edit. Ids only
 * ever join this list; removing one would put a retired role's chat back in
 * every chooser overnight.
 */
export const RETIRED_ROLE_PRESETS: readonly string[] = ['lead-agent']

/**
 * Preset ids that work in Chat alone, whatever list is stored for them. `free`
 * runs on the free-tokens route, which is a chat route: no command-line agent
 * plays it in the terminal, so listing it there offered a brain the terminal
 * could not start (JJ, 7 Sep 2026). A stored list cannot put one of these back
 * in Terminal.
 */
export const CHAT_ONLY_PRESETS: readonly string[] = ['free']

/**
 * Whether a value is a declared space id.
 * @param value - the candidate, typically read off a wire body or a settings document.
 * @returns true when the table declares it.
 */
export function isSpaceId(value: unknown): value is SpaceId {
  return typeof value === 'string' && (SPACE_IDS as readonly string[]).includes(value)
}

/**
 * The declared row for one space.
 * @param id - the space id.
 * @returns the row.
 * @throws when the table declares no row for the id, which the table's own spec forbids.
 */
export function spaceById(id: SpaceId): SpaceDefinition {
  const row = SPACES.find(space => space.id === id)
  if (row === undefined) throw new Error(`@idealize/spaces: no declared space '${id}'`)
  return row
}

/** What the derivation ladder reads about one chat. */
export interface SpaceRecord {
  /** The space recorded by an `idealize/space` event, when the chat has one. */
  space?: SpaceId | undefined
  /** The chat's resolved agent preset id (header value, or the latest `agent-preset/selected`). */
  agentPreset?: string | undefined
}

/**
 * The space a chat is in, including chats made before spaces existed.
 *
 * Three branches, newest evidence first: a recorded `idealize/space` event
 * wins; otherwise a media agent preset names its own space (Gallery, Sound
 * Stage); otherwise the chat reads as Chat. Terminal is deliberately
 * underivable — a pre-spaces terminal launch wrote nothing durable, so a legacy
 * terminal chat reads as Chat rather than being guessed from a per-machine
 * browser store. This function only reads: no chat's log is ever rewritten.
 * @param record - what is known about the chat.
 * @returns the space id; never undefined, so the sidebar lane always has a glyph.
 */
export function deriveSpace(record: SpaceRecord): SpaceId {
  if (isSpaceId(record.space)) return record.space
  const byPreset = SPACES.find(space => space.agentPreset !== undefined && space.agentPreset === record.agentPreset)
  return byPreset?.id ?? DEFAULT_SPACE
}

/**
 * Which spaces one brain works in: the stored list when the user has set one,
 * otherwise the computed default.
 *
 * A {@link CHAT_ONLY_PRESETS} id works in Chat whatever is stored. Defaults
 * otherwise: a media agent preset works in its own space; an agent-role preset
 * works in none (it answers to the person, not to a space); every other brain
 * works in Chat and Terminal, the pair the other activity agents serve.
 * @param presetId - the brain's agent preset id.
 * @param rolePresets - preset ids seeded as agent roles (`@idealize/comm`'s `projectAgentPreset`).
 * @param stored - the settings document's list for this preset, when it holds one.
 * @returns the launchable space ids this brain is offered in, in table order; never Studio.
 */
export function presetSpaces(
  presetId: string,
  rolePresets: readonly string[],
  stored?: readonly string[],
): SpaceId[] {
  if (CHAT_ONLY_PRESETS.includes(presetId)) return ['chat']
  if (stored !== undefined) return LAUNCHABLE_SPACE_IDS.filter(id => stored.includes(id))
  const own = SPACES.find(space => space.agentPreset === presetId)
  if (own !== undefined) return [own.id]
  if (rolePresets.includes(presetId)) return []
  return ['chat', 'terminal']
}
