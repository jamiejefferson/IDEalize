// @vitest-environment jsdom
// The rail and its drawer: every entry is a drawer pane (no modal), the
// Terminal entry shows only where the host has an embedded terminal, the
// Appearance entry seats the appearance plugin's panel, and the Service
// hatch pane switches between its Service and Composition tabs.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { en } from '../src/client/locales.ts'
import { createBarViewStore, type BarPanel, type HatchTab } from '../src/client/bar-store.ts'
import { IdealizeBar, type IdealizeBarProps } from '../src/client/IdealizeBar.tsx'
import { DrawerPanel, type DrawerPanelProps } from '../src/client/DrawerPanel.tsx'
// Type-only: the locale-namespace and slot-key merges the props types read.
import type {} from '../src/client/index.ts'

const t: IdealizeBarProps['t'] = makeTranslate(en, commonEn)
// The root seat's selector hooks: neither component reads the lists.
const unused = (() => undefined) as unknown as IdealizeBarProps['useSessions'] & IdealizeBarProps['useWorkspaces']

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function rail(panel: BarPanel | null = null, openSettings?: () => void, terminalAvailable = false) {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ shellMode: null, reveal: false, terminal: true })))))
  const barView = createBarViewStore()
  barView.update((draft) => {
    draft.panel = panel
    draft.terminalAvailable = terminalAvailable
  })
  const togglePanel = vi.fn()
  const view = render(
    <IdealizeBar
      t={t}
      useSessions={unused}
      useWorkspaces={unused}
      useBarView={bindSnapshotSelector(barView)}
      togglePanel={togglePanel}
      openSettings={openSettings}
    />,
  )
  return { view, togglePanel }
}

describe('IdealizeBar', () => {
  it('carries no Terminal entry without an embedded terminal, no Studio entry, and every entry toggles a drawer pane', () => {
    const { view, togglePanel } = rail()
    // A plain browser has no shell to open; the entry waits for the probe.
    expect(view.queryByRole('button', { name: 'Terminal' })).toBeNull()
    // Studio left the rail on 3 Sep 2026: it is the pinned card above the projects (StudioCard).
    expect(view.queryByRole('button', { name: 'Studio' })).toBeNull()
    // The order is JJ's 11 Sep 2026 list; the mini-mode toggle is not a rail
    // entry any more (MinimodeButton sits in the sidebar header).
    const expected: [string, BarPanel][] = [
      ['Files', 'files'], ['Schedule', 'schedule'], ['Trajectory', 'trajectory'],
      ['Brains', 'models'], ['Appearance', 'appearance'], ['Feedback', 'feedback'],
      ['Service hatch', 'hatch'],
    ]
    const buttons = view.getAllByRole('button').map(button => button.getAttribute('aria-label'))
    expect(buttons).toEqual(expected.map(([label]) => label))
    for (const [label, panel] of expected) {
      fireEvent.click(view.getByRole('button', { name: label }))
      expect(togglePanel).toHaveBeenLastCalledWith(panel)
    }
    expect(togglePanel).toHaveBeenCalledTimes(expected.length)
    expect(view.queryByRole('button', { name: 'Collapse to the Askbar' })).toBeNull()
  })

  it('carries the Terminal entry under Files once the host reports an embedded terminal', () => {
    const { view, togglePanel } = rail(null, undefined, true)
    const buttons = view.getAllByRole('button').map(button => button.getAttribute('aria-label'))
    expect(buttons.slice(0, 3)).toEqual(['Files', 'Terminal', 'Schedule'])
    fireEvent.click(view.getByRole('button', { name: 'Terminal' }))
    expect(togglePanel).toHaveBeenLastCalledWith('terminal')
  })

  it('carries Settings between Appearance and the Service hatch when the dialog exists', () => {
    const openSettings = vi.fn()
    const { view } = rail(null, openSettings)
    const buttons = view.getAllByRole('button').map(button => button.getAttribute('aria-label'))
    expect(buttons).toEqual([
      'Files', 'Schedule', 'Trajectory', 'Brains', 'Appearance', 'Feedback',
      'Settings', 'Service hatch',
    ])
    fireEvent.click(view.getByRole('button', { name: 'Settings' }))
    expect(openSettings).toHaveBeenCalledTimes(1)
  })

  it('presses the entry whose pane is open', () => {
    const { view } = rail('appearance')
    expect(view.getByRole('button', { name: 'Appearance' }).getAttribute('aria-pressed')).toBe('true')
    expect(view.getByRole('button', { name: 'Files' }).getAttribute('aria-pressed')).toBe('false')
  })
})

