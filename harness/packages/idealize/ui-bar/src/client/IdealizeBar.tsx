/**
 * The IDEalize tool rail: a 48px column on the shell.rail seat (per the
 * "Dock launcher" Paper frame), icons stacked from the top. The seat docks at
 * the inner edge of the open deck/drawer columns, on the window edge while
 * both are closed. Every button opens a pane in the docked drawer column at
 * the window edge (DrawerPanel on shell.drawer) — nothing on the rail opens a
 * modal. The Terminal entry opens a plain shell in the drawer for running
 * commands beside a chat (JJ, 15 Sep 2026); it shows only where the host
 * serves an embedded terminal. Which space a chat runs in is chosen in the
 * composer and the welcome card, never here.
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { BarPanel, BarViewStore } from './bar-store.ts'
import {
  BarIconAppearance, BarIconFeedback, BarIconFiles, BarIconHatch, BarIconModels,
  BarIconPlugins, BarIconSchedule, BarIconSettings, BarIconTerminal, BarIconTrajectory,
} from './BarIcons.tsx'
import css from './IdealizeBar.module.css'

/** Icon size on the rail (the Paper frame's 15px glyph in a 22px hit box). */
const ICON = 15

/** Registration-side face: the view store plus the pane transitions (index.ts owns the writes). */
export interface IdealizeBarInjected {
  hooks: {
    /** The bar's view state (arrives as the `useBarView` selector hook). */
    barView: BarViewStore
  }
  /** Open the pane, or close the drawer when it is already the open pane. */
  togglePanel: (panel: BarPanel) => void
  /**
   * Open the upstream settings dialog, or undefined in a composition without
   * `settingsOpen` — the rail then carries no Settings button.
   */
  openSettings: (() => void) | undefined
}

export type IdealizeBarProps = PropsRuntime<'shell.rail'>
  & PropsLocale<'idealize-bar'>
  & InjectFace<IdealizeBarInjected>

/** Sidebar launcher the Plugins button proxies (hidden by this bar's CSS). */
export const MARKET_LAUNCHER_SELECTOR = '.dshMarketLauncher'

export function IdealizeBar(props: IdealizeBarProps) {
  const { useBarView, togglePanel, openSettings, t } = props
  const panel = useBarView(state => state.panel)
  const terminalAvailable = useBarView(state => state.terminalAvailable)
  const [marketPresent, setMarketPresent] = useState(false)

  useEffect(() => {
    let cancelled = false
    // The market launcher mounts from another plugin; look for it briefly.
    let tries = 0
    const probe = setInterval(() => {
      tries += 1
      const found = document.querySelector(MARKET_LAUNCHER_SELECTOR) !== null
      if (found || tries >= 5) {
        clearInterval(probe)
        if (!cancelled && found) setMarketPresent(true)
      }
    }, 1000)
    return () => {
      cancelled = true
      clearInterval(probe)
    }
  }, [])

  const openMarket = (): void => {
    document.querySelector<HTMLButtonElement>(MARKET_LAUNCHER_SELECTOR)?.click()
  }

  const barButton = (
    label: string,
    onClick: () => void,
    icon: ReactNode,
    pressed?: boolean,
  ) => (
    <Tooltip label={label} delayMs={400}>
      <button
        type="button"
        className={css.button}
        data-active={pressed === true ? '' : undefined}
        aria-label={label}
        aria-pressed={pressed}
        onClick={onClick}
      >
        {icon}
      </button>
    </Tooltip>
  )

  const paneButton = (target: BarPanel, label: string, icon: ReactNode) =>
    barButton(label, () => { togglePanel(target) }, icon, panel === target)

  // Order is JJ's 11 Sep 2026 list: the things read most often at the top
  // (Files, Schedule, Trajectory, Brains), the things that change the app
  // below (Plugins, Appearance, Settings), and the Service hatch last. The
  // Terminal (15 Sep 2026) sits under Files, with the working tools.
  // Feedback is not on that list and keeps its place before Settings, the
  // only pane either side of it that it could be confused with. The mini-mode
  // toggle left the rail for the sidebar header, beside the other
  // window-level controls (MinimodeButton on `sidebar.header.action`).
  return (
    <nav className={css.root} aria-label={t('rail.label')}>
      {paneButton('files', t('bar.files'), <BarIconFiles size={ICON} />)}
      {terminalAvailable && paneButton('terminal', t('bar.terminal'), <BarIconTerminal size={ICON} />)}
      {paneButton('schedule', t('bar.schedule'), <BarIconSchedule size={ICON} />)}
      {paneButton('trajectory', t('bar.trajectory'), <BarIconTrajectory size={ICON} />)}
      {paneButton('models', t('bar.models'), <BarIconModels size={ICON} />)}
      {marketPresent && barButton(t('bar.plugins'), openMarket, <BarIconPlugins size={ICON} />)}
      {paneButton('appearance', t('bar.appearance'), <BarIconAppearance size={ICON} />)}
      {paneButton('feedback', t('bar.feedback'), <BarIconFeedback size={ICON} />)}
      {openSettings !== undefined
        && barButton(t('bar.settings'), openSettings, <BarIconSettings size={ICON} />)}
      {paneButton('hatch', t('bar.hatch'), <BarIconHatch size={ICON} />)}
    </nav>
  )
}
