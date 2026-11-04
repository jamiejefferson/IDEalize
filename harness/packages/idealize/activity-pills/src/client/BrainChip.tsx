/**
 * The composer's brain chip: one control on the model seat
 * (`conversation.input.model`) that answers "who is answering?" in every state
 * (Paper "Brains rethink", boards 08 and 09, approved by JJ on 4 Nov 2026). It
 * names the brain and the model it runs on, and its panel holds the brain
 * list, the model with Change into the model browser, thinking effort and
 * auto-switch.
 *
 * THE BRAIN IS BACK ON THE ROW. JJ moved it behind the three dots on 9 Sep 2026
 * ("the main ask bar settings is a mess"), then chose this chip on 4 Nov. The
 * row ends one control shorter on a chat, because this replaces the model chip
 * and takes effort in. Project access stays behind the dots.
 *
 * A media chat's chip names the brain alone. The model is the brain's to define
 * and stays off the row (JJ, 13 Sep 2026); the panel states it.
 *
 * WHAT A SWITCH COSTS IS STATED BEFORE THE CLICK. A started chat's preset is
 * fixed, so choosing a brain there takes its model and leaves the instructions:
 * the row opens to say so and offers a new chat instead. In Terminal a brain
 * whose command differs restarts the shell, the row says so, and the dialog
 * asks once more.
 *
 * UNDER A COMPOSER BLOCK THIS CONTROL STAYS LIVE. The composer keeps its model
 * seat unlocked for that, because choosing a model is how a person clears the
 * block (PC test drive, 18 Sep 2026). The chip turns amber and names what is
 * missing; {@link BrainNotice} carries the fix.
 *
 * The panel is portalled to the body and positioned against the trigger,
 * because the composer's tool row scrolls sideways and clips both axes
 * (JJ, 11 Sep 2026).
 * @module @idealize/activity-pills/client/BrainChip
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Button, Menu, Modal, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the ui-conversation SlotMap merge (the composer's model seat).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SpaceId } from '@idealize/spaces/client'
import type {} from '@idealize/spaces/client'
import type { RoutedModel } from '@idealize/router/client'
import type { ActivityKey } from './locales.ts'
import type { BrainOption, BrainSessionSummary, BrainSwitcherState } from './brain-switcher.ts'
import css from './BrainChip.module.css'

/** One chat's composer block, as far as the chip reads it: raised or not. */
export interface ComposerBlockSource {
  subscribe(listener: () => void): () => void
  getSnapshot(): unknown
}

/** What a chat with no block store reads: never blocked. */
const NO_BLOCK: ComposerBlockSource = { subscribe: () => () => {}, getSnapshot: () => undefined }

/** One effort level of a model, as the host reports it. */
interface EffortLevel {
  id: string
  name: string
}

/** The directory's share of a model that the chip reads (restated; ui-model-selection owns it). */
interface DirectoryModel {
  id: string
  name: string
  reasoning?: { efforts: readonly EffortLevel[]; defaultEffort?: string }
}

/** The model the chat runs on, with the effort it runs at. */
export interface ModelChoice {
  provider: string
  model: string
  reasoningEffort?: string
}

/** The directory's state as the chip reads it (restated; ui-model-selection owns it). */
export interface ChipDirectoryState {
  current: ModelChoice | null
  groups: readonly { id: string; name: string; models: readonly DirectoryModel[] }[]
  status: string
}

/** A session's model directory (restated; ui-model-selection owns it). */
export interface ChipDirectorySource {
  subscribe(listener: () => void): () => void
  getSnapshot(): ChipDirectoryState
}

/** Whether auto-switch can run at all, from `GET /idealize/router/state`. */
export interface RouterAvailability {
  /** On, with OpenRouter connected for the reading and a second model to move to. */
  canRun: boolean
  /** What stands in its way when it cannot run, so the line under the switch can say so. */
  blockedBy?: 'off' | 'account' | 'model'
  /** The brains a person has told auto-switch to leave alone. */
  offBrains: readonly string[]
}

