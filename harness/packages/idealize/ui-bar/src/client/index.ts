/**
 * IDEalize tool rail, browser half: the 48px icon column on the shell.rail
 * seat (docked at the inner edge of the open deck/drawer columns), its panes
 * in the docked shell.drawer column at the window edge (so nothing covers the
 * conversation — no rail entry opens a modal), the file viewer in the
 * shell.deck column between them, and the
 * thank-you heart on the composer's conversation.input.right seat.
 *
 * Panes: Files; the Service hatch (V0's hatch chat under a Service tab, the
 * @idealize/hatch composition page under a Composition tab); Brains (usage,
 * budget and models; the Models settings page re-hosted through its plugin's
 * section service — its settings.section registration was removed, see
 * FORK.md); Trajectory (the event ledger, re-hosted the same way from
 * `trajectorySection` after it left the conversation view ring, and the
 * receiver of the chat's "inspect this call" handoff); Schedule (the Week
 * calendar, re-hosted from `scheduleSection` after its own ring exit);
 * Terminal (one plain shell for running commands beside a chat, the terminal
 * plugin's grid seated from `ctx.terminalMode.Pane`, shown only where the host
 * has an embedded terminal); Feedback (FeedbackPanel, posting to
 * @idealize/feedback's submit route); and Appearance, the appearance plugin's six-tab inspector seated from
 * `ctx.appearance`. The bar follows the appearance service's open flag both
 * ways, so ⌘⌥A and `ctx.appearance.open()` land in the same drawer pane.
 *
 * `ctx.idealizeBar` is this plugin's cross-plugin face: the pane closures
 * (show/close, openFile/closeFile) plus the observable view state, so a
 * shell without the rail (the desktop mini frame) drives the same panes.
 */
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import { createElement } from 'react'
import type { ReactNode } from 'react'
import { createSnapshotStore, type ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ISessions, IWorkspaces, ObservableSnapshot, SessionBinding, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { PillSessionSummary } from '@idealize/activity-pills/client'
// Type-only: the roster payload the welcome card reads, and the space ids it
// records. `@idealize/spaces/client` exports types alone.
import type { SpaceId, SpaceRosterEntry } from '@idealize/spaces/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
// Type-only: the Models section service's Context merge (the component and
// wired face arrive through ctx at runtime — bundle purity forbids the
// value import).
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
// Type-only: the Trajectory ledger service's Context merge, same reason.
import type {} from '@deepseek-ai/dsh-client-ui-trajectory/client'
// Type-only: the Schedule calendar service's Context merge, same reason.
import type {} from '@idealize/ui-schedule/client'
// Type-only: the appearance service's Context merge and locale namespace.
import type {} from '@idealize/appearance/client'
// The ui-layout SlotMap merge (dock + drawer seats) and the ctx.layout face.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: the ui-conversation SlotMap merge (the composer seats) and the
// conversation service face the files panel's add-to-chat goes through.
import type { IConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: the ui-settings SlotMap merge (the settings.trigger seat).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the ui-sidebar SlotMap merge (the sidebar.header.action seat).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// The galleries' Reveal signal, one stateless module inlined into this bundle:
// the `/client` entry is the loader bundle and cannot be imported for a value.
import { onArtefactLanded, onRevealRequest } from '@idealize/artefacts/src/client/reveal.ts'
// The sidebar rail's in-window Studio request, the same kind of stateless module.
import { onStudioRequest } from '@idealize/askbar/src/client/studio-request.ts'
import { createBarViewStore, type BarPanel, type BarViewState, type BrainsRequest, type HatchTab } from './bar-store.ts'
import { IdealizeBar, MARKET_LAUNCHER_SELECTOR, type IdealizeBarInjected } from './IdealizeBar.tsx'
import { BarIconModels, BarIconPlugins } from './BarIcons.tsx'
import { IconSkillOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { MinimodeButton } from './MinimodeButton.tsx'
import { DrawerPanel, type AppearanceHost, type DrawerPanelInjected, type TerminalHost } from './DrawerPanel.tsx'
import { FILE_DRAG_TYPE } from './FilesPanel.tsx'
import { DeckPanel, type DeckPanelInjected } from './DeckPanel.tsx'
import { HeartButton } from './HeartButton.tsx'
import { HatchTrigger, NoLanguageRow, NoProviderDialog } from './HatchChrome.tsx'
import { HeroLauncher, NoPresetChip, type BrainAccess, type HeroLauncherInjected, type LauncherSession, type TerminalLaunches } from './HeroLauncher.tsx'
import { createSpaceSeed, openChatView, ringHasView, subscribeRing, watchInspect, type ErasedSlots } from './view-switch.ts'
import { type TrajectoryHost } from './TrajectoryPane.tsx'
import { type ScheduleHost } from './SchedulePane.tsx'
import { StudioCard, type StudioCardInjected } from './StudioCard.tsx'
import { PlanToggle, type PlanToggleInjected } from './PlanToggle.tsx'
// Type-only: the activityPills service's Context merge (the wired controller face
// arrives through ctx at runtime — bundle purity forbids the value import).
import type {} from '@idealize/activity-pills/client'
// Type-only: the ctx.remote merge (the command channel the plan icon drives).
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { ServiceSectionInjected } from './ServiceSection.tsx'
import type { BrainsPanelHost } from './BrainsPanel.tsx'
import { en, zh, type BarKey } from './locales.ts'

/** The composer menu registry's face, as this plugin uses it (structural: no dependency edge on ui-conversation). */
interface ComposerMenuLike {
  register(entry: {
    id: string
    order: number
    label: string
    icon?: ReactNode
    commands?: boolean
    search?: boolean
    rows?: (session: { sessionId: SessionId }) => readonly ComposerMenuRowLike[] | Promise<readonly ComposerMenuRowLike[]>
    onSelect: (session: { sessionId: SessionId; insertText(text: string): void }, row: string | undefined) => void
  }): () => void
}

/** One submenu row of the composer menu. */
interface ComposerMenuRowLike {
  id: string
  label: string
  disabled?: boolean
  heading?: boolean
  keywords?: string
}

/** What `GET /idealize/bar/skills` answers: the skills folder's packages, its own first (`folder` empty), then each subfolder. */
interface SkillsRoute {
  groups: readonly { folder: string; skills: readonly { name: string; description: string; invocable: boolean }[] }[]
}

const SKILL_ROW = 'skill:'
const COMMAND_ROW = 'command:'

export { IdealizeBar } from './IdealizeBar.tsx'
export { DrawerPanel } from './DrawerPanel.tsx'
export { DeckPanel } from './DeckPanel.tsx'
export { HeartButton } from './HeartButton.tsx'
export { BrainsPanel } from './BrainsPanel.tsx'
export { FeedbackPanel } from './FeedbackPanel.tsx'
export { ServiceSection } from './ServiceSection.tsx'
export { CompositionSection } from './CompositionSection.tsx'
export { SchedulePane } from './SchedulePane.tsx'
export type { ScheduleHost, SchedulePaneProps } from './SchedulePane.tsx'
export { StudioCard } from './StudioCard.tsx'
export type { StudioCardInjected, StudioCardProps } from './StudioCard.tsx'
export { HeroLauncher, NoPresetChip, SPACE_LABELS } from './HeroLauncher.tsx'
export type { BrainAccess, HeroLauncherInjected, HeroLauncherProps, LauncherSession, LauncherSpaces } from './HeroLauncher.tsx'
export { CHAT_VIEW, createSpaceSeed, openChatView, ringHasView, subscribeRing } from './view-switch.ts'
export type { ErasedSlots, SpaceSeed } from './view-switch.ts'
export { PlanToggle } from './PlanToggle.tsx'
export type { PlanToggleInjected, PlanToggleProps } from './PlanToggle.tsx'
export { HatchTrigger } from './HatchChrome.tsx'
export { createBarViewStore } from './bar-store.ts'
export type { BarPanel, BarViewState, BarViewStore, BrainsRequest, HatchTab, RevealRequest } from './bar-store.ts'
export type { BarKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The tool rail's copy. */
    'idealize-bar': BarKey
  }
}

/**
 * The pane face other plugins reach (`ctx.idealizeBar`): drive the rail's
 * drawer panes and the deck's file viewer without importing the components.
 * Calls go through the same closures the rail's own entries use, so the
 * drawer/deck columns (`ctx.layout`) and the appearance service's open flag
 * stay in step however a pane is opened.
 */
export interface IdealizeBarService {
  /** The bar's view state (open pane, hatch tab, deck file); read-only. */
  readonly state: ObservableSnapshot<BarViewState>
  /**
   * Open a drawer pane and the drawer column; the appearance pane also
   * raises the appearance service's open flag. No-op when already showing.
   * @param panel - the pane to show.
   */
  show(panel: BarPanel): void
  /** Close the open drawer pane and the drawer column; no-op when closed. */
  close(): void
  /**
   * Show a file in the deck's viewer and open the deck column.
   * @param path - file path as the files pane reports it.
   */
  openFile(path: string): void
  /** Clear the deck's file and close the deck column; no-op when empty. */
  closeFile(): void
  /**
   * Open the Files pane on one file: the tab whose root holds it (the project
   * tab first), every ancestor folder expanded, its folder selected as the
   * creation target, and its row scrolled into view and highlighted until the
   * next click. A path under no tab's root leaves the pane open with a
   * status line saying so.
   * @param path - absolute path of the file.
   */
  revealFile(path: string): void
  /**
   * Open the Brains pane on its add-a-brain flow with a space already set —
   * what the welcome card's brain step offers when a space has no brains yet.
   * @param space - the space the new brain will work in.
   */
  addBrain(space: SpaceId): void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The rail's pane service (this plugin owns the concrete value). */
    idealizeBar: IdealizeBarService
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'idealize-bar'

/** `@idealize/spaces`' roster route: the one payload both welcome steps read. */
const SPACES_ROSTER_PATH = '/idealize/spaces'
/** The agents route; the launcher reads each brain's `access` from it. */
const ACTIVITY_AGENTS_PATH = '/idealize/activity/agents'

/** `@idealize/spaces`' selection route: the durable record of a chat's space and brain. */
const SPACES_SELECT_PATH = '/idealize/spaces/select'
/** `@idealize/telegram`'s status route; the Studio card's second line reads it. */
const TELEGRAM_STATUS_PATH = '/idealize/telegram/status'
/** How long to wait between attempts at recording a space on a chat the host is still resuming. */
const SPACE_RECORD_RETRY_MS = 250
/** How many attempts a space record gets before the chat is left on the chooser. */
const SPACE_RECORD_ATTEMPTS = 20

/** The Chat⇄Terminal service face (restated; @idealize/ui-terminal owns it). */
interface TerminalModeLike {
  embedded(): Promise<boolean>
  open(sessionId: string): boolean
  Pane: TerminalHost['Pane']
}

/** A brain's chosen route, as `GET /idealize/activity/agents` states it. */
interface BrainModel {
  provider: string
  model: string
}

/**
 * The per-session model directory service (restated;
 * `@deepseek-ai/dsh-client-ui-model-selection` owns it).
 * Writing through it is what makes the composer's label follow: the seat
 * renders that store, and a selection made around it never reaches the label.
 */
interface ModelDirectoriesLike {
  directoryFor(sessionId: string): { select(selection: BrainModel): Promise<void> }
}

/**
 * The settings dialog opener (restated;
 * `@deepseek-ai/dsh-client-ui-settings-general` owns it). Its only caller is
 * the rail's Settings button.
 */
interface SettingsOpenLike {
  open(section?: string): void
}

/** Required services for the rail, its panes, and the composer seats. */
export const inject = [
  'slots', 'locale', 'layout', 'sessions', 'workspaces',
  'modelsSettingsSection', 'trajectorySection', 'scheduleSection', 'studioSection', 'appearance', 'conversation', 'connection',
  'remote', 'remote.commands',
]

/**
 * Client plugin body: the rail, the drawer/deck panes, the composer heart,
 * and the welcome launcher.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'idealize-bar: dictionaries')

  const barView = createBarViewStore()

  // ── pane transitions (the single writer of barView.panel) ─────────────
  // The appearance pane is special: its visibility is the appearance
  // service's own `open` flag (⌘⌥A, ctx.appearance.open()), so the bar
  // mirrors that flag rather than owning a second one.
  const showPanel = (panel: BarPanel): void => {
    const previous = barView.getSnapshot().panel
    if (previous === panel) return
    barView.update((draft) => { draft.panel = panel })
    ctx.layout.openDrawer()
    if (panel === 'appearance') ctx.appearance.open()
    else if (previous === 'appearance') ctx.appearance.close()
  }
  const closePanel = (): void => {
    const previous = barView.getSnapshot().panel
    if (previous === null) return
    barView.update((draft) => { draft.panel = null })
    ctx.layout.closeDrawer()
    if (previous === 'appearance') ctx.appearance.close()
  }
  const togglePanel = (panel: BarPanel): void => {
    if (barView.getSnapshot().panel === panel) closePanel()
    else showPanel(panel)
  }
  const followAppearance = (): void => {
    const open = ctx.appearance.store.getSnapshot().open
    const showing = barView.getSnapshot().panel === 'appearance'
    if (open && !showing) showPanel('appearance')
    else if (!open && showing) closePanel()
  }
  ctx.effect(() => ctx.appearance.store.subscribe(followAppearance), 'idealize-bar: follow the appearance service')
  followAppearance()

  // ── deck transitions (the single writer of barView.file) ───────────────
  const openFile = (path: string): void => {
    barView.update((draft) => { draft.file = path })
    ctx.layout.openDeck()
  }
  const closeFile = (): void => {
    if (barView.getSnapshot().file === null) return
    barView.update((draft) => { draft.file = null })
    ctx.layout.closeDeck()
  }

  // Requests the Brains pane picks up when it next renders: the welcome
  // card's brain step hands the pane a space to add for, or the missing
  // provider key to add. The pane clears the request once it has acted, so a
  // later reopen of the pane does not replay it.
  const requestBrains = (request: BrainsRequest): void => {
    barView.update((draft) => { draft.brainsRequest = request })
    showPanel('models')
  }
  const clearBrainsRequest = (): void => {
    if (barView.getSnapshot().brainsRequest === null) return
    barView.update((draft) => { draft.brainsRequest = null })
  }

  // The Trajectory pane's pending "inspect this call" target, held until the
  // ledger has revealed the record.
  const clearInspect = (): void => {
    if (barView.getSnapshot().inspect === null) return
    barView.update((draft) => { draft.inspect = null })
  }

  // The Files pane's pending reveal, held until the pane has shown the row.
  const revealFile = (path: string): void => {
    barView.update((draft) => { draft.reveal = { path, nonce: (draft.reveal?.nonce ?? 0) + 1 } })
    showPanel('files')
  }
  const clearReveal = (): void => {
    if (barView.getSnapshot().reveal === null) return
    barView.update((draft) => { draft.reveal = null })
  }
  // An artefact landed (JJ, 16 Sep 2026: the first video's folder did not
  // show): the Files pane re-lists every folder it has loaded.
  ctx.effect(() => onArtefactLanded(() => {
    barView.update((draft) => { draft.filesReload += 1 })
  }), 'idealize-bar: artefacts refresh the Files pane')

  // The pane closures as a service, so a shell without the rail (the desktop
  // mini frame) drives the same panes through `ctx.idealizeBar`.
  const barFace: IdealizeBarService = {
    state: barView,
    show: showPanel,
    close: closePanel,
    openFile,
    closeFile,
    revealFile,
    addBrain: (space) => { requestBrains({ kind: 'add-brain', space }) },
  }
  ctx.effect(() => {
    const dispose = ctx.reflect.provide('idealizeBar', barFace)
    // provide()'s disposer settles asynchronously; teardown is synchronous fire-and-forget.
    return () => { void dispose() }
  }, 'idealize-bar: pane service')

  // The rail's Settings button drives the upstream settings dialog through
  // `ctx.settingsOpen`. Probed, never injected: the sidebar foot's own trigger
  // is shadowed by this package (HatchTrigger below), so without the settings
  // plugin there is no dialog to open and the rail simply carries no button.
  const settingsOpener = (): (() => void) | undefined => {
    const maybe = (ctx as unknown as { get(name: string): unknown }).get('settingsOpen')
    const face = maybe as SettingsOpenLike | undefined
    return typeof face?.open === 'function' ? () => { face.open() } : undefined
  }

  const injected = (): IdealizeBarInjected => ({
    hooks: { barView },
    togglePanel,
    openSettings: settingsOpener(),
  })

  // The composer's "+" menu (JJ, 15 Sep 2026: one menu "in the same way as
  // claude does"): Connectors lists what the app talks to and Plugins where
  // to add more, each row opening the pane that owns it. Probed, not
  // injected, like the settings opener.
  const composerMenu = (ctx as unknown as { get(name: string): unknown }).get('composerMenu') as ComposerMenuLike | undefined
  if (composerMenu !== undefined) {
    const barT = ctx.locale.bind('idealize-bar')
    const openMarket = (): void => {
      const launcher = document.querySelector<HTMLElement>(MARKET_LAUNCHER_SELECTOR)
      if (launcher !== null) launcher.click()
      else showPanel('hatch')
    }
    // Skills & Commands (JJ, 15 Sep 2026: "a skills chooser in the modal
    // that uses the skills folder as its source" and "blended ... Skills &
    // Commands"): the folder's skills from the host route, then the session's
    // host commands. A skill pick inserts its reference; a bare command runs
    // at once, like the "/" menu, and one that takes input is inserted for
    // the person to finish.
    const readFolderSkills = async (): Promise<SkillsRoute['groups']> => {
      try {
        const response = await fetch('/idealize/bar/skills')
        if (!response.ok) return []
        return ((await response.json()) as SkillsRoute).groups
      } catch {
        // The host is unreachable mid-reconnect: the submenu shows no skills this time.
        return []
      }
    }
    // Only the skills folder is offered here (JJ, 15 Sep 2026: "anything in
    // agent/skills is only accessed by the / command as those are model
    // specific"); the typed "/" menu still reaches the whole catalogue. Each
    // subfolder is its own heading (JJ: "i need subdirectories for the models
    // to use"); a package the registry did not accept is listed but disabled.
    let commandTakesInput = new Map<string, boolean>()
    const skillRows = (groups: SkillsRoute['groups']): ComposerMenuRowLike[] => {
      if (groups.length === 0) {
        return [
          { id: 'heading:skills', label: barT('menu.skills.heading'), heading: true },
          { id: SKILL_ROW, label: barT('menu.skills.none'), disabled: true },
        ]
      }
      return groups.flatMap(group => [
        {
          id: group.folder === '' ? 'heading:skills' : `heading:skills:${group.folder}`,
          label: group.folder === '' ? barT('menu.skills.heading') : group.folder,
          heading: true,
        },
        ...group.skills.map(skill => ({
          id: `${SKILL_ROW}${skill.name}#${group.folder}`,
          label: skill.name,
          keywords: skill.description,
          ...skill.invocable ? {} : { disabled: true },
        })),
      ])
    }
    ctx.effect(() => composerMenu.register({
      id: 'skills',
      order: 10,
      label: barT('menu.skills'),
      icon: createElement(IconSkillOutline16, { size: 16 }),
      commands: true,
      search: true,
      rows: async (session) => {
        const [groups, listed] = await Promise.all([readFolderSkills(), ctx.remote.commands.list(session.sessionId)])
        const commands = listed.ok ? listed.value : []
        commandTakesInput = new Map(commands.map(command => [command.name, command.input !== undefined]))
        return [
          ...skillRows(groups),
          { id: 'heading:commands', label: barT('menu.commands.heading'), heading: true },
          ...commands.map(command => ({ id: `${COMMAND_ROW}${command.name}`, label: `/${command.name}`, keywords: command.description })),
        ]
      },
      onSelect: (session, row) => {
        if (row === undefined) return
        if (row.startsWith(SKILL_ROW)) {
          // The row id carries the subfolder after `#`; the reference is by name alone.
          session.insertText(`/${row.slice(SKILL_ROW.length).split('#')[0] ?? ''} `)
          return
        }
        if (!row.startsWith(COMMAND_ROW)) return
        const name = row.slice(COMMAND_ROW.length)
        if (commandTakesInput.get(name) === true) session.insertText(`/${name} `)
        else void ctx.remote.commands.execute(session.sessionId, `/${name}`)
      },
    }), 'idealize-bar: composer menu skills and commands')
    // Connectors opens Settings, where the Telegram pairing lives; Plugins
    // opens the community market. Neither has a submenu, and neither names
    // the service hatch (JJ, 15 Sep 2026: "this will confuse people").
    ctx.effect(() => composerMenu.register({
      id: 'connectors',
      order: 20,
      label: barT('menu.connectors'),
      icon: createElement(BarIconModels, { size: 16 }),
      onSelect: () => { settingsOpener()?.() },
    }), 'idealize-bar: composer menu connectors')
    ctx.effect(() => composerMenu.register({
      id: 'plugins',
      order: 30,
      label: barT('menu.plugins'),
      icon: createElement(BarIconPlugins, { size: 16 }),
      onSelect: () => { openMarket() },
    }), 'idealize-bar: composer menu plugins')
  }

  ctx.slots.inject('shell.rail', () => ctx.slots.register({
    name: 'shell.rail',
    locale: NS,
    inject: injected,
  }, IdealizeBar))

  // The desktop mini-mode toggle sits on the sidebar header's top row beside the
  // collapse toggle (JJ, 2026-08-28), not among the rail's panes.
  ctx.slots.inject('sidebar.header.action', () => ctx.slots.register({
    name: 'sidebar.header.action',
    id: 'idealize-minimode',
    order: 100,
    label: 'Mini mode',
    locale: NS,
  }, MinimodeButton))

  // The sidebar foot's Settings trigger: shadowed by an empty occupant (lowest
  // priority renders) so the shell hides the button — the Service hatch is a
  // rail pane and the foot would only repeat it.
  ctx.slots.inject('settings.trigger', () => ctx.slots.register({
    name: 'settings.trigger',
    priority: -1,
    locale: NS,
  }, HatchTrigger))

  // ── English only ───────────────────────────────────────────────────────
  // The product ships in English (JJ, 16 Sep 2026). The upstream locale
  // plugin keeps its Chinese dictionaries, browser detection and Language
  // row, so the active locale is pinned to English whenever it moves (the
  // browser default at boot, or a durable preference adopted later) and the
  // row's seat is shadowed with nothing.
  ctx.effect(() => {
    const pin = () => { if (ctx.locale.getLocale().active !== 'en') ctx.locale.setLocale('en') }
    pin()
    return ctx.locale.subscribe(pin)
  }, 'idealize-bar: English pin')
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'language',
    priority: -1,
  }, NoLanguageRow))
  // The settings onboarding list's DeepSeek entry asks for an official
  // DeepSeek key; the product's DeepSeek models come through OpenRouter (JJ,
  // 16 Sep 2026), so the entry's seat is shadowed with nothing.
  ctx.slots.inject('settings.onboarding', () => ctx.slots.register({
    name: 'settings.onboarding',
    id: 'deepseek-official',
    priority: -1,
  }, NoProviderDialog))

  // ── Trajectory pane host ───────────────────────────────────────────────
  // The event ledger moved here from the conversation view ring: its plugin
  // provides the component and a per-chat wired face as a service (FORK.md).
  const trajectoryHost = (): TrajectoryHost => ({
    Component: ctx.trajectorySection.Component,
    face: sessionId => ctx.trajectorySection.face(sessionId),
  })

  // ── Terminal pane host ─────────────────────────────────────────────────
  // The Chat⇄Terminal service (restated face; @idealize/ui-terminal owns
  // it). ctx.get() is the sanctioned probe for a service this plugin does
  // not inject: without the terminal plugin nothing here opens a shell, and
  // the welcome card's roster states `desktop-only` for the brain step.
  const terminalMode = (): TerminalModeLike | undefined => {
    const maybe = (ctx as unknown as { get(name: string): unknown }).get('terminalMode')
    return typeof (maybe as TerminalModeLike | undefined)?.open === 'function'
      ? maybe as TerminalModeLike
      : undefined
  }
  const terminalHost = (): TerminalHost | undefined => {
    const mode = terminalMode()
    return mode === undefined ? undefined : { Pane: mode.Pane }
  }
  // The rail's Terminal entry follows the service's presence and its probe:
  // the entry shows once the host reports an embedded terminal, and leaves
  // with the service (a pane open on it closes, so the drawer never shows
  // an empty seat).
  ctx.inject(['terminalMode'], (scope) => {
    let live = true
    void terminalMode()?.embedded().then((embedded) => {
      if (live && embedded) barView.update((draft) => { draft.terminalAvailable = true })
    })
    scope.effect(() => () => {
      live = false
      barView.update((draft) => { draft.terminalAvailable = false })
      if (barView.getSnapshot().panel === 'terminal') closePanel()
    }, 'idealize-bar: the Terminal entry leaves with the terminal service')
  })

  // ── Schedule pane host ─────────────────────────────────────────────────
  // The calendar moved here from the conversation view ring the same way; one
  // calendar serves every chat, so its face takes no session.
  const scheduleHost = (): ScheduleHost => ({
    Component: ctx.scheduleSection.Component,
    face: () => ctx.scheduleSection.face(),
  })

  // ── Appearance pane host ───────────────────────────────────────────────
  // The inspector's selector hook and copy bind once; the face is a fresh
  // bag of closures over the same store each time.
  const useAppearance = bindSnapshotSelector(ctx.appearance.store)
  const appearanceT = ctx.locale.bind('idealize-appearance')
  const appearanceHost = (): AppearanceHost => {
    const { hooks, ...face } = ctx.appearance.face()
    void hooks
    return {
      Component: ctx.appearance.Component,
      props: { ...face, useAppearance, t: appearanceT },
    }
  }

  // ── Session plumbing: the hatch chat.
  // Adopt the newest engaged session of a workspace, create one lazily on
  // first send, never select the main surface.
  // ctx.get, not the Context property: this package compiles host and client
  // halves in one project, and the host session store's Context merge shadows
  // the client runtime's typing of these two names.
  const sessionsFace = ctx.get('sessions') as unknown as ISessions
  const workspacesFace = ctx.get('workspaces') as unknown as IWorkspaces
  // The welcome card's media launch reads the conversation view ring and
  // writes one chat's active view; neither reaches through the typed
  // overloads, which cannot see a foreign package's per-session store.
  const erasedSlots = ctx.slots as unknown as ErasedSlots
  const { api } = ctx.get('connection') as ConnectionHandle

  // ── Brains pane host ───────────────────────────────────────────────────
  // The Models settings page moved here from the settings modal: its plugin
  // provides component + wired face as a service (the same store as its
  // onboarding dialogs, so freshness wiring stays upstream).
  //
  // `followBrain` is the second half: a brain the open chat is running keeps
  // its model current. The chat took that model when the brain was chosen, so
  // without this an edit in the sheet left the composer naming the old one
  // (JJ, 10 Sep 2026). Only the chat's OWN brain moves it, and a chat pinned
  // to a model by hand is untouched because its brain no longer names it.
  const modelDirectories = (): ModelDirectoriesLike | undefined => {
    const maybe = (ctx as unknown as { get(name: string): unknown }).get('modelDirectories')
    return typeof (maybe as ModelDirectoriesLike | undefined)?.directoryFor === 'function'
      ? maybe as ModelDirectoriesLike
      : undefined
  }
  const followBrain = async (brainId: string): Promise<void> => {
    const list = sessionsFace.list.getSnapshot()
    const sessionId = list.current
    if (sessionId === undefined) return
    if (list.byId[sessionId]?.projectionValues?.brain?.brain !== brainId) return
    const response = await fetch(ACTIVITY_AGENTS_PATH)
    if (!response.ok) return
    const { agents } = await response.json() as { agents: { id: string; model: BrainModel | null }[] }
    const model = agents.find(agent => agent.id === brainId)?.model
    if (model === null || model === undefined) return
    // Through the directory when the model seat is mounted: it is the store
    // the composer's label reads, and a write around it would not reach it.
    const directory = modelDirectories()?.directoryFor(sessionId)
    if (directory === undefined) {
      await api.sessions.selectModel({ sessionId, provider: model.provider, model: model.model })
      return
    }
    // A refusal is already on the seat's own store, which is where the person
    // reading the composer sees it; the sheet has its own saved/failed line
    // for the save itself and must not report this write twice.
    await directory.select({ provider: model.provider, model: model.model }).catch(() => undefined)
  }
  const modelsHost = (): BrainsPanelHost => ({
    models: {
      Component: ctx.modelsSettingsSection.Component,
      props: ctx.modelsSettingsSection.face(),
    },
    followBrain,
  })
  const adoptSession = (path: string): SessionBinding | null => {
    const workspaces = workspacesFace.list.getSnapshot()
    const workspace = workspaces.items.find(item => item.path === path)
    if (workspace === undefined) return null
    const sessions = sessionsFace.list.getSnapshot()
    const newest = workspace.sessionIds
      .map(id => sessions.byId[id])
      .filter((summary): summary is NonNullable<typeof summary> => summary !== undefined
        && !summary.blank && !workspaces.archivedSessionIds.includes(summary.id))
      .sort((a, b) => b.updatedAt - a.updatedAt)[0]
    if (newest === undefined) return null
    const binding = sessionsFace.binding(newest.id)
    if (binding === undefined) return null
    // Off-stage sessions get no history backfill (staging is the open
    // signal); the class-only open() pulls the tail so the adopted
    // transcript shows. Optional call: the face is future-proofed.
    void (binding.session as unknown as { open?: () => Promise<void> }).open?.()
    return binding
  }
  const service: ServiceSectionInjected = {
    adoptSession,
    ensureSession: async (path: string) => {
      const view = await workspacesFace.create({ path })
      const adopted = adoptSession(path)
      if (adopted !== null) return adopted
      const sessionId = await workspacesFace.connectWorkspace(view.workspaceId)
      const binding = sessionsFace.binding(sessionId)
      // Fail loud: the section renders this message in the pane. A silent
      // null here left the composer dead with no explanation.
      if (binding === undefined) throw new Error(`session "${sessionId}" resolved no binding`)
      // The fresh session is created off-stage; the class-only open() pulls
      // its (empty) tail and starts the stream so the transcript displays.
      void (binding.session as unknown as { open?: () => Promise<void> }).open?.()
      return binding
    },
    openModels: () => { showPanel('models') },
  }

  // The notify plugin's output service (restated face; @idealize/notify owns
  // it). ctx.get() is the sanctioned probe for a service this plugin does not
  // inject: without the notify plugin a feedback submit simply stays silent.
  interface IdealizeNotifyLike {
    notify(title: string, body: string): void
    chime(): void
  }
  const notifyService = (): IdealizeNotifyLike | undefined => {
    const maybe = (ctx as unknown as { get(name: string): unknown }).get('idealizeNotify')
    return typeof (maybe as IdealizeNotifyLike | undefined)?.notify === 'function'
      ? maybe as IdealizeNotifyLike
      : undefined
  }

  // Add-to-chat: append the path to the CURRENT session's composer draft
  // through the conversation input face (plain text — the @-reference chip
  // path needs a registered source codec, which no file source provides yet).
  const addToChat = (path: string): boolean => {
    const conversation: IConversation | undefined = ctx.get('conversation')
    if (conversation === undefined) return false
    const current = sessionsFace.list.getSnapshot().current
    if (current === undefined) return false
    const binding = sessionsFace.binding(current)
    if (binding === undefined) return false
    const input = conversation.input.for(binding.ctx)
    const draft = input.state.getSnapshot().draft
    const joined = draft === '' || draft.endsWith(' ') ? `${draft}${path} ` : `${draft} ${path} `
    input.setDraft(joined)
    return true
  }

  /** The active chat's working directory; undefined while no chat is open. */
  const currentCwd = (): string | undefined => {
    const sessions = sessionsFace.list.getSnapshot()
    return sessions.current === undefined ? undefined : sessions.byId[sessions.current]?.cwd
  }

  /**
   * The active chat's project root: the workspace the chat belongs to, which
   * is the folder `@idealize/artefacts` writes `relPath` under; the chat's
   * cwd while the workspace list has not placed it. Undefined with no chat.
   */
  const projectRoot = (): string | undefined => {
    const current = sessionsFace.list.getSnapshot().current
    if (current === undefined) return undefined
    return workspacesFace.list.getSnapshot().items.find(item => item.sessionIds.includes(current))?.path ?? currentCwd()
  }

  // ── The galleries' Reveal ───────────────────────────────────────────────
  // A Reveal beside a tile's Archive names the file by its project-relative
  // storage path; this is where that path meets the project root and becomes
  // the Files pane's target.
  ctx.effect(() => {
    // The host-side apply test runs this world without a DOM.
    if (typeof document === 'undefined') return () => {}
    return onRevealRequest((relPath) => {
      const root = projectRoot()
      if (root === undefined) {
        ctx.logger.warn(`idealize-bar: cannot reveal "${relPath}" with no project open`)
        return
      }
      revealFile(`${root}/${relPath}`)
    })
  }, 'idealize-bar: reveal an artefact in the Files pane')

  // ── The chat's "inspect this call" handoff ──────────────────────────────
  // A tool row's Inspect button writes the call into the chat store and asks
  // the ring for its 'trajectory' entry. The ledger left the ring for the rail,
  // so the ring half is inert and the store field is the live one: watch it on
  // the current chat's own store instance, open the pane on that record, and
  // let watchInspect clear the field so one click cannot replay.
  //
  // The chat ring entry mounts after a session becomes current, so a failed
  // attach is retried whenever the ring changes.
  ctx.effect(() => {
    let disposeWatch: (() => void) | undefined
    let watched: string | undefined
    const attach = (): void => {
      const current = sessionsFace.list.getSnapshot().current
      if (current === watched && disposeWatch !== undefined) return
      disposeWatch?.()
      disposeWatch = undefined
      watched = current
      if (current === undefined) return
      disposeWatch = watchInspect(erasedSlots, current, (callId) => {
        barView.update((draft) => { draft.inspect = { sessionId: current, callId } })
        showPanel('trajectory')
      })
    }
    const disposers = [sessionsFace.list.subscribe(attach), subscribeRing(erasedSlots, attach)]
    attach()
    return () => {
      disposeWatch?.()
      for (const dispose of disposers) dispose()
    }
  }, 'idealize-bar: chat inspect handoff')

  // ── The ring seeded from the space ──────────────────────────────────────
  // The ring has no tab row, so nothing on screen puts a chat onto its space's
  // view; the durable record does. Each chat is seeded once per page from its
  // `space` projection the first time it is current, which is what lands a
  // reload on Gallery with `localStorage` cleared.
  const spaceSeed = createSpaceSeed(erasedSlots, sessionsFace)
  ctx.effect(() => spaceSeed.start(), 'idealize-bar: seed the ring from the space')

  // ── The pinned Studio card ──────────────────────────────────────────────
  // V0's lead-agent card, always present (JJ, 3 Sep 2026: "it's like the lead
  // agent in v0", "the studio is for all projects"): the top of the sidebar
  // opens the one Studio chat — a blank chat in the `studio` space, minted on
  // first use in the first listed project, hidden from the tree and from New
  // chat's blank reuse — whose view spans every project.
  const studioTarget = createSnapshotStore<{ current: boolean; available: boolean }>({ current: false, available: false })
  // Reuse asks a project to hold the chat: a Studio chat left behind by a
  // removed project has no workspace, so its composer would ask JJ to pick a
  // project (8 Sep 2026, after two projects were removed); it is left where
  // it is and a fresh Studio chat is minted in the first listed project.
  const studioChat = (): SessionId | undefined => {
    const sessions = sessionsFace.list.getSnapshot()
    const workspaces = workspacesFace.list.getSnapshot()
    const held = new Set(workspaces.items.flatMap(item => item.sessionIds))
    for (const id of sessions.ids) {
      const summary = sessions.byId[id]
      const space = spaceSeed.launchedSpace(id) ?? summary?.projectionValues?.space?.space
      if (summary === undefined || space !== 'studio') continue
      if (held.has(summary.id) && !workspaces.archivedSessionIds.includes(summary.id)) return summary.id
    }
    return undefined
  }
  const retarget = (): void => {
    const sessions = sessionsFace.list.getSnapshot()
    const currentSummary = sessions.current === undefined ? undefined : sessions.byId[sessions.current]
    const current = currentSummary !== undefined
      && (spaceSeed.launchedSpace(currentSummary.id) ?? currentSummary.projectionValues?.space?.space) === 'studio'
    const available = workspacesFace.list.getSnapshot().items.length > 0
    const before = studioTarget.getSnapshot()
    if (before.current !== current || before.available !== available) studioTarget.set({ current, available })
  }
  ctx.effect(() => {
    const disposers = [sessionsFace.list.subscribe(retarget), workspacesFace.list.subscribe(retarget)]
    retarget()
    return () => { for (const dispose of disposers) dispose() }
  }, 'idealize-bar: the Studio card follows the current chat')
  /**
   * Record a space on a chat the card has just opened, waiting for the host to
   * have that chat live. A cold chat answers 404 until its resume finishes;
   * any other refusal is final and ends the attempt.
   * @param sessionId - the chat to record.
   * @param space - the space to record on it.
   * @returns whether the record landed.
   */
  const recordSpace = async (sessionId: string, space: string): Promise<boolean> => {
    for (let attempt = 0; attempt < SPACE_RECORD_ATTEMPTS; attempt += 1) {
      if (attempt > 0) await new Promise(resolve => setTimeout(resolve, SPACE_RECORD_RETRY_MS))
      const response = await fetch(SPACES_SELECT_PATH, {
        method: 'POST',
        headers: { 'x-idealize-auth': '1', 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, space }),
      }).catch(() => undefined)
      if (response === undefined) continue
      if (response.ok) return true
      if (response.status !== 404) return false
    }
    return false
  }
  /**
   * Open the one Studio chat, landing on a named Studio event when the
   * request carried one (an alert the person opened names its event).
   * @param studioEvent - the event the view should land on, when named.
   */
  const openStudio = async (studioEvent?: string): Promise<void> => {
    if (studioEvent !== undefined) ctx.studioSection.store.focus(studioEvent)
    const existing = studioChat()
    if (existing !== undefined) {
      spaceSeed.noteLaunch(existing, 'studio')
      sessionsFace.open(existing)
      return
    }
    const workspace = workspacesFace.list.getSnapshot().items[0]
    if (workspace === undefined) return
    const sessionId = await workspacesFace.connectWorkspace(workspace.workspaceId)
    // The reuse scan excludes the `studio` space, but reads it off the
    // projection the record below produces; until that lands, New chat could
    // take this project's one group chat.
    workspacesFace.noteSessionConfigured(sessionId)
    // The seed first, then the durable record, then the ring: the same order
    // as a welcome-card launch, for the same reason (a launch beats the
    // projection the record reaches a beat later).
    // The seed first, so the card and the ring read `studio` on this chat
    // from here on; then the chat opens, and only then does the record go out.
    // `connectWorkspace` hands back the project's existing blank chat when it
    // has one, which after a restart is COLD: the host has no live session of
    // that id, `POST /idealize/spaces/select` answers 404, and a record sent
    // before the open is dropped, leaving the chat on the space chooser (8 Sep
    // 2026, the landing-17 walk). Opening resumes the chat, so the record
    // follows the open and retries across the resume.
    spaceSeed.noteLaunch(sessionId, 'studio')
    sessionsFace.open(sessionId)
    await recordSpace(sessionId, 'studio')
    openChatView(erasedSlots, sessionId, 'studio')
  }
  /**
   * Register a folder as a project and open a chat in it. Finder's "Idealize
   * this" reaches here: the main process turns the `idealize://project` URL
   * into an `open-folder` event, and this window does the work, because
   * registering a Workspace is a client call and the desktop shell has no
   * chat surface of its own (JJ, 13 Sep 2026: "right-click menu on folders
   * should include 'Idealize this' which opens it as a project").
   * `create` is idempotent on the path, so idealizing the same folder twice
   * opens the project that is already there rather than a second copy.
   */
  const openFolder = async (path: string): Promise<void> => {
    try {
      const workspace = await workspacesFace.create({ path })
      workspacesFace.startSession(workspace.workspaceId)
    } catch (cause) {
      // The folder was renamed or unmounted between the Finder click and the
      // window reading the event; there is no surface to recover on.
      console.error(`idealize-bar: cannot idealize ${path}`, cause)
    }
  }
  // The Askbar's Studio entry asks for the Studio two ways and this window
  // answers both with the one open: the floating bar through the host bridge
  // feed (`open-studio`), the sidebar rail through the in-window document
  // event. The bar's New chat rides the same feed (`new-chat`), and Finder's
  // "Idealize this" the same feed again (`open-folder`). Only feed events
  // after attach count, so a reload never replays an old request.
  ctx.effect(() => {
    const offRequest = onStudioRequest((studioEvent) => { void openStudio(studioEvent) })
    let source: EventSource | undefined
    let closed = false
    const attach = async (): Promise<void> => {
      let latest = 0
      let arrival: { kind?: string; folder?: string; at?: string } | undefined
      try {
        const response = await fetch('/idealize/events/recent?since=0')
        if (response.ok) {
          for (const event of (await response.json()) as { seq: number; kind?: string; folder?: string; at?: string }[]) {
            latest = Math.max(latest, event.seq)
            if (event.kind === 'open-folder') arrival = event
          }
        }
      } catch {
        // the bridge is absent in this composition: nothing to listen for
        return
      }
      // The tail is otherwise skipped, so a reload never replays an old
      // request. One kind is the exception: Finder's "Idealize this" starts
      // the app when it is not running, and that request is on the feed
      // before this window can attach to it. Only a request from the last
      // half-minute counts, which is a cold start and nothing older.
      if (arrival !== undefined && (arrival.folder ?? '') !== '' && Date.now() - Date.parse(arrival.at ?? '') < 30_000) {
        void openFolder(arrival.folder ?? '')
      }
      if (closed || typeof EventSource === 'undefined') return
      source = new EventSource(`/idealize/events/stream?since=${String(latest)}`)
      source.onmessage = (message) => {
        let event: { kind?: string; folder?: string }
        try {
          event = JSON.parse(message.data as string) as { kind?: string; folder?: string }
        } catch {
          return // a comment or malformed frame; the feed only carries JSON lines
        }
        if (event.kind === 'open-studio') void openStudio()
        // The bar's New chat: it has no chat surface of its own, so the
        // window it grows back into starts the chat (JJ, 13 Sep 2026).
        if (event.kind === 'new-chat') ctx.workspaces.startSession()
        // Finder's "Idealize this", carrying the folder it was invoked on.
        if (event.kind === 'open-folder' && (event.folder ?? '') !== '') void openFolder(event.folder ?? '')
      }
    }
    void attach()
    return () => {
      closed = true
      source?.close()
      offRequest()
    }
  }, 'idealize-bar: open the Studio on the Askbar\'s request')

  // The card's second line says whether the Telegram remote is connected
  // (JJ, 15 Sep 2026: "a status line for 'Telegram - Connected' or 'Telegram
  // - Not Connected'"): a bot token stored, a chat paired and no standing
  // problem, read from @idealize/telegram's status route on the card's poll.
  // A refusal, a host that is away or a composition without the row reads as
  // not connected.
  const telegramStatus = createSnapshotStore<{ connected: boolean }>({ connected: false })
  const telegramConnected = async (): Promise<boolean> => {
    const response = await fetch(TELEGRAM_STATUS_PATH)
    if (!response.ok) return false
    const status = await response.json() as { configured?: unknown; paired?: unknown; problem?: unknown }
    return status.configured === true && status.paired === true && status.problem === ''
  }
  const readTelegram = async (): Promise<void> => {
    let connected: boolean
    try {
      connected = await telegramConnected()
    } catch {
      // The host is away, or the answer is not JSON: the line reads not connected.
      connected = false
    }
    if (telegramStatus.getSnapshot().connected !== connected) telegramStatus.set({ connected })
  }
  const syncStudioCard = async (): Promise<void> => {
    await Promise.all([ctx.studioSection.store.sync(), readTelegram()])
  }

  const useStudioTarget = bindSnapshotSelector(studioTarget)
  const useStudioState = bindSnapshotSelector(ctx.studioSection.store.state)
  const useTelegramStatus = bindSnapshotSelector(telegramStatus)
  ctx.slots.inject('sidebar.workspaces.pinned', () => ctx.slots.register({
    name: 'sidebar.workspaces.pinned',
    id: 'idealize-studio-card',
    order: 10,
    locale: NS,
    inject: (): StudioCardInjected => ({
      useStudio: useStudioState,
      useTelegram: useTelegramStatus,
      useTarget: useStudioTarget,
      sync: syncStudioCard,
      open: openStudio,
    }),
  }, StudioCard))

  const drawerInjected = (): DrawerPanelInjected => ({
    hooks: { barView },
    closePanel,
    setHatchTab: (tab: HatchTab) => { barView.update((draft) => { draft.hatchTab = tab }) },
    openFile,
    currentCwd,
    pickDirectory: () => workspacesFace.pickDirectory(),
    idealize: (path: string) => { void openFolder(path) },
    modelsHost: modelsHost(),
    clearBrainsRequest,
    trajectoryHost: trajectoryHost(),
    clearInspect,
    clearReveal,
    scheduleHost: scheduleHost(),
    terminalHost,
    addToChat,
    service,
    notifyDone: (title, body) => {
      const notify = notifyService()
      notify?.chime()
      notify?.notify(title, body)
    },
    appearanceHost: appearanceHost(),
  })

  ctx.slots.inject('shell.drawer', () => ctx.slots.register({
    name: 'shell.drawer',
    locale: NS,
    inject: drawerInjected,
  }, DrawerPanel))

  // A Files row dragged onto the composer card is Add to chat: the card's
  // textarea would paste the path as raw text otherwise, bypassing the draft
  // machine. Registered at the document so every composer seat is covered.
  const composerDrop = (event: DragEvent): void => {
    const transfer = event.dataTransfer
    if (transfer === null || !Array.from(transfer.types).includes(FILE_DRAG_TYPE)) return
    if (!(event.target instanceof Element) || event.target.closest('[data-composer-card]') === null) return
    event.preventDefault()
    if (event.type === 'dragover') {
      transfer.dropEffect = 'copy'
      return
    }
    const path = transfer.getData(FILE_DRAG_TYPE)
    if (path !== '') addToChat(path)
  }
  ctx.effect(() => {
    // The host-side apply test runs this world without a DOM.
    if (typeof document === 'undefined') return () => {}
    document.addEventListener('dragover', composerDrop)
    document.addEventListener('drop', composerDrop)
    return () => {
      document.removeEventListener('dragover', composerDrop)
      document.removeEventListener('drop', composerDrop)
    }
  }, 'idealize-bar: Files rows drop into the composer as Add to chat')

  const deckInjected = (): DeckPanelInjected => ({
    hooks: { barView },
    closeFile,
    addToChat,
  })

  ctx.slots.inject('shell.deck', () => ctx.slots.register({
    name: 'shell.deck',
    locale: NS,
    inject: deckInjected,
  }, DeckPanel))

  // ── Welcome card (hero card accessory) ──────────────────────────────────
  // The two-step chooser on every new-chat screen: which space, then which
  // brain. Both steps read one `GET /idealize/spaces` payload, so the tile's
  // count and the brain list can never disagree. The card still registers
  // behind the activity-pills service, which owns the free-tokens route and
  // the roster default for the five activity brains.
  ctx.inject(['activityPills'], (scope: ClientContext) => {
    const host = scope.activityPills
    const face = host.face()
    const currentSession = (): LauncherSession | undefined => {
      const list = sessionsFace.list.getSnapshot()
      const summary = list.current === undefined ? undefined : list.byId[list.current]
      if (summary === undefined) return undefined
      const brain = summary.projectionValues?.brain?.brain
      // A launch in this page beats the projection here as it does in the
      // seed: the Studio card opens its chat before the record reaches the
      // projection, and the card must not ask that chat which space it is in.
      const space = spaceSeed.launchedSpace(summary.id) ?? summary.projectionValues?.space?.space
      return {
        id: summary.id,
        blank: summary.blank,
        ...summary.agentPreset === undefined ? {} : { agentPreset: summary.agentPreset },
        ...brain === undefined ? {} : { brain },
        ...space === undefined ? {} : { space },
      }
    }

    /**
     * Make one brain current for the chat about to launch.
     *
     * An ACTIVITY brain goes through the activity controller, which is what
     * routes Free to the free-tokens policy and moves the roster default so
     * the next new chat opens on the same brain. Every other brain — the
     * seeded media agents, and anything a person authors — is written for THIS
     * chat only, because a Gallery agent must not become what every new chat
     * opens on.
     */
    const selectBrain = async (
      brain: string, model: { provider: string; model: string } | undefined, session: PillSessionSummary,
    ): Promise<boolean> => {
      if (face.hooks.activityPills.getSnapshot().pills.some(pill => pill.id === brain)) {
        await host.face().select(brain, session)
        return face.hooks.activityPills.getSnapshot().error === null
      }
      const response = await api.agentPresets.select({ sessionId: session.id as SessionId, agentPreset: brain })
      if (!response.result.ok) return false
      sessionsFace.noteAgentPreset(session.id as SessionId, response.result.value.agentPreset)
      // The preset carries no model. The brain's chosen model is a `models`
      // entry the activity controller applies for its own brains; every other
      // brain's is applied here, or the chat runs on the deployment default.
      if (model === undefined) return true
      const selected = await api.sessions.selectModel({ sessionId: session.id as SessionId, provider: model.provider, model: model.model })
      return selected.result.ok
    }

    /** The roster the launcher last loaded; `enter` reads a brain's model from it. */
    let roster: readonly SpaceRosterEntry[] = []

    const launcherInjected = (): HeroLauncherInjected => ({
      currentSession,
      spaces: {
        load: async () => {
          // The activity roster first: `selectBrain` reads it to tell an activity
          // brain from any other, and a race there would silently take the
          // wrong write path.
          await host.face().load()
          const response = await fetch(SPACES_ROSTER_PATH)
          roster = response.ok ? (await response.json() as { spaces: SpaceRosterEntry[] }).spaces : []
          return roster
        },
        access: async () => {
          const response = await fetch(ACTIVITY_AGENTS_PATH)
          if (!response.ok) return {}
          const { agents } = await response.json() as { agents: { id: string; access?: BrainAccess; providerName?: string }[] }
          // The route's display name travels beside `access` on the row; the
          // brain step reads it off the access entry.
          return Object.fromEntries(agents.flatMap(agent => agent.access === undefined
            ? []
            : [[agent.id, { ...agent.access, ...agent.providerName === undefined ? {} : { providerName: agent.providerName } }]]))
        },
        enter: async (space, brain, sessionId) => {
          const target = sessionId ?? sessionsFace.list.getSnapshot().current
          if (target === undefined) return false
          const summary = currentSession()
          const session: PillSessionSummary = summary?.id === target ? summary : { id: target, blank: true }
          const model = roster.find(entry => entry.id === space)?.brains.find(entry => entry.id === brain)?.model
          // Before the first write, not after it: the Host's `brain` and
          // `space` projections are what New chat's reuse scan reads, and they
          // land a round trip later. Without this marker New chat pressed
          // inside that window hands this very chat back instead of minting
          // one (4 Sep 2026; the 28 Aug fix closed the steady state only).
          const configured = workspacesFace.noteSessionConfigured(target as SessionId)
          if (!await selectBrain(brain, model, session)) { configured(); return false }
          // The seed reads the `space` projection, which still names the space
          // a relaunched blank chat is leaving until the record below reaches
          // it. Telling the seed first is what stops it taking the chat back.
          spaceSeed.noteLaunch(target, space)
          // The durable record, before the ring: a reload between the two
          // must find the chat in the space it was launched into.
          await fetch(SPACES_SELECT_PATH, {
            method: 'POST',
            headers: { 'x-idealize-auth': '1', 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId: target, space, brain }),
          }).catch(() => undefined)
          if (space === 'terminal') {
            const mode = terminalMode()
            if (mode === undefined) return false
            return mode.open(target)
          }
          // A space whose view package is absent (Motion ships none) leaves
          // the ring on Chat, which is where its composer already is.
          if (!ringHasView(erasedSlots, space)) return true
          return openChatView(erasedSlots, target, space)
        },
        addBrain: (space) => { requestBrains({ kind: 'add-brain', space }) },
        addKey: () => { requestBrains({ kind: 'add-key' }) },
        // The sign-in surface is a page of its own, opened the way the
        // Brains pane's Subscriptions rows open it.
        signIn: () => { window.open('/idealize/signin', '_blank', 'noopener') },
        terminalLaunches: async () => {
          const response = await fetch('/idealize/terminal/launches').catch(() => undefined)
          if (response === undefined || !response.ok) return undefined
          return await response.json() as TerminalLaunches
        },
      },
    })
    scope.slots.inject('conversation.hero.launcher', () => scope.slots.register({
      name: 'conversation.hero.launcher',
      priority: -1,
      locale: NS,
      inject: launcherInjected,
    }, HeroLauncher))
  })

  // The preset chip ("Standard mode") duplicates the brain step: shadow its
  // seat with nothing.
  ctx.slots.inject('conversation.hero.agentPreset', () => ctx.slots.register({
    name: 'conversation.hero.agentPreset',
    priority: -1,
  }, NoPresetChip))

  // ── Plan-mode icon (composer tool row) ──────────────────────────────────
  // Shadows ui-plan's text chip on the same single seat (lowest priority
  // renders); the host plan-mode plugin keeps the state, reached by command.
  const planInjected = (sessionId: SessionId): PlanToggleInjected => ({
    setPlanMode: async (on) => {
      const result = await ctx.remote.commands.execute(sessionId, on ? '/plan' : '/plan off')
      if (!result.ok) return `${result.error.message} (${result.error.code})`
      if (result.value === undefined) return 'unknown command: /plan'
      return null
    },
  })
  // The icon reads the ring's active view out of the chat entry's store, so it
  // can stand down on the generating spaces; the chat entry registers when
  // ui-conversation declares the ring, so wait for it when this plugin applies first.
  ctx.slots.inject('conversation.input.plan', () => {
    let dispose: (() => void) | undefined
    let unsubscribe: (() => void) | undefined
    const tryRegister = (): void => {
      const store = erasedSlots.entries('conversation.view').find(entry => entry.options.id === 'chat')?.store
      if (store === undefined || dispose !== undefined) return
      unsubscribe?.()
      unsubscribe = undefined
      dispose = erasedSlots.register({
        name: 'conversation.input.plan',
        priority: -1,
        locale: NS,
        inject: planInjected,
        store,
      }, PlanToggle)
    }
    tryRegister()
    if (dispose === undefined) unsubscribe = subscribeRing(erasedSlots, tryRegister)
    return () => {
      unsubscribe?.()
      dispose?.()
      dispose = undefined
    }
  })

  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: 'idealize-heart',
    order: 10,
    locale: NS,
  }, HeartButton))
}
