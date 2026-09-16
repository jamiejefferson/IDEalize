// @vitest-environment jsdom
// The plan-mode icon: hidden without the capability, pressed while the
// effective target is plan mode, and each click runs the opposite command.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import type { PlanProjection } from '@deepseek-ai/dsh-plan-mode/client'
import { en } from '../src/client/locales.ts'
import { PlanToggle, type PlanToggleProps } from '../src/client/PlanToggle.tsx'
// Type-only: the locale-namespace merge the props type reads.
import type {} from '../src/client/index.ts'

const t: PlanToggleProps['t'] = makeTranslate(en, commonEn)

function mount(plan: PlanProjection | undefined, locked = false, ringView: string | null = 'chat') {
  const store = createSnapshotStore<{ value: PlanProjection | undefined }>({ value: plan })
  const useProjection = (_key: string, selector?: (v: unknown) => unknown) =>
    bindSnapshotSelector(store)(s => (selector ?? (v => v))(s.value))
  const chat = createSnapshotStore<{ view: string | null }>({ view: ringView })
  const useStore = bindSnapshotSelector(chat)
  const setPlanMode = vi.fn(() => Promise.resolve<string | null>(null))
  const props = { useProjection, useStore, locked, setPlanMode, t } as unknown as PlanToggleProps
  const view = render(<PlanToggle {...props} />)
  return { view, store, chat, setPlanMode }
}

afterEach(cleanup)

describe('PlanToggle', () => {
  it('renders nothing without the plan capability', () => {
    const { view } = mount(undefined)
    expect(view.container.querySelector('[data-plan-toggle]')).toBeNull()
  })

  it('serves Chat and Terminal (and a chat with no view yet) and stands down on the generating spaces', () => {
    for (const ringView of ['gallery', 'motion', 'soundstage']) {
      const { view } = mount({ active: false, pending: false }, false, ringView)
      expect(view.container.querySelector('[data-plan-toggle]')).toBeNull()
      cleanup()
    }
    for (const ringView of ['chat', 'terminal', null]) {
      const { view } = mount({ active: false, pending: false }, false, ringView)
      expect(view.container.querySelector('[data-plan-toggle]')).not.toBeNull()
      cleanup()
    }
    // The ring moves: the icon follows.
    const { view, chat } = mount({ active: true, pending: false })
    act(() => { chat.set({ view: 'gallery' }) })
    expect(view.container.querySelector('[data-plan-toggle]')).toBeNull()
    act(() => { chat.set({ view: 'chat' }) })
    expect(view.container.querySelector('[data-plan-toggle]')?.getAttribute('aria-pressed')).toBe('true')
  })

  it('off → clicking runs /plan; on → clicking runs /plan off, the caption naming the mode before the click\'s effect', async () => {
    const { view, store, setPlanMode } = mount({ active: false, pending: false })
    const button = view.getByRole('button', { name: 'Plan mode off. Click to turn on.' })
    expect(button.getAttribute('aria-pressed')).toBe('false')
    await act(async () => { fireEvent.click(button); await Promise.resolve() })
    expect(setPlanMode).toHaveBeenCalledWith(true)
    act(() => { store.set({ value: { active: true, pending: false } }) })
    const on = view.getByRole('button', { name: 'Plan mode on. Click to turn off.' })
    expect(on.getAttribute('aria-pressed')).toBe('true')
    await act(async () => { fireEvent.click(on); await Promise.resolve() })
    expect(setPlanMode).toHaveBeenLastCalledWith(false)
  })

  it('a pending exit reads as off, and a failure shows its status line', async () => {
    const { view, setPlanMode } = mount({ active: true, pending: true })
    setPlanMode.mockResolvedValueOnce('nope (boom)')
    const button = view.getByRole('button', { name: 'Plan mode off. Click to turn on.' })
    expect(button.getAttribute('aria-pressed')).toBe('false')
    await act(async () => { fireEvent.click(button); await Promise.resolve() })
    expect(view.getByRole('status').getAttribute('title')).toBe('nope (boom)')
  })

  it('locked disables the button', () => {
    const { view } = mount({ active: false, pending: false }, true)
    expect((view.getByRole('button') as HTMLButtonElement).disabled).toBe(true)
  })
})