/** What the chip asks of the router plugin; a shell without it answers 404 and changes nothing. */
export interface RouterActions {
  /** Lock or unlock the chat against routing. */
  lock(sessionId: string, locked: boolean): Promise<void>
  /** Put the chat back on the model it had, and lock it there. */
  back(sessionId: string, to: RoutedModel): Promise<void>
  /** Move the chat to a model the router offered. */
  accept(sessionId: string, to: RoutedModel): Promise<void>
}

/** A media brain's generation model, as the panel states it. */
export interface MediaBrainModel {
  name: string
  service: string
}

/** Everything the bar's model browser needs from the chip. */
export interface ChipBrowserRequest {
  /** The brain's name, for the browser's heading. */
  brainName: string
  /** The chat's model. */
  current: { provider: string; model: string } | null
  onApply: (model: { provider: string; model: string }) => void
  onClose: () => void
}

/** Registration-side face for the chip and its notice. */
export interface BrainChipInjected {
  hooks: {
    /** Menu snapshot bound by the renderer as useBrainSwitcher. */
    brainSwitcher: SnapshotStore<BrainSwitcherState>
  }
  /** Read the brains of this chat's space. */
  load: (session: BrainSessionSummary) => Promise<void>
  /** Make one brain current for this chat. */
  select: (brainId: string, session: BrainSessionSummary) => Promise<void>
  /** Whether this session supports model reads and writes. An addressed subagent does not. */
  available: boolean
  /** The chat's shared model directory. */
  directory: ChipDirectorySource
  /** Refresh the directory. */
  loadModels: () => void
  /**
   * Put the chat on a model at an effort.
   * @returns whether the host accepted it.
   */
  selectModel: (choice: ModelChoice) => Promise<boolean>
  /** The store holding one chat's composer block. Undefined where no conversation service is composed. */
  composerBlock?: (sessionId: string) => ComposerBlockSource | undefined
  /** Open the Brains pane's add flow with the space already set. */
  addBrain?: (space: SpaceId) => void
  /** Open the Brains pane. */
  openBrains?: () => void
  /** Open the key field for a route, or the account list with no route named. */
  addKey?: (provider?: string) => void
  /** Open the sign-in surface. */
  signIn?: () => void
  /** Open a brain's sheet in the Brains pane. */
  editBrain?: (brainId: string) => void
  /** Render the model browser over the window. Absent wherever the tool rail is not composed. */
  renderModelBrowser?: (request: ChipBrowserRequest) => ReactNode
  /** Start a new chat on a brain, in the same project. */
  startChat?: (brainId: string, space: SpaceId, sessionId: string) => Promise<void>
  /** The model router's routes and the chat's model write. */
  router?: RouterActions
  /** Read whether auto-switch can run; null when the router is absent. */
  routerState?: () => Promise<RouterAvailability | null>
  /** How each route is paid for, by provider id. */
  planRoutes?: () => Promise<ReadonlySet<string>>
  /** A media brain's generation model; null when it has none. */
  mediaModel?: (space: SpaceId) => Promise<MediaBrainModel | null>
}

/** Full slot component props. */
export type BrainChipProps =
  PropsRuntime<'conversation.input.model'>
  & PropsLocale<'idealize-activity'>
  & InjectFace<BrainChipInjected>

/** The translator the chip's parts share. */
export type Translate = BrainChipProps['t']

const SPACE_BEFORE_PROJECTION: SpaceId = 'chat'

/** The spaces whose model is the brain's to define and stays off the row (JJ, 13 Sep 2026). */
const MEDIA_SPACES: ReadonlySet<SpaceId> = new Set<SpaceId>(['gallery', 'soundstage', 'motion'])

/** The seeded brains' purposes. A brain somebody authored reads its own description. */
const PURPOSES: Readonly<Record<string, ActivityKey>> = {
  coding: 'brain.purpose.coding',
  design: 'brain.purpose.design',
  writing: 'brain.purpose.writing',
  admin: 'brain.purpose.admin',
  free: 'brain.purpose.free',
}

