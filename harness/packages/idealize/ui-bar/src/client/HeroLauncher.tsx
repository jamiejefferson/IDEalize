/**
 * The welcome card (Paper "Brains rethink", boards 06, 07 and 12, approved by
 * JJ on 4 Nov 2026): the project row at the top of the hero composer card, with
 * the composer live beneath it from the start. JJ's earlier ruling that the
 * card shows no chat element until a brain launches the chat is retired by the
 * same decision. {@link HeroBrains} holds the starting points under the card.
 *
 * Without a project the card offers the way in instead: recent projects, New
 * project (the folder flow), Find a folder (the picker menu).
 */
import type { MouseEvent } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PillSessionSummary } from '@idealize/activity-pills/client'
// Type-only: the roster payload the two steps read. The one value this bundle
// takes from `@idealize/spaces/client` is the icon route helper, in SpaceIcon.
import type { SpaceId, SpaceRosterEntry } from '@idealize/spaces/client'
import type { BarKey } from './locales.ts'
import css from './HeroLauncher.module.css'

/**
 * Whether a chat on a brain can open its first request now, as the agents
 * route's `access` field reports it. `unavailable` with `no-access` means the
 * brain's route has no stored key; with `no-sign-in`, that the route is a
 * subscription nobody has signed in to.
 */
export interface BrainAccess {
  state: 'ready' | 'confirm' | 'unavailable'
  reason?: string
  model: { provider: string; model: string } | null
  /** The route's display name, when the sign-in surface offers the route. */
  providerName?: string
}

/** The launcher's view of the space vocabulary: the roster read, the launch, and the two recoveries. */
export interface LauncherSpaces {
  /**
   * The roster both steps read, in chooser order.
   * @returns one entry per declared space; an empty list when the route is unreachable.
   */
  load: () => Promise<readonly SpaceRosterEntry[]>
  /**
   * Each brain's access, keyed by preset id. A brain marked unavailable is
   * listed with the reason and starts no chat; its row opens the key editor,
   * or the sign-in surface when a sign-in is what the route waits on.
   * @returns the map; empty when the route is unreachable.
   */
  access: () => Promise<Readonly<Record<string, BrainAccess>>>
  /**
   * Enter a space on a brain: record the space and the brain, recompose the
   * chat's preset, and flip its view ring.
   * @param space - the chosen space.
   * @param brain - the chosen brain's agent preset id.
   * @param sessionId - the chat being launched, or undefined for the current one.
   * @returns false when the host refused, which leaves the chooser up.
   */
  enter: (space: SpaceId, brain: string, sessionId: string | undefined) => Promise<boolean>
  /**
   * Put a blank chat on a brain without recording it: the chat answers on what
   * its chip says, and New chat can still hand it back while nobody has used it.
   * @param brain - the brain's agent preset id.
   * @param sessionId - the blank chat.
   */
  prepare: (brain: string, sessionId: string) => Promise<void>
  /**
   * Record the brain once a person starts typing. The router reads a chat's
   * criteria from that record, and a chat with words in it is no longer New
   * chat's to reuse.
   * @param brain - the brain's agent preset id.
   * @param sessionId - the blank chat.
   */
  noteTyping: (brain: string, sessionId: string) => void
  /**
   * Open the Brains pane's add flow with the space already set.
   * @param space - the space the new brain will work in.
   */
  addBrain: (space: SpaceId) => void
  /** Open the Brains pane's provider editor, where a provider key is added. */
  addKey: (provider?: string) => void
  /** Open the sign-in surface, where a subscription route is signed in to. */
  signIn: () => void
  /**
   * The Terminal space's launch table (`GET /idealize/terminal/launches`):
   * the default CLI command, the per-brain overrides and the catalogue that
   * names them. In Terminal a brain runs a CLI on its own login, so the
   * brain step shows the CLI, never the chat model or its key (JJ, 2 Sep
   * 2026: "I selected gpt but got claude").
   * @returns the table, or undefined outside the desktop app.
   */
  terminalLaunches: () => Promise<TerminalLaunches | undefined>
}

/** One CLI the terminal can launch, as the launches route's catalogue lists it. */
export interface TerminalCliOption {
  id: string
  label: string
  command: string
  installed: boolean | null
}

/** The `GET /idealize/terminal/launches` payload the Terminal brain step reads. */
export interface TerminalLaunches {
  default: string
  byActivity: Record<string, string>
  catalog?: TerminalCliOption[]
}

