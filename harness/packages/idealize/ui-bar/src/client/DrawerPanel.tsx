/**
 * The drawer occupant: whichever rail pane is open, rendered in the frame's
 * docked right column (shell.drawer) so it sits beside the conversation
 * instead of covering it. Reads the bar's view store; ctx.layout owns the
 * column width (the drag handle on its inner edge), this component owns the
 * content. Panes: Files, Service hatch (Service chat | Composition tabs),
 * Brains, Trajectory (the re-hosted event ledger), Schedule (the re-hosted
 * calendar), Feedback (the token-styled form pane), Terminal (the terminal
 * plugin's plain-shell grid, seated from `ctx.terminalMode`), and the
 * Appearance inspector seated from the appearance plugin's service.
 */
import { useEffect, useState } from 'react'
import type React from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AppearancePanelComponentProps } from '@idealize/appearance/client'
import type { BarPanel, BarViewStore, HatchTab } from './bar-store.ts'
import type { BarKey } from './locales.ts'
import { BarIconClose } from './BarIcons.tsx'
import { CompositionSection } from './CompositionSection.tsx'
import { FeedbackPanel } from './FeedbackPanel.tsx'
import { FilesPanel } from './FilesPanel.tsx'
import { BrainsPanel, type BrainsPanelHost } from './BrainsPanel.tsx'
import { ServiceSection, type ServiceSectionInjected } from './ServiceSection.tsx'
import { TrajectoryPane, type TrajectoryHost } from './TrajectoryPane.tsx'
import { SchedulePane, type ScheduleHost } from './SchedulePane.tsx'
import css from './DrawerPanel.module.css'

/**
 * The terminal plugin's pane component as the drawer consumes it (restated;
 * `@idealize/ui-terminal` owns `ctx.terminalMode.Pane`). One plain shell for
 * the app, in the directory it is first opened in.
 */
export interface TerminalHost {
  Pane: (props: { cwd: string | undefined }) => React.JSX.Element
}

/** The appearance plugin's panel plus the props the drawer hands it (index.ts binds them once). */
export interface AppearanceHost {
  Component: (props: AppearancePanelComponentProps) => React.JSX.Element | null
  props: AppearancePanelComponentProps
}

/** Registration-side face: the view store, the pane transitions, and the re-hosted sections. */
export interface DrawerPanelInjected {
  hooks: {
    /** The bar's view state (arrives as the `useBarView` selector hook). */
    barView: BarViewStore
  }
  /** Close the drawer (clears the open pane). */
  closePanel: () => void
  /** Switch the Service hatch pane's tab. */
  setHatchTab: (tab: HatchTab) => void
  /** Show a file in the deck column. */
  openFile: (path: string) => void
  /** The active chat's working directory; the Files pane's project tab reads it. */
  currentCwd: () => string | undefined
  /** Raise the host's folder picker (the Files pane's Reconnect flow). */
  pickDirectory: () => Promise<string | null>
  /** Register a folder as a project and open a chat in it (the Files pane's "Idealize this"). */
  idealize: (path: string) => void
  /** The Brains pane's re-hosted provider editor (index.ts). */
  modelsHost: BrainsPanelHost
  /** Mark the pending Brains request handled, so reopening the pane does not replay it. */
  clearBrainsRequest: () => void
  /** The Trajectory pane's re-hosted event ledger (index.ts). */
  trajectoryHost: TrajectoryHost
  /** Mark the pending inspect handoff applied, so reopening the pane does not replay it. */
  clearInspect: () => void
  /** Mark the pending Files reveal shown, so reopening the pane does not replay it. */
  clearReveal: () => void
  /** The Schedule pane's re-hosted calendar (index.ts). */
  scheduleHost: ScheduleHost
  /**
   * The Terminal pane's grid, resolved at render because the terminal plugin
   * provides its service after this drawer registers; undefined where no
   * terminal plugin is composed (the entry that opens the pane is hidden then).
   */
  terminalHost: () => TerminalHost | undefined
  /** The Service chat's session plumbing (index.ts). */
  service: ServiceSectionInjected
  /** The appearance inspector, seated from `ctx.appearance`. */
  appearanceHost: AppearanceHost
  /**
   * Append a file's path to the active chat's composer draft.
   * @returns false when no chat is active to receive it.
   */
  addToChat: (path: string) => boolean
  /** Raise the done chime + a notification (the @idealize/notify seam) after a feedback submit lands. */
  notifyDone: (title: string, body: string) => void
}

export type DrawerPanelProps = PropsRuntime<'shell.drawer'>
  & PropsLocale<'idealize-bar'>
  & InjectFace<DrawerPanelInjected>

const PANEL_TITLE: Record<BarPanel, BarKey> = {
  files: 'bar.files',
  terminal: 'bar.terminal',
  hatch: 'bar.hatch',
  models: 'bar.models',
  feedback: 'bar.feedback',
  appearance: 'bar.appearance',
  trajectory: 'bar.trajectory',
  schedule: 'bar.schedule',
}

