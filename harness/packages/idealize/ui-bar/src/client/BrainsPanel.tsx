/**
 * The Models drawer pane (build spec "One core model", 25 Nov 2026). The app
 * has three views, and the pane states what runs each one, top to bottom:
 *
 * - What runs each view: one row each for Coding, Chat and Studio. Coding
 *   names the command-line app a fresh Terminal shell starts
 *   (`GET /idealize/terminal/launches`) and Change writes the Terminal's
 *   default launch command. Chat names the app's default model
 *   (`GET /idealize/models/state`) and Change opens the model browser, whose
 *   choice is written with `POST /idealize/models/default`. Studio names the
 *   services its image, video and sound models run on and opens the key field
 *   of the one that is missing.
 * - Add another model: a second command-line app, a key from a model company
 *   (the service list with its key fields, sign-ins, keys-file import and the
 *   upstream provider editor), the free route, and the key gateway.
 * - Studio models you have approved: `GET /idealize/generate/approved`, with
 *   Ask again withdrawing one approval. A host without the route serves an
 *   empty list.
 * - Recent model changes: the router's log, read when the disclosure opens.
 *
 * The file and the component keep the name the drawer imports. Every save
 * raises {@link notifyBrainsChanged}, which the welcome card and the gateway
 * row listen for. The token and cost tables live in the Time & cost pane
 * (WorkPanel.tsx, BudgetSection.tsx).
 */
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ModelsSettingsSectionHost, ModelsSectionInjected } from '@deepseek-ai/dsh-client-ui-settings-models/client'
import type { BrainsRequest } from './bar-store.ts'
import { notifyBrainsChanged } from './brains-changed.ts'
import { providerDisplayName } from './format.ts'
import type { BarKey } from './locales.ts'
import { chatModel } from './model-browser.ts'
import type { BrowserModel, ChatModelDetail, MediaCandidateModel, RatingMap } from './model-browser.ts'
import { ModelBrowser } from './ModelBrowser.tsx'
import { RecentModelChanges } from './RouterTab.tsx'
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
   * Move the open chat onto a preset's model. The pane no longer edits
   * presets, so it never calls this; the member stays because the drawer's
   * host object supplies it.
   * @param brainId - the preset that was saved.
   * @returns once the write settled.
   */
  followBrain: (brainId: string) => Promise<void>
}

/** When the pane reads a newly connected service's models again. */
const CATALOGUE_REREADS_MS = [10_000, 60_000, 180_000]
/** What the host's connection check found. */
type ServiceCheck = 'working' | 'refused' | 'no-credit' | 'no-keys' | 'failed' | 'untested'

/** One provider route of the state payload. */
interface ProviderState {
  provider: string
  displayName: string
  auth: 'oauth' | 'apiKey' | 'free'
  connected: boolean
  models: string[]
}

/** The /idealize/models/state payload (host half of @idealize/models). */
interface ModelsState {
  default?: { provider: string; model: string } | null
  providers: ProviderState[]
}

/** One catalogue entry of GET /idealize/terminal/launches: a command-line app the Terminal can start. */
interface TerminalCliOption {
  id: string
  label: string
  command: string
  installed: boolean | null
}

/** The GET /idealize/terminal/launches payload (host half of @idealize/ui-terminal; no catalogue outside the desktop app). */
interface TerminalLaunchesState {
  default: string
  catalog?: TerminalCliOption[]
}

/** One route of GET /idealize/models/details: its chat models with what the browser shows of them. */
interface ChatDetailsProvider {
  provider: string
  displayName: string
  models: ChatModelDetail[]
}

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

/** One row of GET /idealize/brains/media, as far as the Studio row reads it. */
interface MediaPresetRow {
  id: string
  candidates: { backend: string; model: MediaCandidateModel }[]
}

/** One model of GET /idealize/generate/approved: a paid Studio model that runs without asking. */
interface ApprovedModel {
  key: string
  backend: string
  model: string
  name: string
}

/** Where an open key field renders: under the Studio row, or in the service list. */
type KeyPlace = 'studio' | 'list'

/** The open key field: its service, where it renders, and the key typed so far. */
interface ServiceDraft {
  id: string
  kind: 'chat' | 'media'
  place: KeyPlace
  value: string
}

/**
 * The command-line apps the Coding row offers, in the order it lists them.
 * `ids` are catalogue ids of the launches route; a choice with two ids is one
 * row that uses whichever of its apps the computer has.
 */