/** The name of each space, for the media chip and the panel's add row. */
const SPACE_LABELS: Readonly<Record<SpaceId, ActivityKey>> = {
  chat: 'space.chat',
  terminal: 'space.terminal',
  gallery: 'space.gallery',
  soundstage: 'space.soundstage',
  motion: 'space.motion',
  studio: 'space.studio',
}

/**
 * The name a brain goes by on the chip. A media space's seeded brain carries
 * an old stored name ("Gallery"), so the space's own label stands in for it.
 * @param brain - the brain.
 * @param space - the chat's space.
 * @param soleBrain - whether it is the only brain of its space.
 * @param t - the translator.
 * @returns the name to show.
 */
export function brainLabel(brain: Pick<BrainOption, 'name'>, space: SpaceId, soleBrain: boolean, t: Translate): string {
  return MEDIA_SPACES.has(space) && soleBrain ? t(SPACE_LABELS[space]) : brain.name
}

/**
 * Why the auto-switch row's switch cannot be used.
 * @param offBrain - whether this brain was told to stay put.
 * @param blockedBy - what the router's state says stands in the way.
 * @returns the line's key.
 */
function autoSwitchBlock(offBrain: boolean, blockedBy: RouterAvailability['blockedBy']): ActivityKey {
  if (offBrain) return 'chip.autoSwitchOffBrain'
  if (blockedBy === 'off') return 'chip.autoSwitchOff'
  return blockedBy === 'model' ? 'chip.autoSwitchNeedsModel' : 'chip.autoSwitchNeeds'
}

/**
 * The line under a brain's name.
 * @param brain - the brain.
 * @param t - the translator.
 * @returns what the brain is for, or what choosing it costs; empty when nothing is known.
 */
export function brainPurpose(brain: BrainOption, t: Translate): string {
  if (brain.restarts) return t('brain.restarts')
  const key = PURPOSES[brain.id]
  return key === undefined ? brain.description : t(key)
}

/**
 * A model's name without the maker's prefix, which the route's catalogue
 * repeats on every row ("DeepSeek: DeepSeek V4 Flash").
 * @param name - the catalogue name.
 * @returns the readable name.
 */
export function readableModel(name: string): string {
  return /^[^:]{2,40}:\s+(.+)$/.exec(name)?.[1] ?? name
}

/**
 * How a model is paid for, in the three words the rethink settled on.
 * @param model - the model.
 * @param plans - the routes a person's plan covers.
 * @returns the label's key.
 */
export function costKey(model: { provider: string; model: string }, plans: ReadonlySet<string>): ActivityKey {
  if (model.provider === 'free-tokens' || model.model.endsWith(':free')) return 'cost.free'
  return plans.has(model.provider) ? 'cost.plan' : 'cost.payg'
}

/** What the chip and its notice both read about one chat. */
export interface BrainChipView {
  session: BrainSessionSummary | undefined
  space: SpaceId
  brains: readonly BrainOption[]
  current: BrainOption | undefined
  busy: string | null
  /** The chat's model, by the directory. */
  model: ModelChoice | null
  /** The chat's model by its readable name; undefined until the directory knows it. */
  modelName: string | undefined
  /** The chat's model has no route, or the chat sits on a brain whose route has no account. */
  blocked: boolean
  /** The router's record for this chat. */
  routed: ReturnType<typeof readRouter>
}

/** The projection read, split out so its type names itself. */
function readRouter(
  useSessions: BrainChipProps['useSessions'],
  sessionId: BrainChipProps['sessionId'],
) {
  return useSessions(list => list.byId[sessionId]?.projectionValues?.router)
}

/**
 * Read one chat's brain, model and block.
 * @param props - the seat's composed props.
 * @returns the view.
 */
