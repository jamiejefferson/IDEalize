// @vitest-environment jsdom
/**
 * The task column: it renders the chat's task list with a status glyph per
 * row, counts the finished ones in its header, folds and unfolds, and renders
 * nothing at all while the chat has no list (which is what keeps the aside
 * track at zero width).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import type { TodoItem } from '@deepseek-ai/dsh-tool-todo/client'
import { TaskColumn, TaskAside } from '../src/client/TaskColumn.tsx'
import type { TaskAsideProps } from '../src/client/TaskColumn.tsx'
import { en } from '../src/client/locales.ts'
import type { TasksKey } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: TasksKey, params?: Record<string, unknown>): string =>
  en[key].replace(/\{(\w+)\}/g, (_whole, name: string) => {
    const value = params?.[name]
    return typeof value === 'number' || typeof value === 'string' ? String(value) : ''
  })

const list: readonly TodoItem[] = [
  { content: 'Fix the sync script', status: 'completed' },
  { content: 'Fix the timesheet parser', status: 'in_progress' },
  { content: 'Tag the cron jobs', status: 'pending' },
]

describe('the task column', () => {
  it('renders one row per task, each carrying its status', () => {
    const { container } = render(<TaskColumn todos={list} t={t} />)
    const rows = container.querySelectorAll('[data-task-status]')
    expect(rows).toHaveLength(3)
    expect([...rows].map(row => row.getAttribute('data-task-status')))
      .toEqual(['completed', 'in_progress', 'pending'])
    expect(screen.getByText('Fix the timesheet parser')).toBeTruthy()
  })

  it('counts the finished tasks against the whole list in its header', () => {
    render(<TaskColumn todos={list} t={t} />)
    expect(screen.getByText('1/3')).toBeTruthy()
  })

  it('folds the list away and brings it back, keeping the header', () => {
    const { container } = render(<TaskColumn todos={list} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: 'Collapse tasks' }))
    expect(container.querySelectorAll('[data-task-status]')).toHaveLength(0)
    expect(screen.getByText('1/3')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Expand tasks' }))
    expect(container.querySelectorAll('[data-task-status]')).toHaveLength(3)
  })

  it('renders nothing while the chat has no task list, so the column takes no width', () => {
    const { container } = render(<TaskColumn todos={[]} t={t} />)
    expect(container.innerHTML).toBe('')
  })
})

/** The adapter's seat props, of which it reads only the projection and copy. */
function asideProps(projected: readonly TodoItem[] | undefined): TaskAsideProps {
  return { useProjection: () => projected, t } as unknown as TaskAsideProps
}

describe('the aside adapter', () => {
  it('reads the todos projection', () => {
    const { container } = render(<TaskAside {...asideProps(list)} />)
    expect(container.querySelectorAll('[data-task-status]')).toHaveLength(3)
  })

  it('treats an absent projection as an empty chat rather than failing', () => {
    const { container } = render(<TaskAside {...asideProps(undefined)} />)
    expect(container.innerHTML).toBe('')
  })
})
