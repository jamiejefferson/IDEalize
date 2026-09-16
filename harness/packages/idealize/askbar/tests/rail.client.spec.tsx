// @vitest-environment jsdom
// The rail in its sidebar home: the same column as the floating bar, laid out
// for the collapsed sidebar's 36px width. The sidebar column carries the logo
// and the New-chat control above this seat, so the rail starts at the Studio
// entry, which raises the in-window Studio request; a chip click opens that
// chat, hovering one reveals its panel, and the panel's foot asks for the
// Studio the same way from either home.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { AskbarView } from '../src/client/askbar-store.ts'
import { en } from '../src/client/locales.ts'
import { PANEL_LEAVE_GRACE_MS, Rail } from '../src/client/Rail.tsx'
import { SidebarRail } from '../src/client/SidebarRail.tsx'
import type { AskbarRoster } from '../src/types.ts'

const t = makeTranslate(en)
const never = (() => { throw new Error('the rail reads no global hook') }) as never

const ROSTER: AskbarRoster = {
  project: '/work/demo',
  config: { edge: 'right', hoverRevealMs: 150, pendingSendMs: 1000, transformMs: 200, pollMs: 2000 },
  chips: [
    { id: 's-juno', name: 'Juno', title: 'Launch email', role: 'chat', running: true, unread: 0, state: 'needs-input', task: 'Draft the launch email', status: null },
    { id: 's-nova', name: 'Nova', title: 'Captions', role: 'project-agent', running: true, unread: 0, state: 'working', task: null, status: null },
  ],
}
const VIEW: AskbarView = { project: '/work/demo', roster: ROSTER, error: null }

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('Rail in the sidebar home', () => {
  it('marks itself, starts at the Studio, and opens rightward whatever edge the bar docks to', () => {
    const view = render(<Rail view={VIEW} home='sidebar' onOpenMain={vi.fn()} t={t} />)
    const rail = view.container.firstElementChild as HTMLElement
    expect(rail.hasAttribute('data-askbar-rail')).toBe(true)
    expect(rail.getAttribute('data-home')).toBe('sidebar')
    expect(rail.getAttribute('data-edge')).toBe('left')
    // The sidebar column presides with its own logo, so the rail carries none.
    expect(view.queryByLabelText('demo — expand the sidebar')).toBeNull()
    expect(view.getByLabelText('Studio — open it')).toBeTruthy()
    // A rule closes the Studio off from the agents under it.
    expect(rail.querySelector('hr')).toBeTruthy()
  })

  it('names each agent under its own circle, with its state under the name', () => {
    // The sidebar home renders the same chip as the floating bar: the two
    // rails are one rail now (JJ, 13 Sep 2026).
    const view = render(<Rail view={VIEW} home='sidebar' onOpenMain={vi.fn()} t={t} />)
    const chips = [...view.container.querySelectorAll('[data-chip-id]')]
    expect(chips.map(chip => [...chip.querySelectorAll('span')].slice(-2).map(node => node.textContent)))
      .toEqual([['Juno', 'Needs input'], ['Nova', 'Working']])
  })

  it('routes the Studio entry to the home, and a chip click to the override', () => {
    const onOpenMain = vi.fn()
    const onOpenChip = vi.fn()
    const view = render(<Rail view={VIEW} home='sidebar' onOpenMain={onOpenMain} onOpenChip={onOpenChip} t={t} />)
    fireEvent.click(view.getByLabelText('Studio — open it'))
    expect(onOpenMain).toHaveBeenLastCalledWith('studio')
    fireEvent.keyDown(view.getByLabelText('Juno — Needs input'), { key: 'Enter' })
    expect(onOpenChip).toHaveBeenCalledWith(ROSTER.chips[0])
    expect(view.queryByRole('dialog')).toBeNull()
  })

  it('reveals a hovered chip’s panel after the configured delay, keeps it while the pointer is over the panel, and closes it once the pointer has left both', () => {
    vi.useFakeTimers()
    const view = render(<Rail view={VIEW} home='sidebar' onOpenMain={vi.fn()} onOpenChip={vi.fn()} t={t} />)
    const chip = view.getByLabelText('Nova — Working')
    fireEvent.pointerEnter(chip)
    expect(view.queryByRole('dialog')).toBeNull()
    act(() => { vi.advanceTimersByTime(150) })
    expect(view.getByRole('dialog').textContent).toContain('Nova')
    // Crossing from the chip to the panel is a leave and an enter inside the grace period.
    fireEvent.pointerLeave(chip)
    act(() => { vi.advanceTimersByTime(PANEL_LEAVE_GRACE_MS - 50) })
    fireEvent.pointerEnter(view.getByRole('dialog'))
    act(() => { vi.advanceTimersByTime(PANEL_LEAVE_GRACE_MS * 2) })
    expect(view.getByRole('dialog').textContent).toContain('Nova')
    fireEvent.pointerLeave(view.getByRole('dialog'))
    act(() => { vi.advanceTimersByTime(PANEL_LEAVE_GRACE_MS) })
    expect(view.queryByRole('dialog')).toBeNull()
    // And it opens again on the next rollover.
    fireEvent.pointerEnter(chip)
    act(() => { vi.advanceTimersByTime(150) })
    expect(view.getByRole('dialog').textContent).toContain('Nova')
  })

  it('rolling over another chip switches the panel to that agent', () => {
    vi.useFakeTimers()
    const view = render(<Rail view={VIEW} home='sidebar' onOpenMain={vi.fn()} onOpenChip={vi.fn()} t={t} />)
    fireEvent.pointerEnter(view.getByLabelText('Nova — Working'))
    act(() => { vi.advanceTimersByTime(150) })
    expect(view.getByRole('dialog').textContent).toContain('Nova')
    fireEvent.pointerLeave(view.getByLabelText('Nova — Working'))
    fireEvent.pointerEnter(view.getByLabelText('Juno — Needs input'))
    act(() => { vi.advanceTimersByTime(150) })
    expect(view.getByRole('dialog').textContent).toContain('Juno')
    expect(view.getByRole('dialog').textContent).not.toContain('Nova')
  })

  it('a click locks the panel so leaving keeps it, the same chip clicked again closes it, and a press outside closes it too', () => {
    vi.useFakeTimers()
    const view = render(<Rail view={VIEW} home='sidebar' onOpenMain={vi.fn()} t={t} />)
    const chip = view.getByLabelText('Nova — Working')
    const click = (target: Element) => {
      fireEvent.pointerDown(target)
      act(() => { vi.advanceTimersByTime(100) })
      fireEvent.pointerUp(target)
    }
    click(chip)
    expect(view.getByRole('dialog').textContent).toContain('Nova')
    fireEvent.pointerLeave(chip)
    act(() => { vi.advanceTimersByTime(PANEL_LEAVE_GRACE_MS * 2) })
    expect(view.getByRole('dialog').textContent).toContain('Nova')
    // Another chip rolled over switches the locked panel to that agent, and it stays locked.
    fireEvent.pointerEnter(view.getByLabelText('Juno — Needs input'))
    act(() => { vi.advanceTimersByTime(150) })
    fireEvent.pointerLeave(view.getByLabelText('Juno — Needs input'))
    act(() => { vi.advanceTimersByTime(PANEL_LEAVE_GRACE_MS * 2) })
    expect(view.getByRole('dialog').textContent).toContain('Juno')
    // The panel's own chip clicked again closes it.
    click(view.getByLabelText('Juno — Needs input'))
    expect(view.queryByRole('dialog')).toBeNull()
    // Locked again, then a press outside the panel and the chips closes it.
    click(chip)
    expect(view.getByRole('dialog')).toBeTruthy()
    fireEvent.pointerDown(document.body)
    expect(view.queryByRole('dialog')).toBeNull()
  })

  it('groups every project’s agents under a rule carrying no title', () => {
    const grouped: AskbarView = {
      project: '/work/demo',
      roster: {
        ...ROSTER,
        groups: [
          { project: '/work/demo', name: 'demo', chips: [ROSTER.chips[0]!] },
          { project: '/work/other', name: 'other', chips: [ROSTER.chips[1]!] },
        ],
      },
      error: null,
    }
    const view = render(<Rail view={grouped} home='sidebar' onOpenMain={vi.fn()} onOpenChip={vi.fn()} t={t} />)
    // One rule under the Studio, one between the two projects, and no heading.
    expect(view.container.querySelectorAll('hr')).toHaveLength(2)
    expect(view.container.querySelector('[data-group-rule]')?.textContent).toBe('')
    expect(view.queryByText('other')).toBeNull()
    expect(view.getByLabelText('Juno — Needs input')).toBeTruthy()
    expect(view.getByLabelText('Nova — Working')).toBeTruthy()
  })

  it('the panel opens on the rail’s inner side, and its foot asks the home for the Studio', () => {
    vi.useFakeTimers()
    const onOpenMain = vi.fn()
    // No onOpenChip, so a click opens the panel rather than the chat.
    const view = render(<Rail view={VIEW} home='sidebar' onOpenMain={onOpenMain} t={t} />)
    const chip = view.getByLabelText('Nova — Working')
    fireEvent.pointerDown(chip)
    act(() => { vi.advanceTimersByTime(100) })
    fireEvent.pointerUp(chip)
    expect(view.getByRole('dialog').getAttribute('data-edge')).toBe('left')
    fireEvent.click(view.getByText('Open the Studio ↗'))
    expect(onOpenMain).toHaveBeenCalledWith('studio')
  })
})

