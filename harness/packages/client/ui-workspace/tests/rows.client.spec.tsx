// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react'
import type { SessionId, WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { RowDragProps } from '../src/client/rows/Rows.tsx'
import { ProjectRowItem, SearchResultItem, SessionNodeItem } from '../src/client/rows/Rows.tsx'
import type { GroupNode, SearchResultNode, SessionNode } from '../src/client/tree.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

// Standard locale seat stub mirroring the real ns → common → key chain (zh default).
const t = makeTranslate(zh, commonZh) as never

const sid = (id: string) => id as SessionId
const wid = (id: string) => id as WorkspaceId

/** Half detection reads the row rect; jsdom rects are all-zero by default. */
function stubRect(row: HTMLElement): void {
  row.getBoundingClientRect = () => ({
    top: 100, bottom: 134, left: 0, right: 200, width: 200, height: 34,
    x: 0, y: 100, toJSON: () => ({}),
  })
}

function dragProps(overrides: Partial<RowDragProps> = {}): RowDragProps {
  return {
    start: vi.fn(), active: false, marker: null,
    hover: vi.fn(), drop: vi.fn(), end: vi.fn(),
    ...overrides,
  }
}

/** Install the async browser clipboard and restore its prior host shape. */
function installClipboard(writeText: (text: string) => Promise<void>): () => void {
  const prior = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  })
  return () => {
    if (prior === undefined) Reflect.deleteProperty(navigator, 'clipboard')
    else Object.defineProperty(navigator, 'clipboard', prior)
  }
}

const dataTransfer = { effectAllowed: '', dropEffect: '', setData: vi.fn() }

/** jsdom lacks DragEvent — the fireEvent fallback drops clientY, so pin it on the built event. */
function fireDrag(row: HTMLElement, kind: 'dragOver' | 'drop', clientY: number): void {
  const event = kind === 'dragOver' ? createEvent.dragOver(row) : createEvent.drop(row)
  Object.defineProperty(event, 'clientY', { value: clientY })
  Object.defineProperty(event, 'dataTransfer', { value: { ...dataTransfer } })
  fireEvent(row, event)
}

