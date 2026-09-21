/**
 * The Schedule view: the calendar over `@idealize/cron`'s tasks (the Day lane
 * the "calendar wires" frame leads with, and the Week grid), the task editor,
 * and Create-with-chat. Every state reads and writes the cron service
 * through its `/idealize/cron` routes; this package holds no task data of its
 * own.
 *
 * The view left the conversation view ring for the tool rail's drawer pane
 * (JJ, 26 Aug: "move them both out of the tab bar"), so it renders inside a
 * 320–720px column and caps its content at the 424px the lane geometry was
 * drawn for. The drawer unmounts a closed pane exactly as the ring unmounted
 * an inactive view, which is why the navigated day, the grain and the open
 * editor live in the plugin's store rather than component state (SCH-09).
 * Nothing persists across a relaunch: a calendar opens on today's Day lane.
 *
 * The Day lane is the frame's: a week strip picks the day, interval tasks sit
 * in an ALL DAY row, timed tasks are blocks on an hour grid (72px an hour),
 * and a block drags to another time ("Schedule — Reschedule"), snapping to
 * the quarter hour and saving through the cron routes on release. A tap on an
 * empty slot opens Create-with-chat seeded with that day and half hour.
 *
 * The pane follows the store: besides refetching on mount and after its own
 * writes, it listens to the host bridge feed (`/idealize/events/stream`) and
 * refetches on `cron-changed` (any task-list write, including an agent's
 * calendar_add) and `cron-run` (a fire, which may mark a one-off done). A
 * one-off task shows on its own day with a ONCE badge, then DONE once fired
 * (JJ, 8 Sep 2026: "Calendar action, once created, doesn't appear in the
 * calendar").
 * @module @idealize/ui-schedule/client/ScheduleView
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SessionBinding } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import { type BridgeFeedAttachment, followBridgeFeed } from '@idealize/askbar/src/client/bridge-feed.ts'
import { ScheduleEditor } from './ScheduleEditor.tsx'
import { ScheduleCreateChat } from './ScheduleCreateChat.tsx'
// Type-only: the LocaleNamespaceMap merge this view's locale seat resolves through.
import type {} from './locales.ts'
import {
  BLOCK_PX, HOUR_PX, dayName, dayShort, detailLine, laneBlocks, laneHours, localTimeZone, longDate, minutesOf,
  inMonth, monthLabel, monthOf, occursOn, repeatBadge, sameDay, snapMinutes, startOf, tappedSchedule, timeOf, weekOf, withTime,
} from './schedule-model.ts'
import type { Schedule, TaskDraft, TaskView } from './schedule-model.ts'
import type { ScheduleGrain, ScheduleMode, ScheduleViewState } from './store.ts'
import css from './ScheduleView.module.css'

/** Mutating /idealize routes require the auth marker (host route fence). */
const HEADERS = { 'x-idealize-auth': '1', 'content-type': 'application/json' }

/** Service-side face (client/index.ts): the view's own state plus the workspace and session plumbing. */
export interface ScheduleViewInjected {
  /** The view's position: a bound selector hook over the plugin's store. */
  useSchedule: SnapshotSelectorHook<ScheduleViewState>
  /** Navigate to a day (epoch milliseconds), or to today with null. */
  setDate: (dateMs: number | null) => void
  /** Open the calendar, the editor, or Create-with-chat. */
  setMode: (mode: ScheduleMode) => void
  /** Switch between the Day lane and the Week grid. */
  setGrain: (grain: ScheduleGrain) => void
  /** Registered project folders, for the SAVE TO row and the default run folder. */
  workspaces: () => { name: string; path: string }[]
  /** The current chat's working directory (the default for a new task), or undefined without one. */
  currentCwd: () => string | undefined
  /** Create/find the workspace for a path and bind a session in it (the Create-with-chat session). */
  ensureSession: (path: string) => Promise<SessionBinding | null>
}

/** Full Schedule view props: the wired face plus the locale seat. */
export type ScheduleViewProps = ScheduleViewInjected & PropsLocale<'idealize-schedule'>