describe('SidebarRail', () => {
  function mount() {
    const store = createSnapshotStore<AskbarView>(VIEW)
    const openSession = vi.fn()
    const openStudio = vi.fn()
    const expandSidebar = vi.fn()
    const view = render(
      <SidebarRail
        store={store}
        openSession={openSession}
        openStudio={openStudio}
        expandSidebar={expandSidebar}
        useSessions={never}
        useWorkspaces={never}
        t={t}
      />,
    )
    return { view, store, openSession, openStudio, expandSidebar }
  }

  it('opens the chip’s chat and the Studio in place', () => {
    const { view, openSession, openStudio, expandSidebar } = mount()
    fireEvent.keyDown(view.getByLabelText('Juno — Needs input'), { key: 'Enter' })
    expect(openSession).toHaveBeenCalledWith('s-juno')
    fireEvent.click(view.getByLabelText('Studio — open it'))
    expect(openStudio).toHaveBeenCalledOnce()
    // The column is expanded from the sidebar's own logo, above this seat.
    expect(expandSidebar).not.toHaveBeenCalled()
  })

  it('follows the store', () => {
    const { view, store } = mount()
    expect(view.getByLabelText('Juno — Needs input')).toBeTruthy()
    act(() => { store.set({ project: '/work/other', roster: null, error: null }) })
    expect(view.queryByLabelText('Juno — Needs input')).toBeNull()
    expect(view.getByLabelText('Studio — open it')).toBeTruthy()
  })
})