export function useBrainChipView(props: Pick<BrainChipProps, 'sessionId' | 'useSessions' | 'useBrainSwitcher' | 'load' | 'directory' | 'composerBlock'>): BrainChipView {
  const { sessionId, useSessions, useBrainSwitcher, load, directory, composerBlock } = props
  const state = useBrainSwitcher(snapshot => snapshot)
  const summary = useSessions(list => list.byId[sessionId])
  const routed = readRouter(useSessions, sessionId)
  const space = summary?.projectionValues?.space?.space ?? SPACE_BEFORE_PROJECTION
  const recordedBrain = summary?.projectionValues?.brain?.brain
  const blank = summary?.blank
  const agentPreset = summary?.agentPreset
  const models = useSyncExternalStore(
    useCallback((listener: () => void) => directory.subscribe(listener), [directory]),
    () => directory.getSnapshot(),
  )
  const blockSource = composerBlock?.(sessionId) ?? NO_BLOCK
  const subscribeBlock = useCallback((listener: () => void) => blockSource.subscribe(listener), [blockSource])
  const block = useSyncExternalStore(subscribeBlock, () => blockSource.getSnapshot())

  useEffect(() => {
    if (blank === undefined) return
    void load({
      id: sessionId,
      blank,
      space,
      ...agentPreset === undefined ? {} : { agentPreset },
      ...recordedBrain === undefined ? {} : { brain: recordedBrain },
    })
  }, [load, sessionId, blank, space, agentPreset, recordedBrain])

  const session: BrainSessionSummary | undefined = summary === undefined
    ? undefined
    : {
      id: summary.id,
      blank: summary.blank,
      space,
      ...agentPreset === undefined ? {} : { agentPreset },
      ...recordedBrain === undefined ? {} : { brain: recordedBrain },
    }
  const current = state.brains.find(brain => brain.id === state.currentId)
  const model = models.current
  const modelName = model === null
    ? undefined
    : models.groups.find(group => group.id === model.provider)?.models.find(row => row.id === model.model)?.name
  // A brain's route only speaks for the chat while the chat is on that brain's
  // model. A chat the router or a person moved has its own route, and the
  // composer block is what reports that one.
  const onBrainModel = model === null || current?.model === null || current === undefined
    || (current.model.provider === model.provider && current.model.model === model.model)
  const brainBlocked = current?.access?.state === 'unavailable' && onBrainModel && !MEDIA_SPACES.has(space) && space !== 'terminal'
  return {
    session,
    space,
    brains: state.brains,
    current,
    busy: state.busy,
    model,
    modelName: modelName === undefined ? model?.model : readableModel(modelName),
    blocked: block !== undefined || brainBlocked,
    routed,
  }
}

function Chevron({ open }: { open: boolean }): ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true" className={css.chevron}>
      <path d={open ? 'M3.5 8.5 7 5l3.5 3.5' : 'M3.5 5.5 7 9l3.5-3.5'} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** The small mark that says the app moved this chat. */
function SwitchMark(): ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true" data-brain-chip-moved="">
      <path d="M2 4.5h8M8 2.5l2 2-2 2M12 9.5H4M6 7.5l-2 2 2 2" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function Tick(): ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className={css.tick}>
      <path d="m3.5 8.5 3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/**
 * One row of the brain list. On a started chat a row that is not current opens
 * in place to say what choosing it does, because the chat keeps its first
 * brain's instructions whatever is chosen here.
 */
function BrainListRow({ brain, name, currentName, selected, expanded, started, busy, onChoose, onStartChat, t }: {
  brain: BrainOption
  name: string
  currentName: string
  selected: boolean
  expanded: boolean
  started: boolean
  busy: boolean
  onChoose: () => void
  onStartChat: (() => void) | undefined
  t: Translate
}) {
  const purpose = brainPurpose(brain, t)
  const needsAccount = brain.access?.state === 'unavailable' && !brain.restarts
  return (
    <div className={selected ? css.rowSelected : css.row} data-brain={brain.id} data-brain-selected={selected ? '' : undefined}>
      <button type="button" className={css.rowButton} aria-current={selected ? 'true' : undefined} aria-expanded={started && !selected ? expanded : undefined} disabled={busy} onClick={onChoose}>
        <span className={css.rowText}>
          <span className={css.rowName}>{name}</span>
          {purpose !== '' && <span className={css.rowPurpose} data-brain-meta="" data-brain-restarts={brain.restarts ? '' : undefined}>{purpose}</span>}
          {needsAccount && <span className={css.rowAmber} data-brain-needs-account="">{t(brain.access?.reason === 'no-model' ? 'chip.needsSetup' : 'chip.needsAccount')}</span>}
        </span>
        {brain.id === 'free' && !selected && <span className={css.freeTag}>{t('cost.free')}</span>}
        {selected && <Tick />}
      </button>
      {expanded && (
        <div className={css.rowOpen} data-brain-started-note="">
          <span>{t('chip.started.line', { brain: name, current: currentName })}</span>
          <span className={css.rowActions}>
            <button type="button" className={css.outlineButton} data-brain-use-model="" disabled={busy} onClick={onChoose}>{t('chip.started.use')}</button>
            {onStartChat !== undefined && (
              <button type="button" className={css.linkButton} data-brain-new-chat="" onClick={onStartChat}>{t('chip.started.newChat', { brain: name })}</button>
            )}
          </span>
        </div>
      )}
    </div>
  )
}