const HATCH_TABS: readonly { id: HatchTab; label: BarKey }[] = [
  { id: 'service', label: 'service.nav' },
  { id: 'composition', label: 'composition.nav' },
]

interface Capabilities {
  reveal: boolean
  trash: boolean
  /** Absent on a host that predates the default-application route. */
  openExternal?: boolean
}

/**
 * The Terminal pane's seat: the terminal plugin's grid over the plain shell.
 * Renders nothing while the terminal service is absent, which the rail's
 * hidden entry already makes unreachable.
 */
function TerminalPaneSeat({ host, cwd }: { host: TerminalHost | undefined; cwd: string | undefined }) {
  if (host === undefined) return null
  const Pane = host.Pane
  return <Pane cwd={cwd} />
}

export function DrawerPanel(props: DrawerPanelProps) {
  const {
    useBarView, useSessions, closePanel, setHatchTab, openFile, currentCwd, pickDirectory, idealize,
    addToChat, notifyDone, modelsHost, clearBrainsRequest, trajectoryHost, clearInspect, clearReveal,
    scheduleHost, terminalHost, service, appearanceHost, t,
  } = props
  const panel = useBarView(state => state.panel)
  const hatchTab = useBarView(state => state.hatchTab)
  const brainsRequest = useBarView(state => state.brainsRequest)
  const inspect = useBarView(state => state.inspect)
  const filesReload = useBarView(state => state.filesReload)
  const reveal = useBarView(state => state.reveal)
  const currentSession = useSessions(state => state.current)
  const [canReveal, setCanReveal] = useState(false)
  const [canTrash, setCanTrash] = useState(false)
  const [canOpenExternal, setCanOpenExternal] = useState(false)

  useEffect(() => {
    let cancelled = false
    void fetch('/idealize/bar/capabilities')
      .then(response => response.json() as Promise<Capabilities>)
      .then((body) => {
        if (cancelled) return
        setCanReveal(body.reveal)
        setCanTrash(body.trash)
        setCanOpenExternal(body.openExternal === true)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  if (panel === null) return null
  // The appearance inspector draws its own header and tab strip.
  if (panel === 'appearance') {
    return (
      <section className={css.root} aria-label={t('bar.appearance')}>
        <appearanceHost.Component {...appearanceHost.props} />
      </section>
    )
  }
  return (
    <section className={css.root} aria-label={t(PANEL_TITLE[panel])}>
      <header className={panel === 'models' ? css.headerBare : css.header}>
        {/* The hatch names itself in the header rather than inside the
            Service tab, so the Composition tab carries the title too (JJ,
            10 Sep 2026). */}
        {panel !== 'models' && (
          <span className={css.title}>{t(panel === 'hatch' ? 'service.banner.title' : PANEL_TITLE[panel])}</span>
        )}
        <button
          type="button"
          className={css.close}
          aria-label={t('panel.close')}
          onClick={closePanel}
        >
          <BarIconClose size={13} />
        </button>
      </header>
      {panel === 'hatch' && (
        <div className={css.tabs} role="tablist" aria-label={t('bar.hatch')}>
          {HATCH_TABS.map(tab => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              className={css.tab}
              aria-selected={hatchTab === tab.id}
              onClick={() => { setHatchTab(tab.id) }}
            >
              {t(tab.label)}
            </button>
          ))}
        </div>
      )}
      <div className={css.body}>
        {panel === 'files' && (
          <FilesPanel
            canReveal={canReveal}
            canTrash={canTrash}
            canOpenExternal={canOpenExternal}
            currentCwd={currentCwd()}
            pickDirectory={pickDirectory}
            onOpenFile={openFile}
            onAddToChat={addToChat}
            onIdealize={idealize}
            reveal={reveal}
            onRevealDone={clearReveal}
            externalReload={filesReload}
            t={t}
          />
        )}
        {panel === 'hatch' && hatchTab === 'service' && (
          <div className={css.pane}>
            <ServiceSection {...service} t={t} />
          </div>
        )}
        {panel === 'hatch' && hatchTab === 'composition' && <CompositionSection t={t} />}
        {panel === 'models' && (
          <BrainsPanel host={modelsHost} request={brainsRequest} onRequestHandled={clearBrainsRequest} t={t} />
        )}
        {panel === 'trajectory' && (
          <TrajectoryPane
            host={trajectoryHost}
            sessionId={currentSession}
            inspect={inspect !== null && inspect.sessionId === currentSession
              ? { callId: inspect.callId }
              : null}
            onInspectDone={clearInspect}
            t={t}
          />
        )}
        {panel === 'schedule' && <SchedulePane host={scheduleHost} />}
        {panel === 'terminal' && <TerminalPaneSeat host={terminalHost()} cwd={currentCwd()} />}
        {panel === 'feedback' && <FeedbackPanel t={t} notifyDone={notifyDone} />}
      </div>
    </section>
  )
}