const CODING_APPS: readonly { key: string; ids: readonly string[]; label: BarKey }[] = [
  { key: 'claude-code', ids: ['claude-code'], label: 'models.app.claudeCode' },
  { key: 'codex', ids: ['codex'], label: 'models.app.codex' },
  { key: 'antigravity', ids: ['antigravity', 'gemini'], label: 'models.app.antigravity' },
  { key: 'kimi', ids: ['kimi'], label: 'models.app.kimi' },
]

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

/** The id prefix of a route or backend served through the organisation's key gateway (`@idealize/services`). */
const GATEWAY_PREFIX = 'gateway-'

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

/** Alphabetical, case-blind, with digit runs compared by value so `gpt-5.10` follows `gpt-5.9`. */
const byName = (left: string, right: string): number => left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' })

/**
 * The chat catalogue as the browser lists it: providers by display name,
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
 * Render the Models pane.
 * @param props.host - the provider editor face (index.ts).
 * @param props.request - what another surface asked this pane to open.
 * @param props.onRequestHandled - marks the request handled.
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
  const [state, setState] = useState<ModelsState | null>(null)
  const [launches, setLaunches] = useState<TerminalLaunchesState | null>(null)
  const [media, setMedia] = useState<MediaPresetRow[] | null>(null)
  const [services, setServices] = useState<ServiceRow[] | null>(null)
  const [approved, setApproved] = useState<ApprovedModel[]>([])
  const [serviceDraft, setServiceDraft] = useState<ServiceDraft | null>(null)
  // Why the open key form's last Connect failed. Shown inside the form: the
  // pane's status line sits below every section, out of sight of a form open
  // halfway down the list, so a refused key looked like a dead button (JJ,
  // 30 Oct 2026: "nothing happens when i click").
  const [serviceError, setServiceError] = useState<{ id: string; kind: 'chat' | 'media'; message: string } | null>(null)
  /** What each service's last connection check found, by `kind:id`. */
  const [checks, setChecks] = useState<Record<string, ServiceCheck | 'checking'>>({})
  /** The Coding row's list of apps. */
  const [codingOpen, setCodingOpen] = useState(false)
  /** The list under "Another subscription". */
  const [subscriptionsOpen, setSubscriptionsOpen] = useState(false)
  /** The service list under "A key from a model company". */
  const [keysOpen, setKeysOpen] = useState(false)
  /** The full, searchable list of services not yet connected. */
  const [adding, setAdding] = useState(false)
  const [serviceQuery, setServiceQuery] = useState('')
  /** The route an "Add key" asked for, until the services list can place it. */
  const [keyFor, setKeyFor] = useState<string | null>(null)
  const [providerEditor, setProviderEditor] = useState(false)
  /** True while the model browser is open on the default chat model. */
  const [browsing, setBrowsing] = useState(false)
  // The person's ratings, read each time the browser opens so a rating given from a chat shows on the card.
  const [ratings, setRatings] = useState<RatingMap | undefined>(undefined)
  useEffect(() => {
    if (!browsing) return
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
  /** Every chat model's description, abilities and price. */
  const [chatDetails, setChatDetails] = useState<ChatDetailsProvider[] | null>(null)
  const [status, setStatus] = useState('')

  const refreshState = useCallback(async () => {
    setState(await getJson<ModelsState>('/idealize/models/state'))
  }, [])
  const refreshLaunches = useCallback(async () => {
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
  // A host without the approvals route answers 404, which reads as no approvals.
  const refreshApproved = useCallback(async () => {
    const list = await getJson<{ models?: ApprovedModel[] }>('/idealize/generate/approved')
    setApproved(Array.isArray(list?.models) ? list.models : [])
  }, [])

  useEffect(() => {
    void refreshState()
    void refreshLaunches()
    void refreshMedia()
    void refreshApproved()
  }, [refreshState, refreshLaunches, refreshMedia, refreshApproved])
  // The chat details are read once per pane: the Chat row names its model by
  // them, and the browser describes every model.
  const chatDetailsAsked = useRef(false)
  useEffect(() => {
    if (chatDetailsAsked.current) return
    chatDetailsAsked.current = true
    void getJson<{ providers: ChatDetailsProvider[] }>('/idealize/models/details').then((details) => {
      setChatDetails(details?.providers ?? [])
    })
  }, [])

  // Another surface hands this pane the provider key it is waiting on. Acting
  // on the request once and clearing it keeps a later reopen of the pane from
  // replaying it. The requests that opened a preset's sheet have nothing left
  // to open, so they are cleared unanswered.
  useEffect(() => {
    if (request === undefined || request === null) return
    if (request.kind === 'add-key') {
      if (request.provider !== undefined) setKeyFor(request.provider)
      else setProviderEditor(true)
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
    setKeysOpen(true)
    setAdding(!row.connected)
    setServiceError(null)
    setServiceDraft({ id: row.id, kind: row.kind, place: 'list', value: '' })
  }, [keyFor, services])

  /** A route's name anywhere in the pane: one rule ({@link providerDisplayName}) over the state payload's entry. */
  const providerName = (provider: string): string =>
    providerDisplayName(provider, state?.providers.find(p => p.provider === provider)?.displayName)
  /** A chat model by its readable name, without the maker the catalogue repeats. */
  const modelName = (model: { provider: string; model: string }): string => {
    const name = chatDetails?.find(row => row.provider === model.provider)?.models.find(row => row.id === model.model)?.name
    return name === undefined ? readableModelId(model.model) : withoutMaker(name)
  }

  // ── Coding ─────────────────────────────────────────────────────────────
  /**
   * The catalogue entry one offered app resolves to: the entry already in use
   * when it is one of the app's, else the first the computer has, else the first listed.
   */
  const entryFor = (ids: readonly string[]): TerminalCliOption | undefined => {
    const entries = (launches?.catalog ?? []).filter(entry => ids.includes(entry.id))
    return entries.find(entry => entry.command === launches?.default)
      ?? entries.find(entry => entry.installed === true)
      ?? entries[0]
  }
  const offeredIds = CODING_APPS.flatMap(app => app.ids)
  /** Every app the pane lists: the four it names, then any other the catalogue carries. A plain shell is no app. */
  const codingChoices = [
    ...CODING_APPS.flatMap((app) => {
      const entry = entryFor(app.ids)
      return entry === undefined ? [] : [{ key: app.key, label: t(app.label), entry }]
    }),
    ...(launches?.catalog ?? [])
      .filter(entry => !offeredIds.includes(entry.id) && entry.command !== '')
      .map(entry => ({ key: entry.id, label: entry.label, entry })),
  ]
  const currentChoice = codingChoices.find(choice => choice.entry.command === launches?.default)
  /** Persist which command-line app a fresh Terminal shell starts. The command travels whole, so the host needs no catalogue. */
  const saveLaunch = async (command: string, label: string): Promise<void> => {
    const ok = await post('/idealize/terminal/launch', { command })
    setStatus(ok ? t('models.coding.saved', { app: label }) : t('models.coding.failed'))
    if (!ok) return
    setCodingOpen(false)
    notifyBrainsChanged()
    await refreshLaunches()
  }

  // ── Services and keys ──────────────────────────────────────────────────
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
  /**
   * Connect a service with the key the person pasted. One call for both kinds:
   * the route knows where a chat route's key belongs and where a generation
   * backend's does, so this surface never has to.
   */
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
    await Promise.all([refreshMedia(), refreshState()])
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
    // The free route asks too: its engine can hold no keys while the route still lists models.
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
    await Promise.all([refreshMedia(), refreshState()])
  }

  const generates = (row: ServiceRow): boolean => row.kind === 'media' || row.makes.some(kind => kind !== 'chat')
  // The free route keeps its own row: its key only opens the local engine, so "change key" means nothing there.
  const connectedServices = (services ?? []).filter(row => row.connected && row.id !== 'freetokens')
  /** Whether the service itself said this account cannot run: a refused key or no credit, never a check that got no answer. */
  const confirmedDown = (kind: ServiceRow['kind'], id: string): boolean => {
    const check = checks[`${kind}:${id}`]
    return check === 'refused' || check === 'no-credit'
  }
  // The next steps name services by id, so a route with two rows offers one.
  const nextServices = Object.keys(NEXT_SERVICES).flatMap((id) => {
    if ((services ?? []).some(row => row.id === id && row.connected)) return []
    const row = (services ?? []).find(entry => entry.id === id && entry.signIn !== true)
    return row === undefined ? [] : [row]
  })
  const matchesQuery = (name: string): boolean => name.toLowerCase().includes(serviceQuery.trim().toLowerCase())
  // Media first, so the services that make images, video and sound lead.
  const visibleServices = (services ?? [])
    .filter(row => !row.connected && !nextServices.includes(row) && matchesQuery(row.name))
    .sort((left, right) => generates(left) === generates(right) ? 0 : generates(left) ? -1 : 1)

  /** What a service makes, in the person's words; a service with an empty catalogue says so. */
  const makesLabel = (row: ServiceRow): string =>
    row.makes.length === 0
      ? t('brains.services.makesNothing')
      : row.makes.map(kind => t(`brains.services.makes.${kind}`)).join(' · ')

  // Signed-in subscriptions, or ones whose route is configured.
  const subscriptions = state?.providers.filter(p => p.auth === 'oauth' && (p.connected || p.models.length > 0)) ?? []
  const connectedPlans = subscriptions.filter(provider => provider.connected)
  const nextPlans = subscriptions.filter(provider => !provider.connected && PLAN_NAMES[provider.provider] !== undefined)
  // A plan nobody here is likely to reach for stays one search away, not gone.
  const otherPlans = subscriptions.filter(provider => !provider.connected && PLAN_NAMES[provider.provider] === undefined)
  const free = state?.providers.find(p => p.auth === 'free')

  // ── Chat ───────────────────────────────────────────────────────────────
  const chatDefault = state?.default ?? null
  const chatRoute = chatDefault === null ? undefined : state?.providers.find(row => row.provider === chatDefault.provider)
  const chatViaGateway = chatDefault?.provider.startsWith(GATEWAY_PREFIX) === true
  const chatFree = chatDefault !== null && (chatRoute?.auth === 'free' || chatDefault.model.endsWith(':free'))
  const chatConnected = chatDefault !== null && chatRoute?.connected === true
    && !confirmedDown('chat', chatDefault.provider)
    && !(chatRoute.auth === 'free' && checks['chat:freetokens'] === 'no-keys')
  const chatMain = (): string => {
    if (chatDefault === null) return t('models.chat.none')
    const model = chatRoute?.auth === 'free' && chatDefault.model === 'auto' ? t('brains.agent.freeAuto') : modelName(chatDefault)
    return t('models.chat.main', { model, provider: providerName(chatDefault.provider) })
  }
  const chatNote = (): string | undefined => {
    if (chatDefault === null) return undefined
    if (chatViaGateway) return t('models.chat.gateway')
    if (chatFree) return t('models.chat.free')
    if (chatRoute?.auth === 'oauth') return t('models.coding.note')
    return t('models.chat.billed', { provider: providerName(chatDefault.provider) })
  }
  // Sorted by the name as shown, which is the resolved one, not the raw payload field.
  const modelOptions = sortedProviders(
    (state?.providers.filter(p => p.models.length > 0) ?? [])
      .map(p => ({ ...p, displayName: providerDisplayName(p.provider, p.displayName) })),
  )
  /** The chat catalogue as the browser lists it: every route's models, described where the details route knows them. */
  const chatBrowserModels = (): BrowserModel[] => modelOptions.flatMap((provider) => {
    const described = chatDetails?.find(row => row.provider === provider.provider)?.models
    return provider.models.map(id => chatModel(
      provider.provider,
      provider.displayName,
      described?.find(row => row.id === id) ?? { id, name: id },
      t,
    ))
  })
  /** Make one chat model the app's default: the model every new chat starts on. */
  const saveDefault = async (model: { provider: string; model: string }, saved: string): Promise<void> => {
    const ok = await post('/idealize/models/default', model)
    setStatus(ok ? saved : t('models.chat.failed'))
    if (!ok) return
    notifyBrainsChanged()
    await refreshState()
  }
  /** The browser's choice, `provider model`, written as the default. */
  const applyDefault = async (value: string): Promise<void> => {
    setBrowsing(false)
    const split = value.indexOf(' ')
    if (split <= 0) return
    const model = { provider: value.slice(0, split), model: value.slice(split + 1) }
    await saveDefault(model, t('models.chat.saved', { model: modelName(model) }))
  }

  // ── Free models ────────────────────────────────────────────────────────
  const freeIsDefault = free !== undefined && chatDefault?.provider === free.provider
  /** The free route becomes the default once it can answer; its page, which the link opens, is where it gets its keys. */
  const turnOnFree = (): void => {
    if (free === undefined || !free.connected || freeIsDefault) return
    const model = free.models.includes('auto') ? 'auto' : free.models[0]
    if (model !== undefined) void saveDefault({ provider: free.provider, model }, t('models.free.on'))
  }

  // ── Studio ─────────────────────────────────────────────────────────────
  /** Whether Studio can reach one service: by the person's own key, or through the organisation's gateway. */
  const viaGateway = (id: string): boolean =>
    (media ?? []).some(preset => preset.candidates.some(candidate => candidate.backend === `${GATEWAY_PREFIX}${id}`))
  const studioHas = (id: string): boolean =>
    (services ?? []).some(row => row.id === id && row.connected && !confirmedDown(row.kind, row.id)) || viaGateway(id)
  const openRouterOn = studioHas('openrouter')
  const falOn = studioHas('fal')
  // fal's catalogue is public, so the media route lists its models before a key is stored.
  const falModels = new Set((media ?? []).flatMap(preset => preset.candidates.filter(candidate => candidate.backend === 'fal').map(candidate => candidate.model.id))).size
  const studioMissing = openRouterOn ? (falOn ? undefined : 'fal') : 'openrouter'
  /** The service whose key field the Studio row opens: a generation backend's row where one exists. */
  const studioKeyRow = studioMissing === undefined
    ? undefined
    : (services ?? []).filter(row => row.id === studioMissing && row.signIn !== true).sort((left, right) => Number(right.kind === 'media') - Number(left.kind === 'media'))[0]
  const studioMain = openRouterOn || !falOn
    ? t(falOn ? 'models.studio.mainBoth' : 'models.studio.main')
    : t('models.studio.mainFal')
  const studioNote = (): string => {
    if (openRouterOn && falOn) return viaGateway('openrouter') || viaGateway('fal') ? t('models.chat.gateway') : t('models.studio.billed')
    if (falOn) return t('models.studio.addOpenRouter')
    return falModels > 0 ? t('models.studio.addFalCount', { count: falModels }) : t('models.studio.addFal')
  }
  const studioStatus: { key: BarKey; state: string } = openRouterOn && falOn
    ? { key: 'models.status.connected', state: 'connected' }
    : openRouterOn
      ? { key: 'models.status.noFal', state: 'no-fal' }
      : falOn ? { key: 'models.status.noOpenRouter', state: 'no-openrouter' } : { key: 'models.status.needsKey', state: 'needs-key' }

  // ── Approved Studio models ─────────────────────────────────────────────
  const backendName = (backend: string): string =>
    (services ?? []).find(row => row.id === backend)?.name ?? providerDisplayName(backend)
  /** Withdraw one approval, so Studio asks again before that model's next use. */
  const askAgain = async (model: ApprovedModel): Promise<void> => {
    const ok = await post('/idealize/generate/approved', { key: model.key, approved: false })
    if (!ok) {
      setStatus(t('models.approved.failed'))
      return
    }
    setStatus('')
    setApproved(rows => rows.filter(row => row.key !== model.key))
    notifyBrainsChanged()
  }

  /**
   * A service's key field with its actions, the reason a Connect failed, and
   * the page a key comes from.
   * @param row - the service.
   * @param draft - the open draft, which is this service's.
   * @returns the form.
   */
  const keyForm = (row: ServiceRow, draft: ServiceDraft): ReactNode => (
    // A line of its own: the field is where a secret gets typed, and the key
    // page belongs directly under it, where someone without a key is already looking.
    <span className={css.keyPanel}>
      <span className={css.keyRow}>
        <input
          className={css.budgetInput}
          type="password"
          autoComplete="off"
          autoFocus
          aria-label={t('brains.services.field', { service: row.name })}
          placeholder={t('brains.services.placeholder')}
          value={draft.value}
          onChange={(event) => { setServiceDraft({ ...draft, value: event.target.value }) }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void connectService(row, draft.value)
            if (event.key === 'Escape') setServiceDraft(null)
          }}
        />
        <span className={css.keyActions}>
          <button type="button" className={css.secondary} onClick={() => { setServiceDraft(null); setServiceError(null) }}>
            {t('brains.cancel')}
          </button>
          <button type="button" className={css.primary} onClick={() => { void connectService(row, draft.value) }}>
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

  /** The open draft when it is this service's key field in this place. */
  const draftAt = (row: ServiceRow, place: KeyPlace): ServiceDraft | undefined =>
    serviceDraft?.id === row.id && serviceDraft.kind === row.kind && serviceDraft.place === place ? serviceDraft : undefined

  /**
   * One service: its name, what it makes, and a key field or the way to one.
   * Written once because a service can sit under Connected, Good next steps or
   * the full list.
   * @param row - the service.
   * @returns the row element.
   */
  const serviceRow = (row: ServiceRow): ReactNode => {
    const draft = draftAt(row, 'list')
    const check = checks[`${row.kind}:${row.id}`] ?? 'connected'
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
        {draft !== undefined
          ? keyForm(row, draft)
          : row.signIn === true
            ? <span className={css.badge}>{t('brains.services.signIn')}</span>
            : (
              <>
                {row.connected && (
                  <button
                    type="button"
                    className={`${css.badge} ${css.badgeButton}`}
                    data-service-check={check}
                    title={`${t(`brains.services.check.${check}.detail`, { service: row.name })} ${t('brains.services.check.again')}`}
                    onClick={() => { void checkService(row) }}
                  >
                    {t(`brains.services.check.${check}`)}
                  </button>
                )}
                {row.connected && row.kind === 'chat' && (
                  <button type="button" className={css.rowLink} data-service-manage={row.id} onClick={() => { setProviderEditor(true) }}>
                    {t('brains.provider.manage')}
                  </button>
                )}
                <button
                  type="button"
                  className={css.rowLink}
                  onClick={() => { setServiceError(null); setServiceDraft({ id: row.id, kind: row.kind, place: 'list', value: '' }) }}
                >
                  {t(row.connected ? 'brains.services.change' : 'brains.services.connect')}
                </button>
              </>
            )}
      </div>
    )
  }

  /** A subscription the person signs in to, with the page that signs them in. */
  const planRow = (provider: ProviderState, name: string, detail: BarKey, action: BarKey): ReactNode => (
    <div key={provider.provider} className={css.providerRow} data-provider={provider.provider}>
      <span className={css.providerName}>
        <strong>{name}</strong>
        <small>{t(detail)}</small>
      </span>
      {provider.connected && <span className={css.badge}>{t('brains.provider.connected')}</span>}
      <a className={css.rowLink} href="/idealize/signin" target="_blank" rel="noreferrer">{t(action)}</a>
    </div>
  )

  /**
   * One view's row: the view's name, what runs it, how it is paid for, whether
   * it can run now, and the one action that changes it.
   */
  const viewRow = (view: 'coding' | 'chat' | 'studio', row: {
    main: string
    note?: string | undefined
    status?: { text: string; state: string; ok: boolean } | undefined
    action?: ReactNode
    reveal?: ReactNode
  }): ReactNode => (
    <div className={css.viewRow} role="group" aria-label={t(`models.view.${view}`)} data-view={view} data-view-status={row.status?.state}>
      <strong className={css.viewName}>{t(`models.view.${view}`)}</strong>
      <span className={css.viewText}>
        <span className={css.viewMain} data-view-main="">{row.main}</span>
        {row.note !== undefined && <small className={css.viewNote} data-view-note="">{row.note}</small>}
      </span>
      {row.status !== undefined && (
        <span className={row.status.ok ? css.viewOk : css.viewWarn} data-view-state="">{row.status.text}</span>
      )}
      {row.action === undefined || row.action === false ? <span className={css.viewEnd} /> : row.action}
      {row.reveal}
    </div>
  )

  /** One "Add another model" row: a title, one sentence, and its action. */
  const addRow = (id: string, title: BarKey, detail: BarKey, action: ReactNode): ReactNode => (
    <div className={css.providerRow} data-models-add={id}>
      <span className={css.providerName}>
        <strong>{t(title)}</strong>
        <small>{t(detail)}</small>
      </span>
      {action}
    </div>
  )

  const codingInstalled = currentChoice?.entry.installed
  const installedChoices = codingChoices.filter(choice => choice.entry.installed === true)
  const keysConnected = connectedPlans.length > 0 || connectedServices.length > 0

  return (
    <div className={css.root}>
      <header className={css.header}>
        <h2 className={css.title}>{t('models.title')}</h2>
      </header>

      <div className={css.body}>
        <SectionHead title={t('models.views.title')} />
        <div className={css.list} data-models-views="">
          {viewRow('coding', launches === null
            ? { main: t('models.coding.desktop') }
            : {
              main: launches.default.trim() === ''
                ? t('models.coding.none')
                : t('models.coding.main', { app: currentChoice?.label ?? launches.default }),
              note: launches.default.trim() === '' ? undefined : t('models.coding.note'),
              status: codingInstalled === true
                ? { text: t('models.coding.installed'), state: 'installed', ok: true }
                : codingInstalled === false || launches.default.trim() === ''
                  ? { text: t('models.coding.notInstalled'), state: 'not-installed', ok: false }
                  : undefined,
              action: (
                <button type="button" className={css.rowLink} aria-expanded={codingOpen} data-view-action="coding" onClick={() => { setCodingOpen(open => !open) }}>
                  {t('models.change')}
                </button>
              ),
              reveal: codingOpen && (
                <div className={css.viewReveal} role="radiogroup" aria-label={t('models.coding.choose')} data-coding-apps="">
                  {installedChoices.length === 0 && <span className={css.viewNote}>{t('models.coding.noneInstalled')}</span>}
                  {installedChoices.map(choice => (
                    <label key={choice.key} className={css.choice}>
                      <input
                        type="radio"
                        name="idealize-coding-app"
                        value={choice.key}
                        checked={choice.entry.command === launches.default}
                        onChange={() => { void saveLaunch(choice.entry.command, choice.label) }}
                      />
                      {choice.label}
                    </label>
                  ))}
                </div>
              ),
            })}
          {viewRow('chat', {
            main: chatMain(),
            note: chatNote(),
            status: state === null
              ? undefined
              : chatConnected
                ? { text: t('models.status.connected'), state: 'connected', ok: true }
                : { text: t('models.status.needsKey'), state: 'needs-key', ok: false },
            action: (
              <button type="button" className={css.rowLink} data-view-action="chat" onClick={() => { setBrowsing(true) }}>
                {t('models.change')}
              </button>
            ),
          })}
          {viewRow('studio', {
            main: studioMain,
            note: studioNote(),
            status: services === null ? undefined : { text: t(studioStatus.key), state: studioStatus.state, ok: studioStatus.state === 'connected' },
            action: studioKeyRow !== undefined && draftAt(studioKeyRow, 'studio') === undefined && (
              <button
                type="button"
                className={css.rowLink}
                data-view-action="studio"
                onClick={() => { setServiceError(null); setServiceDraft({ id: studioKeyRow.id, kind: studioKeyRow.kind, place: 'studio', value: '' }) }}
              >
                {t('models.studio.addKey')}
              </button>
            ),
            reveal: studioKeyRow !== undefined && draftAt(studioKeyRow, 'studio') !== undefined && (
              <div className={css.viewReveal} data-studio-key={studioKeyRow.id}>
                {keyForm(studioKeyRow, draftAt(studioKeyRow, 'studio') as ServiceDraft)}
              </div>
            ),
          })}
        </div>

        <SectionHead title={t('models.add.title')} />
        <div className={css.list} data-models-add-list="">
          {addRow('subscription', 'models.add.subscription', 'models.add.subscriptionDetail', (
            <button type="button" className={css.rowLink} aria-expanded={subscriptionsOpen} data-models-add-action="subscription" onClick={() => { setSubscriptionsOpen(open => !open) }}>
              {t('models.add')}
            </button>
          ))}
          {subscriptionsOpen && (
            <div className={css.addReveal} data-models-subscriptions="">
              {launches === null && <div className={css.emptyRow}>{t('models.coding.desktop')}</div>}
              {codingChoices.map(choice => (
                <div key={choice.key} className={css.providerRow} data-coding-app={choice.key} data-coding-app-installed={choice.entry.installed === true ? '' : undefined}>
                  <span className={css.providerName}>
                    <strong>{choice.label}</strong>
                    <small>
                      {choice.entry.installed === true
                        ? t('models.subscription.installed', { command: choice.entry.command.split(' ')[0] ?? '' })
                        : choice.entry.installed === false ? t('models.subscription.missing') : t('models.subscription.unknown')}
                    </small>
                  </span>
                  {choice.entry.installed === true && choice.entry.command !== launches?.default && (
                    <button type="button" className={css.rowLinkWide} data-coding-app-use={choice.key} onClick={() => { void saveLaunch(choice.entry.command, choice.label) }}>
                      {t('models.subscription.use')}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {addRow('key', 'models.add.key', 'models.add.keyDetail', (
            <button
              type="button"
              className={css.rowLink}
              aria-expanded={keysOpen}
              data-models-add-action="key"
              onClick={() => { setKeysOpen(open => !open); setServiceDraft(null) }}
            >
              {t(keysConnected ? 'models.manage' : 'models.add')}
            </button>
          ))}
          {keysOpen && (
            <div className={css.addReveal} data-models-keys="" data-services="">
              {keysConnected && <div className={css.groupRow}>{t('brains.accounts.connected')}</div>}
              {connectedPlans.map(provider => planRow(provider, providerName(provider.provider), 'models.coding.note', 'brains.provider.manage'))}
              {connectedServices.map(row => <Fragment key={`${row.kind}:${row.id}`}>{serviceRow(row)}</Fragment>)}
              {(nextPlans.length > 0 || nextServices.length > 0) && <div className={css.groupRow} data-accounts-next="">{t('brains.accounts.next')}</div>}
              {nextPlans.map(provider => planRow(provider, t(PLAN_NAMES[provider.provider] as BarKey), 'brains.accounts.plan', 'brains.agent.signIn'))}
              {nextServices.map(row => <Fragment key={`${row.kind}:${row.id}`}>{serviceRow(row)}</Fragment>)}
              <div className={css.accountsSearch}>
                <button
                  type="button"
                  className={css.rowLinkWide}
                  aria-expanded={adding}
                  data-services-add=""
                  onClick={() => { setAdding(value => !value); setServiceDraft(null) }}
                >
                  {t('brains.accounts.searchAll', { count: (services ?? []).length })}
                </button>
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
                <button type="button" className={css.rowLinkWide} data-services-import="" onClick={() => keysFileField.current?.click()}>
                  {t('brains.services.import')}
                </button>
                {/* The advanced route stays reachable and stays marked: it is the
                    only path that asks for a web address, and asking for one is
                    what made adding a service hard. */}
                <button type="button" className={css.rowLinkWide} data-services-advanced="" onClick={() => { setAdding(false); setProviderEditor(true) }}>
                  {t('brains.services.advanced')}
                </button>
              </div>
              {adding && (
                <div data-services-all="">
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
                  {otherPlans.filter(provider => matchesQuery(providerName(provider.provider)))
                    .map(provider => planRow(provider, providerName(provider.provider), 'brains.accounts.plan', 'brains.agent.signIn'))}
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
                </div>
              )}
            </div>
          )}

          {addRow('free', 'models.add.free', 'models.add.freeDetail', (
            <a className={css.rowLink} href="/idealize/freetokens" target="_blank" rel="noreferrer" data-models-add-action="free" onClick={turnOnFree}>
              {t(freeIsDefault ? 'models.manage' : 'models.turnOn')}
            </a>
          ))}
          <GatewayRow t={t} />
        </div>

        <SectionHead title={t('models.approved.title')} />
        <div className={css.list} data-models-approved="">
          {approved.length === 0 && <div className={css.emptyRow} data-models-approved-empty="">{t('models.approved.empty')}</div>}
          {approved.map(model => (
            <div key={model.key} className={css.providerRow} data-approved={model.key}>
              <span className={css.providerName}>
                <strong>{model.name}</strong>
                <small>{t('models.approved.note', { backend: backendName(model.backend) })}</small>
              </span>
              <button type="button" className={css.rowLink} data-approved-ask={model.key} onClick={() => { void askAgain(model) }}>
                {t('models.approved.askAgain')}
              </button>
            </div>
          ))}
        </div>

        {status !== '' && <p className={css.status} role="status">{status}</p>}
        <RecentModelChanges t={t} />
      </div>

      {browsing && (
        <ModelBrowser
          kind="chat"
          spaceLabel={t('models.view.chat')}
          models={chatDetails === null ? null : chatBrowserModels()}
          current={chatDefault === null ? '' : `${chatDefault.provider} ${chatDefault.model}`}
          t={t}
          ratings={ratings}
          onRate={(model, tag, stars) => { void rate(model, tag, stars) }}
          onClose={() => { setBrowsing(false) }}
          onApply={(value) => { void applyDefault(value) }}
        />
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
