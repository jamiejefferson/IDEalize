/**
 * The composer's model chip: one control on the model seat
 * (`conversation.input.model`) that answers "which model is answering, and may
 * it change?" (JJ, 24 Nov 2026: a chat runs on one company's models). It names
 * the model answering now and how the router behaves, and its panel holds the
 * three-way choice (Auto, Ask me, Fixed), the Cheaper to Smarter slider, the
 * company's models with a tick each, thinking effort, and the way into the
 * model browser.
 *
 * THE CHIP RENDERS FOR EVERY CHAT. Presets still compose a chat underneath,
 * and nobody sees or chooses one, so the chip reads the chat's model and never
 * waits on a recorded preset.
 *
 * THE THREE SETTINGS ARE APP-WIDE. Mode, the slider and the ticks are written
 * to the router's settings, so every chat follows them. A chat locked by
 * "Switch back" reads as Fixed here, and choosing Auto or Ask me unlocks it.
 *
 * A Terminal chat's chip names the command-line app and opens nothing: the app
 * picks its own model. An image, sound or video chat is never routed, so its
 * panel lists the models as one choice and leaves the router's settings out.
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
import { Menu, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the ui-conversation SlotMap merge (the composer's model seat).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SpaceId } from '@idealize/spaces/client'
import type {} from '@idealize/spaces/client'
import type { RoutedModel, RouterChoice, RouterChoices, RouterMode } from '@idealize/router/client'
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

/** What the chip reads from `GET /idealize/router/choices`. */
export type ChipChoices = RouterChoices

/** What the chip writes to `POST /idealize/router/settings`. */
export interface RouterSettingsPatch {
  mode?: RouterMode
  lean?: number
  excluded?: string[]
}

/** What the chip asks of the router plugin; a shell without it answers 404 and changes nothing. */
export interface RouterActions {
  /** Lock or unlock the chat against routing. */
  lock(sessionId: string, locked: boolean): Promise<void>
  /** Put the chat back on the model it had, and lock it there. */
  back(sessionId: string, to: RoutedModel): Promise<void>
  /** Move the chat to a model the router offered. */
  accept(sessionId: string, to: RoutedModel): Promise<void>
  /** Turn the open offer down. */
  stay(sessionId: string): Promise<void>
  /** Let go of a switch the router made, so the chat runs on the model the person just chose. */
  drop(sessionId: string): Promise<void>
}

/** Everything the bar's model browser needs from the chip. */
export interface ChipBrowserRequest {
  /** The heading the browser names the chat by: its space. */
  brainName: string
  /** The chat's model. */
  current: { provider: string; model: string } | null
  onApply: (model: { provider: string; model: string }) => void
  onClose: () => void
}

/** Registration-side face for the chip and its notice. */
export interface BrainChipInjected {
  hooks: {
    /** The presets of this chat's space, bound by the renderer as useBrainSwitcher. The chip reads whether the chat's own can answer. */
    brainSwitcher: SnapshotStore<BrainSwitcherState>
  }
  /** Read the presets of this chat's space. */
  load: (session: BrainSessionSummary) => Promise<void>
  /** Move this chat to another preset of its space; the notice's way out of a block. */
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
  /** Open the Models pane. */
  openBrains?: () => void
  /** Open the key field for a route, or the account list with no route named. */
  addKey?: (provider?: string) => void
  /** Open the sign-in surface. */
  signIn?: () => void
  /** Render the model browser over the window. Absent wherever the tool rail is not composed. */
  renderModelBrowser?: (request: ChipBrowserRequest) => ReactNode
  /** The model router's routes and the chat's model write. */
  router?: RouterActions
  /** Read the router's settings and the models of the chat's company; null when the router is absent. */
  routerChoices?: (sessionId: string, own: { provider: string; model: string } | null) => Promise<ChipChoices | null>
  /** Write the router's mode, slider or unticked models. */
  routerSettings?: (patch: RouterSettingsPatch) => Promise<void>
  /** The name of the command-line app a Terminal chat launches; `''` when none is known. */
  terminalApp?: (presetId: string | undefined) => Promise<string>
}