function drawer(panel: BarPanel | null, current?: string) {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ reveal: false })))))
  const barView = createBarViewStore()
  barView.update((draft) => { draft.panel = panel })
  const Appearance = vi.fn(() => <div data-testid="appearance-panel">inspector</div>)
  // Only the Trajectory pane reads the sessions list, and it reads one field.
  const sessions = bindSnapshotSelector(createSnapshotStore({ current })) as
    unknown as DrawerPanelProps['useSessions']
  const props: DrawerPanelProps = {
    t,
    useSessions: sessions,
    useWorkspaces: unused,
    useBarView: bindSnapshotSelector(barView),
    closePanel: vi.fn(),
    setHatchTab: vi.fn((tab: HatchTab) => { barView.update((draft) => { draft.hatchTab = tab }) }),
    openFile: vi.fn(),
    currentCwd: () => undefined,
    pickDirectory: () => Promise.resolve(null),
    idealize: () => {},
    addToChat: vi.fn(() => true),
    notifyDone: vi.fn(),
    modelsHost: {} as DrawerPanelProps['modelsHost'],
    clearBrainsRequest: vi.fn(),
    trajectoryHost: {
      Component: () => <div data-testid="trajectory-ledger" />,
      face: () => ({}),
    } as unknown as DrawerPanelProps['trajectoryHost'],
    clearInspect: vi.fn(),
    clearReveal: vi.fn(),
    scheduleHost: {
      Component: () => <div data-testid="schedule-calendar" />,
      face: () => ({}),
    } as unknown as DrawerPanelProps['scheduleHost'],
    terminalHost: () => ({
      Pane: ({ cwd }: { cwd: string | undefined }) => <div data-testid="terminal-grid">{cwd ?? 'home'}</div>,
    }),
    service: {
      adoptSession: () => null,
      ensureSession: () => Promise.reject(new Error('unused in this spec')),
      openModels: vi.fn(),
    },
    appearanceHost: {
      Component: Appearance,
      props: {} as DrawerPanelProps['appearanceHost']['props'],
    },
  }
  const view = render(<DrawerPanel {...props} />)
  return { view, props, Appearance }
}

