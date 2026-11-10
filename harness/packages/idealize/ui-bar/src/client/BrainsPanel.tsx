/**
 * The Brains drawer pane (Paper "Brains rethink", boards 10, 11 and 12, approved
 * by JJ on 4 Nov 2026): three tabs under one header (Brains, Accounts,
 * Auto-switch), with one row per brain and a plain mark for whether it can
 * answer (JJ: "i also like the stronger indicator to say whether or not
 * something is actually working"). The stored tab ids stay usage, models and
 * router; only the words changed.
 *
 * - Brains — one row per brain, because a brain is one record whose `spaces`
 *   list names where it works: For conversation, For making, then Behind the
 *   scenes for the brains that work in no space. A row states the brain's model as text and
 *   carries an Edit; the edit sheet is the one place a model is chosen (JJ,
 *   7 Sep 2026: "drop down not needed in brains - just choose model in
 *   edit"). The sheet's selects list providers and models in alphabetical
 *   order (JJ, 7 Sep 2026), whatever order the routes serve them in; every
 *   provider is named by one rule ({@link providerDisplayName}), a filter
 *   field narrows the list once it passes {@link MODEL_FILTER_FROM} models,
 *   and a note under the select states how many models the catalogues hold
 *   and when they were read, so a model no service has published yet is
 *   explained rather than silently absent (JJ, 8 Sep 2026: "gpt 6 is not
 *   available"). Free's model is
 *   stated because the free-tokens route resolves it. A generating space
 *   also states its generation model from `/idealize/brains/media` on the
 *   row of the brain confined to it, or on the space's own row while no such
 *   brain exists; a space with no compatible model renders the live
 *   unavailable verdict with the shared localised recovery and add-key
 *   action, so a space lights up the day a compatible model appears. A brain
 *   whose chat route cannot be reached says what clears it under its row: a
 *   key for a keyed route, a sign-in for a subscription. The Terminal group's
 *   rows keep a CLI select: which CLI a fresh shell types is a launch choice,
 *   and the sheet does not ask it.
 *   Agent roles list below in their own section — the brains that answer to the
 *   person and to no space (Project Coordinator, anything Add agent role
 *   creates). The Project Coordinator row IS the role: which preset
 *   plays it stays in `@idealize/comm`'s settings, and the pane offers no
 *   second picker for it (JJ, 7 Sep 2026: the two sections read as one role
 *   twice). Any row's Edit opens the in-pane edit sheet, which asks the
 *   spaces first, then the model those spaces narrow it to, then the
 *   instructions sent with every message the brain handles. A brain confined
 *   to one generating space has two models — what it generates with, and the
 *   chat model that drives the generation tool — and the sheet asks both, so
 *   a generating brain can be moved off an unreachable default route without
 *   changing that default for every other brain.
 *   Every save raises {@link notifyBrainsChanged}, so the welcome card's
 *   roster follows the pane without a reload, and a chat already running the
 *   saved brain is moved onto its new model so the composer's model seat
 *   agrees with the sheet (JJ, 10 Sep 2026). The router's switch and
 *   sliders show for a chat brain opened from any group but Terminal, with a
 *   line saying they apply in Chat when the brain also works there: a
 *   Terminal chat runs a command-line agent the router cannot reach
 *   (JJ, 22 Sep 2026).
 * - Models — Subscriptions (OAuth providers), Token Use (keyed providers)
 *   and the Free Token Use heading. The free-token engine has no controls
 *   here: it picks its provider on the priorities of the brain that asks,
 *   which the model router sends with each request (JJ, 21 Sep 2026).
 * - Budget left this pane on 24 Sep 2026 for the Time & cost pane
 *   (WorkPanel.tsx, BudgetSection.tsx), where the token and cost tables sit
 *   under each project's working time.
 *
 * Everything reads and writes the loopback /idealize routes of
 * @idealize/models, @idealize/activity-pills and @idealize/comm; the provider
 * editor (add a key, edit models) is upstream's Models settings page,
 * re-hosted behind the Token Use "+" and "Manage" actions.
 */
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ModelsSettingsSectionHost, ModelsSectionInjected } from '@deepseek-ai/dsh-client-ui-settings-models/client'
import type { SpaceId, SpaceRosterEntry } from '@idealize/spaces/client'
import type { BrainsRequest } from './bar-store.ts'
import { notifyBrainsChanged } from './brains-changed.ts'
import { providerDisplayName, when } from './format.ts'
import { SPACE_LABELS } from './HeroLauncher.tsx'
import type { BarKey } from './locales.ts'
import { mediaRecoveryText } from './media-recovery.ts'
import { chatModel, mediaModel, PRICE_UNIT } from './model-browser.ts'
import type { BrowserKind, BrowserModel, ChatModelDetail, MediaCandidateModel, RatingMap } from './model-browser.ts'
import { ModelBrowser } from './ModelBrowser.tsx'
import type { BrowserExample } from './ModelBrowser.tsx'
import { RouterTab } from './RouterTab.tsx'
import { SectionHead } from './SectionHead.tsx'
import { GatewayRow } from './GatewayRow.tsx'
import css from './BrainsPanel.module.css'

export { providerDisplayName } from './format.ts'

/** Mutating /idealize routes require the auth marker (host route fence). */
const HEADERS = { 'x-idealize-auth': '1', 'content-type': 'application/json' }

/** The upstream provider editor, delivered through the Context (index.ts). */
export interface BrainsPanelHost {
  models: { Component: ModelsSettingsSectionHost['Component']; props: ModelsSectionInjected }
  /**
   * Move the open chat onto a brain's model, when that chat is running the
   * brain. The pane knows what changed; only the plugin knows which chat is
   * open and how to write its model, so the sheet hands the id over and the
   * plugin decides whether anything follows.
   * @param brainId - the brain the sheet just saved.
   * @returns once the write settled, or at once when nothing follows.
   */
  followBrain: (brainId: string) => Promise<void>
}

type Tab = 'usage' | 'models' | 'router'
/** When the pane reads a newly connected service's models again. */
const CATALOGUE_REREADS_MS = [10_000, 60_000, 180_000]
/** What the host's connection check found. */
type ServiceCheck = 'working' | 'refused' | 'no-credit' | 'no-keys' | 'failed' | 'untested'
const TABS: readonly Tab[] = ['usage', 'models', 'router']

/** One provider route of the state payload. */
interface ProviderState {
  provider: string
  displayName: string
  auth: 'oauth' | 'apiKey' | 'free'
  connected: boolean
  models: string[]
  /** Where the model list comes from: the app's built-in catalogue, or the route's own configuration. */
  catalogue?: 'built-in' | 'configured'
}

/** The /idealize/models/state payload (host half of @idealize/models). */
interface ModelsState {
  mode: 'auto' | 'manual'
  default?: { provider: string; model: string } | null
  providers: ProviderState[]
  /** ISO instant the catalogues were read for this payload. */
  readAt?: string
}

/** One row of /idealize/activity/agents. */
/** Powell's brain id (the `powell` preset): it lists in its own section. */
const POWELL_ID = 'powell'

/**
 * Brains whose role moved elsewhere: the Studio Coordinator's preset stays on
 * disk with the person's edits, but Powell holds the Studio manager role
 * since 2.0.0, so the pane no longer lists it.
 */
const RETIRED = new Set(['studio-agent'])

const listed = (row: AgentRow): boolean => row.id !== POWELL_ID && !RETIRED.has(row.id)

interface AgentRow {
  id: string
  name: string
  /** What the brain is for, in the words of whoever wrote it. */
  description?: string
  activity: boolean
  /** The free-tokens route resolves this brain's model, so the row states it rather than offering a picker. */
  modelPinned: boolean
  /** The spaces this brain works in, in the declared table's order; empty for an agent role. */
  spaces: SpaceId[]
  model: { provider: string; model: string } | null
  /**
   * Whether a chat on this brain can open its first request now. `no-access`
   * means its route has no key (`signInOffered`: a sign-in would do too), and
   * `no-sign-in` that only a sign-in clears it.
   */
  access?: { state: 'ready' | 'confirm' | 'unavailable'; reason?: string; signInOffered?: true }
  /** The route's display name, when the sign-in surface offers the route. */
  providerName?: string
  overridden: boolean
  instructions: string
}

/** One catalogue entry of GET /idealize/terminal/launches: a CLI the terminal can launch. */
interface TerminalCliOption {
  id: string
  label: string
  command: string
  installed: boolean | null
}

/** The GET /idealize/terminal/launches payload (host half of @idealize/ui-terminal; absent outside the desktop app). */
interface TerminalLaunchesState {
  default: string
  byActivity: Record<string, string>
  catalog?: TerminalCliOption[]
}

/** One `terminal` row of /idealize/activity/agents: a route served by a command-line agent in the terminal. */
interface TerminalCliRow {
  provider: string
  cli: string
  installed: boolean | null
}

/** One /idealize/brains/media candidate: a backend and the model it serves, with what the browser shows of it. */
interface MediaCandidate {
  backend: string
  model: MediaCandidateModel
}

/** One route of GET /idealize/models/details: its chat models with what the browser shows of them. */
interface ChatDetailsProvider {
  provider: string
  displayName: string
  models: ChatModelDetail[]
}

/** What each generating preset makes, as the browser names it. */
const PRESET_KIND: Record<string, Exclude<BrowserKind, 'chat'> | undefined> = {
  images: 'image',
  motion: 'video',
  sound: 'audio',
}

/** One media preset's availability, as the route reports it. */
type MediaAvailability =
  | { state: 'available' }
  | { state: 'unavailable'; reason: 'no-backend' | 'no-compatible-model'; recovery: string; keyMissing?: boolean }

/**
 * One row of GET /idealize/brains/services: a service the person can connect,
 * chat route or generation backend alike, described by what it makes.
 */
interface ServiceRow {
  id: string
  kind: 'chat' | 'media'
  name: string
  makes: ('chat' | 'image' | 'video' | 'audio')[]
  connected: boolean
  keyUrl?: string
  signIn?: boolean
}

/** One row of GET /idealize/brains/media. */
interface MediaPresetRow {
  id: string
  name: string
  model: { backend: string; model: string } | null
  candidates: MediaCandidate[]
  availability: MediaAvailability
}

/**
 * Space names for the shipped media presets; an unknown id shows the route's
 * own name.
 *
 * RELABELLED, NEVER RENAMED. The ids key the user's stored model choices in the
 * `idealize-activity-pills` settings document (`@idealize/generate`'s
 * `storedMediaModel`), so `images` reads as Gallery and `sound` as Sound Stage
 * while both keep the id the document already holds. Renaming an id here would
 * silently discard every model choice the user has made.
 */
const MEDIA_LABEL_KEYS: Record<string, BarKey | undefined> = {
  images: 'brains.media.images',
  motion: 'brains.media.motion',
  sound: 'brains.media.sound',
}

/**
 * The media preset whose generation model each generating space runs on, by the
 * same ids {@link MEDIA_LABEL_KEYS} relabels. Chat and Terminal generate
 * nothing and carry no entry.
 *
 * Restated here rather than read off the roster payload, which serves a space's
 * brains and its availability but not the preset id behind them; the space
 * table (`@idealize/spaces`) is the source, and a client cannot value-import it.
 */
