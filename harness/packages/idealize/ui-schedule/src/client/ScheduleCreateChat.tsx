/**
 * The "Schedule — Create with chat" state: describe the task in your own
 * words, a real agent session (in the task's folder) turns it into a draft
 * carried as a fenced JSON block, the draft card shows what will be created,
 * and the composer refines it. "Create task" saves the parsed draft through
 * the cron service; "Edit fields" opens the same draft in the editor.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { displayFailureMessage, toAssistantBlocks } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  AssistantBlock, ChatConversationViewNode, SessionBinding, UserMessageNode,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { AssistantChatData } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { dayName, folderName, modelLabel, parseDraft, repeatBadge, replyProse, seededMessage, stripSeed } from './schedule-model.ts'
import type { ParsedDraft, Schedule, ScheduleTranslate } from './schedule-model.ts'
import css from './ScheduleView.module.css'

/** One transcript row as the pane shows it. */
interface Row {
  key: string
  role: 'user' | 'assistant' | 'error'
  text: string
  streaming: boolean
}

function textOf(node: ChatConversationViewNode): Row | null {
  if (node.kind === 'user') {
    const data = node.data as UserMessageNode
    const text = toAssistantBlocks(data.content)
      .filter((block): block is AssistantBlock & { kind: 'text' } => block.kind === 'text')
      .map(block => block.text)
      .join('\n')
    return text === '' ? null : { key: node.key, role: 'user', text: stripSeed(text), streaming: false }
  }
  if (node.kind === 'assistant') {
    const data = node.data as AssistantChatData
    const text = data.blocks.filter((block): block is typeof block & { kind: 'text' } => block.kind === 'text').map(block => block.text).join('\n')
    return { key: node.key, role: 'assistant', text, streaming: data.status === 'running' }
  }
  if (node.kind === 'turn-error') {
    return { key: node.key, role: 'error', text: displayFailureMessage(node.data), streaming: false }
  }
  return null
}

/** The live half: rows and the latest draft from one bound session. */
interface Transcript {
  rows: Row[]
  draft: ParsedDraft | undefined
  running: boolean
}

function useTranscript(binding: SessionBinding | null, timeZone: string): Transcript {
  const [rows, setRows] = useState<Row[]>([])
  const [running, setRunning] = useState(false)
  useEffect(() => {
    if (binding === null) return
    const read = (): void => {
      const snapshot = binding.session.getSnapshot()
      const next: Row[] = []
      for (const key of snapshot.chat.order) {
        const node = snapshot.chat.nodes.get(key)
        if (node === undefined) continue
        const row = textOf(node)
        if (row !== null) next.push(row)
      }
      setRows(next)
      setRunning(snapshot.running)
    }
    read()
    return binding.session.subscribe(read)
  }, [binding])
  const draft = useMemo(() => {
    for (let index = rows.length - 1; index >= 0; index--) {
      const row = rows[index]
      if (row === undefined || row.role !== 'assistant' || row.streaming) continue
      const parsed = parseDraft(row.text, timeZone)
      if (parsed !== undefined) return parsed
    }
    return undefined
  }, [rows, timeZone])
  return { rows, draft, running }
}

/**
 * Render the Create-with-chat state.
 * @param props.cwd - the folder the task will run in (and the chat's workspace).
 * @param props.timeZone - zone for the draft's times.
 * @param props.seed - the tapped calendar slot, when the state opened from a calendar tap; seeds the model's default schedule.
 * @param props.ensureSession - session factory (index.ts).
 * @param props.onBack - return to the calendar.
 * @param props.onEditFields - open the parsed draft in the editor.
 * @param props.onCreate - save the parsed draft; resolves an error or undefined.
 * @param props.t - the schedule namespace's bound translate.
 * @returns the state's element tree.
 */
