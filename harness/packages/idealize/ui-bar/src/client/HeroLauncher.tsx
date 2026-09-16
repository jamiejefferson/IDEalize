/**
 * The welcome card (Paper `01M0WPEDKBV54502M7YV97PZDZ` page v2, boards 1 and
 * 4), filling the hero composer card's accessory hole. With a project open it
 * asks two questions in order, under the project chip:
 *
 * 1. **Which space are we working in?** — five tiles from `GET /idealize/spaces`
 *    in the declared order: Chat, Terminal, Images, Sounds, Video. A
 *    tile carries its brain count and nothing else. Pressing one advances to
 *    step 2, except when exactly one brain works in the space, a model can
 *    serve it and that brain's route is reachable: then the tile starts that
 *    brain at once and step 2 is skipped (JJ, 7 Sep 2026: "skip the brain
 *    selection if there's only one brain"). A host that refuses the launch
 *    drops the card onto step 2, which states why.
 * 2. **Which brain?** — the brains that work in the chosen space, each row a
 *    button that starts the chat.
 *
 * NO TILE IS EVER DIMMED OR DISABLED (JJ, 25 Aug: "yeah i want you to be able
 * to click it and then select a model on the next screen. so no2 but its only
 * a dead end once"). The chooser offers; the brain step explains. Every reason
 * a space cannot be entered — no brains yet, no compatible model, no
 * generation backend, no desktop shell, a lone brain whose route wants a key
 * or a sign-in — is stated on step 2, with the way forward and the way back.
 * Generation refusals share localised copy with the Brains pane, keyed by the
 * route's reason.
 *
 * Step 2 has three states, driven by the roster entry alone:
 *
 * - brains listed → each row starts the chat on that brain;
 * - no brains but a model can serve the space → "Add a brain for <Space>",
 *   which opens the Brains pane's add flow with the space already set;
 * - no model can serve it → the shared recovery sentence for the route's
 *   verdict, the provider-key action where a key is what is missing, and the
 *   way back to the tiles. The
 *   brains that work there are not offered as rows, however many there are:
 *   starting a chat in a space nothing can serve is the dead end the second
 *   step exists to explain.
 *
 * Without a project the card offers the way in instead: recent projects, New
 * project (the folder flow), Find a folder (the picker menu).
 */
import { useCallback, useEffect, useState } from 'react'
import type { MouseEvent } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PillSessionSummary } from '@idealize/activity-pills/client'
// Type-only: the roster payload the two steps read. The one value this bundle
// takes from `@idealize/spaces/client` is the icon route helper, in SpaceIcon.
import type { SpaceBrain, SpaceId, SpaceRosterEntry } from '@idealize/spaces/client'
import { onBrainsChanged } from './brains-changed.ts'
import type { BarKey } from './locales.ts'
import { mediaRecoveryText } from './media-recovery.ts'
import { BarIconArrowRight, BarIconChevronLeft, BarIconKey, BarIconPlus } from './BarIcons.tsx'
import { SpaceIcon } from './SpaceIcon.tsx'
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
   * Open the Brains pane's add flow with the space already set.
   * @param space - the space the new brain will work in.
   */
  addBrain: (space: SpaceId) => void
  /** Open the Brains pane's provider editor, where a provider key is added. */
  addKey: () => void
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

/** The one line under the tile's name, saying what the space is for. */
const SPACE_BLURBS: Record<SpaceId, BarKey> = {
  chat: 'launcher.blurb.chat',
  terminal: 'launcher.blurb.terminal',
  gallery: 'launcher.blurb.gallery',
  soundstage: 'launcher.blurb.soundstage',
  motion: 'launcher.blurb.motion',
  studio: 'launcher.blurb.studio',
}

/**
 * The tile's count line: the only number a tile carries.
 * @param count - how many brains work in the space.
 * @param t - the card's translator.
 * @returns the rendered line.
 */
function brainCountLabel(count: number, t: HeroLauncherProps['t']): string {
  if (count === 0) return t('launcher.noBrains')
  return count === 1 ? t('launcher.brainsOne') : t('launcher.brainsMany', { count })
}

/**
 * Whether a provider key is the thing a refused space is waiting on. The
 * desktop shell is not something a key can supply, so that state offers the
 * sentence and the way back and no key action.
 */
function keyRecovers(entry: Pick<SpaceRosterEntry, 'reason' | 'keyMissing'>): boolean {
  return entry.reason === 'no-model' || (entry.reason === 'no-compatible-model' && entry.keyMissing === true)
}

