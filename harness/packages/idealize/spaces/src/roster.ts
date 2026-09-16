/**
 * The space roster read: the payload `GET /idealize/spaces` serves, and the
 * pure composition behind it.
 *
 * THE PAYLOAD FIELDS CARRY THE PRODUCT INVARIANT: the space chooser offers,
 * the brain screen explains. A space tile reads {@link SpaceRosterEntry.id} and
 * {@link SpaceRosterEntry.brainCount} and nothing else, so no tile is ever
 * dimmed, disabled or hidden — Motion with no brains and no backend is still an
 * ordinary tile reading "No brains yet". {@link SpaceRosterEntry.brains},
 * {@link SpaceRosterEntry.models}, {@link SpaceRosterEntry.reason} and
 * {@link SpaceRosterEntry.recovery} exist for the second screen alone: the
 * brains it offers, and every refusal, cause and way forward, stated there
 * once where the user can act on it. One fetch serves both screens, so the two
 * never disagree. A surface that renders `reason` or `recovery` on a tile
 * breaks the invariant this payload exists to enforce.
 * @module @idealize/spaces/roster
 */

import type { CapabilityRequirement, GenerationAvailability } from '@idealize/generate'
import { LAUNCHABLE_SPACES, presetSpaces, SPACES, type SpaceDefinition, type SpaceId } from './space-table.ts'

/** The route serving {@link spaceRoster}. */
export const ROSTER_PATH = '/idealize/spaces'

/** One declared media preset, as far as the capability lookup reads it. */
export interface CapabilityPreset {
  /** The preset id a space's `capability` field names. */
  id: string
  /** What a model must satisfy to serve the preset. */
  requiredCapabilities: readonly CapabilityRequirement[]
}

/**
 * The capability requirement behind each media space, resolved once against
 * the declared media presets.
 *
 * Both tables are code, so a space naming a preset that does not exist is a
 * build error rather than a runtime condition: it throws here, at load, rather
 * than making every later availability read report a missing backend.
 * @param presets - the declared media presets (`MEDIA_PRESETS` of `@idealize/generate`).
 * @returns the requirement set per capability id, for the media spaces only.
 * @throws when a declared space names a media preset the list does not carry.
 */
export function spaceCapabilityRequirements(
  presets: readonly CapabilityPreset[],
): Map<string, readonly CapabilityRequirement[]> {
  const resolved = new Map<string, readonly CapabilityRequirement[]>()
  for (const space of SPACES) {
    if (space.capability === undefined) continue
    const preset = presets.find(row => row.id === space.capability)
    if (preset === undefined) {
      throw new Error(
        `@idealize/spaces: space '${space.id}' names media preset '${space.capability}', which is not declared`,
      )
    }
    resolved.set(space.capability, preset.requiredCapabilities)
  }
  return resolved
}

/**
 * Why a space cannot be entered from here, as the brain step explains it.
 *
 * `no-backend` and `no-compatible-model` come verbatim from the generation
 * seam's own availability verdict (`@idealize/generate`); `no-model` says no
 * chat model resolves at all; `desktop-only` says the space needs the desktop
 * app this surface is not running in.
 */
export type SpaceReason = 'no-backend' | 'no-compatible-model' | 'no-model' | 'desktop-only'

/** One brain the brain step offers for a space. */
export interface SpaceBrain {
  /** The agent preset id this brain runs; the value the launch selects. */
  id: string
  /** Display name from the preset's own metadata, falling back to the id. */
  name: string
  /**
   * The model this brain overrides to. Absent means the brain follows the
   * deployment default, which the row states rather than naming a model the
   * user never chose.
   */
  model?: { provider: string; model: string }
  /** Set on the one brain the space starts with unless the user picks another. */
  default?: true
}

/** One space as both welcome steps read it. */
export interface SpaceRosterEntry {
  /** The declared space id. */
  id: SpaceId
  /**
   * How many brains declare they work in this space. The tile's only number,
   * and the only field a tile may read besides the id.
   */
  brainCount: number
  /**
   * The brains themselves, in roster order, for the brain step to list. Always
   * {@link SpaceRosterEntry.brainCount} long, so a tile and its second screen
   * cannot disagree about what is there.
   */
  brains: SpaceBrain[]
  /**
   * Whether a model can serve this space from this surface. Read by the brain
   * step, never by a tile.
   */
  models: 'some' | 'none'
  /** Why `models` is `none`; absent while a model can serve the space. */
  reason?: SpaceReason
  /** The action that clears {@link SpaceRosterEntry.reason}; absent with it. */
  recovery?: string
  /**
   * With `no-compatible-model`: whether a stored provider key is what the
   * space waits on. False means the providers are connected and none offers
   * the artefact, so the brain step offers no key action.
   */
  keyMissing?: boolean
}