describe('DrawerPanel', () => {
  it('renders nothing while no pane is open', () => {
    const { view } = drawer(null)
    expect(view.container.innerHTML).toBe('')
  })

  it('seats the appearance plugin\'s panel as the Appearance pane', () => {
    const { view, Appearance } = drawer('appearance')
    expect(view.getByTestId('appearance-panel')).toBeTruthy()
    expect(Appearance).toHaveBeenCalled()
    expect(view.getByRole('region', { name: 'Appearance' })).toBeTruthy()
  })

  it('shows the Service hatch pane with its Service and Composition tabs', () => {
    const { view, props } = drawer('hatch')
    expect(view.getByRole('region', { name: 'Service hatch' })).toBeTruthy()
    expect(view.getByRole('tab', { name: 'Service' }).getAttribute('aria-selected')).toBe('true')
    expect(view.getByPlaceholderText('What shall we change?')).toBeTruthy()
    // JJ, 10 Sep 2026: the title stands over both tabs, so it lives in the
    // pane header rather than inside the Service tab's own content.
    expect(view.getByText('Warning, Service Hatch Open…')).toBeTruthy()
    fireEvent.click(view.getByRole('tab', { name: 'Composition' }))
    expect(props.setHatchTab).toHaveBeenCalledWith('composition')
    expect(view.getByTitle('Composition').getAttribute('src')).toBe('/idealize/hatch')
    expect(view.getByText('Warning, Service Hatch Open…')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Close panel' }))
    expect(props.closePanel).toHaveBeenCalledTimes(1)
  })

  it('seats the re-hosted ledger as the Trajectory pane, titled and closable', () => {
    const { view, props } = drawer('trajectory', 's1')
    expect(view.getByRole('region', { name: 'Trajectory' })).toBeTruthy()
    expect(view.getByTestId('trajectory-ledger')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Close panel' }))
    expect(props.closePanel).toHaveBeenCalledTimes(1)
  })

  it('seats the re-hosted calendar as the Schedule pane, titled and closable', () => {
    const { view, props } = drawer('schedule')
    expect(view.getByRole('region', { name: 'Schedule' })).toBeTruthy()
    expect(view.getByTestId('schedule-calendar')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Close panel' }))
    expect(props.closePanel).toHaveBeenCalledTimes(1)
  })

  it('seats the terminal plugin\'s grid as the Terminal pane, titled, closable, in the current chat\'s folder', () => {
    const { view, props } = drawer('terminal')
    expect(view.getByRole('region', { name: 'Terminal' })).toBeTruthy()
    expect(view.getByTestId('terminal-grid').textContent).toBe('home')
    fireEvent.click(view.getByRole('button', { name: 'Close panel' }))
    expect(props.closePanel).toHaveBeenCalledTimes(1)
  })

  it('the Terminal pane shows an empty seat while no terminal plugin is composed', () => {
    const { props } = drawer('terminal')
    cleanup()
    const view = render(<DrawerPanel {...props} terminalHost={() => undefined} />)
    expect(view.getByRole('region', { name: 'Terminal' })).toBeTruthy()
    expect(view.queryByTestId('terminal-grid')).toBeNull()
  })

  it('the Trajectory pane states the no-chat case rather than an empty ledger', () => {
    const { view } = drawer('trajectory')
    expect(view.queryByTestId('trajectory-ledger')).toBeNull()
    expect(view.getByText('Open a chat to see its trajectory.')).toBeTruthy()
  })

  it('hands the Trajectory pane an inspect target only for the chat it belongs to', () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ reveal: false })))))
    const barView = createBarViewStore()
    barView.update((draft) => {
      draft.panel = 'trajectory'
      draft.inspect = { sessionId: 's2', callId: 'call-4' }
    })
    const seen: unknown[] = []
    const props = {
      ...drawer('trajectory', 's1').props,
      useBarView: bindSnapshotSelector(barView),
      trajectoryHost: {
        Component: ({ inspect }: { inspect: unknown }) => {
          seen.push(inspect)
          return <div data-testid="trajectory-ledger" />
        },
        face: () => ({}),
      } as unknown as DrawerPanelProps['trajectoryHost'],
    }
    cleanup()

    // The recorded target belongs to s2; the pane is showing s1.
    render(<DrawerPanel {...props} />)
    expect(seen).toEqual([null])

    cleanup()
    barView.update((draft) => { draft.inspect = { sessionId: 's1', callId: 'call-4' } })
    seen.length = 0
    render(<DrawerPanel {...props} />)
    expect(seen).toEqual([{ callId: 'call-4' }])
  })

  it('seats the Feedback pane as the token-styled form (no iframe)', () => {
    const { view } = drawer('feedback')
    expect(view.queryByTitle('Feedback')).toBeNull()
    expect(view.getByPlaceholderText('What’s on your mind?')).toBeTruthy()
    expect(view.getByRole('button', { name: 'Send' })).toBeTruthy()
  })
})
