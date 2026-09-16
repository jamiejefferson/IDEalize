// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type {
  SidebarFooterActionOwnerProps, SidebarHeaderActionOwnerProps, SidebarRailOwnerProps, SidebarRootComponentProps,
  SidebarSectionOwnerProps, SidebarSettingsOwnerProps,
} from '../src/client/contract/slots.ts'
import { SidebarRoot } from '../src/client/SidebarRoot.tsx'
import { en } from '../src/client/locales.ts'

// English-dictionary translate stub: the shell renders the same copy the
// assertions below query by accessible name.
const t: SidebarRootComponentProps['t'] = key => (en as Record<string, string>)[key] ?? key

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

// The shell never reads the global hooks itself, but they ride the standard
// props share; stub them as never-called functions.
const neverHook = (() => { throw new Error('shell must not read global hooks') }) as never

function mountShell(
  { collapsed = false, width = 300, railOccupied = false }: { collapsed?: boolean; width?: number; railOccupied?: boolean } = {},
) {
  const startSession = vi.fn()
  const toggleSidebar = vi.fn()
  let regionOwner: SidebarSectionOwnerProps | undefined
  let railOwner: SidebarRailOwnerProps | undefined
  let settingsOwner: SidebarSettingsOwnerProps | undefined
  let footerActionOwner: SidebarFooterActionOwnerProps | undefined
  let current = { collapsed, width, railOccupied }
  const root = () => (
    <SidebarRoot
      collapsed={current.collapsed} width={current.width}
      useSessions={neverHook} useWorkspaces={neverHook}
      startSession={startSession} toggleSidebar={toggleSidebar} t={t}
      useRailOccupied={() => current.railOccupied}
      renderSlot={((
        key: string,
        owner: SidebarFooterActionOwnerProps | SidebarRailOwnerProps | SidebarSectionOwnerProps | SidebarSettingsOwnerProps,
      ) => {
        if (key === 'sidebar.settings') {
          settingsOwner = owner as SidebarSettingsOwnerProps
          return <div data-testid="settings-seat" data-wide={settingsOwner.wide} />
        }
        if (key === 'sidebar.footer.action') {
          footerActionOwner = owner as SidebarFooterActionOwnerProps
          return <div data-testid="footer-action-seat" data-wide={footerActionOwner.wide} />
        }
        if (key === 'sidebar.header.action') {
          return <div data-testid="header-action-seat" data-wide={(owner as SidebarHeaderActionOwnerProps).wide} />
        }
        if (key === 'sidebar.rail') {
          railOwner = owner as SidebarRailOwnerProps
          return <div data-testid="rail-seat" />
        }
        regionOwner = owner as SidebarSectionOwnerProps
        return <div data-testid="region" data-wide={regionOwner.wide} />
      }) as SidebarRootComponentProps['renderSlot']}
    />
  )
  const view = render(root())
  return {
    startSession,
    toggleSidebar,
    regionOwner: () => {
      if (regionOwner === undefined) throw new Error('region owner not rendered')
      return regionOwner
    },
    railOwner: () => {
      if (railOwner === undefined) throw new Error('rail owner not rendered')
      return railOwner
    },
    settingsOwner: () => {
      if (settingsOwner === undefined) throw new Error('settings owner not rendered')
      return settingsOwner
    },
    footerActionOwner: () => {
      if (footerActionOwner === undefined) throw new Error('footer action owner not rendered')
      return footerActionOwner
    },
    rerender(next: Partial<typeof current>) {
      current = { ...current, ...next }
      view.rerender(root())
    },
  }
}

describe('SidebarRoot shell', () => {
  it('routes New Session (the header icon) and the column toggle', () => {
    const b = mountShell()
    // Expanded, the single New-chat icon under the toggle starts a session.
    const starters = screen.getAllByRole('button', { name: 'New chat' })
    expect(starters).toHaveLength(1)
    for (const button of starters) fireEvent.click(button)
    expect(b.startSession).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    expect(b.toggleSidebar).toHaveBeenCalledOnce()
  })

  it('hands the region its wide flag and clamps expandSidebar to the collapsed state', () => {
    const b = mountShell()
    expect(b.regionOwner().wide).toBe(true)
    // The settings seat rides the same wide flag (ui-settings renders the row).
    expect(b.settingsOwner().wide).toBe(true)
    expect(b.footerActionOwner().wide).toBe(true)
    // Expanded: the request is a no-op (no accidental collapse).
    b.regionOwner().expandSidebar()
    expect(b.toggleSidebar).not.toHaveBeenCalled()
  })

  it('keeps the region mounted through collapse and expands on its request', () => {
    vi.useFakeTimers()
    const b = mountShell()
    b.rerender({ collapsed: true })
    // Wide content survives the crossfade window, then settles into the rail.
    expect(b.regionOwner().wide).toBe(true)
    vi.advanceTimersByTime(200)
    b.rerender({})
    expect(b.regionOwner().wide).toBe(false)
    expect(b.footerActionOwner().wide).toBe(false)
    expect(screen.getByTestId('region')).toBeTruthy()
    b.regionOwner().expandSidebar()
    expect(b.toggleSidebar).toHaveBeenCalledOnce()
  })

  it('renders statically collapsed on a cold start (no crossfade classes)', () => {
    const b = mountShell({ collapsed: true })
    expect(b.regionOwner().wide).toBe(false)
    expect(screen.getByRole('button', { name: 'Open sidebar' })).toBeTruthy()
  })

  it('collapsed with the rail seat occupied, renders the rail in place of the browser and expands on its request', () => {
    const b = mountShell({ collapsed: true, railOccupied: true })
    expect(screen.getByTestId('rail-seat')).toBeTruthy()
    expect(screen.queryByTestId('region')).toBeNull()
    b.railOwner().expandSidebar()
    expect(b.toggleSidebar).toHaveBeenCalledOnce()
    // The shell's own rail control stays above the seat.
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }))
    expect(b.startSession).toHaveBeenCalledOnce()
  })

  it('never renders the rail seat while wide, and hands the region back when the seat empties', () => {
    vi.useFakeTimers()
    const b = mountShell({ railOccupied: true })
    expect(screen.queryByTestId('rail-seat')).toBeNull()
    expect(b.regionOwner().wide).toBe(true)
    b.rerender({ collapsed: true })
    // The crossfade keeps the browser through the settle; the rail lands after it.
    expect(screen.queryByTestId('rail-seat')).toBeNull()
    vi.advanceTimersByTime(200)
    b.rerender({})
    expect(screen.getByTestId('rail-seat')).toBeTruthy()
    b.rerender({ railOccupied: false })
    expect(screen.queryByTestId('rail-seat')).toBeNull()
    expect(b.regionOwner().wide).toBe(false)
  })
})
