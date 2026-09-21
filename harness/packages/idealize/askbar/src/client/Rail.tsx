/**
 * The rail: the bar body both homes render — the Studio entry, then one chip
 * per agent in a scrolling column (overflow scrolls; nothing pops out), plus
 * the hold / pending-send flow, the compact panel and the keyboard path
 * (arrows move between chips, Enter opens the panel, Escape closes or
 * discards). The home decides what the project cell and the Studio entry do
 * (`onOpenMain`) and, in the sidebar, what a chip click does (`onOpenChip`);
 * a hold reaches the panel in both homes, since its ask field posts to the
 * agent from anywhere.
 *
 * The two homes differ above the chips. The floating bar presides with its own
 * brand mark and New chat, which the sidebar column carries above the seat,
 * so the rail there starts at the Studio. Below that both homes are the same
 * column: every project's agents in the sidebar's order, one group per
 * project under a rule that carries no title (JJ, 10 Sep 2026). Hovering a
 * chip reveals its panel after `hoverRevealMs`.
 * @module @idealize/askbar/src/client/Rail
 */

import React, { useEffect, useRef, useState } from 'react'
import { BrandMark, IconNewChatOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { projectDisplayName } from '../project-name.ts'
import type { AskbarChip } from '../types.ts'
import type { AskbarView } from './askbar-store.ts'
import styles from './Askbar.module.css'
import type { Capture, CaptureError } from './capture.ts'
import { prepareSpeech, speechState, startCapture, transcribeCapture } from './capture.ts'
import { Chip } from './Chip.tsx'
import { Panel } from './Panel.tsx'
import { sendToAgent } from './send.ts'
import { speechNoticeSeen, rememberSpeechNotice } from './speech-notice.ts'

/** Where the rail renders: the floating Askbar window, or the main window's collapsed sidebar. */
export type RailHome = 'floating' | 'sidebar'

/** Rail props: the bar view, its home, the home's callbacks and the locale seat. */
export type RailProps = PropsLocale<'idealize-askbar'> & {
  /** The bar view to render (project, roster, error). */
  view: AskbarView
  /** The home; the sidebar home lays the rail out for a 36px column. */
  home: RailHome
  /**
   * What the project cell (no argument), the Studio entry plus the panel foot
   * (`'studio'`) and the bar's New chat (`'new'`) do: the floating home grows
   * back to the main window, the sidebar home expands the column or opens the
   * Studio chat in place. Only the floating home ever sends `'new'`: the
   * sidebar carries its own New-chat control above this seat.
   */
  onOpenMain: (open?: 'studio' | 'new') => void
  /** When set, a chip click (or Enter) runs this in place of opening the panel; a hold still reaches the panel. */
  onOpenChip?: ((chip: AskbarChip) => void) | undefined
  /**
   * Called whenever a panel appears or goes. The floating home makes room for
   * it in its window; the sidebar home has room already. Must be referentially
   * stable, since the rail reports through an effect.
   */
  onPanelChange?: ((showing: boolean) => void) | undefined
}

/** The still owl the Studio tile shows (served by the host half from the skin). */
export const OWL_SRC = '/idealize/askbar/owl.webp'

/** The one panel the rail shows: which chip, and whether a click locked it there. */
interface OpenPanel {
  id: string
  /** A locked panel stays while the pointer leaves; a rollover's does not. */
  locked: boolean
  /** True when a hold opened the panel, so its note explains why the words are there. */
  fromHold: boolean
  /** Text the panel opens holding. */
  draft: string
}

/** How long the pointer may be off both chip and panel before an unlocked panel closes. */
export const PANEL_LEAVE_GRACE_MS = 250

/**
 * A hold in flight. The chip it names is the destination, locked when the
 * pointer went down: the capture, the transcript and the send all go to that
 * agent even if the roster moves underneath.
 */
type Hold =
  /** First use: what the capture is and where it is processed, before the microphone opens. */
  | { phase: 'notice'; chipId: string }
  /** The model files are being fetched; the hold waits rather than recording into nothing. */
  | { phase: 'preparing'; chipId: string; percent: number }
  /** The microphone is open. */
  | { phase: 'listening'; chipId: string }
  /** The capture is with the transcription seam. */
  | { phase: 'transcribing'; chipId: string }
  /** The transcript is confident and the countdown to dispatch is running. */
  | { phase: 'pending'; chipId: string; text: string }
  /** The transcript is on its way to the agent. */
  | { phase: 'sending'; chipId: string; text: string }
  /** Nothing was sent, and this says why. */
  | { phase: 'refused'; chipId: string; message: string }

/**
 * Render the rail.
 * @param props - the view, home, callbacks and locale seat.
 * @returns the rail column.
 */
export function Rail(props: RailProps): React.JSX.Element {
  const { view, home, onOpenMain, onOpenChip, onPanelChange, t } = props
  // One panel at a time. A rollover reveals it unlocked: it follows the
  // pointer from chip to chip and closes once the pointer has left both the
  // chip and the panel. A click locks it on that chip so the person can work
  // in it; the same chip clicked again, a press outside, or Escape closes it,
  // and another chip rolled over or clicked switches it to that agent (JJ, 14
  // Sep 2026, minimode feedback 1–4).
  const [panel, setPanel] = useState<OpenPanel | null>(null)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [hold, setHold] = useState<Hold | null>(null)
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const capture = useRef<Capture | null>(null)
  // Every hold gets a number. An async step that finds the number has moved on
  // was cancelled or replaced, and drops what it was carrying.
  const run = useRef(0)

  const { project, roster } = view
  const chips = roster === null ? [] : roster.chips
  // The sidebar sits at the window's left edge, so its panel opens rightward whatever the bar's docked edge.
  const edge = home === 'sidebar' || roster === null ? 'left' : roster.config.edge
  const pendingSendMs = roster === null ? 1000 : roster.config.pendingSendMs
  const hoverRevealMs = roster === null ? 150 : roster.config.hoverRevealMs
  const compact = home === 'sidebar'
  // No speech provider composed: a hold opens the panel as a click does,
  // rather than opening a microphone nothing will transcribe.
  const speech = roster?.config.speech !== false
  // The sidebar rail asked for every project's agents; the floating bar reads
  // the one project it follows, which is one group with no rule above it.
  const groups = roster?.groups ?? (chips.length === 0 ? [] : [{ project, name: projectDisplayName(project), chips }])

  useEffect(() => () => {
    clearTimeout(pendingTimer.current)
    clearTimeout(hoverTimer.current)
    clearTimeout(leaveTimer.current)
    capture.current?.cancel()
  }, [])

  /**
   * The pointer entered a chip (after the configured delay the panel shows
   * that agent, keeping any lock) or left one (an unlocked panel closes once
   * the pointer has stayed off both chip and panel for the grace period).
   */
  const onHover = (chipId: string | null): void => {
    clearTimeout(hoverTimer.current)
    if (chipId === null) { armClose(); return }
    clearTimeout(leaveTimer.current)
    hoverTimer.current = setTimeout(() => {
      setPanel(current => current?.id === chipId ? current : { id: chipId, locked: current?.locked ?? false, fromHold: false, draft: '' })
    }, hoverRevealMs)
  }

  /** The pointer entered or left the panel itself: over it the reveal stays; off it the grace period runs. */
  const onPanelHover = (over: boolean): void => {
    clearTimeout(leaveTimer.current)
    if (!over) armClose()
  }

  /** Close an unlocked panel unless the pointer comes back within the grace period. */
  const armClose = (): void => {
    clearTimeout(leaveTimer.current)
    leaveTimer.current = setTimeout(() => {
      setPanel(current => current !== null && !current.locked ? null : current)
    }, PANEL_LEAVE_GRACE_MS)
  }

  /** A click or Enter on a chip: lock the panel on it, or close a panel already locked on it. */
  const onOpen = (chip: AskbarChip): void => {
    clearTimeout(hoverTimer.current)
    clearTimeout(leaveTimer.current)
    if (onOpenChip !== undefined) { onOpenChip(chip); return }
    setPanel(current => current?.id === chip.id && current.locked ? null : { id: chip.id, locked: true, fromHold: false, draft: '' })
  }

  // A press outside the locked panel and its chips closes it.
  useEffect(() => {
    if (panel === null || !panel.locked) return
    const onPress = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (target.closest('[data-askbar-panel], [data-chip-id]') !== null) return
      setPanel(null)
    }
    document.addEventListener('pointerdown', onPress)
    return () => { document.removeEventListener('pointerdown', onPress) }
  }, [panel])

  /** Abandon whatever the hold was doing and release the microphone. */
  const abandon = (): void => {
    run.current += 1
    clearTimeout(pendingTimer.current)
    capture.current?.cancel()
    capture.current = null
    setHold(null)
  }

  // Escape discards a hold at any phase: the recording stops, the countdown
  // stops, and nothing is delivered.
  useEffect(() => {
    if (hold === null) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      abandon()
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [hold])

  /** Deliver a transcript to the agent the hold locked onto. */
  const deliver = async (id: number, chip: AskbarChip, text: string): Promise<void> => {
    setHold({ phase: 'sending', chipId: chip.id, text })
    const sent = await sendToAgent(chip.id, text)
    if (run.current !== id) return
    run.current += 1
    setHold(null)
    // A refused send keeps the words: the panel opens holding them, so the
    // capture is never lost to a failed delivery.
    if (!sent) setPanel({ id: chip.id, locked: true, fromHold: true, draft: text })
  }

  /**
   * Wait out a first-run model fetch, then try the capture once more. Answers
   * undefined when the hold was abandoned while waiting.
   */
  const afterPreparing = async (id: number, chip: AskbarChip, samples: Float32Array) => {
    setHold({ phase: 'preparing', chipId: chip.id, percent: 0 })
    void prepareSpeech()
    for (;;) {
      await new Promise(resolve => setTimeout(resolve, 500))
      if (run.current !== id) return undefined
      const state = await speechState()
      if (run.current !== id) return undefined
      if (state === undefined) return { kind: 'refused' as const, refusal: 'failed', message: t('hold.hostGone') }
      if (state.readiness.state === 'unavailable') {
        return { kind: 'refused' as const, refusal: 'not-ready', message: state.readiness.detail }
      }
      if (state.readiness.state === 'ready') return await transcribeCapture(samples)
      setHold({ phase: 'preparing', chipId: chip.id, percent: state.readiness.percent })
    }
  }

  const onHoldStart = (chip: AskbarChip): void => {
    if (!speech) return
    const id = ++run.current
    if (!speechNoticeSeen()) {
      setHold({ phase: 'notice', chipId: chip.id })
      return
    }
    setHold({ phase: 'listening', chipId: chip.id })
    void (async () => {
      try {
        const started = await startCapture()
        // The hold may already have been released or abandoned while the
        // microphone was opening; that capture is stopped rather than kept.
        if (run.current !== id) { started.cancel(); return }
        capture.current = started
      } catch (error) {
        if (run.current !== id) return
        // `startCapture` rejects with a CaptureError and nothing else.
        setHold({ phase: 'refused', chipId: chip.id, message: (error as CaptureError).message })
      }
    })()
  }

  const onHoldEnd = (chip: AskbarChip, held: number): void => {
    if (!speech) {
      if (held > 0) onOpen(chip)
      return
    }
    const id = run.current
    const started = capture.current
    if (held <= 0 || started === null) {
      abandon()
      return
    }
    capture.current = null
    setHold({ phase: 'transcribing', chipId: chip.id })
    void (async () => {
      const samples = await started.stop().catch(() => null)
      if (run.current !== id) return
      if (samples === null) {
        setHold({ phase: 'refused', chipId: chip.id, message: t('hold.noAudio') })
        return
      }
      let outcome = await transcribeCapture(samples)
      if (run.current !== id) return
      if (outcome.kind === 'refused' && outcome.refusal === 'not-ready') {
        const retried = await afterPreparing(id, chip, samples)
        if (retried === undefined) return
        outcome = retried
      }
      if (run.current !== id) return
      if (outcome.kind === 'refused') {
        setHold({ phase: 'refused', chipId: chip.id, message: outcome.message })
        return
      }
      // Not confident means nobody has read it yet: it becomes a draft in the
      // panel rather than a message the agent receives unseen.
      if (!outcome.confident) {
        run.current += 1
        setHold(null)
        setPanel({ id: chip.id, locked: true, fromHold: true, draft: outcome.text })
        return
      }
      setHold({ phase: 'pending', chipId: chip.id, text: outcome.text })
      clearTimeout(pendingTimer.current)
      pendingTimer.current = setTimeout(() => { void deliver(id, chip, outcome.text) }, pendingSendMs)
    })()
  }

  const moveFocus = (container: HTMLElement, delta: number): void => {
    const buttons = [...container.querySelectorAll<HTMLButtonElement>('[data-chip-id]')]
    if (buttons.length === 0) return
    const active = buttons.findIndex(button => button === document.activeElement)
    const next = buttons[(active + delta + buttons.length) % buttons.length]
    next?.focus()
  }

  const everyChip = groups.flatMap(group => group.chips)
  const holdChip = hold === null ? undefined : everyChip.find(chip => chip.id === hold.chipId)
  // A hold's card takes the panel's place while it runs.
  const shown = panel === null || hold !== null ? undefined : everyChip.find(chip => chip.id === panel.id)
  const panelShowing = shown !== undefined
  useEffect(() => { onPanelChange?.(panelShowing) }, [panelShowing, onPanelChange])
  /** The project a chip belongs to: its group's, which the sidebar's order put it in. */
  const projectOf = (chip: AskbarChip): string => groups.find(group => group.chips.some(c => c.id === chip.id))?.project ?? project
  const projectName = projectDisplayName(project)

  return (
    <div
      className={styles['rail']}
      data-askbar-rail=''
      data-home={home}
      data-edge={edge}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown') { event.preventDefault(); moveFocus(event.currentTarget, 1) }
        if (event.key === 'ArrowUp') { event.preventDefault(); moveFocus(event.currentTarget, -1) }
      }}
    >
      {/* The sidebar column presides with its own logo above this seat, so the
          brand mark is the floating bar's alone. It carries no project name:
          the bar follows whichever project the window is on, and naming it
          under the logo read as a title for the whole column (JJ, 13 Sep
          2026: "theres a rogue 'airscore' title under the logo"). */}
      {!compact && (
        <button
          type='button'
          className={styles['projectCell']}
          onClick={() => { onOpenMain() }}
          aria-label={t('project.expand', { project: projectName })}
        >
          <BrandMark className={styles['projectMark']} size={58} />
        </button>
      )}
      {/* The sidebar carries its own New chat above this seat; the bar had
          none at all until JJ asked for it back (13 Sep 2026). It grows the
          window and starts the chat there, which is where a chat is typed. */}
      {!compact && (
        <button
          type='button'
          className={styles['newChat']}
          onClick={() => { onOpenMain('new') }}
          aria-label={t('newChat.label')}
        >
          <IconNewChatOutline16 size={18} />
        </button>
      )}
      <button
        type='button'
        className={styles['studio']}
        onClick={() => { onOpenMain('studio') }}
        aria-label={t(compact ? 'studio.openHere' : 'studio.open')}
      >
        <span className={styles['studioTile']}>
          <img className={styles['studioOwl']} src={OWL_SRC} alt='' draggable={false} />
        </span>
        <span className={styles['projectName']}>{t('studio.title')}</span>
      </button>
      <hr className={styles['rule']} />
      <div className={styles['chipList']} role='list' aria-label={t('agents.label')}>
        {groups.length === 0 && (
          <div className={styles['empty']}>
            {view.error !== null ? t('error.unreachable') : project === '' ? t('empty.noProject') : t('empty.noAgents')}
          </div>
        )}
        {groups.map((group, index) => (
          <React.Fragment key={group.project}>
            {/* A rule separates one project's agents from the next and carries
                no title: the column is 36px wide, and a chip's own panel names
                the project it belongs to. */}
            {index > 0 && <hr className={styles['rule']} data-group-rule='' />}
            {group.chips.map(chip => (
              <Chip
                key={chip.id}
                chip={chip}
                project={group.project}
                listening={hold?.phase === 'listening' && hold.chipId === chip.id}
                onOpen={onOpen}
                onHover={onHover}
                onHoldStart={onHoldStart}
                onHoldEnd={onHoldEnd}
                t={t}
              />
            ))}
          </React.Fragment>
        ))}
      </div>
      {view.error !== null && <div className={styles['error']}>{view.error}</div>}

      {holdChip !== undefined && hold !== null && (
        <div className={styles['panel']} data-edge={edge} data-hold-phase={hold.phase} role='status'>
          <div className={styles['holdCard']}>
            {hold.phase === 'notice' && (
              <>
                <span className={styles['holdTitle']}>{t('hold.noticeTitle')}</span>
                <span className={styles['holdHint']}>{t('hold.noticeBody')}</span>
                <button
                  type='button'
                  className={styles['holdAction']}
                  data-speech-notice-accept=''
                  onClick={() => { rememberSpeechNotice(); abandon() }}
                >
                  {t('hold.noticeAccept')}
                </button>
              </>
            )}
            {hold.phase === 'listening' && (
              <>
                <span className={styles['holdTitle']}><span className={styles['holdDot']} /> {t('hold.listening', { name: holdChip.name })}</span>
                <span className={styles['holdHint']}>{t('hold.hint')}</span>
              </>
            )}
            {hold.phase === 'transcribing' && (
              <>
                <span className={styles['holdTitle']}>{t('hold.transcribing')}</span>
                <span className={styles['holdHint']}>{t('hold.cancel')}</span>
              </>
            )}
            {hold.phase === 'preparing' && (
              <>
                <span className={styles['holdTitle']}>{t('hold.preparing', { percent: String(hold.percent) })}</span>
                <span className={styles['holdHint']}>{t('hold.preparingBody')}</span>
              </>
            )}
            {hold.phase === 'pending' && (
              <>
                <span className={styles['holdTitle']}>{t('hold.sendingTo', { name: holdChip.name })}</span>
                <span className={styles['holdTranscript']}>{hold.text}</span>
                <div className={styles['progressTrack']}>
                  <div className={styles['progressFill']} style={{ animationDuration: `${pendingSendMs}ms` }} />
                </div>
                <span className={styles['holdHint']}>{t('hold.cancel')}</span>
              </>
            )}
            {hold.phase === 'sending' && (
              <>
                <span className={styles['holdTitle']}>{t('hold.onItsWay', { name: holdChip.name })}</span>
                <span className={styles['holdTranscript']}>{hold.text}</span>
              </>
            )}
            {hold.phase === 'refused' && (
              <>
                <span className={styles['holdTitle']}>{t('hold.refused')}</span>
                <span className={styles['holdHint']}>{hold.message}</span>
                <button type='button' className={styles['holdAction']} onClick={abandon}>{t('hold.dismiss')}</button>
              </>
            )}
          </div>
        </div>
      )}

      {shown !== undefined && panel !== null && (
        <Panel
          key={shown.id}
          chip={shown}
          project={projectOf(shown)}
          edge={edge}
          fromHold={panel.fromHold}
          initialDraft={panel.draft}
          onClose={() => { setPanel(null) }}
          onExpand={() => { onOpenMain('studio') }}
          onHover={onPanelHover}
          t={t}
        />
      )}
    </div>
  )
}