const SPACE_MEDIA: Partial<Record<SpaceId, string>> = {
  gallery: 'images',
  soundstage: 'sound',
  motion: 'motion',
}

/** The edit sheet's draft; `id` undefined = a new agent. */
interface Draft {
  id?: string
  name: string
  /** The model field: a chat model, or for a brain confined to one generating space that space's generation model. */
  model: string
  /**
   * The chat model of a brain confined to one generating space — the model
   * that drives its generation tool — as `provider model`, empty for the
   * default. Unused while the brain works in Chat or Terminal, where `model`
   * is already the chat model.
   */
  chatModel: string
  /**
   * The launch command a fresh Terminal shell types for this brain, as the
   * CLI catalogue states it; empty means the deployment default. Asked in the
   * sheet beside the model, because which CLI a brain runs and which model it
   * runs on are one decision (JJ, 10 Sep 2026) — the Terminal card used to
   * carry the CLI on its rows and the model nowhere.
   */
  cli: string
  instructions: string
  /**
   * The spaces this brain works in, as the sheet's checkboxes stand. Asked
   * first, because the answer narrows the model list below it, and saved into
   * the `spaces` map of the `idealize-activity-pills` section, so a brain added
   * for one space stays in that space's group across a reload. Empty is an
   * agent role: a brain that answers to the person and to no space.
   */
  spaces: SpaceId[]
  /**
   * The group whose row opened the sheet (`chat`, `terminal`, ...), absent
   * for a brain being added. The router's switch and sliders govern the
   * brain's chats only, so a sheet opened from the Terminal group leaves them
   * out (JJ, 22 Sep 2026): a Terminal chat runs a command-line agent that
   * picks its own model, and the controls read as a promise it cannot keep.
   */
  /** Whether the model router may move this brain's chats off its model; absent reads as yes. */
  routed?: boolean
  /** The brain's own routing criteria, once a slider has moved; absent leaves what the router holds. */
  criteria?: RouterCriteria
}

const ROUTER_LEVELS = ['conservative', 'balanced', 'aggressive'] as const
type RouterLevel = typeof ROUTER_LEVELS[number]
const ROUTER_PRIORITIES = ['cost', 'speed', 'intelligence'] as const

/**
 * "What matters most" (Paper "Brains rethink", board 11): three plain choices
 * that write the same three weights the fine-tune sliders do, so a stored brain
 * stays valid. The values are this pane's, chosen on 4 Nov 2026.
 */
const MATTERS = {
  cost: { cost: 90, speed: 50, intelligence: 20 },
  balanced: { cost: 50, speed: 50, intelligence: 50 },
  best: { cost: 10, speed: 50, intelligence: 90 },
} as const
type Matter = keyof typeof MATTERS
const MATTER_ORDER: readonly Matter[] = ['cost', 'balanced', 'best']

/**
 * Which plain choice a brain's weights read as. A brain's shipped row and a
 * fine-tuned one rarely match a choice exactly, so this reads the lean.
 * @param criteria - the brain's weights.
 * @param criteria.cost - how much low cost counts.
 * @param criteria.intelligence - how much intelligence counts.
 * @returns the choice to mark.
 */
export function matterOf(criteria: { cost: number; intelligence: number }): Matter {
  const lean = criteria.intelligence - criteria.cost
  if (lean >= 40) return 'best'
  return lean <= -40 ? 'cost' : 'balanced'
}

/** What each seeded brain is for. A brain somebody wrote reads its own description. */
const BRAIN_PURPOSES: Readonly<Record<string, BarKey>> = {
  coding: 'launcher.purpose.coding',
  design: 'launcher.purpose.design',
  writing: 'launcher.purpose.writing',
  admin: 'launcher.purpose.admin',
  free: 'launcher.purpose.free',
  gallery: 'launcher.purpose.gallery',
  soundstage: 'launcher.purpose.soundstage',
  motion: 'launcher.purpose.motion',
  video: 'launcher.purpose.motion',
}

/**
 * The names the app seeds its media brains with. They predate the words the
 * rethink settled on, so a row reads the new word until somebody renames the
 * brain. The stored name stays what it was.
 */
const SEEDED_NAMES: Readonly<Record<string, { name: string; label: SpaceId }>> = {
  gallery: { name: 'Gallery', label: 'gallery' },
  soundstage: { name: 'Sound Stage', label: 'soundstage' },
  video: { name: 'Video', label: 'motion' },
}

/** How a route's id reads where no catalogue names it, by the words a plain capital gets wrong. */
const ID_WORDS: Readonly<Record<string, string>> = { deepseek: 'DeepSeek', gpt: 'GPT', glm: 'GLM', openai: 'OpenAI', ai: 'AI' }

/**
 * A model's readable name from its route id, for when no catalogue has been read
 * yet: `deepseek/deepseek-v4-flash` reads DeepSeek V4 Flash.
 * @param id - the model id.
 * @returns the name to show.
 */
export function readableModelId(id: string): string {
  const last = id.slice(id.lastIndexOf('/') + 1).replace(/^~/, '').replace(/-latest$/, '').replace(/:[a-z]+$/, '')
  return last.split('-').filter(word => word !== '').map((word) => {
    const known = ID_WORDS[word.toLowerCase()]
    if (known !== undefined) return known
    return /^v?\d/.test(word) ? word.toUpperCase() : `${word.charAt(0).toUpperCase()}${word.slice(1)}`
  }).join(' ')
}

/** A catalogue name without the maker it opens with: `Google: Lyria 3` reads Lyria 3. */
const withoutMaker = (name: string): string => /^[^:]{2,40}:\s+(.+)$/.exec(name)?.[1] ?? name

/** The plans offered as a next step, by route. */
const PLAN_NAMES: Readonly<Record<string, BarKey>> = {
  anthropic: 'brains.accounts.planClaude',
  'openai-codex': 'brains.accounts.planChatGpt',
}

/** The keyed services offered as a next step, with why each is worth having. */
const NEXT_SERVICES: Readonly<Record<string, BarKey>> = {
  openrouter: 'brains.accounts.openrouter',
  fal: 'brains.accounts.fal',
}

/** The spaces whose work is a made thing, not a conversation. */
const MAKING_SPACES: ReadonlySet<SpaceId> = new Set<SpaceId>(['gallery', 'soundstage', 'motion'])
/** How readily a brain's chats move, and what a better model weighs for it, on the sliders' 0 to 100 scale. */
interface RouterCriteria { aggressiveness: RouterLevel; cost: number; speed: number; intelligence: number }
/** The /idealize/router/state payload, as far as the sheet reads it. */
interface RouterBrainsState {
  settings?: { offBrains?: string[]; aggressiveness?: RouterLevel }
  weights?: { cost: number; speed: number; intelligence: number }
  brains?: Record<string, Partial<RouterCriteria>>
  shippedBrains?: Record<string, Partial<RouterCriteria>>
}

/** Alphabetical, case-blind, with digit runs compared by value so `gpt-5.10` follows `gpt-5.9`. */
const byName = (left: string, right: string): number => left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' })

/**
 * The chat catalogue as every picker lists it: providers by display name,
 * each provider's models by id, both alphabetical. The routes serve their
 * lists in registration and catalogue order, which reads as random.
 */
function sortedProviders<T extends { displayName: string; models: string[] }>(providers: readonly T[]): T[] {
  return [...providers]
    .sort((left, right) => byName(left.displayName, right.displayName))
    .map(provider => ({ ...provider, models: [...provider.models].sort(byName) }))
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url)
    return response.ok ? await response.json() as T : null
  } catch {
    return null
  }
}

/** POST and keep the host's reason for a refusal, so the row can show it. */
async function postForReason(url: string, body: unknown): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch(url, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) })
    const parsed = response.headers.get('content-type')?.includes('json') === true
      ? await response.json() as { error?: unknown }
      : undefined
    const reason = typeof parsed?.error === 'string' ? parsed.error : undefined
    return { ok: response.ok, ...reason === undefined ? {} : { error: reason } }
  } catch {
    return { ok: false }
  }
}

/** POST a document as it was read, and keep what the host connected or why it refused. */
async function postDocument(url: string, text: string): Promise<{ ok: boolean; error?: string; connected: string[] }> {
  try {
    const response = await fetch(url, { method: 'POST', headers: HEADERS, body: text })
    const parsed = response.headers.get('content-type')?.includes('json') === true
      ? await response.json() as { error?: unknown; connected?: unknown }
      : undefined
    const reason = typeof parsed?.error === 'string' ? parsed.error : undefined
    const connected = Array.isArray(parsed?.connected)
      ? (parsed.connected as { name?: unknown }[]).map(row => typeof row.name === 'string' ? row.name : '').filter(name => name !== '')
      : []
    return { ok: response.ok, connected, ...reason === undefined ? {} : { error: reason } }
  } catch {
    return { ok: false, connected: [] }
  }
}

async function post(url: string, body: unknown): Promise<boolean> {
  try {
    return (await fetch(url, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) })).ok
  } catch {
    return false
  }
}

/**
 * Render the Brains pane.
 * @param props.host - the provider editor face (index.ts).
 * @param props.t - bar copy.
 * @returns the pane element tree.
 */