/** Shown when no generation service is composed at all, so no backend can register. */
const NO_GENERATION_RECOVERY
  = 'No generation backend is running. Enable a generation adapter plugin, then reopen this screen.'

/** Shown when neither the deployment default model nor the free route resolves. */
const NO_CHAT_MODEL_RECOVERY
  = 'No model is connected yet. Add a provider API key in Settings, then come back.'

/** Shown for a space the desktop app owns, on a surface that is not the desktop app. */
const DESKTOP_ONLY_RECOVERY
  = 'The terminal runs in the IDEalize desktop app. Open IDEalize there to use it.'

/** The provider route that serves models without a key of the user's own. */
const FREE_PROVIDER = 'freetokens'

/**
 * The settings sections the chat/terminal model read touches, restated here
 * the way `@idealize/generate` restates the activity section: each owning
 * plugin keeps the schema, and this package reads only the fields it needs.
 * Restating rather than importing also keeps the dependency one-way, so
 * `@idealize/activity-pills` stays free to read this package's space table.
 */
export interface ActivitySpacesSection {
  /** Which spaces each brain works in, keyed by agent preset id; absent entries take the computed default. */
  spaces?: Record<string, string[]> | undefined
  /** The per-brain model overrides; an entry proves at least one model resolves for a chat. */
  models?: Record<string, { provider: string; model: string } | undefined> | undefined
}

/** The three settings sections {@link chatModelResolves} reads, each absent when its plugin is not composed. */
export interface ChatModelSections {
  /** `idealize-activity-pills`: the per-brain model overrides (`@idealize/activity-pills` owns it). */
  activity?: ActivitySpacesSection | undefined
  /** `agent-default-model`: the model every chat runs on unless a brain overrides it. */
  defaultModel?: { provider?: unknown; model?: unknown } | undefined
  /** `llm-pi-ai`: the provider routes, read for the free route's model list. */
  llm?: { providers?: Record<string, { models?: { id?: unknown }[] } | undefined> } | undefined
}

/**
 * Whether any model resolves for a chat: the deployment default, the free
 * route's first model, or a model a brain overrides to. This is the same
 * resolution `/idealize/activity/models` performs per pill, asked once for the
 * space as a whole — the brain step needs to know whether to offer brains or
 * to state that nothing can answer yet.
 * @param sections - the three settings sections, each absent when its plugin is not composed.
 * @returns true when at least one model resolves.
 */
export function chatModelResolves(sections: ChatModelSections): boolean {
  const { provider, model } = sections.defaultModel ?? {}
  if (typeof provider === 'string' && provider !== '' && typeof model === 'string' && model !== '') return true
  if (sections.llm?.providers?.[FREE_PROVIDER]?.models?.some(entry => typeof entry.id === 'string') === true) return true
  return Object.keys(sections.activity?.models ?? {}).length > 0
}

/** One usable agent preset, as far as the roster read looks at it. */
export interface RosterPreset {
  /** The preset id. */
  id: string
  /** Display name from the preset's metadata; the id when it published none. */
  name: string
  /** Which root supplied it: `system` ships with the deployment, `user` was authored locally. */
  trust: 'system' | 'user'
}

/**
 * The presets that are brains, out of everything the agent-preset roster
 * supplies.
 *
 * A `system` preset ships with the deployment: `standard` — the composition
 * every seeded brain is derived from — plus whatever else the install carries.
 * None of them is a brain. They are read-only, `/idealize/activity/agents`
 * already excludes them from the Brains pane, and counting them would put a
 * number on a tile that no screen can account for.
 * @param presets - the usable presets the roster supplied.
 * @returns the presets that are brains, in roster order.
 */
export function brainPresets(presets: readonly RosterPreset[]): RosterPreset[] {
  return presets.filter(preset => preset.trust === 'user')
}

