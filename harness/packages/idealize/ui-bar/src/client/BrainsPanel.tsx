/**
 * The Brains drawer pane (Paper "models wires", frames 7A-0 / NX-0 / D5-0 /
 * 9D-0): three tabs under one header.
 *
 * - Usage — the brains, grouped by the space they work in: one section per
 *   declared space (Chat, Terminal, Gallery, Sound Stage, Motion, in the
 *   order `GET /idealize/spaces` serves them), each listing the brains whose
 *   `spaces` list names it. A row states the brain's model as text and
 *   carries an Edit; the edit sheet is the one place a model is chosen (JJ,
 *   7 Sep 2026: "drop down not needed in brains - just choose model in
 *   edit"). The sheet's selects list providers and models in alphabetical
 *   order (JJ, 7 Sep 2026), whatever order the routes serve them in; every
 *   provider is named by one rule ({@link providerDisplayName}), a filter
 *   field narrows the list once it passes {@link MODEL_FILTER_FROM} models,
 *   and a note under the select states how many models the catalogues hold
 *   and when they were read, so a model no service has published yet is
 *   explained rather than silently absent (JJ, 8 Sep 2026: "gpt 6 is not
 *   available"). A brain
 *   that works in more than one space appears under each; Free's model is
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
 *   agrees with the sheet (JJ, 10 Sep 2026).
 * - Models — Subscriptions (OAuth providers), Token Use (keyed providers)
 *   and the Free Token Use card: the free-token engine's routing strategy
 *   and its reliability / speed / intelligence weight vector, read and
 *   written through @idealize/freetokens' routing routes. The harness's own
 *   auto policy (cost / speed / intelligence) keeps its home on the
 *   /idealize/models page.
 * - Budget — month-to-date and year-to-date tokens per billing category,
 *   overall or for one project, against the monthly token budget. When the
 *   host has token prices or subscription plan costs configured
 *   (idealize-models settings), each cell leads with the cost those prices
 *   compute and notes call out any usage they leave unpriced; costs are
 *   never estimated, so with nothing configured the cells stay token-only
 *   under a hint. Beneath, one row per model with usage this month: its
 *   tokens and, for a metered route, its cost where a price exists or a Set
 *   price action where none does. The action opens an inline editor for the
 *   input and output prices per million tokens (cache read and write under
 *   "more"), saved through `POST /idealize/models/prices`; a row OpenRouter
 *   priced from its published directory says so, and a typed price wins over
 *   it. The total sums the priced rows and counts the unpriced ones.
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
import { SPACE_LABELS } from './HeroLauncher.tsx'
import type { BarKey } from './locales.ts'
import { mediaRecoveryText } from './media-recovery.ts'
import { RouterTab } from './RouterTab.tsx'
import css from './BrainsPanel.module.css'

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

type Tab = 'usage' | 'budget' | 'models' | 'router'
const TABS: readonly Tab[] = ['usage', 'budget', 'models', 'router']

/** The engine's weight axes, in the Paper frame's slider order. */
const WEIGHT_KEYS = ['reliability', 'speed', 'intelligence'] as const
type WeightKey = typeof WEIGHT_KEYS[number]
/** The engine's vector; the engine normalizes it to sum 1 once saved. */
type Weights = Record<WeightKey, number>
/** The engine's strategies: priority = its manual chain order; the rest are weight vectors. */
const STRATEGIES = ['priority', 'balanced', 'fastest', 'smartest', 'reliable'] as const
type Strategy = typeof STRATEGIES[number] | 'custom'

/** The /idealize/freetokens/routing payload: `weights` is null in priority mode. */
interface EngineRouting {
  strategy: Strategy
  weights: Weights | null
  customWeights: Weights
}

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

/**
 * Once the chat catalogue passes this many models, the sheet offers a filter
 * field over the select. Twelve, not forty: a native select scrolls its own
 * popup, so a list a screen deep already costs more to read than to type into
 * (JJ, 10 Sep 2026: the dropdown is "overly long").
 */
const MODEL_FILTER_FROM = 12