/**
 * Whether a brain's row on step 2 would start the chat rather than send the
 * person to the key editor or the sign-in surface. In Terminal the brain runs
 * a CLI on its own login, so its chat route's access does not apply.
 * @param space - the space the brain is offered in.
 * @param access - the brain's access row, undefined while the map is unread.
 * @returns true when a click on the row starts the chat.
 */
function startsChat(space: SpaceId, access: BrainAccess | undefined): boolean {
  return space === 'terminal' || access?.state !== 'unavailable'
}

/**
 * The brain a tile starts on its own: the one brain of a space a model can
 * serve, when its row would start the chat. A lone brain whose route wants a
 * key or a sign-in is not returned, so step 2 renders and explains.
 * @param entry - the space the tile names.
 * @param access - the access map the card read.
 * @returns the brain, or undefined when step 2 must render.
 */
function soleReachableBrain(entry: SpaceRosterEntry, access: Readonly<Record<string, BrainAccess>>): SpaceBrain | undefined {
  const brain = entry.brains[0]
  if (entry.brainCount !== 1 || entry.models !== 'some' || brain === undefined) return undefined
  return startsChat(entry.id, access[brain.id]) ? brain : undefined
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

/** Focus the revealed composer textarea once it is in the DOM. */
function focusComposer(): void {
  window.setTimeout(() => {
    document.querySelector<HTMLTextAreaElement>('[data-composer-card] textarea')?.focus()
  }, 0)
}

/**
 * Render the welcome card body.
 * @param props - composed slot props.
 * @returns the card rows.
 */
export function HeroLauncher(props: HeroLauncherProps) {
  const {
    t, spaces, currentSession,
    projectRow, projectOpen, recentProjects, onNewProject, onFindProject,
  } = props
  const [roster, setRoster] = useState<readonly SpaceRosterEntry[]>([])
  const [access, setAccess] = useState<Readonly<Record<string, BrainAccess>>>({})
  // The chosen space is keyed to the session it was chosen for, for the same
  // reason the launch below is: a new blank chat asks its own first question,
  // rather than opening on the space the previous chat happened to pick.
  const [chosen, setChosen] = useState<{ session: string | null; space: SpaceId } | null>(null)
  // JJ: the welcome card shows no chat element until a brain launches the
  // chat. The undecided attribute hides the card's input via CSS :has.
  // The launch is keyed to the SESSION it launched, never a loose boolean:
  // a new blank chat (or a project switch, which moves to that workspace's
  // blank session) shows the chooser again by construction, and a transient
  // owner re-render during the select round-trip cannot snap a launched
  // card back to the chooser.
  const [launchedFor, setLaunchedFor] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // The brain a tile is starting on its own, while that launch is in flight.
  // Step 1 stays on screen for the round-trip; a refusal clears this and
  // step 2 takes over, so the person sees why.
  const [autoStart, setAutoStart] = useState<string | null>(null)
  const load = spaces.load
  const loadAccess = spaces.access

  // Loaded on mount and again whenever the Brains pane saves something: the
  // card's own Add-a-brain flow ends in that pane, and the card must show the
  // brain it just made rather than "No brains yet" until the next chat.
  useEffect(() => {
    let cancelled = false
    const reload = (): void => {
      void load().then((entries) => { if (!cancelled) setRoster(entries) })
      void loadAccess().then((map) => { if (!cancelled) setAccess(map) })
    }
    reload()
    const stop = onBrainsChanged(reload)
    return () => { cancelled = true; stop() }
  }, [load, loadAccess])

  const session = currentSession()
  const sessionKey = session?.id ?? null
  // Launched in this page, or launched before it: a recorded brain is the
  // durable form of the same fact. A Studio chat never reaches this: the card
  // renders nothing for one.
  const launched = (launchedFor !== null && launchedFor === sessionKey) || session?.brain !== undefined
  const entry = chosen !== null && chosen.session === sessionKey
    ? roster.find(space => space.id === chosen.space)
    : undefined

  const back = useCallback(() => { setChosen(null) }, [])

  // One launch at a time: `busy` is the guard, whether the trigger is a brain
  // row or a tile. A re-render cannot launch again, because nothing here runs
  // as an effect — a click is the only way in.
  const launch = (space: SpaceRosterEntry, brain: string): void => {
    if (busy) return
    setBusy(true)
    void spaces.enter(space.id, brain, session?.id).then((opened) => {
      setBusy(false)
      setAutoStart(null)
      if (!opened) return
      setLaunchedFor(sessionKey)
      focusComposer()
    })
  }
  const start = (brain: string): void => {
    if (entry !== undefined) launch(entry, brain)
  }
  // A tile picks the space; when one reachable brain works there, it also
  // starts it, so the person answers one question rather than two.
  const pick = (space: SpaceId): void => {
    setChosen({ session: sessionKey, space })
    const target = roster.find(row => row.id === space)
    const brain = target === undefined ? undefined : soleReachableBrain(target, access)
    if (target === undefined || brain === undefined || busy) return
    setAutoStart(brain.id)
    launch(target, brain.id)
  }

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
  // Nothing else on the card applies either: a Studio chat is launched by
  // construction, so the two steps never run.
  if (session?.space === 'studio') return null

  return (
    <div
      className={css.root}
      data-hero-undecided={launched ? undefined : ''}
      data-launcher-autostart={autoStart ?? undefined}
      onClick={stopCardTrigger}
    >
      <div className={css.projectRow}>{projectRow}</div>
      <div className={css.divider} />
      {/* A launch LANDS IN THE CHAT: the two steps retire and the card is the
          composer under the project chip. They return with the next blank
          chat (JJ, round-3 review). */}
      {!launched && (entry === undefined || autoStart !== null) && (
        <SpaceStep roster={roster} onPick={pick} t={t} />
      )}
      {!launched && entry !== undefined && autoStart === null && (
        <BrainStep entry={entry} access={access} busy={busy} onStart={start} onBack={back} spaces={spaces} t={t} />
      )}
    </div>
  )
}

/** Step 1: the five tiles, every one live. */
function SpaceStep(
  { roster, onPick, t }:
  { roster: readonly SpaceRosterEntry[]; onPick: (space: SpaceId) => void; t: HeroLauncherProps['t'] },
) {
  return (
    <div className={css.step} data-launcher-step="space">
      <div className={css.question}>
        <span className={css.questionText}>{t('launcher.whichSpace')}</span>
        <span className={css.stepMark}>{t('launcher.step1')}</span>
      </div>
      <div className={css.tiles} role="group" aria-label={t('launcher.whichSpace')}>
        {roster.map((space) => {
          return (
            <button
              key={space.id}
              type="button"
              className={css.tile}
              data-space={space.id}
              data-brain-count={space.brainCount}
              onClick={() => { onPick(space.id) }}
            >
              <span className={css.tileHead}>
                <SpaceIcon space={space.id} size={24} />
                <span className={css.tileGo}><BarIconArrowRight size={17} /></span>
              </span>
              <span className={css.tileName}>{t(SPACE_LABELS[space.id])}</span>
              <span className={css.tileBlurb}>{t(SPACE_BLURBS[space.id])}</span>
              <span className={css.tileCount} data-tile-count="">{brainCountLabel(space.brainCount, t)}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Step 2: the brains of one space, or the reason there are none to offer. */
function BrainStep(
  { entry, access, busy, onStart, onBack, spaces, t }: {
    access: Readonly<Record<string, BrainAccess>>
    entry: SpaceRosterEntry
    busy: boolean
    onStart: (brain: string) => void
    onBack: () => void
    spaces: LauncherSpaces
    t: HeroLauncherProps['t']
  },
) {
  const name = t(SPACE_LABELS[entry.id])
  // Terminal rows name the CLI they launch; the table is read once per step.
  const [launches, setLaunches] = useState<TerminalLaunches | undefined>(undefined)
  useEffect(() => {
    if (entry.id !== 'terminal') return
    let cancelled = false
    void spaces.terminalLaunches().then((table) => { if (!cancelled) setLaunches(table) })
    return () => { cancelled = true }
  }, [entry.id, spaces])
  return (
    <div className={css.step} data-launcher-step="brain" data-space={entry.id}>
      <div className={css.stepHead}>
        <button type="button" className={css.back} aria-label={t('launcher.back')} data-launcher-back="" onClick={onBack}>
          <BarIconChevronLeft size={17} />
        </button>
        <span className={css.spaceChip}><SpaceIcon space={entry.id} size={18} />{name}</span>
        <span className={css.stepMark}>{t('launcher.step2')}</span>
      </div>
      <div className={css.question}>
        <span className={css.questionText}>{t('launcher.whichBrain')}</span>
        <span className={css.questionNote} data-brain-summary="">
          {entry.brainCount === 0
            ? t('launcher.noBrains')
            : entry.brainCount === 1
              ? t('launcher.worksHereOne', { space: name })
              : t('launcher.worksHereMany', { count: entry.brainCount, space: name })}
        </span>
      </div>
      {/* A space no model can serve offers no rows: starting a chat there
          would land the user in a space that cannot answer. The refusal below
          is what step 2 shows instead — the invariant's "explains" half. */}
      {entry.brainCount > 0 && entry.models === 'some' && (
        <div className={css.brains}>
          {entry.brains.map(brain => (
            <BrainRow
              key={brain.id}
              space={entry.id}
              brain={brain}
              access={access[brain.id]}
              cli={entry.id === 'terminal' && launches !== undefined ? terminalCliOf(brain.id, launches, t) : undefined}
              busy={busy}
              onStart={onStart}
              onAddKey={spaces.addKey}
              onSignIn={spaces.signIn}
              t={t}
            />
          ))}
          <button
            type="button"
            className={css.addBrain}
            data-launcher-add-brain={entry.id}
            onClick={() => { spaces.addBrain(entry.id) }}
          >
            <BarIconPlus size={17} />
            {t('launcher.addBrain', { space: name })}
          </button>
        </div>
      )}
      {entry.brainCount === 0 && entry.models === 'some' && (
        <div className={css.empty}>
          <button
            type="button"
            className={css.addBrainPrimary}
            data-launcher-add-brain={entry.id}
            onClick={() => { spaces.addBrain(entry.id) }}
          >
            <BarIconPlus size={17} />
            <span className={css.addBrainLabel}>{t('launcher.addBrain', { space: name })}</span>
            <BarIconArrowRight size={17} />
          </button>
          <p className={css.emptyNote}>{t('launcher.addBrainNote', { space: name })}</p>
        </div>
      )}
      {entry.models === 'none' && (
        <div className={css.empty} data-launcher-refusal={entry.reason}>
          <p className={css.refusal} data-launcher-recovery="">
            {mediaRecoveryText(entry.id, entry, t)}
          </p>
          <div className={css.refusalActions}>
            {keyRecovers(entry) && (
              <button type="button" className={css.keyAction} data-launcher-add-key="" onClick={spaces.addKey}>
                <BarIconKey size={17} />
                {t('brains.media.addKey')}
              </button>
            )}
            <button type="button" className={css.backLink} data-launcher-back="" onClick={onBack}>
              <BarIconChevronLeft size={17} />
              {t('launcher.pickAnother')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * The row's second line: the brain's access when the route cannot serve it,
 * else the model it runs.
 */
function brainNote(brain: SpaceBrain, access: BrainAccess | undefined, blocked: boolean, t: HeroLauncherProps['t']): string {
  if (blocked && access !== undefined) {
    if (access.reason === 'no-model') return t('launcher.noModel')
    const provider = access.providerName ?? access.model?.provider ?? brain.model?.provider ?? ''
    return t(access.reason === 'no-sign-in' ? 'launcher.noSignIn' : 'launcher.noKey', { provider })
  }
  return brain.model === undefined ? t('launcher.brainDefaultModel') : `${brain.model.provider} · ${brain.model.model}`
}

/**
 * One brain: a button that starts the chat, with its model and the default
 * mark. A brain whose route has no key says so and opens the key editor
 * instead, and one whose route waits on a sign-in opens the sign-in surface:
 * a chat started on either would fail at its first turn. The same
 * {@link startsChat} test decides whether a tile starts a lone brain itself.
 */
function BrainRow(
  { space, brain, access, cli, busy, onStart, onAddKey, onSignIn, t }: {
    space: SpaceId
    brain: SpaceBrain
    access: BrainAccess | undefined
    /** In Terminal: the CLI this brain launches, once the launch table is read. The chat model and its key are irrelevant there. */
    cli: { label: string; installed: boolean | null } | undefined
    busy: boolean
    onStart: (brain: string) => void
    onAddKey: () => void
    onSignIn: () => void
    t: HeroLauncherProps['t']
  },
) {
  const blocked = !startsChat(space, access)
  const recover = access?.reason === 'no-sign-in' ? onSignIn : onAddKey
  const note = cli === undefined
    ? brainNote(brain, access, blocked, t)
    : cli.installed === false ? t('launcher.cliMissing', { cli: cli.label }) : cli.label
  return (
    <button
      type="button"
      className={css.brain}
      data-brain={brain.id}
      data-brain-default={brain.default === true ? '' : undefined}
      data-brain-access={blocked ? access?.reason ?? 'unavailable' : undefined}
      data-brain-cli={cli?.label}
      aria-busy={busy}
      onClick={() => { if (blocked) recover(); else onStart(brain.id) }}
    >
      <span className={css.brainName}>{brain.name}</span>
      <span className={blocked || cli?.installed === false ? css.brainBlocked : css.brainModel}>{note}</span>
      {brain.default === true && <span className={css.brainBadge}>{t('launcher.default')}</span>}
      <span className={css.brainGo}>{blocked ? <BarIconKey size={17} /> : <BarIconArrowRight size={17} />}</span>
    </button>
  )
}