/**
 * The composer's brain chip and its panel.
 * @param props - composed slot props.
 * @returns the chip, or null until the roster has placed this chat on a brain.
 */
export function BrainChip(props: BrainChipProps) {
  const {
    locked, select, available, loadModels, selectModel, addBrain, openBrains, editBrain,
    renderModelBrowser, startChat, router: routerActions, routerState, planRoutes, mediaModel, t,
  } = props
  const view = useBrainChipView(props)
  const { session, space, brains, current, busy, model, modelName, blocked, routed } = view
  const directory = useSyncExternalStore(
    useCallback((listener: () => void) => props.directory.subscribe(listener), [props.directory]),
    () => props.directory.getSnapshot(),
  )

  const [open, setOpen] = useState(false)
  const [at, setAt] = useState<{ right: number; bottom: number; maxHeight: number } | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [pending, setPending] = useState<BrainOption | null>(null)
  const [browsing, setBrowsing] = useState(false)
  const [effortOpen, setEffortOpen] = useState(false)
  const [availability, setAvailability] = useState<RouterAvailability | null>(null)
  const [plans, setPlans] = useState<ReadonlySet<string>>(new Set())
  const [media, setMedia] = useState<MediaBrainModel | null>(null)
  const wrap = useRef<HTMLSpanElement | null>(null)
  const panel = useRef<HTMLDivElement | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)

  const isMedia = MEDIA_SPACES.has(space)

  useEffect(() => { if (available) loadModels() }, [available, loadModels])

  // Read when the panel opens, so a key added a moment ago shows here.
  useEffect(() => {
    if (!open) return
    let live = true
    loadModels()
    void routerState?.().then((value) => { if (live) setAvailability(value) })
    void planRoutes?.().then((value) => { if (live) setPlans(value) })
    if (isMedia) void mediaModel?.(space).then((value) => { if (live) setMedia(value) })
    return () => { live = false }
  }, [open, loadModels, routerState, planRoutes, mediaModel, isMedia, space])

  // Right-aligned to the trigger and 8px above it, in viewport coordinates.
  useLayoutEffect(() => {
    if (!open) {
      setAt(null)
      return
    }
    const place = (): void => {
      const box = wrap.current?.getBoundingClientRect()
      if (box === undefined) return
      // The panel opens upward, and on the welcome card the box sits mid-screen,
      // so its own height has to stop at the window's top or the first brains go
      // out of reach.
      setAt({
        right: Math.max(8, window.innerWidth - box.right),
        bottom: window.innerHeight - box.top + 8,
        maxHeight: Math.max(240, box.top - 16),
      })
    }
    place()
    window.addEventListener('resize', place)
    return () => { window.removeEventListener('resize', place) }
  }, [open])

  // Pointerdown: a menu opened from inside the panel portals to the body, and
  // closing on its click would take the panel away underneath it.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (wrap.current?.contains(target) === true || panel.current?.contains(target) === true) return
      if (target instanceof Element && target.closest('[role="menu"], [role="dialog"]') !== null) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || browsing || effortOpen || pending !== null) return
      setOpen(false)
      trigger.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, browsing, effortOpen, pending])

  useEffect(() => { if (!open) setExpanded(null) }, [open])

  if (!available || session === undefined || current === undefined) return null

  const soleBrain = brains.length === 1
  const brainName = brainLabel(current, space, soleBrain, t)
  const moved = routed?.last?.outcome === 'switched'
  const seatLocked = locked && !blocked
  const inChat = space === 'chat'
  const started = !session.blank && inChat

  const chipModel = isMedia || space === 'terminal' ? undefined : blocked
    ? t(current.access?.reason === 'no-model' ? 'chip.needsSetup' : 'chip.needsAccount')
    : modelName

  const apply = (brain: BrainOption): void => {
    setExpanded(null)
    void select(brain.id, session)
  }
  const choose = (brain: BrainOption): void => {
    if (brain.id === current.id) return
    if (brain.restarts) {
      setPending(brain)
      return
    }
    if (started && expanded !== brain.id) {
      setExpanded(brain.id)
      return
    }
    apply(brain)
  }

  const reasoning = model === null
    ? undefined
    : directory.groups.find(group => group.id === model.provider)?.models.find(row => row.id === model.model)?.reasoning
  const effort = model?.reasoningEffort ?? reasoning?.defaultEffort
  const effortLabel = effort === undefined
    ? t('chip.thinkingDefault')
    : reasoning?.efforts.find(level => level.id === effort)?.name ?? effort
  const effortItems: MenuEntry[] = reasoning === undefined
    ? []
    : [
      ...reasoning.defaultEffort === undefined ? [{ id: ' default', label: t('chip.thinkingDefault') }] : [],
      ...reasoning.efforts.map(level => ({ id: level.id, label: level.name })),
    ]
  const onEffort = (id: string): void => {
    setEffortOpen(false)
    if (model === null) return
    const { reasoningEffort: _dropped, ...rest } = model
    void selectModel(id === ' default' ? rest : { ...rest, reasoningEffort: id })
  }

  const offBrain = availability?.offBrains.includes(current.id) === true
  const canSwitch = availability?.canRun === true && !offBrain
  const switchOn = canSwitch && routed?.locked !== true

  const panelBody = at === null ? null : (
    <div
      ref={panel}
      className={css.panel}
      role="dialog"
      aria-label={t('brain.trigger')}
      data-brain-chip-panel=""
      style={{ right: `${String(at.right)}px`, bottom: `${String(at.bottom)}px`, maxHeight: `${String(at.maxHeight)}px` }}
    >
      {(!isMedia || !soleBrain) && (
        <div className={css.section} data-brain-list="">
          <span className={css.label}>{t('chip.brain')}</span>
          {brains.map(brain => (
            <BrainListRow
              key={brain.id}
              brain={brain}
              name={brainLabel(brain, space, soleBrain, t)}
              currentName={brainName}
              selected={brain.id === current.id}
              expanded={expanded === brain.id}
              started={started}
              busy={busy !== null}
              onChoose={() => { choose(brain) }}
              onStartChat={startChat === undefined ? undefined : () => {
                setOpen(false)
                void startChat(brain.id, space, session.id)
              }}
              t={t}
            />
          ))}
        </div>
      )}
      {space !== 'terminal' && (
        <div className={css.section} data-brain-runs-on="">
          <span className={css.label}>{t('chip.runsOn', { brain: brainName })}</span>
          <div className={css.modelRow}>
            <span className={css.rowText}>
              <span className={css.rowName} data-brain-model="">{isMedia ? media === null ? t('chip.noMediaModel') : readableModel(media.name) : modelName ?? ''}</span>
              <span className={css.rowPurpose} data-brain-cost="">
                {isMedia
                  ? media === null ? '' : t('chip.mediaCost', { service: media.service })
                  : model === null ? '' : t(costKey(model, plans))}
              </span>
            </span>
            {isMedia
              ? editBrain !== undefined && (
                <button type="button" className={css.outlineButton} data-brain-change="" onClick={() => { setOpen(false); editBrain(current.id) }}>{t('chip.change')}</button>
              )
              : renderModelBrowser !== undefined && (
                <button type="button" className={css.outlineButton} data-brain-change="" onClick={() => { setBrowsing(true) }}>{t('chip.change')}</button>
              )}
          </div>
          {!isMedia && <span className={css.hint}>{t('chip.changeHint', { brain: brainName })}</span>}
          {!isMedia && reasoning !== undefined && (
            <div className={css.settingRow} data-brain-thinking="">
              <span className={css.rowName}>{t('chip.thinking')}</span>
              <Menu
                open={effortOpen}
                side="top"
                align="end"
                portal
                items={effortItems}
                selectedId={effort ?? ' default'}
                onSelect={onEffort}
                onClose={() => { setEffortOpen(false) }}
                anchor={(
                  <button type="button" className={css.textChoice} aria-haspopup="menu" aria-expanded={effortOpen} onClick={() => { setEffortOpen(value => !value) }}>
                    {effortLabel}
                    <Chevron open={effortOpen} />
                  </button>
                )}
              />
            </div>
          )}
          {inChat && routerActions !== undefined && (
            <label className={css.settingRow} data-brain-auto-switch="">
              <span className={css.rowText}>
                <span className={css.rowName}>{t('chip.autoSwitch')}</span>
                <span className={css.rowPurpose}>
                  {availability === null || canSwitch
                    ? t('chip.autoSwitchHint')
                    : t(autoSwitchBlock(offBrain, availability.blockedBy))}
                </span>
              </span>
              <input
                type="checkbox"
                role="switch"
                className={css.toggle}
                data-router-lock=""
                checked={switchOn}
                disabled={!canSwitch}
                onChange={(event) => { void routerActions.lock(session.id, !event.target.checked) }}
              />
            </label>
          )}
        </div>
      )}
      {(openBrains !== undefined || addBrain !== undefined) && (
        <div className={css.foot}>
          {openBrains !== undefined && (
            <button type="button" className={css.linkButton} data-brain-manage="" onClick={() => { setOpen(false); openBrains() }}>{t('chip.manage')}</button>
          )}
          {addBrain !== undefined && (
            <button type="button" className={css.linkButton} data-brain-add="" onClick={() => { setOpen(false); addBrain(space) }}>{t('chip.add')}</button>
          )}
        </div>
      )}
    </div>
  )

  return (
    <span className={css.wrap} ref={wrap} data-brain-chip="" data-space={space} data-brain-current={current.id}>
      <button
        ref={trigger}
        type="button"
        className={blocked ? css.chipBlocked : css.chip}
        data-brain-chip-trigger=""
        data-brain-chip-blocked={blocked ? '' : undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('chip.trigger', { brain: brainName, model: chipModel ?? '' })}
        disabled={seatLocked}
        onClick={() => { setOpen(value => !value) }}
      >
        {moved && !blocked && <SwitchMark />}
        <span className={css.brain}>{brainName}</span>
        {chipModel !== undefined && <span className={css.model}>{chipModel}</span>}
        <Chevron open={open} />
      </button>
      {open && panelBody !== null && createPortal(panelBody, document.body)}
      {browsing && renderModelBrowser?.({
        brainName,
        current: model === null ? null : { provider: model.provider, model: model.model },
        onClose: () => { setBrowsing(false) },
        onApply: (choice) => {
          setBrowsing(false)
          void selectModel(choice)
        },
      })}
      <Modal
        open={pending !== null}
        onClose={() => { setPending(null) }}
        closeLabel={t('confirm.cancel')}
        title={t('brain.confirmTitle', { brain: pending?.name ?? '' })}
        footer={(
          <>
            <Button variant="outline" data-brain-cancel="" onClick={() => { setPending(null) }}>{t('confirm.cancel')}</Button>
            <Button
              variant="primary"
              data-brain-confirm=""
              onClick={() => {
                const brain = pending
                setPending(null)
                if (brain !== null) apply(brain)
              }}
            >
              {t('confirm.continue')}
            </Button>
          </>
        )}
      >
        <p className={css.confirmLine} data-brain-restart-line="">{t('brain.restartLine')}</p>
      </Modal>
    </span>
  )
}