/** Everything {@link spaceRoster} reads, gathered by the route from live services. */
export interface SpaceRosterFacts {
  /** Every usable agent preset on the roster; {@link brainPresets} decides which are brains. */
  presets: readonly RosterPreset[]
  /** Preset ids the deployment maps to agent roles, which answer to the person and to no space. */
  rolePresets: readonly string[]
  /** The `spaces` map of the `idealize-activity-pills` section, keyed by preset id. */
  storedSpaces: Readonly<Record<string, readonly string[] | undefined>>
  /** The `models` map of the same section: each brain's own model override. */
  storedModels: Readonly<Record<string, { provider: string; model: string } | undefined>>
  /** The roster default preset id, which marks the default brain of a space that declares no agent. */
  defaultPreset: string
  /**
   * Availability per `MEDIA_PRESETS` id, as the generation seam reports it.
   * `undefined` means no generation service is composed, which is not the same
   * as a composed service with no backend registered.
   */
  mediaAvailability: Readonly<Record<string, GenerationAvailability>> | undefined
  /** Whether any chat model resolves ({@link chatModelResolves}). */
  chatModel: boolean
  /** Whether the desktop shell is present, which the terminal space needs. */
  desktopShell: boolean
}

/** The models verdict for one space, without the id and count the tile reads. */
type ModelsVerdict = Pick<SpaceRosterEntry, 'models' | 'reason' | 'recovery' | 'keyMissing'>

function refusal(reason: SpaceReason, recovery: string, keyMissing?: boolean): ModelsVerdict {
  return { models: 'none', reason, recovery, ...keyMissing === undefined ? {} : { keyMissing } }
}

function verdictFor(space: SpaceDefinition, facts: SpaceRosterFacts): ModelsVerdict {
  if (space.requiresDesktopShell === true && !facts.desktopShell) {
    return refusal('desktop-only', DESKTOP_ONLY_RECOVERY)
  }
  if (space.capability === undefined) {
    return facts.chatModel ? { models: 'some' } : refusal('no-model', NO_CHAT_MODEL_RECOVERY)
  }
  // No generation service composed, and a composed service that reports
  // nothing for this capability, are the same answer to the brain step: no
  // backend can serve the space here.
  const availability = facts.mediaAvailability?.[space.capability]
  if (availability === undefined) return refusal('no-backend', NO_GENERATION_RECOVERY)
  return availability.state === 'available'
    ? { models: 'some' }
    : refusal(availability.reason, availability.recovery, availability.keyMissing)
}

/**
 * The brain a space starts on: the agent the space declares, otherwise the
 * roster default when it works here, otherwise the first brain listed. A space
 * with no brains marks none.
 */
function defaultBrainId(space: SpaceDefinition, brains: readonly RosterPreset[], rosterDefault: string): string | undefined {
  const ids = brains.map(brain => brain.id)
  if (space.agentPreset !== undefined && ids.includes(space.agentPreset)) return space.agentPreset
  if (ids.includes(rosterDefault)) return rosterDefault
  return ids[0]
}

/**
 * Compose the roster every welcome step reads: one entry per launchable space,
 * in chooser order, each carrying its brains and its models verdict. Studio has
 * no entry: nothing launches it.
 * @param facts - the live reads the route gathered.
 * @returns one entry per launchable space, in the table's chooser order.
 */
export function spaceRoster(facts: SpaceRosterFacts): SpaceRosterEntry[] {
  const brains = brainPresets(facts.presets)
  const worksIn = new Map(brains.map(brain =>
    [brain.id, presetSpaces(brain.id, facts.rolePresets, facts.storedSpaces[brain.id])]))
  return LAUNCHABLE_SPACES.map((space) => {
    const here = brains.filter(brain => worksIn.get(brain.id)?.includes(space.id) === true)
    const marked = defaultBrainId(space, here, facts.defaultPreset)
    return {
      id: space.id,
      brainCount: here.length,
      brains: here.map((brain) => {
        const model = facts.storedModels[brain.id]
        return {
          id: brain.id,
          name: brain.name,
          ...model === undefined ? {} : { model },
          ...brain.id === marked ? { default: true as const } : {},
        }
      }),
      ...verdictFor(space, facts),
    }
  })
}