export function ScheduleCreateChat({ cwd, timeZone, seed, ensureSession, onBack, onEditFields, onCreate, t }: {
  cwd: string
  timeZone: string
  seed?: Schedule
  ensureSession: (path: string) => Promise<SessionBinding | null>
  onBack: () => void
  onEditFields: (draft: ParsedDraft) => void
  onCreate: (draft: ParsedDraft) => Promise<string | undefined>
  t: ScheduleTranslate
}) {
  const [binding, setBinding] = useState<SessionBinding | null>(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const { rows, draft, running } = useTranscript(binding, timeZone)
  const scroller = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const element = scroller.current
    if (element !== null) element.scrollTop = element.scrollHeight
  }, [rows.length, draft])

  const send = async (): Promise<void> => {
    const words = input.trim()
    if (words === '' || busy) return
    if (cwd === '') { setError(t('sched.create.pickFolder')); return }
    setBusy(true)
    setError(undefined)
    try {
      const bound = binding ?? await ensureSession(cwd)
      if (bound === null) { setError(t('sched.create.noChat')); return }
      setBinding(bound)
      const response = await bound.session.prompt([{ type: 'text', text: seededMessage(words, timeZone, cwd, seed) }], 'queue')
      if (response.ok) setInput('')
    } finally {
      setBusy(false)
    }
  }

  const create = async (): Promise<void> => {
    if (draft === undefined) return
    setBusy(true)
    try {
      const message = await onCreate(draft)
      if (message !== undefined) setError(message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={css.root} aria-label={t('sched.create.title')}>
      <header className={css.createHeader}>
        <button type="button" className={css.backButton} aria-label={t('sched.back')} onClick={onBack}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M8.5 3 4.5 7l4 4" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
        <div className={css.createHeaderText}>
          <h2 className={css.createTitle}>{t('sched.create.title')}</h2>
          <p className={css.createSubtitle}>{t('sched.create.subtitle')}</p>
        </div>
      </header>

      <div ref={scroller} className={css.conversation}>
        {rows.length === 0 && seed !== undefined && seed.kind !== 'every' && (
          <p className={css.createHint}>
            {t('sched.create.slot', {
              day: seed.kind === 'weekly' ? dayName(seed.days[0] ?? 0, t) : t('sched.repeat.daily'),
              time: seed.at,
            })}
          </p>
        )}
        {rows.length === 0 && (
          <p className={css.createHint}>
            {t('sched.create.hint', { folder: folderName(cwd) || t('sched.create.thisProject') })}
          </p>
        )}
        {rows.map((row) => {
          if (row.role === 'user') return <div key={row.key} className={css.userBubble}>{row.text}</div>
          if (row.role === 'error') return <p key={row.key} className={css.formError} role="alert">{row.text}</p>
          return (
            <div key={row.key} className={css.assistantRow}>
              <span className={css.aiMark} aria-hidden="true">AI</span>
              <div className={css.assistantText}>
                <p>{replyProse(row.text) || (row.streaming ? '…' : '')}</p>
                {!row.streaming && parseDraft(row.text, timeZone) !== undefined && (
                  <p className={css.assistantNote}>{t('sched.create.times', { zone: timeZone })}</p>
                )}
              </div>
            </div>
          )
        })}
        {draft !== undefined && (
          <div className={css.draftCard}>
            <div className={css.draftHead}>
              <div className={css.draftHeadText}>
                <span className={css.draftEyebrow}>{t('sched.create.draft')}</span>
                <span className={css.draftName}>{draft.name}</span>
              </div>
              <button type="button" className={css.linkButton} onClick={() => { onEditFields(draft) }}>{t('sched.create.edit')}</button>
            </div>
            <div className={css.draftRow}>
              <span className={css.draftLabel}>{t('sched.field.schedule')}</span>
              <span className={css.draftValue}>
                {draft.schedule.kind === 'every' ? repeatBadge(draft.schedule, t) : `${draft.schedule.at} · ${repeatBadge(draft.schedule, t)}`}
              </span>
              <span className={css.dot} aria-hidden="true" />
            </div>
            <button type="button" className={css.draftRowButton} onClick={() => { onEditFields(draft) }}>
              <span className={css.draftLabel}>{t('sched.model')}</span>
              <span className={css.draftValue}>{modelLabel({}, t)}</span>
              <span className={css.chevron} aria-hidden="true">›</span>
            </button>
            <button type="button" className={css.draftRowButton} onClick={() => { onEditFields(draft) }}>
              <span className={css.draftLabel}>{t('sched.create.deliver')}</span>
              <span className={css.draftValue}>{folderName(cwd)}</span>
              <span className={css.chevron} aria-hidden="true">›</span>
            </button>
            <div className={css.draftInstructions}>
              <span className={css.draftLabel}>{t('sched.create.instructions')}</span>
              <span className={css.draftPrompt}>{draft.prompt}</span>
            </div>
          </div>
        )}
        {error !== undefined && <p className={css.formError} role="alert">{error}</p>}
      </div>

      <div className={css.composer}>
        <div className={css.composerField}>
          <input
            className={css.composerInput}
            placeholder={draft === undefined ? t('sched.create.describe') : t('sched.create.change')}
            value={input}
            aria-label={t('sched.create.aria')}
            disabled={busy}
            onChange={(event) => { setInput(event.target.value) }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') { event.preventDefault(); void send() }
            }}
          />
          <button
            type="button"
            className={css.composerSend}
            aria-label={t('sched.create.send')}
            disabled={busy || running || input.trim() === ''}
            onClick={() => { void send() }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M7 11V3M3.5 6.5 7 3l3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
            </svg>
          </button>
        </div>
        <button
          type="button"
          className={css.primaryButtonWide}
          disabled={draft === undefined || busy}
          onClick={() => { void create() }}
        >
          {t('sched.createTask')}
        </button>
      </div>
    </section>
  )
}