/** Full slot component props. */
export type BrainChipProps =
  PropsRuntime<'conversation.input.model'>
  & PropsLocale<'idealize-activity'>
  & InjectFace<BrainChipInjected>

/** The translator the chip's parts share. */
export type Translate = BrainChipProps['t']

const SPACE_BEFORE_PROJECTION: SpaceId = 'chat'

/** The spaces that generate media: their chats are never routed. */
const MEDIA_SPACES: ReadonlySet<SpaceId> = new Set<SpaceId>(['gallery', 'soundstage', 'motion'])

/** The name of each space, for the model browser's heading and a Terminal chip with no app known. */
const SPACE_LABELS: Readonly<Record<SpaceId, ActivityKey>> = {
  chat: 'space.chat',
  terminal: 'space.terminal',
  gallery: 'space.gallery',
  soundstage: 'space.soundstage',
  motion: 'space.motion',
  studio: 'space.studio',
}

/** The three modes, in the order the control shows them. */
const MODES: readonly RouterMode[] = ['auto', 'ask', 'fixed']

/** How far one arrow key moves the slider. */
const LEAN_STEP = 5

/** Every route a key gateway adds starts with this (restated; `@idealize/services` names them). */
const GATEWAY_PREFIX = 'gateway-'

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
 * The word the chip shows after the model's name.
 * @param mode - how the router behaves for this chat; undefined where it does not route.
 * @param t - the translator.
 * @returns "Auto", "Ask me", or nothing when the model is fixed.
 */
export function modeWord(mode: RouterMode | undefined, t: Translate): string {
  return mode === 'auto' ? t('chip.mode.auto') : mode === 'ask' ? t('chip.mode.ask') : ''
}

/** A dollar figure without the cents a whole number does not need: $15, $2.50, $0.25. */
function dollars(amount: number): string {
  if (Number.isInteger(amount)) return `$${String(amount)}`
  return `$${amount >= 0.1 ? amount.toFixed(2) : String(Number(amount.toPrecision(2)))}`
}

/**
 * A model's price on its row: what a million written tokens cost.
 * @param price - the price the router holds.
 * @param t - the translator.
 * @returns "$15 / M", "Free", or nothing when no price is known.
 */
export function priceLabel(price: RouterChoice['price'], t: Translate): string {
  if (price === null) return ''
  return price === 'free' ? t('chip.price.free') : t('chip.price', { price: dollars(price.output) })
}

/** A model's key in the router's list of unticked models. */
const routeKeyOf = (model: { provider: string; model: string }): string => `${model.provider}/${model.model}`

/**
 * The unticked models after one row's tick changes. A model behind a key gateway follows the
 * tick of the route the gateway fronts, so ticking it clears both keys.
 * @param excluded - the unticked models now.
 * @param row - the row whose tick changed.
 * @param allowed - whether the row is now ticked.
 * @returns the list to write.
 */
export function excludedAfter(excluded: readonly string[], row: { provider: string; model: string }, allowed: boolean): string[] {
  const key = routeKeyOf(row)
  if (!allowed) return excluded.includes(key) ? [...excluded] : [...excluded, key]
  const fronted = row.provider.startsWith(GATEWAY_PREFIX)
    ? routeKeyOf({ provider: row.provider.slice(GATEWAY_PREFIX.length), model: row.model })
    : key
  return excluded.filter(item => item !== key && item !== fronted)
}

