/**
 * The compact panel: the design spec's six elements — agent and project,
 * latest task, response summary, the chat's recent exchanges (JJ, 14 Sep
 * 2026: "do something useful with the large blank space"), one ask field,
 * and the way into the Studio — plus the pending-send progress strip a
 * completed hold shows. The exchanges come
 * from comm's `transcript` command and refresh while the panel is open, so an
 * ask sent from the bar shows its answer where it was asked.
 * @module @idealize/askbar/src/client/Panel
 */

import React, { useEffect, useRef, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { portraitOf } from '../portrait.ts'
import type { AskbarChip, AskbarEdge } from '../types.ts'
import styles from './Askbar.module.css'
import { stateDetailKey } from './Chip.tsx'

/** Panel props: the chip it details, the bar's locale seat, and the root's callbacks. */
export type PanelProps = PropsLocale<'idealize-askbar'> & {
  /** The chip the panel details. */
  chip: AskbarChip
  /** The project folder (identity header and portrait seed). */
  project: string
  /** The bar's docked edge; the panel opens on its inner side. */
  edge: AskbarEdge
  /** True when a hold opened the panel, so the note explains why the words are here rather than sent. */
  fromHold: boolean
  /** Text the panel opens holding: a transcript nobody has read, or one whose delivery was refused. */
  initialDraft: string
  /** Close the panel. */
  onClose: () => void
  /** Expand to the main window and open the Studio there. */
  onExpand: () => void
  /** The pointer entered (true) or left (false) the panel; a rollover's panel stays while it is over it. */
  onHover?: ((over: boolean) => void) | undefined
}

/** One question-and-answer pair as comm's `transcript` command folds it. */
export interface PanelExchange {
  /** 1-based position in the chat. */
  index: number
  /** What the person asked. */
  question: string
  /** The agent's reply so far; absent while the agent has not answered. */
  answer?: string | undefined
}

/** How many exchanges the panel shows, newest last. */
export const RECENT_EXCHANGES = 4

/** How often the open panel re-reads the transcript, so an answer lands where it was asked. */
export const RECENT_REFRESH_MS = 3000

/** Base name of a project folder, for the identity header. */
function projectLabel(project: string): string {
  const parts = project.split(/[\\/]/).filter(part => part !== '')
  return parts[parts.length - 1] ?? project
}

/**
 * Render the compact panel for one chip.
 * @param props - the chip, locale seat and callbacks.
 * @returns the panel card.
 */
export function Panel(props: PanelProps): React.JSX.Element {
  const { chip, project, edge, fromHold, initialDraft, onClose, onExpand, onHover, t } = props
  const [draft, setDraft] = useState(initialDraft)
  const [sendState, setSendState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle')
  const [recent, setRecent] = useState<readonly PanelExchange[] | undefined>(undefined)
  const [refreshTick, setRefreshTick] = useState(0)
  const field = useRef<HTMLInputElement>(null)
  const recentList = useRef<HTMLDivElement>(null)

  useEffect(() => { field.current?.focus() }, [])
  // The transcript read: once on open, again on a timer and after each send.
  // A failed read leaves the list as it was; the panel is not the place for
  // a transport error.
  useEffect(() => {
    let live = true
    const read = async (): Promise<void> => {
      try {
        const response = await fetch('/idealize/comm', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-idealize-auth': '1' },
          body: JSON.stringify({ command: 'transcript', target: chip.id, limit: RECENT_EXCHANGES }),
        })
        const result = await response.json() as { ok: boolean; exchanges?: PanelExchange[] }
        if (live && result.ok && Array.isArray(result.exchanges)) setRecent(result.exchanges)
      } catch {
        // The read is retried on the next tick; the list keeps what it had.
      }
    }
    void read()
    const timer = setInterval(() => { void read() }, RECENT_REFRESH_MS)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [chip.id, refreshTick])
  // The newest exchange is the one the person is waiting on.
  useEffect(() => {
    const list = recentList.current
    if (list !== null) list.scrollTop = list.scrollHeight
  }, [recent])
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [onClose])

  const portrait = portraitOf(project, chip.name)

  const send = async (): Promise<void> => {
    const body = draft.trim()
    if (body === '' || sendState === 'sending') return
    setSendState('sending')
    try {
      const response = await fetch('/idealize/comm', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-idealize-auth': '1' },
        body: JSON.stringify({ command: 'send', from: 'user', target: chip.id, body }),
      })
      const result = await response.json() as { ok: boolean }
      if (!result.ok) throw new Error('send refused')
      setDraft('')
      setSendState('sent')
      setRefreshTick(tick => tick + 1)
    } catch {
      setSendState('failed')
    }
  }

  const sendLabel = sendState === 'sending' ? t('panel.sending') : sendState === 'sent' ? t('panel.sent') : sendState === 'failed' ? t('panel.retry') : t('panel.send')

  return (
    <div
      className={styles['panel']}
      data-edge={edge}
      data-askbar-panel=''
      role='dialog'
      aria-label={t('panel.label', { name: chip.name })}
      onPointerEnter={() => { onHover?.(true) }}
      onPointerLeave={() => { onHover?.(false) }}
    >
      <div className={styles['panelHeader']}>
        <span
          className={styles['panelAvatar']}
          style={{ backgroundColor: portrait.fill, borderColor: portrait.border, color: portrait.ink }}
        >
          {portrait.face}
        </span>
        <span className={styles['panelIdentity']}>
          <span className={styles['panelName']}>{chip.name}</span>
          <span className={styles['panelProject']}>{t('panel.identity', { project: projectLabel(project), state: t(stateDetailKey(chip.state)) })}</span>
        </span>
      </div>
      <div className={styles['panelBody']}>
        <span className={styles['panelEyebrow']}>{t('panel.latestTask')}</span>
        <span className={styles['panelTask']}>{chip.task ?? t('panel.noTask')}</span>
        <span className={styles['panelSummary']}>{chip.status ?? t('panel.noStatus')}</span>
      </div>
      <div className={styles['panelRecent']} ref={recentList} data-askbar-recent=''>
        <span className={styles['panelEyebrow']}>{t('panel.recent')}</span>
        {recent !== undefined && recent.length === 0 && (
          <span className={styles['panelSummary']}>{t('panel.noRecent')}</span>
        )}
        {recent?.map(exchange => (
          <div key={exchange.index} className={styles['exchange']}>
            <span className={styles['exchangeQuestion']}>
              <span className={styles['exchangeWho']}>{t('panel.you')}</span>
              {exchange.question}
            </span>
            <span className={styles['exchangeAnswer']} data-pending={exchange.answer === undefined ? '' : undefined}>
              <span className={styles['exchangeWho']}>{chip.name}</span>
              {exchange.answer ?? (chip.running ? t('panel.working') : t('panel.noAnswer'))}
            </span>
          </div>
        ))}
      </div>
      {fromHold && draft !== '' && (
        <div className={styles['panelNote']}>{t('panel.checkTranscript')}</div>
      )}
      {fromHold && draft === '' && (
        <div className={styles['panelNote']}>{t('panel.nothingHeard')}</div>
      )}
      <div className={styles['askRow']}>
        <input
          ref={field}
          className={styles['askField']}
          value={draft}
          placeholder={t('panel.ask', { name: chip.name })}
          onChange={(event) => {
            setDraft(event.target.value)
            if (sendState !== 'idle') setSendState('idle')
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void send()
          }}
        />
        <button type='button' className={styles['askSend']} onClick={() => { void send() }}>
          {sendLabel}
        </button>
      </div>
      <button type='button' className={styles['panelFoot']} onClick={onExpand}>
        {t('panel.openStudio')}
      </button>
    </div>
  )
}