describe('workspace browser rows', () => {
  it('omits only an empty leading status slot in the hierarchy-free flat list', () => {
    const idle: SessionNode = {
      space: 'chat',
      id: sid('flat'), title: 'Flat Session', blank: false, shellOnly: false, running: false,
      runningSubagentCount: 0, completed: false, updatedAt: 0,
    }
    const view = render(<SessionNodeItem node={idle} currentId={undefined} now={0} onOpen={vi.fn()}
      onRename={vi.fn()} onFork={vi.fn()} onArchive={vi.fn()} flat t={t} />)
    const title = screen.getByText('Flat Session')
    // The space lane leads every row; the status slot is what a flat idle row drops.
    expect(title.previousElementSibling?.getAttribute('data-space')).toBe('chat')

    view.rerender(<SessionNodeItem node={{ ...idle, running: true }} currentId={undefined} now={0}
      onOpen={vi.fn()} onRename={vi.fn()} onFork={vi.fn()} onArchive={vi.fn()} flat t={t} />)
    expect(screen.getByText('Flat Session').previousElementSibling?.querySelector('[data-state="ongoing"]')).toBeTruthy()
  })

  it('renders a selected content-search row and opens only its session', () => {
    const onOpen = vi.fn()
    const result: SearchResultNode = {
      id: sid('result'),
      title: 'Result title',
      workspace: 'Workspace context',
      running: true,
      runningSubagentCount: 0,
      completed: false,
      snippet: 'matching message excerpt',
    }
    render(<SearchResultItem result={result} currentId={result.id} onOpen={onOpen} t={t} />)
    const row = screen.getByRole('treeitem')
    expect(row.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('Workspace context')).toBeTruthy()
    expect(screen.getByText('matching message excerpt')).toBeTruthy()
    expect(row.querySelector('[data-state="ongoing"]')).toBeTruthy()
    expect(screen.getByText('进行中')).toBeTruthy()
    expect(row.hasAttribute('draggable')).toBe(false)
    fireEvent.click(row)
    expect(onOpen).toHaveBeenCalledWith(result.id)
  })

  it.each([
    ['approval', '等待审批'],
    ['plan-review', '计划待审'],
    ['question', '等待回答'],
  ] as const)('shows %s ahead of running in search results', (pendingInteraction, label) => {
    const result: SearchResultNode = {
      id: sid(pendingInteraction), title: 'Needs input', workspace: 'Project',
      pendingInteraction, running: true, runningSubagentCount: 0, completed: false,
    }
    render(<SearchResultItem result={result} currentId={undefined} onOpen={vi.fn()} t={t} />)
    const row = screen.getByRole('treeitem')
    expect(row.querySelector('[data-state="warning"]')).toBeTruthy()
    expect(row.querySelector('[data-state="ongoing"]')).toBeNull()
    expect(screen.getByText(label)).toBeTruthy()
  })

  it('renders an active Workspace and keeps its create action separate from toggling', () => {
    const onToggle = vi.fn()
    const onCreate = vi.fn()
    const group: GroupNode = {
      key: 'project', workspaceId: wid('project'), cwd: '/projects/project', createdAt: 0, label: 'Project',
      sessionCount: 1, expanded: true, containsCurrent: true, sessions: [],
    }
    render(<ProjectRowItem group={group} onToggle={onToggle} onCreate={onCreate} t={t} />)

    expect(screen.getByRole('treeitem').getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '在“Project”中新建会话' }))
    expect(onCreate).toHaveBeenCalledOnce()
    expect(onToggle).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Project'))
    expect(onToggle).toHaveBeenCalledOnce()
  })

  it('renders and opens a selected running Session row', () => {
    const node: SessionNode = {
      space: 'chat',
      id: sid('session'), title: 'Session', blank: false, shellOnly: false, running: true,
      runningSubagentCount: 0, completed: false, updatedAt: 0,
    }
    const onOpen = vi.fn()
    render(
      <SessionNodeItem node={node} currentId={node.id} now={0} onOpen={onOpen}
        onRename={vi.fn()} onFork={vi.fn()} onArchive={vi.fn()} t={t} />,
    )

    const row = screen.getByRole('treeitem')
    expect(row.getAttribute('aria-selected')).toBe('true')
    expect(row.hasAttribute('aria-expanded')).toBe(false)
    expect(screen.queryByRole('button', { name: /展开|收起/ })).toBeNull()
    fireEvent.click(row)
    expect(onOpen).toHaveBeenCalledWith(node.id)
  })

  it('shows the green done dot only on a finished, unviewed session (live activity wins the slot)', () => {
    const renderRow = (over: Partial<SessionNode>) => render(
      <SessionNodeItem
        node={{
          space: 'chat',
          id: sid('s1'), title: 'One', blank: false, shellOnly: false, running: false,
          runningSubagentCount: 0, completed: false, updatedAt: 0, ...over,
        }}
        currentId={undefined} now={0} onOpen={vi.fn()}
        onRename={vi.fn()} onFork={vi.fn()} onArchive={vi.fn()} t={t}
      />,
    )
    const stateDot = (view: ReturnType<typeof renderRow>) =>
      view.container.querySelector('[data-state]')
    // No completion reminder, not running: no state dot at all.
    const plain = renderRow({})
    expect(stateDot(plain)).toBeNull()
    plain.unmount()
    // Completed while unviewed: the green done dot.
    const done = renderRow({ completed: true })
    expect(done.container.querySelector('[data-state="done"]')).not.toBeNull()
    done.unmount()
    // Running wins the slot: the animated ongoing dot, no done dot.
    const running = renderRow({ completed: true, running: true })
    expect(running.container.querySelector('[data-state="ongoing"]')).not.toBeNull()
    expect(running.container.querySelector('[data-state="done"]')).toBeNull()
    running.unmount()
    // Descendant activity also wins until the last running descendant stops.
    const delegated = renderRow({ completed: true, runningSubagentCount: 1 })
    expect(delegated.container.querySelector('[data-state="ongoing"]')).not.toBeNull()
    expect(delegated.container.querySelector('[data-state="done"]')).toBeNull()
  })

  it('shows descendant activity without describing an idle parent as running', () => {
    vi.useFakeTimers()
    try {
      const node: SessionNode = {
        space: 'chat',
        id: sid('owner'), title: 'Delegating', blank: false, shellOnly: false, running: false,
        runningSubagentCount: 2, completed: false, updatedAt: 0,
      }
      render(<SessionNodeItem node={node} currentId={undefined} now={0} onOpen={vi.fn()}
        onRename={vi.fn()} onFork={vi.fn()} onArchive={vi.fn()} t={t} />)
      const row = screen.getByRole('treeitem')
      expect(row.querySelector('[data-state="ongoing"]')).not.toBeNull()
      expect(screen.getByText('2 个子代理运行中')).toBeTruthy()
      expect(screen.queryByText('进行中')).toBeNull()

      fireEvent.pointerEnter(row.parentElement as HTMLElement)
      act(() => { vi.advanceTimersByTime(500) })
      expect(screen.getAllByText('2 个子代理运行中')).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps descendant activity secondary while the parent is running', () => {
    vi.useFakeTimers()
    try {
      const node: SessionNode = {
        space: 'chat',
        id: sid('owner'), title: 'Delegating', blank: false, shellOnly: false, running: true,
        runningSubagentCount: 1, completed: false, updatedAt: 0,
      }
      render(<SessionNodeItem node={node} currentId={undefined} now={0} onOpen={vi.fn()}
        onRename={vi.fn()} onFork={vi.fn()} onArchive={vi.fn()} t={t} />)
      const row = screen.getByRole('treeitem')
      expect(row.querySelectorAll('[data-state="ongoing"]')).toHaveLength(1)
      expect(screen.getByText('进行中')).toBeTruthy()
      expect(screen.getByText('1 个子代理运行中')).toBeTruthy()

      fireEvent.pointerEnter(row.parentElement as HTMLElement)
      act(() => { vi.advanceTimersByTime(500) })
      expect(screen.getAllByText('进行中')).toHaveLength(2)
      expect(screen.getAllByText('1 个子代理运行中')).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps child activity as a secondary status while user attention is primary', () => {
    const node: SessionNode = {
      space: 'chat',
      id: sid('owner'), title: 'Needs input', blank: false, shellOnly: false, pendingInteraction: 'question',
      running: false, runningSubagentCount: 1, completed: false, updatedAt: 0,
    }
    render(<SessionNodeItem node={node} currentId={undefined} now={0} onOpen={vi.fn()}
      onRename={vi.fn()} onFork={vi.fn()} onArchive={vi.fn()} t={t} />)
    const row = screen.getByRole('treeitem')
    expect(row.querySelector('[data-state="warning"]')).not.toBeNull()
    expect(row.querySelector('[data-state="ongoing"]')).toBeNull()
    expect(screen.getByText('等待回答')).toBeTruthy()
    expect(screen.getByText('1 个子代理运行中')).toBeTruthy()
  })

  it('shows the green done dot on a finished search result row', () => {
    render(<SearchResultItem
      result={{
        id: sid('result'), title: 'Done', workspace: 'Workspace', running: false,
        runningSubagentCount: 0, completed: true,
      }}
      currentId={undefined} onOpen={vi.fn()} t={t}
    />)
    expect(screen.getByRole('treeitem').querySelector('[data-state="done"]')).not.toBeNull()
  })

  it('workspace row menu opens on the ellipsis, renames, and shows the remove row', () => {
    const onRename = vi.fn()
    const onDelete = vi.fn()
    const onToggle = vi.fn()
    const group: GroupNode = {
      key: 'project', workspaceId: wid('project'), cwd: '/projects/project', createdAt: 0, label: 'Project',
      sessionCount: 0, expanded: false, containsCurrent: false, sessions: [],
    }
    render(<ProjectRowItem
      group={group} onToggle={onToggle} onCreate={vi.fn()}
      actions={{ rename: onRename, delete: onDelete }} t={t}
    />)
    fireEvent.click(screen.getByRole('button', { name: '工作区“Project”的操作' }))
    // Opening the menu neither toggles the group nor renames yet.
    expect(onToggle).not.toHaveBeenCalled()
    // Remove is not destructive (the folder and chat logs remain): no danger styling.
    expect(screen.getByRole('menuitem', { name: '移除工作区' }).className).not.toMatch(/danger/)
    fireEvent.click(screen.getByRole('menuitem', { name: '重命名' }))
    expect(onRename).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '工作区“Project”的操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '移除工作区' }))
    expect(screen.queryByRole('menu')).toBeNull()
    expect(onRename).toHaveBeenCalledOnce()
    expect(onDelete).toHaveBeenCalledOnce()
    // Escape closes without selecting (Menu onClose path).
    fireEvent.click(screen.getByRole('button', { name: '工作区“Project”的操作' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('workspace hover card shows its details and copies the full directory path', async () => {
    vi.useFakeTimers()
    const writeText = vi.fn(async () => {})
    const restoreClipboard = installClipboard(writeText)
    try {
      const group: GroupNode = {
        key: 'project', workspaceId: wid('project'), cwd: '/projects/project', createdAt: 0, label: 'Project',
        sessionCount: 0, expanded: false, containsCurrent: false, sessions: [],
      }
      render(<ProjectRowItem group={group} onToggle={vi.fn()} onCreate={vi.fn()} t={t} />)
      fireEvent.pointerEnter(screen.getByRole('treeitem').parentElement as HTMLElement)
      act(() => { vi.advanceTimersByTime(500) })
      // Card body: full title + cwd + absolute creation time.
      expect(screen.getAllByText('Project')).toHaveLength(2)
      expect(screen.getByText('/projects/project')).toBeTruthy()
      expect(screen.getByText(/^创建于 \d+年\d+月\d+日 /)).toBeTruthy()
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: '复制: /projects/project' })) })
      expect(writeText).toHaveBeenCalledWith('/projects/project')
      expect(screen.getByRole('status').textContent).toBe('已复制')
    } finally {
      restoreClipboard()
      vi.useRealTimers()
    }
  })

  it('ungrouped bucket renders no workspace menu without an archive-all action', () => {
    const group: GroupNode = {
      key: '', workspaceId: undefined, cwd: undefined, createdAt: undefined, label: 'Ungrouped',
      sessionCount: 0, expanded: false, containsCurrent: false, sessions: [],
    }
    render(<ProjectRowItem group={group} onToggle={vi.fn()} onCreate={vi.fn()} t={t} />)
    expect(screen.queryByRole('button', { name: /工作区/ })).toBeNull()
  })

  it('ungrouped bucket menu carries only Archive all chats with the started-chat count', () => {
    const run = vi.fn()
    const group: GroupNode = {
      key: '', workspaceId: undefined, cwd: undefined, createdAt: undefined, label: 'Ungrouped',
      sessionCount: 3, expanded: true, containsCurrent: false, sessions: [],
    }
    render(<ProjectRowItem group={group} onToggle={vi.fn()} onCreate={vi.fn()}
      archiveAll={{ count: 3, run }} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: '工作区“未分组”的操作' }))
    expect(screen.getAllByRole('menuitem').map(m => m.textContent)).toEqual(['归档全部会话（3）'])
    expect(screen.queryByRole('menuitem', { name: '移除工作区' })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: '归档全部会话（3）' }))
    expect(run).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('blank New Session rows carry no menu, no time label, and no hover-card time', () => {
    vi.useFakeTimers()
    try {
      const node: SessionNode = {
        space: 'chat',
        id: sid('s-blank'), title: 'ignored', blank: true, shellOnly: false, running: false,
        runningSubagentCount: 0, completed: false, updatedAt: 0,
      }
      render(<SessionNodeItem node={node} currentId={node.id} now={0} onOpen={vi.fn()}
        onRename={vi.fn()} onFork={vi.fn()} onArchive={vi.fn()} t={t} />)
      // The placeholder has no content yet: no row verbs, no "now" stamp.
      expect(screen.queryByRole('button', { name: /会话.*的操作/ })).toBeNull()
      expect(screen.queryByText('刚刚')).toBeNull()
      // The hover card keeps title + status but drops the timestamp line.
      const wrapper = screen.getByRole('treeitem').parentElement as HTMLElement
      fireEvent.pointerEnter(wrapper)
      act(() => { vi.advanceTimersByTime(500) })
      expect(screen.getAllByText('新会话').length).toBeGreaterThanOrEqual(2)
      expect(screen.getByText('空闲')).toBeTruthy()
      expect(screen.queryByText('刚刚')).toBeNull()
      expect(screen.getByText('空闲').closest('[role="button"]')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('session row menu opens without opening the session and dispatches rename, fork, and archive', () => {
    const onOpen = vi.fn()
    const onRename = vi.fn()
    const onFork = vi.fn()
    const onArchive = vi.fn()
    const node: SessionNode = {
      space: 'chat',
      id: sid('s1'), title: 'One', blank: false, shellOnly: false, running: false,
      runningSubagentCount: 0, completed: false, updatedAt: 0,
    }
    render(<SessionNodeItem node={node} currentId={undefined} now={0} onOpen={onOpen}
      onRename={onRename} onFork={onFork} onArchive={onArchive} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: '会话“One”的操作' }))
    expect(onOpen).not.toHaveBeenCalled()
    // Archive is not destructive (log and accounting slot remain): no danger styling.
    expect(screen.getByRole('menuitem', { name: '归档会话' }).className).not.toMatch(/danger/)
    // Rename dispatches with the current display title (dialog prefill).
    fireEvent.click(screen.getByRole('menuitem', { name: '重命名' }))
    expect(screen.queryByRole('menu')).toBeNull()
    expect(onRename).toHaveBeenCalledWith(node.id, 'One')
    expect(onOpen).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '会话“One”的操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '分叉会话' }))
    expect(onFork).toHaveBeenCalledWith(node.id)
    // Archive dispatches without opening the session.
    fireEvent.click(screen.getByRole('button', { name: '会话“One”的操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '归档会话' }))
    expect(onArchive).toHaveBeenCalledWith(node.id)
    expect(onRename).toHaveBeenCalledOnce()
    expect(onOpen).not.toHaveBeenCalled()
    // Escape closes without selecting (Menu onClose path).
    fireEvent.click(screen.getByRole('button', { name: '会话“One”的操作' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  })


  it('shows the hover card after the dwell and suppresses it while the row menu is open', () => {
    vi.useFakeTimers()
    try {
      const node: SessionNode = {
        space: 'chat',
        id: sid('s1'), title: 'Hovered', blank: false, shellOnly: false, running: true,
        runningSubagentCount: 0, completed: false, updatedAt: 0,
      }
      render(<SessionNodeItem node={node} currentId={undefined} now={60_000} onOpen={vi.fn()}
        onRename={vi.fn()} onFork={vi.fn()} onArchive={vi.fn()} t={t} />)
      const wrapper = screen.getByRole('treeitem').parentElement as HTMLElement
      fireEvent.pointerEnter(wrapper)
      act(() => { vi.advanceTimersByTime(500) })
      // Card body: full title + relative time + running status.
      expect(screen.getAllByText('Hovered')).toHaveLength(2)
      expect(screen.getByText('1分钟前')).toBeTruthy()
      expect(screen.getAllByText('进行中')).toHaveLength(2)
      fireEvent.pointerLeave(wrapper)
      // Menu open (disabled=true) suppresses the card for the same hover.
      fireEvent.click(screen.getByRole('button', { name: '会话“Hovered”的操作' }))
      fireEvent.pointerEnter(wrapper)
      act(() => { vi.advanceTimersByTime(1000) })
      expect(screen.queryByText('1分钟前')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([
    ['approval', '等待审批'],
    ['plan-review', '计划待审'],
    ['question', '等待回答'],
  ] as const)('shows %s as warning ahead of the running state', (pendingInteraction, label) => {
    vi.useFakeTimers()
    try {
      const node: SessionNode = {
        space: 'chat',
        id: sid(pendingInteraction), title: 'Needs input', blank: false, shellOnly: false,
        pendingInteraction, running: true, runningSubagentCount: 0, completed: false, updatedAt: 0,
      }
      const view = render(<SessionNodeItem node={node} currentId={undefined} now={0} onOpen={vi.fn()}
        onRename={vi.fn()} onFork={vi.fn()} onArchive={vi.fn()} t={t} />)
      const row = screen.getByRole('treeitem')
      expect(row.querySelector('[data-state="warning"]')).toBeTruthy()
      expect(row.querySelector('[data-state="ongoing"]')).toBeNull()
      expect(screen.getByText(label)).toBeTruthy()

      view.rerender(<SessionNodeItem node={{ ...node, running: false }} currentId={undefined} now={0}
        onOpen={vi.fn()} onRename={vi.fn()} onFork={vi.fn()} onArchive={vi.fn()} t={t} />)
      expect(screen.getByRole('treeitem').querySelector('[data-state="warning"]')).toBeTruthy()

      fireEvent.pointerEnter(screen.getByRole('treeitem').parentElement as HTMLElement)
      act(() => { vi.advanceTimersByTime(500) })
      expect(screen.getAllByText(label)).toHaveLength(2)
      expect(document.querySelectorAll('[data-state="warning"]')).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('idle hover card shows the Idle status line', () => {
    vi.useFakeTimers()
    try {
      const node: SessionNode = {
        space: 'chat',
        id: sid('s1'), title: 'Quiet', blank: false, shellOnly: false, running: false,
        runningSubagentCount: 0, completed: false, updatedAt: 0,
      }
      render(<SessionNodeItem node={node} currentId={undefined} now={0} onOpen={vi.fn()}
        onRename={vi.fn()} onFork={vi.fn()} onArchive={vi.fn()} t={t} />)
      fireEvent.pointerEnter(screen.getByRole('treeitem').parentElement as HTMLElement)
      act(() => { vi.advanceTimersByTime(500) })
      expect(screen.getByText('空闲')).toBeTruthy()
      expect(screen.getAllByText('刚刚')).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('completed hover card shows the Completed status line', () => {
    vi.useFakeTimers()
    try {
      const node: SessionNode = {
        space: 'chat',
        id: sid('s1'), title: 'Done', blank: false, shellOnly: false, running: false,
        runningSubagentCount: 0, completed: true, updatedAt: 0,
      }
      render(<SessionNodeItem node={node} currentId={undefined} now={0} onOpen={vi.fn()}
        onRename={vi.fn()} onFork={vi.fn()} onArchive={vi.fn()} t={t} />)
      fireEvent.pointerEnter(screen.getByRole('treeitem').parentElement as HTMLElement)
      act(() => { vi.advanceTimersByTime(500) })
      // Row's visually-hidden reminder label plus the hover card's status line.
      expect(screen.getAllByText('已完成')).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('draggable row wires start/end and gates hover/drop on an active same-group drag', () => {
    const node: SessionNode = {
      space: 'chat',
      id: sid('s1'), title: 'Drag me', blank: false, shellOnly: false, running: false,
      runningSubagentCount: 0, completed: false, updatedAt: 0,
    }
    const inactive = dragProps()
    const { rerender } = render(
      <SessionNodeItem node={node} currentId={undefined} now={0} onOpen={vi.fn()}
        onRename={vi.fn()} onFork={vi.fn()} onArchive={vi.fn()} drag={inactive} t={t} />,
    )
    const row = screen.getByRole('treeitem')
    stubRect(row)
    expect(row.getAttribute('draggable')).toBe('true')
    fireEvent.dragStart(row, { dataTransfer })
    expect(inactive.start).toHaveBeenCalledOnce()
    // Inactive drag: hover and drop are rejected.
    fireEvent.dragOver(row, { dataTransfer })
    fireEvent.drop(row, { dataTransfer })
    expect(inactive.hover).not.toHaveBeenCalled()
    expect(inactive.drop).not.toHaveBeenCalled()
    fireEvent.dragEnd(row)
    expect(inactive.end).toHaveBeenCalledOnce()

    const active = dragProps({ active: true, marker: 'before' })
    rerender(
      <SessionNodeItem node={node} currentId={undefined} now={0} onOpen={vi.fn()}
        onRename={vi.fn()} onFork={vi.fn()} onArchive={vi.fn()} drag={active} t={t} />,
    )
    stubRect(screen.getByRole('treeitem'))
    // Top half hovers/drops 'before'; bottom half 'after' (row mid = 117).
    fireDrag(screen.getByRole('treeitem'), 'dragOver', 105)
    expect(active.hover).toHaveBeenCalledWith('before')
    fireDrag(screen.getByRole('treeitem'), 'dragOver', 130)
    expect(active.hover).toHaveBeenCalledWith('after')
    fireDrag(screen.getByRole('treeitem'), 'drop', 130)
    expect(active.drop).toHaveBeenCalledWith('after')

    const after = dragProps({ active: true, marker: 'after' })
    rerender(
      <SessionNodeItem node={node} currentId={undefined} now={0} onOpen={vi.fn()}
        onRename={vi.fn()} onFork={vi.fn()} onArchive={vi.fn()} drag={after} t={t} />,
    )
    expect(screen.getByRole('treeitem').className).toMatch(/dropAfter/)
  })
  it('renders the context capsule with V0 colour steps and hides it without data', () => {
    const base: SessionNode = {
      space: 'chat',
      id: sid('ctx'), title: 'Context Session', blank: false, shellOnly: false, running: false,
      runningSubagentCount: 0, completed: false, updatedAt: 1,
    }
    const view = render(<SessionNodeItem node={{ ...base, contextPercent: 42 }} currentId={undefined}
      now={0} onOpen={vi.fn()} onRename={vi.fn()} onFork={vi.fn()} onArchive={vi.fn()} t={t} />)
    const low = screen.getByRole('img', { name: '上下文已用 42%' })
    expect(low.getAttribute('data-level')).toBe('low')

    view.rerender(<SessionNodeItem node={{ ...base, contextPercent: 61 }} currentId={undefined}
      now={0} onOpen={vi.fn()} onRename={vi.fn()} onFork={vi.fn()} onArchive={vi.fn()} t={t} />)
    expect(screen.getByRole('img', { name: '上下文已用 61%' }).getAttribute('data-level')).toBe('mid')

    view.rerender(<SessionNodeItem node={{ ...base, contextPercent: 90 }} currentId={undefined}
      now={0} onOpen={vi.fn()} onRename={vi.fn()} onFork={vi.fn()} onArchive={vi.fn()} t={t} />)
    expect(screen.getByRole('img', { name: '上下文已用 90%' }).getAttribute('data-level')).toBe('high')

    view.rerender(<SessionNodeItem node={base} currentId={undefined}
      now={0} onOpen={vi.fn()} onRename={vi.fn()} onFork={vi.fn()} onArchive={vi.fn()} t={t} />)
    expect(screen.queryByRole('img', { name: /上下文/ })).toBeNull()
  })

  it.each([
    ['chat', '对话'],
    ['terminal', '终端'],
    ['gallery', '图片'],
    ['soundstage', '声音'],
    ['motion', '视频'],
  ] as const)('gives the %s row its own icon in the space lane', (space, label) => {
    const node: SessionNode = {
      space,
      id: sid(space), title: 'Space Session', blank: false, shellOnly: false, running: false,
      runningSubagentCount: 0, completed: false, updatedAt: 0,
    }
    render(<SessionNodeItem node={node} currentId={undefined} now={0} onOpen={vi.fn()}
      onRename={vi.fn()} onFork={vi.fn()} onArchive={vi.fn()} t={t} />)
    const lane = screen.getByRole('img', { name: label })
    expect(lane.getAttribute('data-space')).toBe(space)
    // The lane leads the row, ahead of the status slot, so its x position is
    // the same on every row whatever else the row carries.
    expect(screen.getByRole('treeitem').firstElementChild).toBe(lane)
    // The icon is the file `@idealize/spaces` serves for the space, applied as
    // a mask over the row's text colour; the lane carries the label.
    const icon = lane.querySelector<HTMLElement>('[data-space-icon]')
    expect(icon?.style.getPropertyValue('--space-icon')).toBe(`url(/idealize/spaces/icons/${space}.svg)`)
  })

  it('loads a different icon for every space so the lane distinguishes five spaces', () => {
    const drawn = new Set<string>()
    for (const space of ['chat', 'terminal', 'gallery', 'soundstage', 'motion'] as const) {
      const node: SessionNode = {
        space,
        id: sid(space), title: 'Space Session', blank: false, shellOnly: false, running: false,
        runningSubagentCount: 0, completed: false, updatedAt: 0,
      }
      const view = render(<SessionNodeItem node={node} currentId={undefined} now={0} onOpen={vi.fn()}
        onRename={vi.fn()} onFork={vi.fn()} onArchive={vi.fn()} t={t} />)
      drawn.add(view.container.querySelector<HTMLElement>('[data-space] [data-space-icon]')?.style.getPropertyValue('--space-icon') ?? '')
      cleanup()
    }
    expect(drawn.size).toBe(5)
  })

  it('keeps the space lane on a blank row and on a row that carries every other signal', () => {
    const blank: SessionNode = {
      space: 'terminal',
      id: sid('blank'), title: '', blank: true, shellOnly: false, running: false,
      runningSubagentCount: 0, completed: false, updatedAt: 0,
    }
    const view = render(<SessionNodeItem node={blank} currentId={undefined} now={0} onOpen={vi.fn()}
      onRename={vi.fn()} onFork={vi.fn()} onArchive={vi.fn()} t={t} />)
    expect(screen.getByRole('treeitem').firstElementChild?.getAttribute('data-space')).toBe('terminal')

    view.rerender(<SessionNodeItem
      node={{ ...blank, blank: false, title: 'Loaded', running: true, pendingInteraction: 'approval',
        agentName: 'Scout', contextPercent: 90 }}
      currentId={undefined} now={0} onOpen={vi.fn()}
      onRename={vi.fn()} onFork={vi.fn()} onArchive={vi.fn()} t={t} />)
    expect(screen.getByRole('treeitem').firstElementChild?.getAttribute('data-space')).toBe('terminal')
  })
})