/** One row of /idealize/activity/agents. */
interface AgentRow {
  id: string
  name: string
  activity: boolean
  /** The free-tokens route resolves this brain's model, so the row states it rather than offering a picker. */
  modelPinned: boolean
  /** The spaces this brain works in, in the declared table's order; empty for an agent role. */
  spaces: SpaceId[]
  model: { provider: string; model: string } | null
  /** Whether a chat on this brain can open its first request now; `no-access` means its route has no key, `no-sign-in` no sign-in. */
  access?: { state: 'ready' | 'confirm' | 'unavailable'; reason?: string }
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

/** One /idealize/brains/media candidate: a backend and the model it serves. */
interface MediaCandidate {
  backend: string
  model: { id: string; name: string }
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

type Totals = Record<'subscriptions' | 'metered' | 'free' | 'total', number>

/**
 * The usage payload's cost half, computed by the host from user-configured
 * token prices and subscription plan costs only. `configured` false means
 * nothing is priced yet, and the tab shows a hint instead of zero costs;
 * the unpriced fields name what the shown costs leave out.
 */
interface CostState {
  currency: string
  month: Totals
  year: Totals
  unpricedTokens: { month: number; year: number }
  unpricedSubscriptions: string[]
  configured: boolean
}

/** One model's token prices per million, with who supplied them. */
interface PricedModel {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  source: 'user' | 'market' | 'catalogue'
}

/** One model with usage this month, as the usage payload lists it. */
interface ModelCostRow {
  provider: string
  model: string
  category: 'subscriptions' | 'metered' | 'free'
  total: number
  /** This month's cost; only a metered route with a price carries one. */
  cost?: number
  price?: PricedModel
}

/** The /idealize/models/usage payload. */
interface UsageState {
  scope: string
  projects: { path: string; label: string }[]
  month: Totals
  year: Totals
  monthlyTokenBudget: number
  cost: CostState
  models?: ModelCostRow[]
  /** OpenRouter's published price list, when the route is connected: when it was read and how many models it prices. */
  openRouterPrices?: { fetchedAt: string; models: number } | null
  /** What was generated this month per endpoint, with what fal billed for it. */
  generations?: GenerationState
  /** fal's usage report, when a key for fal is stored: when it was read, and why a read failed. */
  falUsage?: { fetchedAt: string | null; error?: string } | null
}

/** One endpoint's generations this month, as the usage payload lists them. */
interface GenerationRow {
  provider: string
  /** The endpoint id (`fal-ai/flux/dev`). */
  model: string
  /** The artefacts' media type; absent for an endpoint only fal reported. */
  mediaType?: string
  /** Artefacts this app made this month. */
  count: number
  /** What fal billed this month, in fal's own currency. */
  billed?: { quantity: number; unit: string; cost: number; currency: string }
}

/** The usage payload's generation half. */
interface GenerationState {
  rows: GenerationRow[]
  /** Billed totals per currency, this month and year to date; absent while fal has reported nothing. */
  billed?: { month: Record<string, number>; year: Record<string, number> }
  /** The currency fal billed in, null while it has billed nothing. */
  currency: string | null
}

/** The inline price editor's fields, as typed; `more` opens the cache prices. */
interface PriceDraft {
  provider: string
  model: string
  input: string
  output: string
  cacheRead: string
  cacheWrite: string
  more: boolean
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
  /** Whether the model router may move this brain's chats off its model; absent reads as yes. */
  routed?: boolean
}

const CATEGORIES = ['subscriptions', 'metered', 'free', 'total'] as const

/** The engine's vector as slider percentages; priority mode shows the saved custom vector. */
function percentages(routing: EngineRouting): Weights {
  const vector = routing.weights ?? routing.customWeights
  return {
    reliability: Math.round(vector.reliability * 100),
    speed: Math.round(vector.speed * 100),
    intelligence: Math.round(vector.intelligence * 100),
  }
}

function tokens(value: number): string {
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}k`
  return String(value)
}

/** A cost in the viewer's locale; the currency code is host-validated ISO 4217 shaped, which Intl always formats. */
function money(value: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value)
}

/**
 * The media kind a generation row names, from the artefact's media type: the
 * type before the slash, which the copy has a word for. A row fal reported
 * that this app did not make carries no media type and reads as items.
 */
function mediaKind(mediaType: string | undefined): 'image' | 'video' | 'audio' | 'other' {
  const top = (mediaType ?? '').split('/')[0]
  if (top === 'image' || top === 'video' || top === 'audio') return top
  return 'other'
}

/** An instant as a short day-and-time in the viewer's locale ("8 Sept, 10:12"). */
function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/**
 * What a provider route is called, everywhere in this pane: the name its
 * directory gave it when that is a name, else its id with a capital. The
 * host already resolves catalogue routes through the services directory
 * (openai → OpenAI); this is the last resort for a route no table knows.
 * @param provider - the route id.
 * @param displayName - the name the state payload carries, when it does.
 * @returns the name to show.
 */
export function providerDisplayName(provider: string, displayName?: string): string {
  if (displayName !== undefined && displayName.trim() !== '' && displayName !== provider) return displayName
  return `${provider.charAt(0).toUpperCase()}${provider.slice(1)}`
}

/** A price field as typed, to a non-negative number; undefined when it is not one. */
function priceNumber(text: string): number | undefined {
  if (text.trim() === '') return undefined
  const value = Number(text)
  return Number.isFinite(value) && value >= 0 ? value : undefined
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

/** A generating space's candidates by model name, alphabetical. */
function sortedCandidates(candidates: readonly MediaCandidate[]): MediaCandidate[] {
  return [...candidates].sort((left, right) => byName(left.model.name, right.model.name))
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
 * Section heading: title, an optional one-line detail, an optional trailing
 * action. The space groups carry a title alone — the space name says what the
 * group is, and five repeated detail lines would say nothing five times.
 */
function SectionHead({ title, detail, action }: { title: string; detail?: string; action?: ReactNode }) {
  return (
    <div className={css.sectionHead}>
      <div>
        <div className={css.sectionTitle}>{title}</div>
        {detail !== undefined && <div className={css.sectionDetail}>{detail}</div>}
      </div>
      {action}
    </div>
  )
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
  const [usage, setUsage] = useState<UsageState | null>(null)
  const [scope, setScope] = useState('')
  const [weights, setWeights] = useState<Weights | null>(null)
  const [routing, setRouting] = useState<EngineRouting | null>(null)
  const [media, setMedia] = useState<MediaPresetRow[] | null>(null)
  const [services, setServices] = useState<ServiceRow[] | null>(null)
  /** The service whose key field is open, and the key typed so far. */
  const [serviceDraft, setServiceDraft] = useState<{ id: string; kind: 'chat' | 'media'; value: string } | null>(null)
  /** True while the "Add a service" picker is open over the connected list. */
  const [adding, setAdding] = useState(false)
  const [spaces, setSpaces] = useState<SpaceRosterEntry[] | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [providerEditor, setProviderEditor] = useState(false)
  const [budgetDraft, setBudgetDraft] = useState<string | null>(null)
  /** The model row whose price is being edited, and the figures typed so far. */
  const [priceDraft, setPriceDraft] = useState<PriceDraft | null>(null)
  /** What the sheet's model filter field holds; cleared when the sheet closes. */
  const [modelFilter, setModelFilter] = useState('')
  const [status, setStatus] = useState('')

  // The brains the model router leaves alone, for the sheet's routing choice.
  const [routerOff, setRouterOff] = useState<string[]>([])
  const refreshRouterOff = useCallback(async () => {
    setRouterOff((await getJson<{ settings?: { offBrains?: string[] } }>('/idealize/router/state'))?.settings?.offBrains ?? [])
  }, [])
  const refreshState = useCallback(async () => {
    const [next, engine] = await Promise.all([
      getJson<ModelsState>('/idealize/models/state'),
      getJson<EngineRouting>('/idealize/freetokens/routing'),
    ])
    setState(next)
    setRouting(engine)
    setWeights(engine === null ? null : percentages(engine))
  }, [])
  const refreshAgents = useCallback(async () => {
    const list = await getJson<{ agents: AgentRow[]; terminal?: TerminalCliRow[] }>('/idealize/activity/agents')
    setAgents(list?.agents ?? null)
    setTerminalClis(list?.terminal ?? [])
    const commands = await getJson<TerminalLaunchesState>('/idealize/terminal/launches')
    setLaunches(commands?.catalog === undefined ? null : commands)
  }, [])
  const refreshUsage = useCallback(async (path: string) => {
    setUsage(await getJson<UsageState>(`/idealize/models/usage?scope=${encodeURIComponent(path)}`))
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
  useEffect(() => { if (tab === 'budget') void refreshUsage(scope) }, [tab, scope, refreshUsage])
  useEffect(() => { if (draft === null) setModelFilter('') }, [draft])

  // The welcome card's brain step hands this pane the space with no brains, or
  // the provider key a refused space is waiting on. Acting on it once and
  // clearing it keeps a later reopen of the pane from replaying the flow.
  useEffect(() => {
    if (request === undefined || request === null) return
    setTab('usage')
    if (request.kind === 'add-brain') {
      setDraft({ name: '', model: '', chatModel: '', cli: '', instructions: '', spaces: [request.space as SpaceId] })
    } else {
      setProviderEditor(true)
    }
    onRequestHandled?.()
  }, [request, onRequestHandled])

  // ── Usage tab ──────────────────────────────────────────────────────────
  /**
   * A row's chat model as text: its own override, else the resolved default
   * marked as such, else "Default" while no model resolves at all.
   */
  const chatModelText = (row: AgentRow): string => {
    if (row.model === null) return t('brains.agent.default')
    return row.overridden ? row.model.model : `${t('brains.agent.default')} · ${row.model.model}`
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
  const connectService = async (row: ServiceRow, value: string): Promise<void> => {
    setStatus('')
    const outcome = await postForReason('/idealize/brains/services', { id: row.id, kind: row.kind, apiKey: value })
    if (!outcome.ok) {
      // The route knows why it refused — an environment variable already
      // supplying this key, say. Its reason beats a generic "check the key".
      setStatus(outcome.error ?? t('brains.services.failed'))
      return
    }
    setStatus(t('brains.services.saved'))
    setServiceDraft(null)
    setAdding(false)
    notifyBrainsChanged()
    // The models a newly connected service offers must be selectable at once:
    // a person who pastes a key and sees nothing change reads it as failure.
    await Promise.all([refreshMedia(), refreshState(), refreshAgents()])
  }

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
  const visibleServices = (services ?? [])
    .filter(row => adding ? !row.connected : row.connected)
    .sort((left, right) => left.kind === right.kind ? 0 : left.kind === 'media' ? -1 : 1)

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
  const applyStrategy = async (strategy: Strategy): Promise<void> => {
    if (strategy === 'custom') return
    await post('/idealize/freetokens/routing/strategy', { strategy })
    await refreshState()
  }
  /** Save the sliders as the engine's custom vector; it normalizes, and the refresh reads the result back. */
  const commitWeights = async (): Promise<void> => {
    if (weights === null) return
    const ok = await post('/idealize/freetokens/routing/strategy', { strategy: 'custom', weights })
    setStatus(ok ? t('brains.prefs.saved') : t('brains.prefs.failed'))
    if (ok) await refreshState()
  }

  // ── Budget tab ─────────────────────────────────────────────────────────
  /** One period cell: the cost from configured prices over the token count, or tokens alone while nothing is priced. */
  const periodCell = (period: 'month' | 'year', category: typeof CATEGORIES[number]): ReactNode => {
    if (usage === null) return '—'
    const count = tokens(usage[period][category])
    if (!usage.cost.configured) return count
    return (
      <span className={css.cellCost} data-budget-cost={`${period}-${category}`}>
        <strong>{money(usage.cost[period][category], usage.cost.currency)}</strong>
        <small>{count}</small>
      </span>
    )
  }
  /**
   * What the price editor says beneath its fields: where the price it shows
   * came from, or, with no price yet, how to type one.
   */
  const priceHint = (row: ModelCostRow, cost: CostState, openRouterPrices: UsageState['openRouterPrices']): string => {
    if (row.price?.source === 'market' && openRouterPrices != null) {
      return t('brains.prices.source.openrouter', { time: when(openRouterPrices.fetchedAt) })
    }
    if (row.price?.source === 'catalogue') return t('brains.prices.source.catalogue')
    return t('brains.prices.hint', { currency: cost.currency })
  }
  /** Open the inline editor on a model row, seeded with the price it has. */
  const beginPrice = (row: ModelCostRow): void => {
    const price = row.price
    setPriceDraft({
      provider: row.provider,
      model: row.model,
      input: price === undefined ? '' : String(price.input),
      output: price === undefined ? '' : String(price.output),
      cacheRead: price === undefined ? '' : String(price.cacheRead),
      cacheWrite: price === undefined ? '' : String(price.cacheWrite),
      more: false,
    })
  }
  /**
   * Save the editor's figures as the model's price. Input and output are
   * required; a cache price left blank takes the input price, which is what
   * a service with no cache discount charges — no kind is ever saved as free
   * by omission.
   */
  const savePrice = async (): Promise<void> => {
    if (priceDraft === null) return
    const input = priceNumber(priceDraft.input)
    const output = priceNumber(priceDraft.output)
    if (input === undefined || output === undefined) {
      setStatus(t('brains.prices.incomplete'))
      return
    }
    const price = {
      input,
      output,
      cacheRead: priceNumber(priceDraft.cacheRead) ?? input,
      cacheWrite: priceNumber(priceDraft.cacheWrite) ?? input,
    }
    const ok = await post('/idealize/models/prices', { provider: priceDraft.provider, model: priceDraft.model, price })
    setStatus(ok ? t('brains.prices.saved') : t('brains.prices.failed'))
    if (ok) {
      setPriceDraft(null)
      await refreshUsage(scope)
    }
  }
  const saveBudget = async (): Promise<void> => {
    if (budgetDraft === null) return
    const value = Number(budgetDraft.replace(/[^0-9]/g, ''))
    const ok = await post('/idealize/models/budget', { monthlyTokenBudget: value })
    setStatus(ok ? t('brains.budget.saved') : t('brains.budget.failed'))
    if (ok) {
      setBudgetDraft(null)
      await refreshUsage(scope)
    }
  }

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
  const strategy: Strategy = routing?.strategy ?? 'priority'
  // Sorted by the name as shown, which is the resolved one, not the raw payload field.
  const modelOptions = sortedProviders(
    (state?.providers.filter(p => p.models.length > 0) ?? [])
      .map(p => ({ ...p, displayName: providerDisplayName(p.provider, p.displayName) })),
  )
  const catalogueModels = modelOptions.reduce((sum, provider) => sum + provider.models.length, 0)
  /** The sheet's chat catalogue after the filter field: a group drops out when none of its models match. */
  const filteredOptions = (() => {
    const query = modelFilter.trim().toLowerCase()
    if (query === '') return modelOptions
    return modelOptions
      .map(provider => ({
        ...provider,
        models: providerLabel(provider).toLowerCase().includes(query)
          ? provider.models
          : provider.models.filter(id => id.toLowerCase().includes(query)),
      }))
      .filter(provider => provider.models.length > 0)
  })()
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
        {row.access.reason === 'no-model' && t('brains.agent.unassigned')}
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
            <button type="button" className={css.chip} onClick={() => { setProviderEditor(true) }}>
              {t('brains.agent.addKey')}
            </button>
          )}
      </span>
    )
  }

  // A brain works in the spaces its `spaces` list names, and lists under each
  // of them; a brain naming none is an agent role, which answers to the person.
  const brainsIn = (space: SpaceId): AgentRow[] => (agents ?? []).filter(row => row.spaces.includes(space))
  const roleAgents = (agents ?? []).filter(row => row.spaces.length === 0)
  /** What the open sheet's model field is picking: a space's generation model, or a chat model. */
  const sheetGeneration = draft === null ? undefined : mediaForSpaces(draft.spaces)
  /** The chat catalogue as a sheet field lists it: the default first, then every provider's models the filter leaves. */
  // A native menu draws an optgroup label small and grey, which at 650 models
  // reads as more list. The rules make each group findable while scrolling
  // (JJ, 10 Sep 2026).
  const chatModelOptions = (): ReactNode => (
    <>
      <option value="">{t('brains.edit.modelDefault')}</option>
      {filteredOptions.map(provider => (
        <optgroup key={provider.provider} label={`──  ${providerLabel(provider)}  ──`}>
          {provider.models.map(id => (
            <option key={id} value={`${provider.provider} ${id}`}>{id}</option>
          ))}
        </optgroup>
      ))}
    </>
  )
  /**
   * The filter field over a long chat catalogue, and the note that says what
   * the catalogue holds and when it was read. A query matching nothing says so
   * in place of the note, which is the moment a person is looking for a model
   * no service has published.
   */
  const chatCatalogueAids = (): ReactNode => (
    <>
      {catalogueModels > MODEL_FILTER_FROM && (
        <input
          className={css.fieldInput}
          type="search"
          data-brains-model-filter=""
          aria-label={t('brains.edit.modelFilter')}
          placeholder={t('brains.edit.modelFilter')}
          value={modelFilter}
          onChange={(event) => { setModelFilter(event.target.value) }}
        />
      )}
      <span className={css.fieldHint} data-brains-catalogue="">
        {modelFilter.trim() !== '' && filteredOptions.length === 0
          ? t('brains.edit.noMatch', { query: modelFilter.trim() })
          : t('brains.edit.catalogue', {
            models: catalogueModels,
            providers: modelOptions.length,
            time: state?.readAt === undefined ? '—' : when(state.readAt),
          })}
      </span>
    </>
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
      return listed === undefined ? stored.model : listed.model.name
    }
    const first = row.candidates[0]
    return first === undefined ? t('brains.media.choose') : `${t('brains.agent.default')} · ${first.model.name}`
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
              <button type="button" className={css.chip} onClick={() => { setProviderEditor(true) }}>
                {t('brains.media.addKey')}
              </button>
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
    const pinnedText = row.model === null ? t('brains.agent.unassigned') : row.model.model
    // A Terminal row reads the CLI it launches beside its model: the choice
    // itself lives in the sheet, where the model is chosen with it.
    const cli = prefix !== 'terminal' ? undefined : cliLabel(launches?.byActivity[row.id])
    return (
      <div key={`${prefix}:${row.id}`} className={css.row} role="row" data-brain={row.id}>
        <span className={css.cellKey}>{row.name}</span>
        {row.modelPinned
          ? <span className={css.rowNote} data-brain-pinned="" data-brain-model={pinnedText}>{pinnedText}</span>
          : generation !== undefined
            ? generationCell(generation)
            : (
              <span className={css.rowNote} data-brain-model={chatModelText(row)}>
                {cli === undefined ? chatModelText(row) : `${cli} · ${chatModelText(row)}`}
              </span>
            )}
        <span className={css.cellAction}>
          <button type="button" className={css.chip} onClick={() => { beginEdit(row) }}>
            {t('brains.agent.edit')}
          </button>
        </span>
        {accessNote(row)}
      </div>
    )
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
    return (
      <div key={row.id} className={css.row} role="row" data-media-preset={row.id}>
        <span className={css.cellKey}>{name}</span>
        {generationCell(row)}
      </div>
    )
  }

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
            <SectionHead title={t('brains.agents.title')} detail={t('brains.agents.detail')} />
            {(spaces ?? []).map((entry) => {
              const label = t(SPACE_LABELS[entry.id])
              const generation = mediaOf(entry.id)
              return (
                <div key={entry.id} data-brains-space={entry.id}>
                  <SectionHead title={label} />
                  <div className={css.list} role="table" aria-label={label}>
                    {brainsIn(entry.id).map(row => agentRow(row, entry.id))}
                    {entry.id === 'terminal' && defaultCliRow()}
                    {/* A brain confined to this space states the space's
                        generation model on its own row; the space row repeats
                        it only while no such brain exists. */}
                    {generation !== undefined
                      && !brainsIn(entry.id).some(row => !row.modelPinned && mediaForSpaces(row.spaces)?.id === generation.id)
                      && mediaRow(generation)}
                    <button
                      type="button"
                      className={css.addRow}
                      data-brains-space-add={entry.id}
                      onClick={() => { setDraft({ name: '', model: '', chatModel: '', cli: '', instructions: '', spaces: [entry.id] }) }}
                    >
                      <span className={css.plusBox} aria-hidden="true">+</span>
                      {t('brains.space.addBrain')}
                    </button>
                  </div>
                </div>
              )
            })}

            <SectionHead title={t('brains.otherAgents.title')} detail={t('brains.otherAgents.detail')} />
            <div className={css.list} role="table" aria-label={t('brains.otherAgents.title')}>
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

          </>
        )}

        {tab === 'models' && (
          <>
            <SectionHead
              title={t('brains.subs.title')}
              detail={t('brains.subs.detail')}
              action={(
                <a className={css.plusButton} href="/idealize/signin" target="_blank" rel="noreferrer" aria-label={t('brains.subs.add')}>+</a>
              )}
            />
            <div className={css.list}>
              {subscriptions.length === 0 && terminalClis.length === 0 && <div className={css.emptyRow}>{t('brains.subs.empty')}</div>}
              {terminalClis.map(row => (
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
              ))}
              {subscriptions.map(provider => (
                <div key={provider.provider} className={css.providerRow}>
                  <span className={css.providerName}>
                    <strong>{providerName(provider.provider)}</strong>
                    <small>{t('brains.subs.kind')}</small>
                  </span>
                  <span className={css.badge}>{t(provider.connected ? 'brains.provider.connected' : 'brains.provider.signedOut')}</span>
                  <a className={css.rowLink} href="/idealize/signin" target="_blank" rel="noreferrer">
                    {t(provider.connected ? 'brains.provider.manage' : 'brains.provider.connect')}
                  </a>
                </div>
              ))}
            </div>

            {/* One list for every service the person can connect. Chat routes
                and generation backends sit together, because a person has an
                account with a company and what that company sells is the
                company's business to state, not a category to navigate. */}
            <SectionHead
              title={t('brains.services.title')}
              detail={t('brains.services.detail')}
              action={(
                <button
                  type="button"
                  className={css.plusButton}
                  aria-label={t('brains.services.add')}
                  data-services-add=""
                  onClick={() => { setAdding(value => !value); setServiceDraft(null) }}
                >
                  +
                </button>
              )}
            />
            <div className={css.list} data-services="">
              {(services ?? []).filter(row => row.connected).length === 0 && !adding && (
                <div className={css.emptyRow}>{t('brains.services.empty')}</div>
              )}
              {/* While adding, the media services lead under their own label.
                  Unlabelled, thirty chat routes bury the handful that make
                  images, video or sound, which is what a person opening this
                  list to make a video came for. */}
              {visibleServices
                .map((row, index) => {
                  const heading = !adding || row.kind === visibleServices[index - 1]?.kind
                    ? undefined
                    : t(row.kind === 'media' ? 'brains.services.groupMedia' : 'brains.services.groupChat')
                  return { row, heading }
                })
                .map(({ row, heading }) => {
                  const open = serviceDraft?.id === row.id && serviceDraft.kind === row.kind
                  return (
                    <Fragment key={`${row.kind}:${row.id}`}>
                      {heading !== undefined && <div className={css.groupRow} data-service-group={row.kind}>{heading}</div>}
                      <div
                        className={css.providerRow}
                        data-service={row.id}
                        data-service-kind={row.kind}
                        data-service-connected={row.connected ? '' : undefined}
                      >
                        <span className={css.providerName}>
                          <strong>{row.name}</strong>
                          <small>{makesLabel(row)}</small>
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
                                  <button type="button" className={css.secondary} onClick={() => { setServiceDraft(null) }}>
                                    {t('brains.cancel')}
                                  </button>
                                  <button type="button" className={css.primary} onClick={() => { void connectService(row, serviceDraft.value) }}>
                                    {t('brains.services.connect')}
                                  </button>
                                </span>
                              </span>
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
                                {row.connected && <span className={css.badge}>{t('brains.provider.connected')}</span>}
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
                    </Fragment>
                  )
                })}
              {adding && (services ?? []).filter(row => !row.connected).length === 0 && (
                <div className={css.emptyRow}>{t('brains.services.none')}</div>
              )}
              {/* A keys file connects several services at once: the route an
                  organisation's keys arrive by, for anyone who did not open
                  the file itself. */}
              {adding && (
                <>
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
                  <button
                    type="button"
                    className={css.rowLink}
                    data-services-import=""
                    onClick={() => keysFileField.current?.click()}
                  >
                    {t('brains.services.import')}
                  </button>
                </>
              )}
              {/* The advanced route stays reachable and stays marked: it is the
                  only path that asks for a web address, and asking for one is
                  what made adding a service hard. */}
              {adding && (
                <button
                  type="button"
                  className={css.rowLink}
                  data-services-advanced=""
                  onClick={() => { setAdding(false); setProviderEditor(true) }}
                >
                  {t('brains.services.advanced')}
                </button>
              )}
            </div>

            <SectionHead
              title={t('brains.free.title')}
              detail={free === undefined ? t('brains.free.none') : `${t('brains.free.detail')} · ${String(free.models.length)} ${t('brains.free.models')}`}
            />
            <div className={css.card}>
              <label className={css.cardRow}>
                <span className={css.cardLabel}>{t('brains.free.strategy')}</span>
                <select
                  className={css.cardSelect}
                  value={strategy}
                  disabled={routing === null}
                  onChange={(event) => { void applyStrategy(event.target.value as Strategy) }}
                >
                  {STRATEGIES.map(name => (
                    <option key={name} value={name}>{t(`brains.strategy.${name}`)}</option>
                  ))}
                  {strategy === 'custom' && <option value="custom">{t('brains.strategy.custom')}</option>}
                </select>
              </label>
              {WEIGHT_KEYS.map(key => (
                <label key={key} className={css.weightRow}>
                  <span className={css.weightLabel}>{t(`brains.weight.${key}`)}</span>
                  <input
                    type="range"
                    className={css.weightInput}
                    min={0}
                    max={100}
                    aria-label={t(`brains.weight.${key}`)}
                    disabled={weights === null}
                    value={weights?.[key] ?? 0}
                    onChange={(event) => {
                      setWeights(previous => previous === null ? null : { ...previous, [key]: Number(event.target.value) })
                    }}
                    onMouseUp={() => { void commitWeights() }}
                    onKeyUp={() => { void commitWeights() }}
                    onTouchEnd={() => { void commitWeights() }}
                  />
                  <span className={css.weightValue}>{weights === null ? '—' : `${String(weights[key])}%`}</span>
                </label>
              ))}
            </div>
          </>
        )}

        {tab === 'router' && <RouterTab t={t} />}
        {tab === 'budget' && (
          <>
            <SectionHead title={t('brains.budget.title')} detail={t('brains.budget.detail')} />
            <label className={css.field}>
              <span className={css.fieldLabel}>{t('brains.budget.view')}</span>
              <select className={css.fieldSelect} value={scope} onChange={(event) => { setScope(event.target.value) }}>
                <option value="">{t('brains.budget.overall')}</option>
                {(usage?.projects ?? []).map(project => (
                  <option key={project.path} value={project.path}>{project.label}</option>
                ))}
              </select>
            </label>
            <div className={css.table} role="table" aria-label={t('brains.budget.title')}>
              <div className={css.tableHead} role="row">
                <span className={css.colCategory}>{t('brains.budget.category')}</span>
                <span className={css.colPeriod}>{t('brains.budget.month')}</span>
                <span className={css.colPeriod}>{t('brains.budget.year')}</span>
              </div>
              {CATEGORIES.map(category => (
                <div key={category} className={category === 'total' ? css.tableTotal : css.tableRow} role="row">
                  <span className={css.colCategory}>
                    <strong>{t(`brains.category.${category}`)}</strong>
                    <small>{t(`brains.category.${category}.detail`)}</small>
                  </span>
                  <span className={css.colPeriod}>{periodCell('month', category)}</span>
                  <span className={css.colPeriod}>{periodCell('year', category)}</span>
                </div>
              ))}
            </div>
            {usage !== null && !usage.cost.configured && (
              <p className={css.note} data-budget-no-prices="">{t('brains.budget.noPrices')}</p>
            )}
            {usage !== null && usage.cost.configured && usage.cost.unpricedSubscriptions.length > 0 && (
              <p className={css.note} data-budget-unpriced-subs="">
                {t('brains.budget.unpricedSubs', { providers: usage.cost.unpricedSubscriptions.map(providerName).join(', ') })}
              </p>
            )}
            {usage !== null && usage.cost.configured && usage.cost.unpricedTokens.year > 0 && (
              <p className={css.note} data-budget-unpriced-tokens="">
                {t('brains.budget.unpricedTokens', { tokens: tokens(usage.cost.unpricedTokens.year) })}
              </p>
            )}
            {usage !== null && (
              <>
                <SectionHead title={t('brains.spend.title')} detail={t('brains.spend.detail')} />
                <div className={css.table} role="table" aria-label={t('brains.spend.title')} data-spend-models="">
                  <div className={css.tableHead} role="row">
                    <span className={css.colCategory}>{t('brains.spend.model')}</span>
                    <span className={css.colPeriod}>{t('brains.spend.tokens')}</span>
                    <span className={css.colCost}>{t('brains.spend.cost')}</span>
                  </div>
                  {(usage.models ?? []).length === 0 && <div className={css.emptyRow}>{t('brains.spend.none')}</div>}
                  {(usage.models ?? []).map((row) => {
                    const key = `${row.provider} ${row.model}`
                    const editing = priceDraft !== null && priceDraft.provider === row.provider && priceDraft.model === row.model
                    return (
                      <Fragment key={key}>
                        <div className={css.tableRow} role="row" data-spend-model={key} data-spend-category={row.category}>
                          <span className={css.colCategory}>
                            <strong>{row.model === '' ? t('brains.agent.default') : row.model}</strong>
                            <small>{providerName(row.provider)}</small>
                          </span>
                          <span className={css.colPeriod}>{tokens(row.total)}</span>
                          <span className={css.colCost}>
                            {row.category === 'subscriptions' && <small>{t('brains.spend.plan')}</small>}
                            {row.category === 'free' && <small>{t('brains.spend.free')}</small>}
                            {row.category === 'metered' && row.cost !== undefined && (
                              <>
                                <strong data-spend-cost={key}>{money(row.cost, usage.cost.currency)}</strong>
                                <button type="button" className={css.priceLink} onClick={() => { beginPrice(row) }}>
                                  {t('brains.spend.editPrice')}
                                </button>
                              </>
                            )}
                            {row.category === 'metered' && row.cost === undefined && (
                              <>
                                <span data-spend-unpriced={key}>—</span>
                                <button type="button" className={css.priceLink} onClick={() => { beginPrice(row) }}>
                                  {t('brains.spend.setPrice')}
                                </button>
                              </>
                            )}
                          </span>
                        </div>
                        {editing && (
                          <div className={css.priceEditor} data-spend-price-editor={key}>
                            <div className={css.priceFields}>
                              {(['input', 'output', ...priceDraft.more ? ['cacheRead', 'cacheWrite'] as const : []] as const).map(kind => (
                                <label key={kind} className={css.priceField}>
                                  <span className={css.fieldHint}>{t(`brains.prices.${kind}`)}</span>
                                  <input
                                    className={css.budgetInput}
                                    inputMode="decimal"
                                    aria-label={`${row.model} ${t(`brains.prices.${kind}`)}`}
                                    placeholder={kind === 'cacheRead' || kind === 'cacheWrite' ? priceDraft.input : ''}
                                    value={priceDraft[kind]}
                                    onChange={(event) => { setPriceDraft({ ...priceDraft, [kind]: event.target.value }) }}
                                    onKeyDown={(event) => {
                                      if (event.key === 'Enter') { event.preventDefault(); void savePrice() }
                                      if (event.key === 'Escape') setPriceDraft(null)
                                    }}
                                  />
                                </label>
                              ))}
                            </div>
                            <span className={css.fieldHint} data-spend-price-source={row.price?.source ?? 'none'}>
                              {priceHint(row, usage.cost, usage.openRouterPrices)}
                            </span>
                            <span className={css.keyActions}>
                              <button type="button" className={css.secondary} onClick={() => { setPriceDraft({ ...priceDraft, more: !priceDraft.more }) }}>
                                {t(priceDraft.more ? 'brains.prices.less' : 'brains.prices.more')}
                              </button>
                              <button type="button" className={css.secondary} onClick={() => { setPriceDraft(null) }}>{t('brains.cancel')}</button>
                              <button type="button" className={css.primary} onClick={() => { void savePrice() }}>{t('brains.save')}</button>
                            </span>
                          </div>
                        )}
                      </Fragment>
                    )
                  })}
                  {(usage.models ?? []).length > 0 && (() => {
                    const rows = usage.models ?? []
                    const priced = rows.filter(row => row.cost !== undefined)
                    const unpriced = rows.filter(row => row.category === 'metered' && row.cost === undefined).length
                    const sum = priced.reduce((total, row) => total + (row.cost ?? 0), 0)
                    return (
                      <div className={css.tableTotal} role="row" data-spend-total="">
                        <span className={css.colCategory}><strong>{t('brains.spend.total')}</strong></span>
                        <span className={css.colPeriod}>{tokens(rows.reduce((total, row) => total + row.total, 0))}</span>
                        <span className={css.colCost}>
                          <strong data-spend-total-cost="">{priced.length === 0 ? '—' : money(sum, usage.cost.currency)}</strong>
                          {unpriced > 0 && <small data-spend-unpriced-count={String(unpriced)}>{t('brains.spend.unpricedCount', { count: unpriced })}</small>}
                        </span>
                      </div>
                    )
                  })()}
                </div>
                <SectionHead title={t('brains.generations.title')} detail={t('brains.generations.detail')} />
                {(() => {
                  const generations = usage.generations ?? { rows: [], currency: null }
                  const madeTotal = generations.rows.reduce((sum, row) => sum + row.count, 0)
                  const billedTotal = generations.rows.reduce((sum, row) => sum + (row.billed?.cost ?? 0), 0)
                  return (
                    <div className={css.table} role="table" aria-label={t('brains.generations.title')} data-generations="">
                      <div className={css.tableHead} role="row">
                        <span className={css.colCategory}>{t('brains.generations.endpoint')}</span>
                        <span className={css.colPeriod}>{t('brains.generations.made')}</span>
                        <span className={css.colCost}>{t('brains.generations.billed')}</span>
                      </div>
                      {generations.rows.length === 0 && <div className={css.emptyRow}>{t('brains.generations.none')}</div>}
                      {generations.rows.map(row => (
                        <div key={`${row.provider} ${row.model}`} className={css.tableRow} role="row" data-generation-row={row.model}>
                          <span className={css.colCategory}>
                            <strong>{row.model}</strong>
                            <small>
                              {row.mediaType === undefined
                                ? providerName(row.provider)
                                : t('brains.generations.of', {
                                  provider: providerName(row.provider),
                                  kind: t(`brains.generations.kind.${mediaKind(row.mediaType)}`),
                                })}
                            </small>
                          </span>
                          <span className={css.colPeriod}>{String(row.count)}</span>
                          <span className={css.colCost}>
                            {row.billed === undefined
                              ? <small data-generation-unbilled={row.model}>{t('brains.generations.unbilled')}</small>
                              : (
                                <>
                                  <strong data-generation-cost={row.model}>{money(row.billed.cost, row.billed.currency)}</strong>
                                  <small>{t('brains.generations.units', { quantity: row.billed.quantity, unit: row.billed.unit })}</small>
                                </>
                              )}
                          </span>
                        </div>
                      ))}
                      {generations.rows.length > 0 && (
                        <div className={css.tableTotal} role="row" data-generations-total="">
                          <span className={css.colCategory}><strong>{t('brains.spend.total')}</strong></span>
                          <span className={css.colPeriod}>{String(madeTotal)}</span>
                          <span className={css.colCost}>
                            <strong data-generations-total-cost="">
                              {generations.currency === null ? '—' : money(billedTotal, generations.currency)}
                            </strong>
                          </span>
                        </div>
                      )}
                    </div>
                  )
                })()}
                {usage.falUsage == null && <p className={css.note} data-generations-connect="">{t('brains.generations.connect')}</p>}
                {usage.falUsage?.error !== undefined && (
                  <p className={css.note} data-generations-error="">{t('brains.generations.failed', { error: usage.falUsage.error })}</p>
                )}
              </>
            )}
            <div className={css.budgetRow}>
              <span className={css.fieldLabel}>{t('brains.budget.monthly')}</span>
              {budgetDraft === null
                ? (
                  <button type="button" className={css.budgetValue} onClick={() => { setBudgetDraft(String(usage?.monthlyTokenBudget ?? 0)) }}>
                    {usage === null || usage.monthlyTokenBudget === 0
                      ? t('brains.budget.unset')
                      : `${tokens(usage.month.total)} / ${tokens(usage.monthlyTokenBudget)}`}
                  </button>
                )
                : (
                  <span className={css.budgetEdit}>
                    <input
                      className={css.budgetInput}
                      inputMode="numeric"
                      aria-label={t('brains.budget.monthly')}
                      value={budgetDraft}
                      onChange={(event) => { setBudgetDraft(event.target.value) }}
                    />
                    <button type="button" className={css.primary} onClick={() => { void saveBudget() }}>{t('brains.save')}</button>
                    <button type="button" className={css.secondary} onClick={() => { setBudgetDraft(null) }}>{t('brains.cancel')}</button>
                  </span>
                )}
            </div>
            {usage !== null && usage.monthlyTokenBudget > 0 && (
              <div className={css.track} aria-hidden="true">
                <div className={css.fill} style={{ width: `${String(Math.min(100, Math.round(usage.month.total / usage.monthlyTokenBudget * 100)))}%` }} />
              </div>
            )}
            <p className={css.note}>{t('brains.budget.note')}</p>
          </>
        )}

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
              <label className={css.field} data-brains-field="name">
                <span className={css.fieldLabel}>{t('brains.edit.name')}</span>
                <input
                  className={css.fieldInput}
                  value={draft.name}
                  required
                  onChange={(event) => { setDraft({ ...draft, name: event.target.value }) }}
                />
              </label>
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
              <label className={css.field} data-brains-field="model">
                <span className={css.fieldLabel}>{t(sheetGeneration === undefined ? 'brains.edit.model' : 'brains.edit.generationModel')}</span>
                {/* Narrowed by the spaces above: a brain confined to one
                    generating space picks from that space's compatible models,
                    and every other brain picks from the chat catalogue. */}
                <select
                  className={css.fieldSelect}
                  data-brains-model=""
                  aria-label={t(sheetGeneration === undefined ? 'brains.edit.model' : 'brains.edit.generationModel')}
                  value={draft.model}
                  onChange={(event) => { setDraft({ ...draft, model: event.target.value }) }}
                >
                  {sheetGeneration === undefined
                    ? chatModelOptions()
                    : (
                      <>
                        <option value="">{t('brains.media.choose')}</option>
                        {sortedCandidates(sheetGeneration.candidates).map(candidate => (
                          <option
                            key={`${candidate.backend} ${candidate.model.id}`}
                            value={`${candidate.backend} ${candidate.model.id}`}
                          >
                            {candidate.model.name}
                          </option>
                        ))}
                      </>
                    )}
                </select>
                {sheetGeneration === undefined && chatCatalogueAids()}
              </label>
              {sheetGeneration !== undefined && (
                <label className={css.field} data-brains-field="chat-model">
                  <span className={css.fieldLabel}>{t('brains.edit.chatModel')}</span>
                  {/* The model that drives the generation tool. Its own field,
                      so a generating brain can leave an unreachable default
                      route without moving every other brain off it. */}
                  <select
                    className={css.fieldSelect}
                    data-brains-chat-model=""
                    aria-label={t('brains.edit.chatModel')}
                    value={draft.chatModel}
                    onChange={(event) => { setDraft({ ...draft, chatModel: event.target.value }) }}
                  >
                    {chatModelOptions()}
                  </select>
                  {chatCatalogueAids()}
                  <span className={css.fieldHint}>{t('brains.edit.chatModelHint')}</span>
                </label>
              )}
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
              {draft.spaces.includes('chat') && (
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
                </div>
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
