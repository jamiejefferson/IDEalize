/**
 * One agent chip: the generated portrait with the state's badge, ring and
 * motion, plus the press-and-hold gesture. The chip owns only the gesture
 * mechanics; what a hold means (pending send, panel) is the root's decision
 * through the callbacks.
 *
 * A chip captions its portrait with the agent's name and its state in words.
 * The faces are generated, so a chip captioned with its state alone named
 * nobody and the bar's agents read as unrelated to the chats in the sidebar
 * (JJ, 11 Sep 2026: "the agents in it bear no relation to the live ones").
 * Both homes are 108px wide and render this identically (JJ, 13 Sep 2026:
 * "the two bars should both be the same").
 * @module @idealize/askbar/src/client/Chip
 */

import React, { useRef } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { portraitOf } from '../portrait.ts'
import type { AskbarChip, ChipState } from '../types.ts'
import styles from './Askbar.module.css'
import type { AskbarKey } from './locales.ts'

/** The dictionary key naming each visual state. */
export const STATE_LABEL_KEYS: Record<ChipState, AskbarKey> = {
  'listening': 'state.listening',
  'working': 'state.working',
  'needs-input': 'state.needsInput',
  'wrong': 'state.wrong',
  'ready': 'state.ready',
  'idle': 'state.idle',
}

const STATE_CLASSES: Record<ChipState, string | undefined> = {
  'listening': styles['stListening'],
  'working': styles['stWorking'],
  'needs-input': styles['stNeedsInput'],
  'wrong': styles['stWrong'],
  'ready': styles['stReady'],
  'idle': styles['stIdle'],
}

/** Chip props: the roster row, the bar's locale seat, and the root's gesture callbacks. */
export type ChipProps = PropsLocale<'idealize-askbar'> & {
  /** The roster row this chip renders. */
  chip: AskbarChip
  /** The project folder, part of the portrait seed. */
  project: string
  /** The pointer entered this chip (its id) or left every chip (null); the root arms the reveal. */
  onHover?: ((chipId: string | null) => void) | undefined
  /** True while this chip's hold is capturing (renders the listening state). */
  listening: boolean
  /** Open the compact panel (click or Enter). */
  onOpen: (chip: AskbarChip) => void
  /** A hold began on this chip. */
  onHoldStart: (chip: AskbarChip) => void
  /** The hold ended; `held` is how long the pointer stayed down, in milliseconds. */
  onHoldEnd: (chip: AskbarChip, held: number) => void
}

/** A press outlasting this is a hold, not a click. */
const HOLD_THRESHOLD_MS = 250

/**
 * Render one chip.
 * @param props - the roster row, locale seat and gesture callbacks.
 * @returns the chip button.
 */
export function Chip(props: ChipProps): React.JSX.Element {
  const { chip, project, listening, onOpen, onHover, onHoldStart, onHoldEnd, t } = props
  const downAt = useRef<number | null>(null)
  const holdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const portrait = portraitOf(project, chip.name)
  const state: ChipState = listening ? 'listening' : chip.state
  const stateLabel = t(STATE_LABEL_KEYS[state])

  const release = (): void => {
    clearTimeout(holdTimer.current)
    if (downAt.current === null) return
    const held = Date.now() - downAt.current
    downAt.current = null
    if (held >= HOLD_THRESHOLD_MS) onHoldEnd(chip, held)
    else onOpen(chip)
  }

  const cancel = (): void => {
    clearTimeout(holdTimer.current)
    if (downAt.current === null) return
    downAt.current = null
    onHoldEnd(chip, 0)
  }

  return (
    <button
      type='button'
      className={[styles['chip'], STATE_CLASSES[state]].join(' ')}
      aria-label={t('chip.label', { name: chip.name, state: stateLabel })}
      data-chip-id={chip.id}
      onPointerDown={(event) => {
        event.preventDefault()
        downAt.current = Date.now()
        holdTimer.current = setTimeout(() => { onHoldStart(chip) }, HOLD_THRESHOLD_MS)
      }}
      onPointerUp={release}
      onPointerEnter={() => { onHover?.(chip.id) }}
      onPointerLeave={() => {
        onHover?.(null)
        cancel()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen(chip)
        }
      }}
    >
      <span className={styles['avatarWrap']}>
        <span
          className={styles['avatar']}
          style={{ backgroundColor: portrait.fill, borderColor: portrait.border, color: portrait.ink }}
        >
          {portrait.face}
        </span>
        {state === 'needs-input' && <span className={styles['badge']}>!</span>}
        {state === 'wrong' && <span className={styles['badge']}>×</span>}
        {(state === 'ready' || state === 'working' || state === 'idle') && <span className={styles['presenceDot']} />}
        {chip.unread > 0 && <span className={styles['unread']}>{chip.unread}</span>}
      </span>
      <span className={styles['label']}>{chip.name}</span>
      <span className={styles['stateLine']}>{stateLabel}</span>
    </button>
  )
}