/** What the task fetch has produced so far (SCH-10: loading, populated/empty, and a failure with its cause). */
type Load =
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'failed'; cause: string }

/** Default time for taps on a week column (the grid has no hour granularity). */
const DEFAULT_TAP_AT = '09:00'

/** A drag snaps to the quarter hour; a lane tap to the half hour. */
const DRAG_STEP = 15
const TAP_STEP = 30

/** Pointer travel under which a press on a block is a click, not a drag. */
const DRAG_SLOP_PX = 4

/** The feed kinds that mean the task list may read differently. */
const REFETCH_KINDS = new Set(['cron-changed', 'cron-run'])

/** A block drag in progress: which task, where the pointer started, how far it has moved. */
interface Drag {
  id: string
  startY: number
  dy: number
}

async function readTasks(): Promise<TaskView[]> {
  const response = await fetch('/idealize/cron/tasks')
  if (!response.ok) throw new Error(`tasks ${String(response.status)}`)
  return await response.json() as TaskView[]
}

/**
 * Save (create or update) one task through the cron service.
 * @param draft - the task to persist.
 * @returns the saved task, or an error message.
 */
export async function saveTask(draft: TaskDraft): Promise<{ ok: true; task: TaskView } | { ok: false; error: string }> {
  const response = await fetch('/idealize/cron/tasks', { method: 'POST', headers: HEADERS, body: JSON.stringify(draft) })
  const body = await response.json() as TaskView | { error: string }
  if (!response.ok || 'error' in body) return { ok: false, error: 'error' in body ? body.error : `save ${String(response.status)}` }
  return { ok: true, task: body }
}

async function deleteTask(id: string): Promise<void> {
  await fetch(`/idealize/cron/delete?id=${encodeURIComponent(id)}`, { method: 'POST', headers: HEADERS })
}

function toDraft(task: TaskView): TaskDraft {
  return {
    id: task.id,
    name: task.name,
    schedule: task.schedule,
    prompt: task.prompt,
    cwd: task.cwd,
    ...task.provider !== undefined ? { provider: task.provider } : {},
    ...task.model !== undefined ? { model: task.model } : {},
    ...task.remind === true ? { remind: true } : {},
    ...task.done !== undefined ? { done: task.done } : {},
    enabled: task.enabled,
  }
}

/** The badge on a task item: DONE for a fired one-off, else its repeat rule. */
function badgeOf(task: TaskView, t: ScheduleViewProps['t']): string {
  return task.done === undefined ? repeatBadge(task.schedule, t) : t('sched.badge.done')
}

/**
 * Render the Schedule view.
 * @param props - the wired face and `t`.
 * @returns the view's element tree.
 */