/** What the chip and its notice both read about one chat. */
export interface BrainChipView {
  session: BrainSessionSummary | undefined
  space: SpaceId
  /** The presets of the chat's space. */
  brains: readonly BrainOption[]
  /** The chat's own preset, when its space lists it. */
  current: BrainOption | undefined
  /** The chat's model, by the directory. */
  model: ModelChoice | null
  /** The chat's model by its readable name; undefined until the directory knows it. */
  modelName: string | undefined
  /** The chat's model has no route, or its preset's route has no account. */
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
 * Read one chat's model, block and routing record.
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
  // A preset's route only speaks for the chat while the chat is on that preset's
  // model. A chat the router or a person moved has its own route, and the
  // composer block is what reports that one.
  const onPresetModel = model === null || current?.model === null || current === undefined
    || (current.model.provider === model.provider && current.model.model === model.model)
  const presetBlocked = current?.access?.state === 'unavailable' && onPresetModel && !MEDIA_SPACES.has(space) && space !== 'terminal'
  return {
    session,
    space,
    brains: state.brains,
    current,
    model,
    modelName: modelName === undefined ? model?.model : readableModel(modelName),
    blocked: block !== undefined || presetBlocked,
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

/** What one row of the model list shows after its control: the name, the dot on the one answering, and the price. */
function ModelRowText({ row, t }: { row: RouterChoice; t: Translate }): ReactElement {
  const price = priceLabel(row.price, t)
  return (
    <>
      <span className={css.choiceName}>{readableModel(row.label)}</span>
      {row.answering && <span className={css.dot} role="img" aria-label={t('chip.answering')} data-chip-answering="" />}
      {price !== '' && <span className={css.price} data-chip-price="">{price}</span>}
    </>
  )
}

/**
 * The composer's model chip and its panel.
 * @param props - composed slot props.
 * @returns the chip, or null for a session with no model reads.
 */
export function BrainChip(props: BrainChipProps) {
  const {
    sessionId, locked, available, loadModels, selectModel, renderModelBrowser,
    router: routerActions, routerChoices, routerSettings, terminalApp, t,
  } = props
  const view = useBrainChipView(props)
  const { session, space, current, model, modelName, blocked, routed } = view
  const directory = useSyncExternalStore(
    useCallback((listener: () => void) => props.directory.subscribe(listener), [props.directory]),
    () => props.directory.getSnapshot(),
  )

  const [open, setOpen] = useState(false)
  const [at, setAt] = useState<{ right: number; bottom: number; maxHeight: number } | null>(null)
  const [browsing, setBrowsing] = useState(false)
  const [effortOpen, setEffortOpen] = useState(false)
  const [choices, setChoices] = useState<ChipChoices | null>(null)
  /** The slider while it is being dragged; null once its position is written. */
  const [leanDraft, setLeanDraft] = useState<number | null>(null)
  const [app, setApp] = useState('')
  /** Bumped after a write, so the list is read again from the host. */
  const [reads, setReads] = useState(0)
  const wrap = useRef<HTMLSpanElement | null>(null)
  const panel = useRef<HTMLDivElement | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)

  const isTerminal = space === 'terminal'
  const routes = space === 'chat'
  const ownProvider = model?.provider
  const ownModel = model?.model
  const last = routed?.last
  const lastKey = last === undefined ? '' : `${last.outcome}:${last.to.provider}/${last.to.model}`
  const presetId = session?.brain ?? session?.agentPreset

  useEffect(() => { if (available) loadModels() }, [available, loadModels])

  // Read on mount, when the chat's model or its routing record changes, after a
  // write, and when the panel opens, so a key added a moment ago shows here.
  useEffect(() => {
    if (!available || isTerminal || routerChoices === undefined) return
    let live = true
    const own = ownProvider === undefined || ownModel === undefined ? null : { provider: ownProvider, model: ownModel }
    void routerChoices(sessionId, own).then((value) => { if (live) setChoices(value) }, () => undefined)
    return () => { live = false }
  }, [available, isTerminal, routerChoices, sessionId, ownProvider, ownModel, lastKey, open, reads])

  useEffect(() => { if (open && available) loadModels() }, [open, available, loadModels])

  useEffect(() => {
    if (!isTerminal || terminalApp === undefined) return
    let live = true
    void terminalApp(presetId).then((value) => { if (live) setApp(value) }, () => undefined)
    return () => { live = false }
  }, [isTerminal, terminalApp, presetId])

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
      // so its own height has to stop at the window's top or the first rows go
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
      if (event.key !== 'Escape' || browsing || effortOpen) return
      setOpen(false)
      trigger.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, browsing, effortOpen])

  if (!available || session === undefined) return null

  // A Studio chat's box names the model that makes the picture, video or
  // sound, in the strip beside the kind toggle. A second model name here
  // crowded that strip off the row and read as the one doing the making
  // (JJ, 13 Sep 2026: "its also shown twice - one of them being wrong").
  if (MEDIA_SPACES.has(space)) return null

  if (isTerminal) {
    return (
      <span className={css.wrap} data-brain-chip="" data-space={space}>
        <span className={css.chipStatic} data-brain-chip-app="">{app === '' ? t(SPACE_LABELS.terminal) : app}</span>
      </span>
    )
  }

  const moved = last?.outcome === 'switched'
  const seatLocked = locked && !blocked
  // A chat locked by "Switch back" is never routed, which is what Fixed means for it.
  const mode: RouterMode | undefined = !routes || choices === null ? undefined : routed?.locked === true ? 'fixed' : choices.mode
  const answering = readableModel((moved ? last.to.label : undefined) ?? choices?.answering.label ?? modelName ?? '')
  const word = modeWord(mode, t)
  const amber = blocked ? t(current?.access?.reason === 'no-model' ? 'chip.needsSetup' : 'chip.needsAccount') : undefined
  const suffix = amber ?? word
  const ticks = mode === 'auto' || mode === 'ask'
  const excluded = choices?.excluded ?? []
  const lean = leanDraft ?? choices?.lean ?? 0

  /** Show a write at once, send it, then read the host's answer back. */
  const write = (patch: RouterSettingsPatch, shown: ChipChoices): void => {
    setChoices(shown)
    void routerSettings?.(patch).then(() => { setReads(count => count + 1) }, () => undefined)
  }
  const chooseMode = (next: RouterMode): void => {
    if (choices === null) return
    if (next !== 'fixed' && routed?.locked === true) void routerActions?.lock(session.id, false)
    if (choices.mode !== next) write({ mode: next }, { ...choices, mode: next })
  }
  const commitLean = (): void => {
    if (leanDraft === null || choices === null) return
    if (leanDraft !== choices.lean) write({ lean: leanDraft }, { ...choices, lean: leanDraft })
    setLeanDraft(null)
  }
  const tick = (row: RouterChoice, allowed: boolean): void => {
    if (choices === null) return
    const next = excludedAfter(excluded, row, allowed)
    write({ excluded: next }, {
      ...choices,
      excluded: next,
      models: choices.models.map(one => (one.provider === row.provider && one.model === row.model ? { ...one, allowed } : one)),
    })
  }
  /** Put the chat on one model, and let go of whatever the router last did with it. */
  const pick = (row: RouterChoice): void => {
    if (row.answering) return
    void selectModel({ provider: row.provider, model: row.model }).then(async (accepted) => {
      if (!accepted) return
      if (last?.outcome === 'switched') await routerActions?.drop(session.id)
      else if (last?.outcome === 'offer') await routerActions?.stay(session.id)
      setReads(count => count + 1)
    })
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

  const panelBody = at === null ? null : (
    <div
      ref={panel}
      className={css.panel}
      role="dialog"
      aria-label={t('chip.panel')}
      data-brain-chip-panel=""
      style={{ right: `${String(at.right)}px`, bottom: `${String(at.bottom)}px`, maxHeight: `${String(at.maxHeight)}px` }}
    >
      {mode !== undefined && routerSettings !== undefined && (
        <div className={css.section} data-chip-router="">
          <div className={css.segmented} role="radiogroup" aria-label={t('chip.mode')}>
            {MODES.map(option => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={mode === option}
                className={mode === option ? css.segmentOn : css.segment}
                data-router-mode={option}
                onClick={() => { chooseMode(option) }}
              >
                {t(`chip.mode.${option}`)}
              </button>
            ))}
          </div>
          {mode !== 'fixed' && (
            <div className={css.leanRow} data-chip-lean="">
              <span className={css.leanEnd}>{t('chip.lean.cheaper')}</span>
              <input
                type="range"
                className={css.range}
                min={0}
                max={100}
                step={LEAN_STEP}
                value={lean}
                aria-label={t('chip.lean')}
                data-router-lean=""
                onChange={(event) => { setLeanDraft(Number(event.target.value)) }}
                onPointerUp={commitLean}
                onKeyUp={commitLean}
                onBlur={commitLean}
              />
              <span className={css.leanEnd}>{t('chip.lean.smarter')}</span>
            </div>
          )}
        </div>
      )}
      {choices !== null && choices.models.length > 0 && (
        <div className={css.section} role={ticks ? 'group' : 'radiogroup'} aria-label={t('chip.models')} data-chip-models="">
          {choices.models.map(row => (ticks && routerSettings !== undefined
            ? (
              <label key={routeKeyOf(row)} className={css.choice} data-chip-model={routeKeyOf(row)}>
                <input
                  type="checkbox"
                  className={css.check}
                  checked={row.allowed}
                  data-router-allow=""
                  onChange={(event) => { tick(row, event.target.checked) }}
                />
                <ModelRowText row={row} t={t} />
              </label>
            )
            : (
              <button
                key={routeKeyOf(row)}
                type="button"
                role="radio"
                aria-checked={row.answering}
                className={css.choice}
                data-chip-model={routeKeyOf(row)}
                data-chip-pick=""
                onClick={() => { pick(row) }}
              >
                <span className={row.answering ? css.radioOn : css.radio} aria-hidden="true" />
                <ModelRowText row={row} t={t} />
              </button>
            )))}
        </div>
      )}
      {reasoning !== undefined && (
        <div className={css.section}>
          <div className={css.settingRow} data-chip-thinking="">
            <span className={css.settingName}>{t('chip.thinking')}</span>
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
        </div>
      )}
      {renderModelBrowser !== undefined && (
        <div className={css.foot}>
          <button type="button" className={css.linkButton} data-chip-browse="" onClick={() => { setBrowsing(true) }}>{t('chip.otherModels')}</button>
        </div>
      )}
    </div>
  )

  return (
    <span className={css.wrap} ref={wrap} data-brain-chip="" data-space={space} data-router-mode-now={mode}>
      <button
        ref={trigger}
        type="button"
        className={blocked ? css.chipBlocked : css.chip}
        data-brain-chip-trigger=""
        data-brain-chip-blocked={blocked ? '' : undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={suffix === '' ? t('chip.triggerPlain', { model: answering }) : t('chip.trigger', { model: answering, mode: suffix })}
        disabled={seatLocked}
        onClick={() => { setOpen(value => !value) }}
      >
        {moved && !blocked && <SwitchMark />}
        <span className={css.name} data-chip-name="">{answering}</span>
        {amber !== undefined
          ? <span className={css.model}>{amber}</span>
          : word !== '' && <span className={css.model} data-chip-mode="">{word}</span>}
        <Chevron open={open} />
      </button>
      {open && panelBody !== null && createPortal(panelBody, document.body)}
      {browsing && renderModelBrowser?.({
        brainName: t(SPACE_LABELS[space]),
        current: model === null ? null : { provider: model.provider, model: model.model },
        onClose: () => { setBrowsing(false) },
        onApply: (choice) => {
          setBrowsing(false)
          void selectModel(choice).then(() => { setReads(count => count + 1) }, () => undefined)
        },
      })}
    </span>
  )
}