export function BrainsPanel({ host, request, onRequestHandled, t }: {
  host: BrainsPanelHost
  /** What another surface asked this pane to do; null when nothing is outstanding. */
  request?: BrainsRequest | null
  /** Mark {@link request} handled, so reopening the pane does not replay it. */
  onRequestHandled?: () => void
  t: (key: BarKey, params?: Record<string, string | number>) => string
}) {
  const [tab, setTab] = useState<Tab>('usage')
  const [state, setState] = useState<ModelsState | null>(null)
  const [agents, setAgents] = useState<AgentRow[] | null>(null)
  const [terminalClis, setTerminalClis] = useState<TerminalCliRow[]>([])
  const [launches, setLaunches] = useState<TerminalLaunchesState | null>(null)
  const [media, setMedia] = useState<MediaPresetRow[] | null>(null)
  const [services, setServices] = useState<ServiceRow[] | null>(null)
  /** The service whose key field is open, and the key typed so far. */
  const [serviceDraft, setServiceDraft] = useState<{ id: string; kind: 'chat' | 'media'; value: string } | null>(null)
  // Why the open key form's last Connect failed. Shown inside the form: the
  // pane's status line sits below every section, out of sight of a form open
  // halfway down the list, so a refused key looked like a dead button (JJ,
  // 30 Oct 2026: "nothing happens when i click").
  const [serviceError, setServiceError] = useState<{ id: string; kind: 'chat' | 'media'; message: string } | null>(null)
  /** What each service's last connection check found, by `kind:id`. */
  const [checks, setChecks] = useState<Record<string, ServiceCheck | 'checking'>>({})
  /** True while the "Add a service" picker is open over the connected list. */
  const [adding, setAdding] = useState(false)
  const [gatewaySet, setGatewaySet] = useState(false)
  /** The route an "Add key" asked for, until the services list can place it. */
  const [keyFor, setKeyFor] = useState<string | null>(null)
  const [spaces, setSpaces] = useState<SpaceRosterEntry[] | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [providerEditor, setProviderEditor] = useState(false)
  /** The sheet's More options, and its full instructions: both one click down. */
  const [serviceQuery, setServiceQuery] = useState('')
  const [moreOpen, setMoreOpen] = useState(false)
  const [instructionsOpen, setInstructionsOpen] = useState(false)
  /** The brain the chip asked to edit, held until the agents have loaded. */
  const [editing, setEditing] = useState<string | null>(null)
  /** The sheet field whose model browser is open, or null. */
  const [browsing, setBrowsing] = useState<'model' | 'chatModel' | null>(null)
  // The person's ratings, read each time the browser opens so a rating given from a chat shows on the card.
  const [ratings, setRatings] = useState<RatingMap | undefined>(undefined)
  useEffect(() => {
    if (browsing === null) return
    let live = true
    void getJson<{ models: RatingMap }>('/idealize/router/ratings').then((answer) => {
      if (live && answer !== null) setRatings(answer.models)
    })
    return () => { live = false }
  }, [browsing])
  const rate = async (model: BrowserModel, tag: string, stars: number | null): Promise<void> => {
    try {
      const response = await fetch('/idealize/router/ratings', {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({ kind: model.makes, provider: model.provider, model: model.id, tag, stars, label: model.name }),
      })
      if (response.ok) setRatings((await response.json() as { models: RatingMap }).models)
    } catch {
      // The card keeps what it showed; the next open reads the file again.
    }
  }
  /** Every chat model's description, abilities and price, read the first time a browser needs them. */
  const [chatDetails, setChatDetails] = useState<ChatDetailsProvider[] | null>(null)
  const [status, setStatus] = useState('')

  // The brains the model router leaves alone, for the sheet's routing choice.
  const [routerOff, setRouterOff] = useState<string[]>([])
  // Each brain's own criteria as the router would read them now: its saved fields, its shipped row, the app-wide values.
  const [routerBrains, setRouterBrains] = useState<RouterBrainsState | null>(null)
  const refreshRouterOff = useCallback(async () => {
    const next = await getJson<RouterBrainsState>('/idealize/router/state')
    setRouterBrains(next)
    setRouterOff(next?.settings?.offBrains ?? [])
  }, [])
  const refreshState = useCallback(async () => {
    setState(await getJson<ModelsState>('/idealize/models/state'))
  }, [])
  const refreshAgents = useCallback(async () => {
    const list = await getJson<{ agents: AgentRow[]; terminal?: TerminalCliRow[] }>('/idealize/activity/agents')
    setAgents(list?.agents ?? null)
    setTerminalClis(list?.terminal ?? [])
    const commands = await getJson<TerminalLaunchesState>('/idealize/terminal/launches')
    setLaunches(commands?.catalog === undefined ? null : commands)
  }, [])
  const refreshMedia = useCallback(async () => {
    const [presets, list] = await Promise.all([
      getJson<{ presets: MediaPresetRow[] }>('/idealize/brains/media'),
      getJson<{ services: ServiceRow[] }>('/idealize/brains/services'),
    ])
    setMedia(presets?.presets ?? null)
    setServices(list?.services ?? null)
  }, [])
  // The declared spaces in their declared order, which is the order the groups
  // render in: the roster route is the one place that order is stated.
  const refreshSpaces = useCallback(async () => {
    setSpaces((await getJson<{ spaces: SpaceRosterEntry[] }>('/idealize/spaces'))?.spaces ?? null)
  }, [])

  useEffect(() => {
    void refreshState()
    void refreshAgents()
    void refreshMedia()
    void refreshSpaces()
    void refreshRouterOff()
  }, [refreshState, refreshAgents, refreshMedia, refreshSpaces, refreshRouterOff])
  // A new brain has no answers to keep out of the way, so its sheet asks where
  // it works and how it should work from the start.
  const sheetOpen = draft !== null
  const addingBrain = draft !== null && draft.id === undefined
  useEffect(() => {
    if (!sheetOpen) setBrowsing(null)
    setMoreOpen(addingBrain)
    setInstructionsOpen(addingBrain)
  }, [sheetOpen, addingBrain])
  // The chat details are read once per pane: a row names its model by them,
  // the sheet its price, and the browser describes every model.
  const chatDetailsAsked = useRef(false)
  useEffect(() => {
    if (chatDetailsAsked.current) return
    chatDetailsAsked.current = true
    void getJson<{ providers: ChatDetailsProvider[] }>('/idealize/models/details').then((details) => {
      setChatDetails(details?.providers ?? [])
    })
  }, [])

  // The welcome card's brain step hands this pane the space with no brains, or
  // the provider key a refused space is waiting on. Acting on it once and
  // clearing it keeps a later reopen of the pane from replaying the flow.
  useEffect(() => {
    if (request === undefined || request === null) return
    setTab('usage')
    if (request.kind === 'add-brain') {
      setDraft({ name: '', model: '', chatModel: '', cli: '', instructions: '', spaces: [request.space as SpaceId] })
    } else if (request.kind === 'edit-brain') {
      setEditing(request.id)
    } else if (request.provider !== undefined) {
      setKeyFor(request.provider)
    } else {
      setProviderEditor(true)
    }
    onRequestHandled?.()
  }, [request, onRequestHandled])

  // "Add key" names a route, so it opens that route's own key field. The editor
  // sheet lists only routes already configured: OpenRouter was never on it, so
  // the button led nowhere (JJ, 4 Nov 2026). A route the list cannot place,
  // such as a custom provider, still goes to the sheet.
  useEffect(() => {
    if (keyFor === null || services === null) return
    setKeyFor(null)
    const row = services.find(entry => entry.id === keyFor && entry.signIn !== true)
    if (row === undefined) {
      setProviderEditor(true)
      return
    }
    setTab('models')
    setAdding(!row.connected)
    setServiceError(null)
    setServiceDraft({ id: row.id, kind: row.kind, value: '' })
  }, [keyFor, services])

  // ── Usage tab ──────────────────────────────────────────────────────────
  /**
   * A row's chat model as text: its own override, else the resolved default
   * marked as such, else "Default" while no model resolves at all.
   */
  /** A chat model by its readable name, without the maker the catalogue repeats. */
  const modelName = (model: { provider: string; model: string }): string => {
    const name = chatDetails?.find(row => row.provider === model.provider)?.models.find(row => row.id === model.model)?.name
    return name === undefined ? readableModelId(model.model) : withoutMaker(name)
  }
  /** How a model is paid for, in the three words the rethink settled on. */
  const costLabel = (model: { provider: string; model: string }): string => {
    const route = state?.providers.find(row => row.provider === model.provider)
    if (route?.auth === 'free' || model.provider === 'free-tokens' || model.model.endsWith(':free')) return t('brains.cost.free')
    return route?.auth === 'oauth' && route.connected && model.provider !== 'openrouter' ? t('brains.cost.plan') : t('brains.cost.payg')
  }
  /**
   * What a brain's row says it runs on: the model and how it is paid for. A
   * brain with no model of its own names the default it follows, so nobody has
   * to know what "default" means to read the row.
   * @param row - the brain.
   * @returns the text.
   */
  const chatModelText = (row: AgentRow): string => {
    const model = row.model ?? state?.default ?? null
    if (model === null) return t('brains.agent.followsDefault')
    const route = state?.providers.find(entry => entry.provider === model.provider)
    if (route?.auth === 'free' && model.model === 'auto') return t('brains.agent.freeAuto')
    return `${modelName(model)} · ${costLabel(model)}`
  }
  /**
   * Persist a launch choice: which CLI a fresh Terminal shell types for this
   * brain, or for every brain without its own choice when `activity` is
   * undefined. The command travels whole, so the host needs no catalogue.
   */
  const saveLaunch = async (activity: string | undefined, command: string): Promise<void> => {
    const ok = await post('/idealize/terminal/launch', activity === undefined ? { command } : { activity, command })
    setStatus(ok ? t('brains.cli.saved') : t('brains.cli.failed'))
    if (ok) {
      notifyBrainsChanged()
      await refreshAgents()
    }
  }
  /**
   * Connect a service with the key the person pasted. One call for both kinds:
   * the route knows where a chat route's key belongs and where a generation
   * backend's does, so this surface never has to.
   */
  const checkService = async (row: Pick<ServiceRow, 'id' | 'kind'>): Promise<void> => {
    const key = `${row.kind}:${row.id}`
    setChecks(now => ({ ...now, [key]: 'checking' }))
    try {
      const response = await fetch('/idealize/brains/services/check', { method: 'POST', headers: HEADERS, body: JSON.stringify({ id: row.id, kind: row.kind }) })
      const body = await response.json() as { check?: ServiceCheck }
      setChecks(now => ({ ...now, [key]: body.check ?? 'failed' }))
    } catch {
      setChecks(now => ({ ...now, [key]: 'failed' }))
    }
  }
  const connectService = async (row: ServiceRow, value: string): Promise<void> => {
    setStatus('')
    setServiceError(null)
    const outcome = await postForReason('/idealize/brains/services', { id: row.id, kind: row.kind, apiKey: value })
    if (!outcome.ok) {
      // The route knows why it refused — an environment variable already
      // supplying this key, say. Its reason beats a generic "check the key".
      setServiceError({ id: row.id, kind: row.kind, message: outcome.error ?? t('brains.services.failed') })
      return
    }
    setStatus(t('brains.services.saved'))
    setServiceDraft(null)
    setAdding(false)
    void checkService(row)
    notifyBrainsChanged()
    // The models a newly connected service offers must be selectable at once:
    // a person who pastes a key and sees nothing change reads it as failure.
    await Promise.all([refreshMedia(), refreshState(), refreshAgents()])
    // A large catalogue is still arriving after the reply, so its models are picked up as they land.
    for (const delay of CATALOGUE_REREADS_MS) setTimeout(() => { void refreshMedia() }, delay)
  }

  // Every connected service is tried once when the list arrives, so a key that stopped working shows here first.
  const checkedOnce = useRef(new Set<string>())
  useEffect(() => {
    for (const row of services ?? []) {
      const key = `${row.kind}:${row.id}`
      if (!row.connected || row.signIn === true || checkedOnce.current.has(key)) continue
      checkedOnce.current.add(key)
      void checkService(row)
    }
    // The free route's row asks too: its engine can hold no keys while the route still lists models.
    if (!checkedOnce.current.has('chat:freetokens') && state?.providers.some(provider => provider.provider === 'freetokens' && provider.connected) === true) {
      checkedOnce.current.add('chat:freetokens')
      void checkService({ id: 'freetokens', kind: 'chat' })
    }
  }, [services, state])

  /** The hidden file field the "Import a keys file" link opens. */
  const keysFileField = useRef<HTMLInputElement>(null)

  /**
   * Connect every service a keys file names in one go. The file is sent as it
   * was read: the host owns what a keys file may say and answers with the
   * services it connected, or the one line it refused on.
   */
  const importKeysFile = async (file: File): Promise<void> => {
    setStatus('')
    const outcome = await postDocument('/idealize/brains/services/import', await file.text())
    if (!outcome.ok) {
      setStatus(outcome.error ?? t('brains.services.failed'))
      return
    }
    setStatus(t('brains.services.imported', { services: outcome.connected.join(', ') }))
    setServiceDraft(null)
    setAdding(false)
    notifyBrainsChanged()
    await Promise.all([refreshMedia(), refreshState(), refreshAgents()])
  }

  /**
   * The rows on screen: what is connected, or — while adding — what is not,
   * media first so the services that make images, video and sound lead.
   */
  const generates = (row: ServiceRow): boolean => row.kind === 'media' || row.makes.some(kind => kind !== 'chat')
  // The free route keeps its own row: its key only opens the local engine, so "change key" means nothing there.
  const connectedServices = (services ?? []).filter(row => row.connected && row.id !== 'freetokens')
  /** Whether a service can run a model: one this list names as unconnected cannot. */
  /** Whether the service itself said this account cannot run: a refused key or no credit, never a check that got no answer. */
  const confirmedDown = (kind: ServiceRow['kind'], id: string): boolean => {
    const check = checks[`${kind}:${id}`]
    return check === 'refused' || check === 'no-credit'
  }
  const backendRuns = (backend: string): boolean => !(services ?? []).some(service => service.id === backend && !service.connected)
  /**
   * Whether a generating route can run. The route reports `available` from public
   * catalogues, so a service with no key still lists its models.
   * @param row - the media preset.
   * @returns whether a generation would reach a service with a key.
   */
  const mediaRuns = (row: MediaPresetRow): boolean => row.availability.state === 'available'
    && row.candidates.some(candidate => backendRuns(candidate.backend) && !confirmedDown('media', candidate.backend))
  // The next steps name services by id, so a route with two rows offers one.
  const nextServices = Object.keys(NEXT_SERVICES).flatMap((id) => {
    if ((services ?? []).some(row => row.id === id && row.connected)) return []
    const row = (services ?? []).find(entry => entry.id === id && entry.signIn !== true)
    return row === undefined ? [] : [row]
  })
  const matchesQuery = (name: string): boolean => name.toLowerCase().includes(serviceQuery.trim().toLowerCase())
  const visibleServices = (services ?? [])
    .filter(row => !row.connected && !nextServices.includes(row) && matchesQuery(row.name))
    .sort((left, right) => generates(left) === generates(right) ? 0 : generates(left) ? -1 : 1)

  /** What a service makes, in the person's words; a service with an empty catalogue says so. */
  const makesLabel = (row: ServiceRow): string =>
    row.makes.length === 0
      ? t('brains.services.makesNothing')
      : row.makes.map(kind => t(`brains.services.makes.${kind}`)).join(' · ')


  /** The generation-model row a space carries, when the space generates. */
  const mediaOf = (space: SpaceId): MediaPresetRow | undefined => {
    const preset = SPACE_MEDIA[space]
    return preset === undefined ? undefined : (media ?? []).find(row => row.id === preset)
  }
  /**
   * The generation-model row a draft's model field stands for: the one a brain
   * confined to a single generating space runs on. A brain that works in Chat
   * or Terminal takes a chat model instead, so it has none.
   */
  const mediaForSpaces = (chosen: readonly SpaceId[]): MediaPresetRow | undefined => {
    const only = chosen.length === 1 ? chosen[0] : undefined
    return only === undefined ? undefined : mediaOf(only)
  }
  /** The criteria the router reads for a brain now; a brain being created has no id and starts from the app-wide values. */
  const criteriaOf = (id: string | undefined): RouterCriteria | undefined => {
    if (routerBrains === null) return undefined
    const own = id === undefined ? {} : { ...routerBrains.shippedBrains?.[id], ...routerBrains.brains?.[id] }
    return {
      aggressiveness: own.aggressiveness ?? routerBrains.settings?.aggressiveness ?? 'balanced',
      cost: Math.round(own.cost ?? routerBrains.weights?.cost ?? 34),
      speed: Math.round(own.speed ?? routerBrains.weights?.speed ?? 33),
      intelligence: Math.round(own.intelligence ?? routerBrains.weights?.intelligence ?? 33),
    }
  }
  /** Whether the sheet shows the router's switch and sliders: a chat brain, opened from any group but Terminal. */
  const routerShown = draft !== null && draft.spaces.includes('chat')
  const draftPurposeKey = draft?.id === undefined ? undefined : BRAIN_PURPOSES[draft.id]
  const draftPurpose = draftPurposeKey === undefined
    ? (agents ?? []).find(row => row.id === draft?.id)?.description ?? ''
    : t(draftPurposeKey)
  const beginEdit = (row: AgentRow): void => {
    const generation = mediaForSpaces(row.spaces)
    const chatModel = row.overridden && row.model !== null ? `${row.model.provider} ${row.model.model}` : ''
    setDraft({
      id: row.id,
      name: row.name,
      model: generation !== undefined
        ? (generation.model === null ? '' : `${generation.model.backend} ${generation.model.model}`)
        : chatModel,
      chatModel,
      cli: launches?.byActivity[row.id] ?? '',
      instructions: row.instructions,
      spaces: row.spaces,
      routed: !routerOff.includes(row.id),
    })
  }
  useEffect(() => {
    if (editing === null || agents === null) return
    const row = agents.find(agent => agent.id === editing)
    setEditing(null)
    if (row !== undefined) beginEdit(row)
    // beginEdit closes over the media table, which the same pane read loads.
  }, [editing, agents])
  const saveDraft = async (): Promise<void> => {
    if (draft === null) return
    const generation = mediaForSpaces(draft.spaces)
    const [provider, model] = draft.model.split(' ')
    const chosen = draft.model === '' ? null : { provider: provider ?? '', model: model ?? '' }
    const [chatProvider, chatModelId] = draft.chatModel.split(' ')
    const chatChosen = draft.chatModel === '' ? null : { provider: chatProvider ?? '', model: chatModelId ?? '' }
    // A brain in a generating space generates on that space's model, which
    // the media route owns; its own model override is the chat model that
    // drives the generation tool, and the two vocabularies stay apart.
    let ok = await post('/idealize/activity/agent', {
      ...draft.id === undefined ? {} : { id: draft.id },
      name: draft.name,
      model: generation === undefined ? chosen : chatChosen,
      instructions: draft.instructions,
      spaces: draft.spaces,
    })
    if (ok && generation !== undefined && chosen !== null) {
      ok = await post('/idealize/brains/media', {
        id: generation.id,
        model: { backend: chosen.provider, model: chosen.model },
      })
    }
    // A brain being created has no id until the route answers, so the writes
    // keyed by id are made against the row that comes back.
    const savedId = ok ? draft.id ?? (await agentIdNamed(draft.name)) : undefined
    // The CLI a Terminal shell types is the terminal plugin's setting, keyed
    // by the brain's id.
    if (ok && savedId !== undefined && draft.spaces.includes('terminal')) {
      ok = await post('/idealize/terminal/launch', { activity: savedId, command: draft.cli })
    }
    setStatus(ok ? t('brains.agent.saved') : t('brains.agent.failed'))
    if (ok && savedId !== undefined && (draft.routed ?? true) === routerOff.includes(savedId)) {
      // The router keeps the list of brains it leaves alone; the sheet adds or removes this one.
      const offBrains = draft.routed ?? true ? routerOff.filter(id => id !== savedId) : [...routerOff, savedId]
      if (await post('/idealize/router/settings', { offBrains })) setRouterOff(offBrains)
    }
    if (ok && savedId !== undefined && draft.criteria !== undefined && draft.spaces.includes('chat')) {
      // The router keeps each brain's criteria beside the list of brains it leaves alone.
      if (await post('/idealize/router/brain', { brain: savedId, ...draft.criteria })) await refreshRouterOff()
    }
    if (ok) {
      setDraft(null)
      notifyBrainsChanged()
      // A chat running this brain takes the model the sheet just chose, so the
      // composer stops naming the one the brain ran under before.
      if (savedId !== undefined) await host.followBrain(savedId)
      await refreshAgents()
      await refreshMedia()
    }
  }

  /**
   * The id of the brain answering to one name, read back after a create.
   * @param name - the name the sheet saved.
   * @returns the id, or undefined when the roster does not name it.
   */
  const agentIdNamed = async (name: string): Promise<string | undefined> => {
    const list = await getJson<{ agents: AgentRow[] }>('/idealize/activity/agents')
    return list?.agents.find(row => row.name === name)?.id
  }

  // ── Models tab ─────────────────────────────────────────────────────────
  // Signed-in subscriptions, or ones whose route is configured; the rest of
  // the OAuth catalogue waits behind "+" (the sign-in page).
  const subscriptions = state?.providers.filter(p => p.auth === 'oauth' && (p.connected || p.models.length > 0)) ?? []
  // Keyed routes the user has touched: a stored key or a configured model
  // list. The rest of the catalogue waits behind "+" (the provider editor).
  /** A route's name anywhere in the pane: one rule ({@link providerDisplayName}) over the state payload's entry. */
  const providerName = (provider: string): string =>
    providerDisplayName(provider, state?.providers.find(p => p.provider === provider)?.displayName)
  /** The CLI serving a route in the terminal, when the route is terminal-only. */
  const cliFor = (provider: string): TerminalCliRow | undefined => terminalClis.find(row => row.provider === provider)
  /** Whether the route has a stored API key, so chats reach it directly. */
  const connectedFor = (provider: string): boolean => state?.providers.find(p => p.provider === provider)?.connected === true
  /** A provider's picker group label: its name, marked when its models run as a CLI in the terminal. */
  const providerLabel = (provider: { provider: string; displayName: string }): string => {
    const name = providerDisplayName(provider.provider, provider.displayName)
    const cli = cliFor(provider.provider)
    // With a key stored the chat reaches the route directly, so the mark would mislead.
    if (cli === undefined || connectedFor(provider.provider)) return name
    return t('brains.model.cli', { provider: name, cli: cli.cli })
  }
  const free = state?.providers.find(p => p.auth === 'free')
  const connectedPlans = subscriptions.filter(provider => provider.connected)
  const nextPlans = subscriptions.filter(provider => !provider.connected && PLAN_NAMES[provider.provider] !== undefined)
  // A plan nobody here is likely to reach for stays one search away, not gone.
  const otherPlans = subscriptions.filter(provider => !provider.connected && PLAN_NAMES[provider.provider] === undefined)
  // Sorted by the name as shown, which is the resolved one, not the raw payload field.
  const modelOptions = sortedProviders(
    (state?.providers.filter(p => p.models.length > 0) ?? [])
      .map(p => ({ ...p, displayName: providerDisplayName(p.provider, p.displayName) })),
  )
  const catalogueModels = modelOptions.reduce((sum, provider) => sum + provider.models.length, 0)
  /**
   * Where the route's models are served: an option's group label helps the
   * pickers, this line helps the row. It names what clears the refusal — a
   * key for a keyed route, a sign-in for a subscription — and offers it.
   */
  const accessNote = (row: AgentRow): ReactNode => {
    if (row.access?.state !== 'unavailable') return null
    const cli = row.model === null ? undefined : cliFor(row.model.provider)
    const terminalOnly = row.access.reason === 'terminal-only' || (row.access.reason === 'no-access' && cli !== undefined)
    const signIn = row.access.reason === 'no-sign-in'
    // The route's name where a directory knows it, else by the pane's one naming rule.
    const provider = row.providerName ?? (row.model === null ? '' : providerName(row.model.provider))
    return (
      <span className={css.rowAccess} data-brain-access={terminalOnly ? 'terminal-only' : row.access.reason}>
        {row.access.reason === 'no-model' && t(row.id === 'free' ? 'brains.agent.freeNotSetUp' : 'brains.agent.unassigned')}
        {row.access.reason === 'no-model' && row.id === 'free' && (
          <a className={css.chip} href="/idealize/freetokens" target="_blank" rel="noreferrer" data-brain-free-setup="">
            {t('brains.agent.setUp')}
          </a>
        )}
        {row.access.reason !== 'no-model' && terminalOnly && t('brains.agent.terminalOnly', { cli: cli?.cli ?? '' })}
        {signIn && t('brains.agent.noSignIn', { provider })}
        {row.access.reason !== 'no-model' && !terminalOnly && !signIn && t('brains.agent.noKey', { provider })}
        {signIn
          ? (
            <a className={css.chip} href="/idealize/signin" target="_blank" rel="noreferrer">
              {t('brains.agent.signIn')}
            </a>
          )
          : row.access.reason !== 'no-model' && (
            <button type="button" className={css.chip} onClick={() => { if (row.model === null) setProviderEditor(true); else setKeyFor(row.model.provider) }}>
              {t('brains.agent.addKey')}
            </button>
          )}
        {row.access.signInOffered === true && !terminalOnly && (
          <a className={css.chip} href="/idealize/signin" target="_blank" rel="noreferrer">
            {t('brains.agent.signIn')}
          </a>
        )}
      </span>
    )
  }

  // A brain works in the spaces its `spaces` list names, and lists under each
  // of them; a brain naming none is an agent role, which answers to the person.
  // Powell (the desktop owl and Studio manager) is no space's brain and no
  // role another agent calls: it lists on its own (JJ, 2 Oct 2026).
  const brainsIn = (space: SpaceId): AgentRow[] => (agents ?? []).filter(row => listed(row) && row.spaces.includes(space))
  const roleAgents = (agents ?? []).filter(row => listed(row) && row.spaces.length === 0)
  const powellAgent = (agents ?? []).find(row => row.id === POWELL_ID)
  // One row per brain: a brain confined to one generating space makes things,
  // and every other brain with a place to work holds a conversation.
  const placedBrains = (agents ?? []).filter(row => listed(row) && row.spaces.length > 0)
  const makingBrains = placedBrains.filter(row => row.spaces.every(id => MAKING_SPACES.has(id)))
  const conversationBrains = placedBrains.filter(row => !makingBrains.includes(row))
  /** What the open sheet's model field is picking: a space's generation model, or a chat model. */
  const sheetGeneration = draft === null ? undefined : mediaForSpaces(draft.spaces)
  /** The chat catalogue as a sheet field lists it: the default first, then every provider's models the filter leaves. */
  // A native menu draws an optgroup label small and grey, which at 650 models
  // reads as more list. The rules make each group findable while scrolling
  // (JJ, 10 Sep 2026).
  /** The chat catalogue as the browser lists it: every route's models, described where the details route knows them. */
  const chatBrowserModels = (): BrowserModel[] => modelOptions.flatMap((provider) => {
    const described = chatDetails?.find(row => row.provider === provider.provider)?.models
    return provider.models.map(id => chatModel(
      provider.provider,
      providerLabel(provider),
      described?.find(row => row.id === id) ?? { id, name: id },
      t,
      providerLabel(provider),
    ))
  })
  /** The open sheet's generation catalogue as the browser lists it. */
  const mediaBrowserModels = (preset: MediaPresetRow): BrowserModel[] => {
    const kind = PRESET_KIND[preset.id] ?? 'image'
    return preset.candidates.map(candidate => mediaModel(
      candidate.backend,
      candidate.model,
      kind,
      services?.find(row => row.id === candidate.backend)?.name ?? candidate.backend,
      t,
    ))
  }
  /** One media model's example output, from the generation route; null when it has none or the read fails. */
  const fetchExample = async (backend: string, model: string): Promise<BrowserExample | null> => {
    const answer = await getJson<{ example: BrowserExample | null }>(
      `/idealize/brains/media/example?backend=${encodeURIComponent(backend)}&model=${encodeURIComponent(model)}`,
    )
    return answer?.example ?? null
  }
  /**
   * A model field of the sheet: the chosen model's picture, name and headline
   * price, and Change, which opens the browser over the window.
   */
  const modelField = (
    field: 'model' | 'chatModel', label: string, kind: BrowserKind, models: readonly BrowserModel[], value: string,
  ): ReactNode => {
    const chosen = models.find(row => row.value === value)
    const [, rawId] = value.split(' ')
    const name = chosen?.name ?? (value === '' ? undefined : rawId)
    return (
      <span className={css.modelRow} role="group" aria-label={label} data-brains-model-row={field} data-value={value}>
        {/* No picture, no slot: chat models never have one, and an empty tile reads as a broken image. */}
        {chosen?.thumbnailUrl !== undefined && <img className={css.modelThumb} src={chosen.thumbnailUrl} alt="" />}
        <span className={css.modelText}>
          <span className={css.modelName} data-brains-model-name="">
            {name ?? (kind !== 'chat'
              ? t('browser.none')
              : state?.default === undefined || state.default === null
                ? t('browser.default')
                : t('browser.defaultIs', {
                  model: state.providers.find(entry => entry.provider === state.default?.provider)?.auth === 'free' && state.default.model === 'auto'
                    ? t('brains.agent.freeAuto')
                    : modelName(state.default),
                }))}
          </span>
          {chosen?.price.headline !== undefined && (
            <span className={css.modelPrice}>
              {chosen.price.headline} {chosen.price.comparable ? t(PRICE_UNIT[kind]).toLowerCase() : chosen.price.sub ?? ''}
            </span>
          )}
        </span>
        <button
          type="button"
          className={css.chip}
          data-brains-model-change={field}
          onClick={() => { setBrowsing(field) }}
        >
          {t('browser.change')}
        </button>
      </span>
    )
  }
  /** The note that says what the chat catalogue holds and when it was read. */
  const chatCatalogueAids = (): ReactNode => (
    <span className={css.fieldHint} data-brains-catalogue="">
      {t('brains.edit.catalogue', {
        models: catalogueModels,
        providers: modelOptions.length,
        time: state?.readAt === undefined ? '—' : when(state.readAt),
      })}
    </span>
  )
  /**
   * Tick or untick one space in the open sheet. The list is rebuilt from the
   * roster's order, so a stored list always reads back in the declared table's
   * order. A chosen model is dropped when the change moves the field between
   * catalogues — a chat model cannot stand as a space's generation model, and a
   * stale value would be saved into the wrong one.
   */
  const toggleSpace = (space: SpaceId, on: boolean): void => {
    if (draft === null || spaces === null) return
    const next = on
      ? spaces.filter(row => row.id === space || draft.spaces.includes(row.id)).map(row => row.id)
      : draft.spaces.filter(id => id !== space)
    const moved = mediaForSpaces(next)?.id !== sheetGeneration?.id
    setDraft({ ...draft, spaces: next, ...moved ? { model: '' } : {} })
  }

  /**
   * The CLI choice select over the launch catalogue. `resolved` is the command
   * a fresh shell would type now; a command outside the catalogue (set in
   * settings by hand) shows as its own option rather than being misread.
   * @param resolved - the command currently resolved for this scope.
   * @param label - the control's accessible name.
   * @param save - persists the chosen catalogue command.
   */
  const cliSelect = (resolved: string, label: string, save: (command: string) => void): ReactNode => {
    const matched = (launches?.catalog ?? []).find(entry => entry.command === resolved)
    // Only CLIs the login shell finds are offered; the current choice stays
    // visible even when missing, marked, so a selection is never misread.
    const catalog = (launches?.catalog ?? []).filter(entry => entry.installed !== false || entry.id === matched?.id)
    return (
      <select
        className={css.rowSelect}
        aria-label={label}
        value={matched === undefined ? 'custom' : `cli:${matched.id}`}
        onChange={(event) => {
          const entry = catalog.find(option => `cli:${option.id}` === event.target.value)
          if (entry !== undefined) save(entry.command)
        }}
      >
        {matched === undefined && <option value="custom">{t('brains.cli.custom', { command: resolved === '' ? '—' : resolved })}</option>}
        {catalog.map(entry => (
          <option key={entry.id} value={`cli:${entry.id}`}>
            {entry.installed === false ? t('brains.cli.notFound', { label: entry.label }) : entry.label}
          </option>
        ))}
      </select>
    )
  }

  /** The Terminal group's closing row: the CLI every brain without its own choice launches. */
  const defaultCliRow = (): ReactNode => {
    if (launches === null) return null
    return (
      <div className={css.row} role="row" data-terminal-default-cli="">
        <span className={css.cellKey}>{t('brains.cli.defaultRow')}</span>
        {cliSelect(launches.default, t('brains.cli.defaultRow'), (command) => { void saveLaunch(undefined, command) })}
      </div>
    )
  }

  /**
   * A space's generation model as text: the stored candidate's name (its id
   * when the live catalogue no longer lists it), else the candidate a generate
   * call falls to — the route's first — marked as the default.
   * @param row - the media preset the space runs on.
   * @returns the text.
   */
  const generationModelText = (row: MediaPresetRow): string => {
    if (row.model !== null) {
      const stored = row.model
      const listed = row.candidates.find(candidate => candidate.backend === stored.backend && candidate.model.id === stored.model)
      return listed === undefined ? stored.model : withoutMaker(listed.model.name)
    }
    // A generation falls to a compatible model, and only a connected service can
    // run it: the catalogues of the others are public.
    const first = row.candidates.find(candidate => backendRuns(candidate.backend)) ?? row.candidates[0]
    return first === undefined ? t('brains.media.choose') : withoutMaker(first.model.name)
  }

  /**
   * What a generating space's row states: its model as text, or the route's
   * reason, with a key action only when a key is what is missing. Both states
   * are read from the live route.
   * @param row - the media preset the space runs on.
   * @returns the row's value cell(s).
   */
  const generationCell = (row: MediaPresetRow): ReactNode => {
    if (row.availability.state !== 'available') {
      return (
        <>
          <span className={css.rowNote} data-media-reason={row.availability.reason}>
            {mediaRecoveryText(row.id, row.availability, t)}
          </span>
          {row.availability.reason === 'no-compatible-model' && row.availability.keyMissing === true && (
            <span className={css.cellAction}>
              <button type="button" className={css.chip} onClick={() => { setKeyFor('openrouter') }}>
                {t('brains.media.addKey')}
              </button>
            </span>
          )}
        </>
      )
    }
    if (!mediaRuns(row)) {
      const backend = row.candidates[0]?.backend
      const service = (services ?? []).find(entry => entry.id === backend)?.name
      return (
        <>
          <span className={css.rowNote} data-media-reason="no-connected-service">
            {service === undefined ? t('brains.media.needsAccountAny') : t('brains.media.needsAccount', { service })}
          </span>
          {backend !== undefined && (
            <span className={css.cellAction}>
              <button type="button" className={css.chip} onClick={() => { setKeyFor(backend) }}>{t('brains.agent.addKey')}</button>
            </span>
          )}
        </>
      )
    }
    const text = generationModelText(row)
    return <span className={css.rowNote} data-brain-model={text}>{text}</span>
  }

  /**
   * One editable preset's row: name, its model as text, and Edit — the sheet
   * behind Edit is where the model is chosen. Every group renders it, so a
   * row behaves the same wherever it sits — including in two groups at once,
   * which is why the caller supplies the key prefix.
   *
   * Free's model is pinned: the free-tokens route resolves it, so the sheet
   * offers no choice for it either.
   * @param row - the preset to render.
   * @param prefix - the group the row is rendering in, for the React key.
   * @returns the row element.
   */
  const agentRow = (row: AgentRow, prefix: string): ReactNode => {
    const generation = mediaForSpaces(row.spaces)
    const pinnedText = row.model === null ? t('brains.agent.unassigned') : chatModelText(row)
    const terminalOnly = row.spaces.includes('terminal') && !row.spaces.includes('chat')
    // A Terminal row reads the CLI it launches: the choice itself lives in the
    // sheet, where the model is chosen with it.
    const cli = terminalOnly ? cliLabel(launches?.byActivity[row.id]) : undefined
    const purposeKey = BRAIN_PURPOSES[row.id]
    const purpose = purposeKey === undefined ? row.description ?? '' : t(purposeKey)
    const places = row.spaces.filter(id => id !== 'studio').map(id => t(SPACE_LABELS[id])).join(' · ')
    const ready = brainReady(row)
    const seeded = SEEDED_NAMES[row.id]
    const shownName = seeded !== undefined && seeded.name === row.name ? t(SPACE_LABELS[seeded.label]) : row.name
    return (
      <div key={`${prefix}:${row.id}`} className={css.brainRow} role="row" data-brain={row.id} data-brain-ready={ready ? '' : undefined}>
        {brainMark(ready)}
        <span className={css.brainText}>
          <span className={css.brainHead}>
            <span className={css.cellKey}>{shownName}</span>
            {places !== '' && places !== shownName && <span className={css.brainPlaces} data-brain-places="">{places}</span>}
          </span>
          {purpose !== '' && <span className={css.brainPurpose} data-brain-purpose="">{purpose}</span>}
          {row.modelPinned
            // A pinned brain has no model to choose, so a missing one is left to the access note.
            ? row.access?.reason === 'no-model' ? null : <span className={css.rowNote} data-brain-pinned="" data-brain-model={pinnedText}>{pinnedText}</span>
            : generation !== undefined
              ? generationCell(generation)
              : (
                <span className={css.rowNote} data-brain-model={chatModelText(row)}>
                  {cli === undefined ? chatModelText(row) : cli}
                </span>
              )}
          {/* A terminal runs its own CLI, which brings its own login, so the chat
              route's key is not what it waits on (JJ, 4 Nov 2026). */}
          {/* A generation row that cannot run has already said what it needs. */}
          {terminalOnly || (generation !== undefined && !mediaRuns(generation)) ? null : accessNote(row)}
        </span>
        <span className={css.cellAction}>
          <button type="button" className={css.chip} onClick={() => { beginEdit(row) }}>
            {t('brains.agent.edit')}
          </button>
        </span>
      </div>
    )
  }

  /**
   * The tick or the amber mark at a row's start, spelled out for a screen reader.
   * @param ready - whether the row can answer now.
   * @returns the mark.
   */
  const brainMark = (ready: boolean): ReactNode => (
    <span className={ready ? css.markReady : css.markNeeds} data-brain-mark={ready ? 'ready' : 'needs'}>
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <path d={ready ? 'm3.5 8.5 3 3 6-7' : 'M8 3.5v5.5M8 12h.01'} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className={css.visuallyHidden}>{t(ready ? 'brains.mark.ready' : 'brains.mark.needs')}</span>
    </span>
  )

  /**
   * Whether a brain can answer now: the one place the row's mark is decided. A
   * media brain needs its generation model and the chat route that drives it, a
   * Terminal brain its CLI, and every other brain its chat route.
   * @param row - the brain.
   * @returns true when a chat on it would answer.
   */
  function brainReady(row: AgentRow): boolean {
    const generation = mediaForSpaces(row.spaces)
    if (generation !== undefined && !mediaRuns(generation)) return false
    if (generation === undefined && row.model !== null && confirmedDown('chat', row.model.provider)) return false
    if (row.spaces.includes('terminal') && !row.spaces.includes('chat')) {
      const command = launches?.byActivity[row.id] ?? launches?.default
      return (launches?.catalog ?? []).find(entry => entry.command === command)?.installed !== false
    }
    return row.access?.state !== 'unavailable'
  }

  /**
   * How a launch command reads in a row: the catalogue's label for it, the
   * command itself when the catalogue does not list it, and the default's
   * label when the brain names none.
   * @param command - the brain's own launch command, absent for the default.
   * @returns the label, or undefined while the catalogue is unread.
   */
  const cliLabel = (command: string | undefined): string | undefined => {
    if (launches === null) return undefined
    const resolved = command === undefined || command === '' ? launches.default : command
    const matched = (launches.catalog ?? []).find(entry => entry.command === resolved)
    return matched?.label ?? (resolved === '' ? t('brains.cli.none') : resolved)
  }

  /**
   * A generating space's own row, shown while no brain confined to the space
   * states its model: the model that space generates with, or why it cannot
   * generate. The model is set by adding a brain for the space, whose sheet
   * asks it.
   * @param row - the media preset the space runs on.
   * @returns the row element.
   */
  const mediaRow = (row: MediaPresetRow): ReactNode => {
    const labelKey = MEDIA_LABEL_KEYS[row.id]
    const name = labelKey === undefined ? row.name : t(labelKey)
    const ready = mediaRuns(row)
    return (
      <div key={row.id} className={css.brainRow} role="row" data-media-preset={row.id}>
        {brainMark(ready)}
        <span className={css.brainText}>
          <span className={css.cellKey}>{name}</span>
          {generationCell(row)}
        </span>
      </div>
    )
  }

  /**
   * One service: its name, what it makes, and a key field or the way to one.
   * Written once because a service can sit under Connected, Good next steps or
   * the full list.
   * @param row - the service.
   * @returns the row element.
   */
  const serviceRow = (row: ServiceRow): ReactNode => {
    const open = serviceDraft?.id === row.id && serviceDraft.kind === row.kind
    return (
      <div
        className={css.providerRow}
        data-service={row.id}
        data-service-kind={row.kind}
        data-service-connected={row.connected ? '' : undefined}
      >
        <span className={css.providerName}>
          <strong>{row.name}</strong>
          <small>{NEXT_SERVICES[row.id] === undefined || row.connected ? makesLabel(row) : t(NEXT_SERVICES[row.id] as BarKey)}</small>
        </span>
        {open
          ? (
          // A line of its own: the field is where a secret gets
          // typed, and the key page belongs directly under it,
          // where someone without a key is already looking.
            <span className={css.keyPanel}>
              <span className={css.keyRow}>
                <input
                  className={css.budgetInput}
                  type="password"
                  autoComplete="off"
                  autoFocus
                  aria-label={t('brains.services.field', { service: row.name })}
                  placeholder={t('brains.services.placeholder')}
                  value={serviceDraft.value}
                  onChange={(event) => { setServiceDraft({ id: row.id, kind: row.kind, value: event.target.value }) }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void connectService(row, serviceDraft.value)
                    if (event.key === 'Escape') setServiceDraft(null)
                  }}
                />
                <span className={css.keyActions}>
                  <button type="button" className={css.secondary} onClick={() => { setServiceDraft(null); setServiceError(null) }}>
                    {t('brains.cancel')}
                  </button>
                  <button type="button" className={css.primary} onClick={() => { void connectService(row, serviceDraft.value) }}>
                    {t('brains.services.connect')}
                  </button>
                </span>
              </span>
              {serviceError?.id === row.id && serviceError.kind === row.kind && (
                <span className={css.keyError} role="alert" data-service-error={row.id}>{serviceError.message}</span>
              )}
              {row.keyUrl !== undefined && (
                <a className={css.rowHint} href={row.keyUrl} target="_blank" rel="noreferrer" data-service-key-link={row.id}>
                  {t('brains.services.keyLink', { service: row.name })}
                </a>
              )}
            </span>
          )
          : row.signIn === true
            ? <span className={css.badge}>{t('brains.services.signIn')}</span>
            : (
              <>
                {row.connected && (
                  <button
                    type="button"
                    className={`${css.badge} ${css.badgeButton}`}
                    data-service-check={checks[`${row.kind}:${row.id}`] ?? 'connected'}
                    title={`${t(`brains.services.check.${checks[`${row.kind}:${row.id}`] ?? 'connected'}.detail`, { service: row.name })} ${t('brains.services.check.again')}`}
                    onClick={() => { void checkService(row) }}
                  >
                    {t(`brains.services.check.${checks[`${row.kind}:${row.id}`] ?? 'connected'}`)}
                  </button>
                )}
                {row.connected && row.kind === 'chat' && (
                  <button
                    type="button"
                    className={css.rowLink}
                    data-service-manage={row.id}
                    onClick={() => { setProviderEditor(true) }}
                  >
                    {t('brains.provider.manage')}
                  </button>
                )}
                <button
                  type="button"
                  className={css.rowLink}
                  onClick={() => { setServiceDraft({ id: row.id, kind: row.kind, value: '' }) }}
                >
                  {t(row.connected ? 'brains.services.change' : 'brains.services.connect')}
                </button>
              </>
            )}
      </div>
    )
  }

  // A CLI's login is its own, so it counts as an account once the Mac can find it.
  const readyClis = terminalClis.filter(row => row.installed !== false)
  const missingClis = terminalClis.filter(row => row.installed === false)
  /**
   * One terminal tool. Its login pays for it in the terminal, and a key is what
   * lets a chat reach the same route (JJ, 31 Aug 2026).
   * @param row - the tool's route.
   * @returns the row element.
   */
  const cliRow = (row: TerminalCliRow): ReactNode => (
    <div key={`cli:${row.provider}`} className={css.providerRow} data-terminal-cli={row.cli}>
      <span className={css.providerName}>
        <strong>{providerName(row.provider)}</strong>
        <small>{t('brains.terminal.kind', { cli: row.cli })}</small>
      </span>
      <span className={css.badge}>
        {row.installed === null ? t('brains.terminal.unknown') : t(row.installed ? 'brains.terminal.installed' : 'brains.terminal.missing')}
      </span>
      <button type="button" className={css.rowLink} onClick={() => { setProviderEditor(true) }}>
        {t(connectedFor(row.provider) ? 'brains.provider.manage' : 'brains.terminal.chatKey')}
      </button>
    </div>
  )
  /**
   * The free route. Its keys live on its own page, so the row only leads there.
   * @param models - how many models the route can reach now.
   * @returns the row element.
   */
  const freeRow = (models: number): ReactNode => (
    <div className={css.providerRow} data-accounts-free="">
      <span className={css.providerName}>
        <strong>{t('brains.free.title')}</strong>
        <small>
          {checks['chat:freetokens'] === 'no-keys'
            ? t('brains.accounts.freeEmpty')
            : models > 0 ? t('brains.accounts.freeCount', { count: models }) : t('brains.accounts.free')}
        </small>
      </span>
      {checks['chat:freetokens'] === 'no-keys' && (
        <span className={css.badge} data-service-check="no-keys">{t('brains.services.check.no-keys')}</span>
      )}
      <a className={css.rowLink} href="/idealize/freetokens" target="_blank" rel="noreferrer">
        {t(models > 0 && checks['chat:freetokens'] !== 'no-keys' ? 'brains.provider.manage' : 'brains.agent.setUp')}
      </a>
    </div>
  )

  /**
   * Whether a place can work now, read from the same marks its brains carry so
   * the strip and the rows never disagree. A plain browser serves no CLI
   * catalogue, and a place with no brain falls to its generation route.
   * @param id - the place.
   * @returns true when something in it can answer.
   */
  const placeReady = (id: SpaceId): boolean => {
    if (id === 'terminal') {
      const catalog = launches?.catalog
      return catalog === undefined || catalog.some(entry => entry.installed !== false)
    }
    const brains = brainsIn(id)
    if (brains.length > 0) return brains.some(brainReady)
    const media = mediaOf(id)
    return media !== undefined && mediaRuns(media)
  }
  const spaceStatus = (spaces ?? []).filter(entry => entry.id !== 'studio').map(entry => ({ id: entry.id, ok: placeReady(entry.id) }))
  const chatBlocked = agents !== null && brainsIn('chat').length > 0 && brainsIn('chat').every(row => row.access?.state === 'unavailable')

  return (
    <div className={css.root} data-tab={tab}>
      <header className={css.header}>
        <h2 className={css.title}>{t('brains.title')}</h2>
        <p className={css.subtitle}>{t(`brains.${tab}.intro`)}</p>
      </header>
      <div className={css.tabs} role="tablist">
        {TABS.map(name => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            className={css.tab}
            onClick={() => { setTab(name) }}
          >
            {t(`brains.tab.${name}`)}
          </button>
        ))}
      </div>

      <div className={css.body}>
        {tab === 'usage' && (
          <>
            {spaceStatus.length > 0 && (
              <div className={css.statusStrip} data-brains-status="">
                {spaceStatus.map(({ id, ok }) => ok
                  ? <span key={id} className={css.statusOk} data-space-status="ready">{t('brains.status.ready', { space: t(SPACE_LABELS[id]) })}</span>
                  : (
                    <button key={id} type="button" className={css.statusNeeds} data-space-status="needs" onClick={() => { setTab('models') }}>
                      {t('brains.status.needs', { space: t(SPACE_LABELS[id]) })}
                    </button>
                  ))}
              </div>
            )}
            {chatBlocked && (
              <div className={css.readiness} data-brains-readiness="">
                <span>{t('brains.readiness')}</span>
                <button type="button" className={css.primary} onClick={() => { setTab('models') }}>{t('brains.readiness.connect')}</button>
              </div>
            )}
            <SectionHead title={t('brains.group.conversation')} />
            <div className={css.list} role="table" aria-label={t('brains.group.conversation')} data-brains-group="conversation">
              {conversationBrains.map(row => agentRow(row, 'conversation'))}
              {defaultCliRow()}
            </div>
            <SectionHead title={t('brains.group.making')} />
            <div className={css.list} role="table" aria-label={t('brains.group.making')} data-brains-group="making">
              {makingBrains.map(row => agentRow(row, 'making'))}
              {/* A brain confined to a space states its generation model on its
                  own row; the space's row stands in only while no such brain exists. */}
              {(spaces ?? []).filter(entry => MAKING_SPACES.has(entry.id)).flatMap((entry) => {
                const generation = mediaOf(entry.id)
                if (generation === undefined || makingBrains.some(row => mediaForSpaces(row.spaces)?.id === generation.id)) return []
                return [mediaRow(generation)]
              })}
            </div>
            <div className={css.addBrainRow}>
              <button
                type="button"
                className={css.addRow}
                data-brains-add=""
                onClick={() => { setDraft({ name: '', model: '', chatModel: '', cli: '', instructions: '', spaces: ['chat'] }) }}
              >
                <span className={css.plusBox} aria-hidden="true">+</span>
                {t('brains.space.addBrain')}
              </button>
            </div>
            <details className={css.behindScenes} data-brains-behind="">
              <summary className={css.behindSummary}>{t('brains.behind.title', { count: roleAgents.length + (powellAgent === undefined ? 0 : 1) })}</summary>
              <p className={css.behindDetail}>{t('brains.otherAgents.detail')}</p>
              <div className={css.list} role="table" aria-label={t('brains.otherAgents.title')}>
                {powellAgent !== undefined && <div data-brains-powell="">{agentRow(powellAgent, 'powell')}</div>}
                {roleAgents.map(row => agentRow(row, 'roles'))}
                <button
                  type="button"
                  className={css.addRow}
                  onClick={() => { setDraft({ name: '', model: '', chatModel: '', cli: '', instructions: '', spaces: [] }) }}
                >
                  <span className={css.plusBox} aria-hidden="true">+</span>
                  {t('brains.agent.add')}
                </button>
              </div>
            </details>
          </>
        )}

        {tab === 'models' && (
          <>
            <SectionHead title={t('brains.accounts.connected')} />
            <div className={css.list} data-accounts-connected="" data-services="">
              {connectedPlans.length === 0 && readyClis.length === 0 && connectedServices.length === 0
                && free?.connected !== true && !gatewaySet && (
                <div className={css.emptyRow}>{t('brains.accounts.none')}</div>
              )}
              {connectedPlans.map(provider => (
                <div key={provider.provider} className={css.providerRow} data-provider={provider.provider}>
                  <span className={css.providerName}>
                    <strong>{providerName(provider.provider)}</strong>
                    <small>{t('brains.cost.plan')}</small>
                  </span>
                  <span className={css.badge}>{t('brains.provider.connected')}</span>
                  <a className={css.rowLink} href="/idealize/signin" target="_blank" rel="noreferrer">{t('brains.provider.manage')}</a>
                </div>
              ))}
              {readyClis.map(cliRow)}
              {connectedServices.map(row => <Fragment key={`${row.kind}:${row.id}`}>{serviceRow(row)}</Fragment>)}
              <GatewayRow t={t} configuredOnly onState={setGatewaySet} />
              {free?.connected === true && freeRow(free.models.length)}
            </div>

            {(nextPlans.length > 0 || missingClis.length > 0 || nextServices.length > 0 || (free !== undefined && !free.connected)) && (
              <>
                <SectionHead title={t('brains.accounts.next')} />
                <div className={css.list} data-accounts-next="">
                  {nextPlans.map(provider => (
                    <div key={provider.provider} className={css.providerRow} data-provider={provider.provider}>
                      <span className={css.providerName}>
                        <strong>{t(PLAN_NAMES[provider.provider] as BarKey)}</strong>
                        <small>{t('brains.accounts.plan')}</small>
                      </span>
                      <a className={css.rowLink} href="/idealize/signin" target="_blank" rel="noreferrer">{t('brains.agent.signIn')}</a>
                    </div>
                  ))}
                  {nextServices.map(row => <Fragment key={`${row.kind}:${row.id}`}>{serviceRow(row)}</Fragment>)}
                  {missingClis.map(cliRow)}
                  {free !== undefined && !free.connected && freeRow(free.models.length)}
                </div>
              </>
            )}

            <div className={css.accountsSearch}>
              <button
                type="button"
                className={css.rowLink}
                aria-expanded={adding}
                data-services-add=""
                onClick={() => { setAdding(value => !value); setServiceDraft(null) }}
              >
                {t('brains.accounts.searchAll', { count: (services ?? []).length })}
              </button>
            </div>
            {adding && (
              <div className={css.list} data-services-all="">
                {visibleServices.length === 0 && otherPlans.length === 0 && serviceQuery === '' && nextServices.length === 0 && (
                  <div className={css.emptyRow}>{t('brains.services.none')}</div>
                )}
                <label className={css.serviceSearch}>
                  <span className={css.visuallyHidden}>{t('brains.accounts.searchLabel')}</span>
                  <input
                    type="search"
                    className={css.textInput}
                    placeholder={t('brains.accounts.searchLabel')}
                    value={serviceQuery}
                    data-services-search=""
                    onChange={(event) => { setServiceQuery(event.target.value) }}
                  />
                </label>
                <GatewayRow t={t} configuredOnly={false} onState={setGatewaySet} />
                {otherPlans.filter(provider => matchesQuery(providerName(provider.provider))).map(provider => (
                  <div key={provider.provider} className={css.providerRow} data-provider={provider.provider}>
                    <span className={css.providerName}>
                      <strong>{providerName(provider.provider)}</strong>
                      <small>{t('brains.accounts.plan')}</small>
                    </span>
                    <a className={css.rowLink} href="/idealize/signin" target="_blank" rel="noreferrer">{t('brains.agent.signIn')}</a>
                  </div>
                ))}
                {/* The media services lead under their own label. Unlabelled,
                    thirty chat routes bury the handful that make images, video
                    or sound, which is what a person opening this list came for. */}
                {visibleServices.map((row, index) => {
                  const previous = visibleServices[index - 1]
                  const heading = previous !== undefined && generates(row) === generates(previous)
                    ? undefined
                    : t(generates(row) ? 'brains.services.groupMedia' : 'brains.services.groupChat')
                  return (
                    <Fragment key={`${row.kind}:${row.id}`}>
                      {heading !== undefined && <div className={css.groupRow} data-service-group={generates(row) ? 'media' : 'chat'}>{heading}</div>}
                      {serviceRow(row)}
                    </Fragment>
                  )
                })}
                {/* A keys file connects several services at once: the route an
                    organisation's keys arrive by, for anyone who did not open
                    the file itself. */}
                <input
                  ref={keysFileField}
                  type="file"
                  accept=".idealizekeys,application/json"
                  hidden
                  data-services-keys-file=""
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0]
                    event.currentTarget.value = ''
                    if (file !== undefined) void importKeysFile(file)
                  }}
                />
                <button type="button" className={css.rowLink} data-services-import="" onClick={() => keysFileField.current?.click()}>
                  {t('brains.services.import')}
                </button>
                {/* The advanced route stays reachable and stays marked: it is the
                    only path that asks for a web address, and asking for one is
                    what made adding a service hard. */}
                <button
                  type="button"
                  className={css.rowLink}
                  data-services-advanced=""
                  onClick={() => { setAdding(false); setProviderEditor(true) }}
                >
                  {t('brains.services.advanced')}
                </button>
              </div>
            )}
          </>
        )}

        {tab === 'router' && <RouterTab t={t} onConnect={() => { setKeyFor('openrouter') }} />}
        {status !== '' && <p className={css.status} role="status">{status}</p>}
      </div>

      {draft !== null && (
        <div className={css.scrim}>
          <form
            className={css.sheet}
            aria-label={t('brains.edit.title')}
            onSubmit={(event) => { event.preventDefault(); void saveDraft() }}
          >
            <div className={css.sheetHead}>
              <div className={css.sheetTitle}>{t(draft.id === undefined ? 'brains.edit.newTitle' : 'brains.edit.title')}</div>
              <div className={css.sheetDetail}>{t('brains.edit.detail')}</div>
            </div>
            {/* The fields scroll inside the sheet and the actions stay pinned
                under them: on a short window Save brain sat below the fold,
                which read as a broken dialog (PC test drive, 18 Sep 2026). */}
            <div className={css.sheetBody} data-brains-sheet-body="">
              <label className={css.field} data-brains-field="name">
                <span className={css.fieldLabel}>{t('brains.edit.name')}</span>
                <input
                  className={css.fieldInput}
                  value={draft.name}
                  required
                  onChange={(event) => { setDraft({ ...draft, name: event.target.value }) }}
                />
              </label>
              <div className={css.field} data-brains-field="what">
                <span className={css.fieldLabel}>{t('brains.edit.whatItDoes')}</span>
                {instructionsOpen
                  ? (
                    <label className={css.field} data-brains-field="instructions">
                      <span className={css.fieldLabel}>{t('brains.edit.instructions')}</span>
                      <textarea
                        className={css.fieldArea}
                        rows={5}
                        value={draft.instructions}
                        onChange={(event) => { setDraft({ ...draft, instructions: event.target.value }) }}
                      />
                      <span className={css.fieldHint} data-brains-instructions-hint="">
                        {t('brains.edit.instructionsHint')}
                      </span>
                    </label>
                  )
                  : (
                    <>
                      {draftPurpose !== '' && <span className={css.fieldText} data-brains-purpose="">{draftPurpose}</span>}
                      <button type="button" className={css.rowLinkStart} data-brains-see-instructions="" onClick={() => { setInstructionsOpen(true) }}>
                        {t('brains.edit.seeInstructions')}
                      </button>
                    </>
                  )}
              </div>
              <div className={css.field} data-brains-field="model">
                <span className={css.fieldLabel}>{t(sheetGeneration === undefined ? 'brains.edit.model' : 'brains.edit.generationModel')}</span>
                {/* Narrowed by the spaces above: a brain confined to one
                    generating space picks from that space's compatible models,
                    and every other brain picks from the chat catalogue. Change
                    opens the model browser over the window. */}
                {sheetGeneration === undefined
                  ? modelField('model', t('brains.edit.model'), 'chat', chatBrowserModels(), draft.model)
                  : modelField(
                    'model', t('brains.edit.generationModel'), PRESET_KIND[sheetGeneration.id] ?? 'image', mediaBrowserModels(sheetGeneration), draft.model,
                  )}
                {sheetGeneration === undefined && chatCatalogueAids()}
              </div>
              {browsing !== null && (() => {
                const generating = browsing === 'model' && sheetGeneration !== undefined
                const kind: BrowserKind = generating ? PRESET_KIND[sheetGeneration.id] ?? 'image' : 'chat'
                const label = sheetGeneration === undefined ? undefined : MEDIA_LABEL_KEYS[sheetGeneration.id]
                return (
                  <ModelBrowser
                    kind={kind}
                    spaceLabel={generating ? (label === undefined ? sheetGeneration.name : t(label)) : draft.name.trim() === '' ? t('brains.edit.model') : draft.name}
                    models={generating ? mediaBrowserModels(sheetGeneration) : chatDetails === null ? null : chatBrowserModels()}
                    current={draft[browsing]}
                    allowDefault={!generating}
                    sampleSource={generating ? services?.find(row => row.id === draft.model.split(' ')[0])?.name ?? 'fal.ai' : undefined}
                    t={t}
                    fetchExample={fetchExample}
                    ratings={ratings}
                    onRate={(model, tag, stars) => { void rate(model, tag, stars) }}
                    onClose={() => { setBrowsing(null) }}
                    onApply={(value) => {
                      setDraft({ ...draft, [browsing]: value })
                      setBrowsing(null)
                    }}
                  />
                )
              })()}
              {routerShown && (draft.routed ?? true) && (() => {
                const criteria = draft.criteria ?? criteriaOf(draft.id)
                if (criteria === undefined) return null
                const marked = matterOf(criteria)
                return (
                  <div className={css.field} role="group" aria-label={t('brains.matters.label')} data-brains-field="matters">
                    <span className={css.fieldLabel}>{t('brains.matters.label')}</span>
                    <span className={css.segments}>
                      {MATTER_ORDER.map(key => (
                        <button
                          key={key}
                          type="button"
                          className={css.segment}
                          aria-pressed={marked === key}
                          data-brains-matter={key}
                          onClick={() => { setDraft({ ...draft, criteria: { ...criteria, ...MATTERS[key] } }) }}
                        >
                          {t(`brains.matters.${key}`)}
                        </button>
                      ))}
                    </span>
                    <span className={css.fieldHint}>{t('brains.matters.hint')}</span>
                  </div>
                )
              })()}
              <button
                type="button"
                className={css.moreToggle}
                aria-expanded={moreOpen}
                data-brains-more=""
                onClick={() => { setMoreOpen(value => !value) }}
              >
                {t('brains.edit.more')}
              </button>
              {moreOpen && (
                <>
                  {spaces !== null && (
                    <div
                      className={css.field}
                      role="group"
                      data-brains-field="spaces"
                      aria-label={t('brains.edit.space')}
                      {...draft.id === undefined && draft.spaces[0] !== undefined
                        ? { 'data-brains-add-space': draft.spaces[0] }
                        : {}}
                    >
                      <span className={css.fieldLabel}>{t('brains.edit.space')}</span>
                      <span className={css.fieldChoices}>
                        {spaces.map(entry => (
                          <label key={entry.id} className={css.choice}>
                            <input
                              type="checkbox"
                              checked={draft.spaces.includes(entry.id)}
                              onChange={(event) => { toggleSpace(entry.id, event.target.checked) }}
                            />
                            {t(SPACE_LABELS[entry.id])}
                          </label>
                        ))}
                      </span>
                      {/* The rule that separates the pane's two lists, where the
                          choice is made: a brain in no space is an agent role
                          (JJ, 1 Sep 2026: the wording was not clear). */}
                      <span className={css.fieldHint} data-brains-space-hint="">{t('brains.edit.spaceHint')}</span>
                    </div>
                  )}
                  {draft.spaces.includes('terminal') && launches !== null && (
                    <label className={css.field} data-brains-field="cli">
                      <span className={css.fieldLabel}>{t('brains.edit.cli')}</span>
                      {/* Which CLI a fresh Terminal shell types for this brain. The
                          model below is the brain's own; a CLI brings its own models
                          with it, which this app cannot enumerate, so the two are
                          stated separately rather than one filtering the other. */}
                      <select
                        className={css.fieldSelect}
                        data-brains-cli=""
                        aria-label={t('brains.edit.cli')}
                        value={draft.cli}
                        onChange={(event) => { setDraft({ ...draft, cli: event.target.value }) }}
                      >
                        <option value="">{t('brains.edit.cliDefault', { label: cliLabel('') ?? '' })}</option>
                        {(launches.catalog ?? [])
                          .filter(entry => entry.installed !== false || entry.command === draft.cli)
                          .map(entry => (
                            <option key={entry.id} value={entry.command}>
                              {entry.installed === false ? t('brains.cli.notFound', { label: entry.label }) : entry.label}
                            </option>
                          ))}
                      </select>
                      <span className={css.fieldHint}>{t('brains.edit.cliHint')}</span>
                    </label>
                  )}
                  {sheetGeneration !== undefined && (
                    <div className={css.field} data-brains-field="chat-model">
                      <span className={css.fieldLabel}>{t('brains.edit.chatModel')}</span>
                      {/* The model that drives the generation tool. Its own field,
                          so a generating brain can leave an unreachable default
                          route without moving every other brain off it. */}
                      {modelField('chatModel', t('brains.edit.chatModel'), 'chat', chatBrowserModels(), draft.chatModel)}
                      {chatCatalogueAids()}
                      <span className={css.fieldHint}>{t('brains.edit.chatModelHint')}</span>
                    </div>
                  )}
                  {routerShown && (
                    <div className={css.field} data-brains-field="routed">
                      <label className={css.choice}>
                        <input
                          type="checkbox"
                          checked={draft.routed ?? true}
                          onChange={(event) => { setDraft({ ...draft, routed: event.target.checked }) }}
                        />
                        {t('brains.edit.routed')}
                      </label>
                      <span className={css.fieldHint}>{t('brains.edit.routedHint')}</span>
                      {draft.spaces.includes('terminal') && (
                        <span className={css.fieldHint} data-brains-routed-terminal="">{t('brains.edit.routedTerminalHint')}</span>
                      )}
                    </div>
                  )}
                  {routerShown && (draft.routed ?? true) && (() => {
                    // The sheet shows what the router would read now; the draft holds criteria only once a slider moves.
                    const criteria = draft.criteria ?? criteriaOf(draft.id)
                    if (criteria === undefined) return null
                    return (
                      <>
                        <div className={css.field} role="group" aria-label={t('brains.router.level')} data-brains-field="flexibility">
                          <span className={css.fieldLabel}>{t('brains.router.level')}</span>
                          <label className={css.weightRow}>
                            <span className={css.weightLabel}>{t('brains.router.level.low')}</span>
                            <input
                              type="range"
                              className={css.weightInput}
                              data-router-level=""
                              min={0}
                              max={ROUTER_LEVELS.length - 1}
                              step={1}
                              aria-label={t('brains.router.level')}
                              aria-valuetext={t(`brains.router.level.${criteria.aggressiveness}`)}
                              value={ROUTER_LEVELS.indexOf(criteria.aggressiveness)}
                              onChange={(event) => {
                                setDraft({ ...draft, criteria: { ...criteria, aggressiveness: ROUTER_LEVELS[Number(event.target.value)] ?? 'balanced' } })
                              }}
                            />
                            <span className={css.weightEnd}>{t('brains.router.level.high')}</span>
                          </label>
                          <span className={css.fieldHint} data-router-level-hint={criteria.aggressiveness}>
                            {t(`brains.router.level.${criteria.aggressiveness}.hint`)}
                          </span>
                        </div>
                        <div className={css.field} role="group" aria-label={t('brains.router.priorities')} data-brains-field="priorities">
                          <span className={css.fieldLabel}>{t('brains.router.priorities')}</span>
                          {ROUTER_PRIORITIES.map(key => (
                            <label key={key} className={css.weightRow}>
                              <span className={css.weightLabel}>{t(`brains.router.priority.${key}`)}</span>
                              <input
                                type="range"
                                className={css.weightInput}
                                data-router-priority={key}
                                min={0}
                                max={100}
                                aria-label={t(`brains.router.priority.${key}`)}
                                value={criteria[key]}
                                onChange={(event) => {
                                  setDraft({ ...draft, criteria: { ...criteria, [key]: Number(event.target.value) } })
                                }}
                              />
                              <span className={css.weightValue}>{String(criteria[key])}</span>
                            </label>
                          ))}
                          <span className={css.fieldHint}>{t('brains.router.prioritiesHint')}</span>
                        </div>
                      </>
                    )
                  })()}
                </>
              )}
            </div>
            <div className={css.sheetActions}>
              <button type="button" className={css.secondary} onClick={() => { setDraft(null) }}>{t('brains.cancel')}</button>
              <button type="submit" className={css.primary}>{t('brains.edit.save')}</button>
            </div>
          </form>
        </div>
      )}

      {providerEditor && (
        <div className={css.scrim}>
          <div className={css.sheet} role="dialog" aria-label={t('brains.metered.title')}>
            <div className={css.sheetHead}>
              <div className={css.sheetTitle}>{t('brains.metered.title')}</div>
              <div className={css.sheetDetail}>{t('brains.metered.editorDetail')}</div>
            </div>
            <div className={css.hosted}>
              <host.models.Component {...host.models.props} />
            </div>
            <div className={css.sheetActions}>
              <button
                type="button"
                className={css.primary}
                onClick={() => {
                  setProviderEditor(false)
                  notifyBrainsChanged()
                  void refreshState()
                  void refreshMedia()
                  void refreshAgents()
                }}
              >
                {t('brains.done')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