export function ScheduleView(props: ScheduleViewProps) {
  const { useSchedule, setDate, setMode, setGrain, workspaces, currentCwd, ensureSession, t } = props
  const dateMs = useSchedule(state => state.dateMs)
  const grain = useSchedule(state => state.grain)
  const mode = useSchedule(state => state.mode)
  const [tasks, setTasks] = useState<TaskView[]>([])
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [drag, setDrag] = useState<Drag | null>(null)
  const [moved, setMoved] = useState<string | undefined>(undefined)
  // Set when a press travelled past the slop, so the click that follows the release does not open the editor.
  const dragged = useRef(false)
  const lane = useRef<HTMLDivElement>(null)

  const refresh = useCallback(async () => {
    try {
      setTasks(await readTasks())
      setLoad({ status: 'ready' })
    } catch (error) {
      setLoad({ status: 'failed', cause: error instanceof Error ? error.message : String(error) })
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  // The store has two writers (this pane and every agent's calendar tools),
  // so the pane follows the host bridge feed and refetches on each change.
  // Only events after attach count; the mount fetch already covers the past.
  useEffect(() => {
    let feed: BridgeFeedAttachment | undefined
    let closed = false
    const attach = async (): Promise<void> => {
      // The window's one feed connection (`@idealize/askbar`'s bridge-feed);
      // without the bridge, mount and own writes are the only refreshes.
      const attachment = await followBridgeFeed((event) => {
        if (event.kind !== undefined && REFETCH_KINDS.has(event.kind)) void refresh()
      })
      if (attachment === undefined) return
      if (closed) { attachment.close(); return }
      feed = attachment
    }
    void attach()
    return () => {
      closed = true
      feed?.close()
    }
  }, [refresh])

  const today = new Date()
  // `null` is today read at mount, so an app left open overnight still opens
  // the calendar on the current day rather than the day the store was made.
  const date = useMemo(() => new Date(dateMs ?? Date.now()), [dateMs])
  const week = useMemo(() => weekOf(date), [date])
  // The soonest enabled fire is the highlighted (accent) item.
  const nextId = useMemo(() => {
    const enabled = tasks.filter(task => task.enabled && task.nextFireAt !== undefined)
    enabled.sort((a, b) => (a.nextFireAt ?? '').localeCompare(b.nextFireAt ?? ''))
    return enabled[0]?.id
  }, [tasks])

  const step = (direction: -1 | 1): void => {
    const next = new Date(date)
    if (grain === 'month') next.setMonth(date.getMonth() + direction, 1)
    else next.setDate(date.getDate() + (grain === 'day' ? 1 : 7) * direction)
    setDate(next.getTime())
  }

  const month = useMemo(() => monthOf(date), [date])
  // How many tasks fall on each day of the shown month, so the grid says
  // where the work is without repeating the week grid's list of it.
  const monthCounts = useMemo(
    () => month.map(day => tasks.filter(task => occursOn(task.schedule, day)).length),
    [month, tasks],
  )

  // The lane opens scrolled to its first block, or to 08:00 when the day is empty.
  const dayTasks = useMemo(() => tasks.filter(task => occursOn(task.schedule, date)), [tasks, date])
  const allDay = useMemo(() => dayTasks.filter(task => task.schedule.kind === 'every'), [dayTasks])
  const hours = useMemo(
    () => laneHours(dayTasks.filter(task => task.schedule.kind !== 'every').map(task => minutesOf(startOf(task.schedule)))),
    [dayTasks],
  )
  const blocks = useMemo(() => laneBlocks(dayTasks, hours.start), [dayTasks, hours.start])
  useEffect(() => {
    const el = lane.current
    if (el === null || grain !== 'day') return
    const first = blocks[0]?.top ?? (8 - hours.start) * HOUR_PX
    el.scrollTop = Math.max(0, first - 8)
  }, [grain, dateMs, load.status, blocks, hours.start])

  /** Release of a drag: snap the new start to the quarter hour and save it through the cron routes. */
  const reschedule = async (task: TaskView, dy: number): Promise<void> => {
    if (task.schedule.kind === 'every' || task.done !== undefined) return
    const minutes = snapMinutes(minutesOf(startOf(task.schedule)) + (dy / HOUR_PX) * 60, DRAG_STEP)
    const at = timeOf(minutes)
    if (at === startOf(task.schedule)) return
    const result = await saveTask({ ...toDraft(task), schedule: withTime(task.schedule, at) })
    if (result.ok) {
      setMoved(t('sched.moved', { name: task.name, time: at }))
      await refresh()
    } else {
      setLoad({ status: 'failed', cause: result.error })
    }
  }

  const openEditor = (task: TaskView): void => {
    setMode({ kind: 'edit', draft: toDraft(task), ...task.nextFireAt !== undefined ? { nextFireAt: task.nextFireAt } : {} })
  }

  const newDraft = (schedule?: Schedule): TaskDraft => ({
    name: '',
    schedule: schedule ?? { kind: 'weekly', at: '09:00', timeZone: localTimeZone(), days: [1, 2, 3, 4, 5] },
    prompt: '',
    cwd: currentCwd() ?? workspaces()[0]?.path ?? '',
    enabled: true,
  })

  /**
   * A tap on an empty week column: the Create-with-chat state seeded with
   * that day (JJ round 3 — the editor stays reachable from the draft card's
   * Edit fields).
   */
  const openCreateAt = (day: Date, at: string): void => {
    setMode({ kind: 'create', schedule: tappedSchedule(day, at, localTimeZone()) })
  }

  // ── Editor + create ────────────────────────────────────────────────────
  if (mode.kind === 'edit') {
    return (
      <ScheduleEditor
        t={t}
        draft={mode.draft}
        nextFireAt={mode.nextFireAt}
        workspaces={workspaces()}
        onBack={() => { setMode({ kind: 'calendar' }) }}
        onSave={async (draft) => {
          const result = await saveTask(draft)
          if (!result.ok) return result.error
          await refresh()
          setMode({ kind: 'calendar' })
          return undefined
        }}
        onDelete={mode.draft.id === undefined ? undefined : async () => {
          await deleteTask(mode.draft.id ?? '')
          await refresh()
          setMode({ kind: 'calendar' })
        }}
      />
    )
  }

  if (mode.kind === 'create') {
    const base = newDraft(mode.schedule)
    return (
      <ScheduleCreateChat
        t={t}
        {...mode.schedule === undefined ? {} : { seed: mode.schedule }}
        cwd={base.cwd}
        timeZone={localTimeZone()}
        ensureSession={ensureSession}
        onBack={() => { setMode({ kind: 'calendar' }) }}
        onEditFields={(parsed) => {
          setMode({ kind: 'edit', draft: { ...base, ...parsed } })
        }}
        onCreate={async (parsed) => {
          const result = await saveTask({ ...base, ...parsed })
          if (!result.ok) return result.error
          await refresh()
          setMode({ kind: 'calendar' })
          return undefined
        }}
      />
    )
  }

  // ── Calendar ───────────────────────────────────────────────────────────
  const dateLocale = t('sched.dateLocale')
  const dragging = drag !== null && Math.abs(drag.dy) > DRAG_SLOP_PX

  const grainButton = (target: ScheduleGrain, label: string) => (
    <button
      type="button"
      role="tab"
      className={css.grainTab}
      aria-selected={grain === target}
      data-active={grain === target ? '' : undefined}
      onClick={() => { setGrain(target) }}
    >
      {label}
    </button>
  )

  const toneOf = (task: TaskView): 'done' | 'paused' | 'next' | 'plain' =>
    task.done !== undefined ? 'done' : !task.enabled ? 'paused' : task.id === nextId ? 'next' : 'plain'

  const taskBlock = (task: TaskView, top: number, column: number) => {
    const offset = drag?.id === task.id && dragging ? drag.dy : 0
    return (
      <button
        key={task.id}
        type="button"
        className={css.block}
        data-schedule-task={task.id}
        data-tone={toneOf(task)}
        data-dragging={drag?.id === task.id && dragging ? '' : undefined}
        aria-label={t('sched.lane.block', { name: task.name, time: task.schedule.kind === 'every' ? '' : startOf(task.schedule) })}
        style={{ top: `${String(top + offset + 2)}px`, height: `${String(BLOCK_PX)}px`, left: `${String(8 + column * 90)}px`, right: '8px' }}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          dragged.current = false
          setDrag({ id: task.id, startY: event.clientY, dy: 0 })
          if (typeof event.currentTarget.setPointerCapture === 'function') event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          if (drag === null || drag.id !== task.id) return
          const dy = event.clientY - drag.startY
          if (Math.abs(dy) > DRAG_SLOP_PX) dragged.current = true
          setDrag({ ...drag, dy })
        }}
        onPointerUp={() => {
          if (drag === null || drag.id !== task.id) return
          setDrag(null)
          if (dragged.current) void reschedule(task, drag.dy)
        }}
        onPointerCancel={() => { setDrag(null); dragged.current = false }}
        onClick={() => {
          if (dragged.current) { dragged.current = false; return }
          openEditor(task)
        }}
      >
        <span className={css.blockHead}>
          <span className={css.blockName}>{task.name}</span>
          <span className={css.blockBadge}>{badgeOf(task, t)}</span>
        </span>
        <span className={css.blockDetail}>{detailLine(task, t)}</span>
      </button>
    )
  }

  return (
    <section className={css.root} aria-label={t('sched.title')} data-schedule-view="" data-schedule-grain={grain}>
      <header className={css.header}>
        <div className={css.headerText}>
          <h2 className={css.title}>{t('sched.title')}</h2>
          <p className={css.subtitle}>{dragging ? t('sched.subtitle.drag') : t('sched.subtitle')}</p>
        </div>
        <div className={css.headerActions}>
          <button type="button" className={css.squareButton} aria-label={t('sched.new')} onClick={() => { setMode({ kind: 'create' }) }}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
            </svg>
          </button>
        </div>
      </header>

      <div className={css.switcher}>
        <div className={css.grainTabs} role="tablist" aria-label={t('sched.view.aria')}>
          {grainButton('day', t('sched.view.day'))}
          {grainButton('week', t('sched.view.week'))}
          {grainButton('month', t('sched.view.month'))}
        </div>
        <button type="button" className={css.todayButton} onClick={() => { setDate(null) }}>{t('sched.today')}</button>
      </div>

      <div className={css.navigator}>
        <div className={css.navigatorRow}>
          <span className={css.navigatorDate}>
            {grain === 'month' ? monthLabel(date, dateLocale) : longDate(date, dateLocale)}
          </span>
          <div className={css.navigatorArrows}>
            <button type="button" className={css.arrow} aria-label={t('sched.prev')} onClick={() => { step(-1) }}>
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                <path d="M7.5 2.5 4 6l3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
              </svg>
            </button>
            <button type="button" className={css.arrow} aria-label={t('sched.next')} onClick={() => { step(1) }}>
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                <path d="M4.5 2.5 8 6 4.5 9.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
              </svg>
            </button>
          </div>
        </div>
        {/* The month grid is its own day picker; a second one above it would
            say the same thing twice. */}
        {grain !== 'month' && <div className={css.weekStrip}>
          {week.map(day => (
            <button
              key={day.toDateString()}
              type="button"
              className={css.weekDay}
              data-selected={sameDay(day, date) ? '' : undefined}
              data-today={sameDay(day, today) ? '' : undefined}
              data-weekend={day.getDay() === 0 || day.getDay() === 6 ? '' : undefined}
              aria-pressed={sameDay(day, date)}
              onClick={() => { setDate(day.getTime()) }}
            >
              <span className={css.weekDayName}>{dayShort(day.getDay(), t)}</span>
              <span className={css.weekDayNumber}>{day.getDate()}</span>
            </button>
          ))}
        </div>}
      </div>

      {load.status === 'loading' && <p className={css.notice} data-schedule-loading="">{t('sched.loading')}</p>}

      {load.status === 'failed' && (
        <div className={css.failure} data-schedule-error="" role="alert">
          <p className={css.notice}>{t('sched.error')}</p>
          <p className={css.noticeCause}>{t('sched.error.cause', { cause: load.cause })}</p>
          <button
            type="button"
            className={css.retryButton}
            onClick={() => { setLoad({ status: 'loading' }); void refresh() }}
          >
            {t('sched.retry')}
          </button>
        </div>
      )}

      {moved !== undefined && <p className={css.moved} role="status">{moved}</p>}

      {grain === 'day' && (
        <>
          {allDay.length > 0 && (
            <div className={css.allDay} data-schedule-allday="">
              <span className={css.allDayLabel}>{t('sched.allDay')}</span>
              <div className={css.allDayItems}>
                {allDay.map(task => (
                  <button
                    key={task.id}
                    type="button"
                    className={css.allDayItem}
                    data-schedule-task={task.id}
                    data-tone={toneOf(task)}
                    onClick={() => { openEditor(task) }}
                  >
                    <span className={css.blockName}>{task.name}</span>
                    <span className={css.blockBadge}>{badgeOf(task, t)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className={css.timeGrid} ref={lane} data-schedule-lane="">
            <div className={css.timeLabels} aria-hidden="true">
              {Array.from({ length: hours.end - hours.start + 1 }, (_, index) => (
                <span key={index} className={css.timeLabel} style={{ top: `${String(index * HOUR_PX)}px` }}>
                  {timeOf((hours.start + index) * 60)}
                </span>
              ))}
            </div>
            <div
              className={css.lane}
              role="group"
              aria-label={t('sched.lane.aria', { day: dayName(date.getDay(), t) })}
              style={{ height: `${String((hours.end - hours.start) * HOUR_PX + 1)}px` }}
              onClick={(event) => {
                // Only the lane's own surface: block clicks open that task's editor instead.
                if (event.target !== event.currentTarget) return
                const y = event.clientY - event.currentTarget.getBoundingClientRect().top
                const minutes = snapMinutes(hours.start * 60 + (y / HOUR_PX) * 60, TAP_STEP)
                openCreateAt(date, timeOf(minutes))
              }}
            >
              {Array.from({ length: hours.end - hours.start }, (_, index) => (
                <span key={index} className={css.hourRule} style={{ top: `${String(index * HOUR_PX)}px` }} aria-hidden="true" />
              ))}
              {blocks.map(block => taskBlock(block.task, block.top, block.column))}
            </div>
          </div>
        </>
      )}

      {grain === 'week' && (
        <div className={css.weekGrid}>
          {week.map((day) => {
            const items = tasks.filter(task => occursOn(task.schedule, day))
            return (
              <div
                key={day.toDateString()}
                className={css.weekColumn}
                data-today={sameDay(day, today) ? '' : undefined}
                onClick={(event) => {
                  // Only the column's own surface: item clicks open that task's editor instead.
                  if (event.target === event.currentTarget) openCreateAt(day, DEFAULT_TAP_AT)
                }}
              >
                {items.length === 0 && load.status !== 'loading' && <span className={css.weekEmpty}>—</span>}
                {items.map(task => (
                  <button
                    key={task.id}
                    type="button"
                    className={css.weekItem}
                    data-schedule-task={task.id}
                    data-tone={toneOf(task)}
                    title={`${task.name} · ${badgeOf(task, t)}`}
                    onClick={() => { openEditor(task) }}
                  >
                    <span className={css.weekItemTime}>{task.schedule.kind === 'every' ? t('sched.badge.allDay') : startOf(task.schedule)}</span>
                    <span className={css.weekItemName}>{task.name}</span>
                  </button>
                ))}
              </div>
            )
          })}
        </div>
      )}

      {grain === 'month' && (
        <div
          className={css.monthGrid}
          role="grid"
          aria-label={t('sched.month.aria', { month: monthLabel(date, dateLocale) })}
          data-schedule-month=""
        >
          {week.map(day => (
            <span key={`head-${String(day.getDay())}`} className={css.monthHead} aria-hidden="true">
              {dayShort(day.getDay(), t)}
            </span>
          ))}
          {month.map((day, index) => {
            const count = monthCounts[index] ?? 0
            return (
              <button
                key={day.toDateString()}
                type="button"
                role="gridcell"
                className={css.monthCell}
                data-schedule-day={day.toDateString()}
                data-outside={inMonth(day, date) ? undefined : ''}
                data-selected={sameDay(day, date) ? '' : undefined}
                data-today={sameDay(day, today) ? '' : undefined}
                aria-label={`${longDate(day, dateLocale)}, ${count === 0 ? t('sched.month.none') : t('sched.month.tasks', { count })}`}
                // The month's whole job: land on a day. The Day lane is where
                // that day's work is read and changed.
                onClick={() => { setDate(day.getTime()); setGrain('day') }}
              >
                <span className={css.monthNumber}>{day.getDate()}</span>
                {/* A dot, not the number: with a daily task every cell reads
                    the same count, and the month is for picking a day. The
                    number stays on the label and the attribute. */}
                {count > 0 && <span className={css.monthDot} data-schedule-count={String(count)} aria-hidden="true" />}
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}