/**
 * The CLI one brain launches in Terminal, by label: the per-brain override
 * or the default, named through the catalogue; a command outside the
 * catalogue is shown verbatim, and `''` is a plain shell.
 * @param brain - the brain's preset id.
 * @param launches - the launch table.
 * @param t - the bar's copy.
 * @returns the label and whether the login shell finds the executable.
 */
export function terminalCliOf(brain: string, launches: TerminalLaunches, t: HeroLauncherProps['t']): { label: string; installed: boolean | null } {
  const command = (launches.byActivity[brain] ?? launches.default).trim()
  if (command === '') return { label: t('launcher.plainShell'), installed: true }
  const entry = launches.catalog?.find(option => option.command.trim() === command)
  return entry === undefined ? { label: command, installed: null } : { label: entry.label, installed: entry.installed }
}

/**
 * The chat the card launches: the pills summary plus the brain the durable
 * record already names, when one does. A brain is recorded only by a launch
 * or a brain switch, so its presence means this chat has already answered the
 * card's questions — on a reload, where the in-memory launch key is gone, it
 * is what keeps the chooser from asking again inside a Gallery chat.
 */
export type LauncherSession = PillSessionSummary & {
  brain?: string | undefined
  /** The recorded space; the Studio chat (`studio`) is launched by construction and never asks. */
  space?: string | undefined
}

/** Registration-side face: the space vocabulary and the chat the card launches. */
export interface HeroLauncherInjected {
  /** The five spaces, their brains, and the launch. */
  spaces: LauncherSpaces
  /** The session the welcome card launches (the current blank one), if any. */
  currentSession: () => LauncherSession | undefined
}

export type HeroLauncherProps =
  PropsRuntime<'conversation.hero.launcher'>
  & PropsLocale<'idealize-bar'>
  & InjectFace<HeroLauncherInjected>

/** The name of each space, wherever one is shown (the tiles, the chip, the Brains pane's add sheet). */
export const SPACE_LABELS: Record<SpaceId, BarKey> = {
  chat: 'launcher.chat',
  terminal: 'launcher.terminal',
  gallery: 'launcher.gallery',
  soundstage: 'launcher.soundstage',
  motion: 'launcher.motion',
  studio: 'launcher.studio',
}

/**
 * The no-project composer card is itself a picker trigger (a click anywhere
 * on it opens the project menu); the card body's own controls must not
 * double as that trigger.
 */
function stopCardTrigger(event: MouseEvent<HTMLDivElement>): void {
  event.stopPropagation()
}

/**
 * The empty occupant of the hero's agent-preset seat: the brain step is the
 * preset choice, so the "Standard mode" chip renders nothing.
 * @returns null.
 */
export function NoPresetChip() {
  return null
}

/**
 * Render the welcome card body.
 * @param props - composed slot props.
 * @returns the card rows.
 */
export function HeroLauncher(props: HeroLauncherProps) {
  const { t, currentSession, projectRow, projectOpen, recentProjects, onNewProject, onFindProject } = props
  const session = currentSession()

  if (!projectOpen) {
    // The Studio runs across every project, so a Studio chat without one is
    // never asked to pick one (JJ, 8 Sep 2026: "Studio chat is asking for a
    // project but it runs across all projects"). The card only opens a Studio
    // chat a listed project holds; this covers the chat being shown anyway.
    if (session?.space === 'studio') return null
    return (
      <div className={css.root} data-hero-undecided="" onClick={stopCardTrigger}>
        <div className={css.projectRow}>{projectRow}</div>
        <div className={css.divider} />
        <div className={css.noProject}>
          <div className={css.noProjectHeading}>{t('launcher.pickProject')}</div>
          {recentProjects}
          <div className={css.projectActions}>
            <button type="button" className={css.projectAction} data-project-action="new" onClick={onNewProject}>
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                <path d="M7 2v10M2 7h10" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
              {t('launcher.newProject')}
            </button>
            <button type="button" className={css.projectAction} data-project-action="find" onClick={onFindProject}>
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                <path d="M1.8 3.6a1 1 0 0 1 1-1h2.6l1.3 1.4h4.5a1 1 0 0 1 1 1v5.9a1 1 0 0 1-1 1H2.8a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
              </svg>
              {t('launcher.findFolder')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // The Studio spans every project, so its chat names none. Left in, the card
  // headed the Studio's ask bar with whichever project happened to be open
  // (JJ, 11 Sep 2026), and now that the Studio has a coordinator of its own,
  // an untagged post goes to that agent rather than to the named project.
  if (session?.space === 'studio') return null

  return (
    <div className={css.root} onClick={stopCardTrigger}>
      <div className={css.projectRow}>{projectRow}</div>
      <div className={css.divider} />
    </div>
  )
}
