// @vitest-environment jsdom
/**
 * The `sidebar.rail` seat through the real assembly path: the shell reads the
 * seat's occupancy off the registry, renders the registrant in the browsing
 * region only while the column is collapsed, keeps `sidebar.workspaces` at
 * its place when the seat is empty, and hands the region back when the
 * registrant leaves.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, waitFor } from '@testing-library/react'
import { SlotTestRuntime, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-sidebar/client'

usePinnedBrowserLanguages('en')

afterEach(cleanup)

async function bench() {
  const runtime = await SlotTestRuntime.create()
  const toggleSidebar = vi.fn()
  runtime.provide('layout', { toggleSidebar })
  const locale = new LocaleRuntime(runtime.ctx)
  locale.setLocale('en')
  runtime.provide('locale', locale)
  runtime.slots.installLocale(locale)
  await runtime.declare({ 'sidebar': { kind: 'single', scope: 'root' } })
  await runtime.mount({ inject: [...inject], apply })
  const seatRail = (expand: (request: () => void) => void = () => {}) => runtime.slots.register(
    { name: 'sidebar.rail' },
    (props: { expandSidebar: () => void }) => {
      expand(props.expandSidebar)
      return <div data-testid="rail" />
    },
  )
  const seatBrowser = () => runtime.slots.register(
    { name: 'sidebar.workspaces' },
    (props: { wide: boolean }) => <div data-testid="browser" data-wide={props.wide} />,
  )
  return { runtime, toggleSidebar, seatRail, seatBrowser }
}

describe('the sidebar.rail seat', () => {
  it('renders the registrant in the collapsed column in place of the browser, and the browser wide', async () => {
    const b = await bench()
    act(() => { b.seatBrowser() })
    let expand: (() => void) | undefined
    act(() => { b.seatRail((request) => { expand = request }) })
    const slot = b.runtime.renderSlot('sidebar', { collapsed: true, width: 56 })
    expect(slot.view.getByTestId('rail')).toBeTruthy()
    expect(slot.view.queryByTestId('browser')).toBeNull()
    expect(slot.container.querySelector('[data-slot="sidebar.workspaces"]')).toBeNull()
    expand?.()
    expect(b.toggleSidebar).toHaveBeenCalledOnce()
    slot.update({ collapsed: false, width: 300 })
    await waitFor(() => { expect(slot.view.getByTestId('browser').getAttribute('data-wide')).toBe('true') })
    expect(slot.view.queryByTestId('rail')).toBeNull()
    await b.runtime.dispose()
  })

  it('keeps the browser in the collapsed column while the seat is empty, and swaps live as the seat fills and empties', async () => {
    const b = await bench()
    act(() => { b.seatBrowser() })
    const slot = b.runtime.renderSlot('sidebar', { collapsed: true, width: 56 })
    expect(slot.view.getByTestId('browser').getAttribute('data-wide')).toBe('false')
    expect(slot.container.querySelector('[data-slot="sidebar.rail"]')).toBeNull()
    let unseat: (() => void) | undefined
    act(() => { unseat = b.seatRail() })
    await waitFor(() => { expect(slot.view.getByTestId('rail')).toBeTruthy() })
    expect(slot.view.queryByTestId('browser')).toBeNull()
    act(() => { unseat?.() })
    await waitFor(() => { expect(slot.view.getByTestId('browser')).toBeTruthy() })
    expect(slot.view.queryByTestId('rail')).toBeNull()
    await b.runtime.dispose()
  })
})
