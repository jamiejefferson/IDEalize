/**
 * The task column: the agent's current task list as a full-height column
 * immediately left of the tool rail.
 *
 * The list is the `todos` projection the harness already computes from
 * `todo_write` (whole-list snapshot, cleared on the next turn), so this view
 * reads it and renders nothing of its own. The composer's plan strip shows the
 * same list folded into one line; this column is the version JJ asked for on
 * 24 Aug 2026, where a chat working through several tasks shows all of them at
 * once beside the work.
 *
 * An empty list renders nothing at all, which is what keeps the column out of
 * the layout: the aside track is sized by its occupant.
 */

import { useState } from 'react'
// Type-only: the `todos` projection-key merge for useProjection, and the
// payload type the column renders.
import type { TodoItem } from '@deepseek-ai/dsh-tool-todo/client'
// Type-only: the ui-layout SlotMap merge (the shell.aside seat).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { Translate } from './locales.ts'
import css from './TaskColumn.module.css'

/** What the column renders: one chat's task list and the copy face. */
export interface TaskColumnProps {
  /** The chat's current task list; an empty list renders nothing. */
  todos: readonly TodoItem[]
  t: Translate
}

/* v8 ignore next 3 -- closed-union backstop; only reached if status is forged */
function assertNever(value: never): never {
  throw new Error(`unreachable todo status: ${String(value)}`)
}

/** Completed: a filled ring with a tick. */
function CompletedGlyph() {
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="6.4" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4 7.2 6.1 9.3 10 5.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** In-progress: a ring fading out, spun by CSS. */
function ProgressGlyph() {
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden="true" className={css.spin}>
      <circle cx="7" cy="7" r="6.4" stroke="currentColor" strokeWidth="1.2" strokeDasharray="14 6" strokeLinecap="round" />
    </svg>
  )
}

/** Pending: the unstarted dashed ring. */
function PendingGlyph() {
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="6.4" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2.4 2.4" />
    </svg>
  )
}

function StatusGlyph({ status }: { status: TodoItem['status'] }) {
  switch (status) {
    case 'completed': return <CompletedGlyph />
    case 'in_progress': return <ProgressGlyph />
    case 'pending': return <PendingGlyph />
    /* v8 ignore next -- closed TodoItem status union */
    default: return assertNever(status)
  }
}

/**
 * Render one chat's task column.
 * @param props - the task list and the copy face.
 * @returns the column, or nothing while the chat has no list.
 */
export function TaskColumn({ todos, t }: TaskColumnProps) {
  const [collapsed, setCollapsed] = useState(false)
  if (todos.length === 0) return null

  const done = todos.filter(item => item.status === 'completed').length
  return (
    <section className={css.root} data-idealize-tasks aria-label={t('column.title')}>
      <button
        type="button"
        className={css.header}
        aria-expanded={!collapsed}
        aria-label={collapsed ? t('column.expand') : t('column.collapse')}
        onClick={() => { setCollapsed(value => !value) }}
      >
        <span className={css.chevron} data-collapsed={collapsed || undefined} aria-hidden="true">
          <svg width={12} height={12} viewBox="0 0 12 12" fill="none">
            <path d="M3.5 4.5 6 7l2.5-2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className={css.title}>{t('column.title')}</span>
        <span className={css.count}>{t('column.progress', { done, total: todos.length })}</span>
      </button>
      {!collapsed && (
        <ol className={css.list}>
          {todos.map(item => (
            <li key={item.content} className={css.item} data-status={item.status} data-task-status={item.status}>
              <span className={css.glyph}><StatusGlyph status={item.status} /></span>
              <span className={css.content}>{item.content}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

/** Full props of the aside seat: the session-maybe kit plus the locale seat. */
export type TaskAsideProps = PropsRuntime<'shell.aside'> & PropsLocale<'idealize-tasks'>

/**
 * The aside adapter: reads the host-computed `todos` projection and renders
 * the column. No session, or no list, renders nothing, which leaves the aside
 * track at zero width.
 * @param props - the framework's projection reader and the copy face.
 * @returns the task column.
 */
export function TaskAside({ useProjection, t }: TaskAsideProps) {
  const todos = useProjection('todos')
  return <TaskColumn todos={todos ?? []} t={t} />
}
