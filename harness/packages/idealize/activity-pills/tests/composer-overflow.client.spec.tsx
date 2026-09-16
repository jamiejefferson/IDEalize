// @vitest-environment jsdom
/**
 * The composer's three-dot overflow: what the panel holds, that the composer's
 * own access chip is placed rather than rebuilt, and the two ways the panel
 * closes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { ComposerOverflow, type ComposerOverflowProps } from '../src/client/ComposerOverflow.tsx'
import type { BrainOption, BrainSwitcherState } from '../src/client/brain-switcher.ts'
import { en } from '../src/client/locales.ts'

const t = makeTranslate(en, commonEn) as unknown as ComposerOverflowProps['t']

const BRAINS: BrainOption[] = [
  { id: 'pi', name: 'pi', model: { provider: 'openrouter', model: 'pi-1' }, instructions: 'Be exact.', isDefault: true, restarts: false },
]

function mount(options: { locked?: boolean } = {}) {
  const state = createSnapshotStore<BrainSwitcherState>({
    status: 'ready', space: 'gallery', brains: BRAINS, currentId: 'pi', busy: null, error: null,
  })
  const sessions = createSnapshotStore({
    byId: {
      s1: {
        id: 's1',
        blank: false,
        agentPreset: 'pi',
        projectionValues: { space: { space: 'gallery' }, brain: { brain: 'pi' } },
      },
    },
  })
  const props = {
    locked: options.locked ?? false,
    control: <button type="button" data-access-chip="">Workspace Write</button>,
    sessionId: 's1',
    useBrainSwitcher: bindSnapshotSelector(state),
    useSessions: bindSnapshotSelector(sessions),
    load: vi.fn(() => Promise.resolve()),
    select: vi.fn(() => Promise.resolve()),
    t,
  } as unknown as ComposerOverflowProps
  const view = render(<ComposerOverflow {...props} />)
  const trigger = (): HTMLButtonElement => view.container.querySelector('[data-composer-overflow-trigger]')!
  return { view, trigger }
}

afterEach(cleanup)

describe('the three-dot control', () => {
  it('holds the panel shut until it is pressed', () => {
    const { trigger } = mount()
    expect(document.querySelector('[data-composer-overflow-panel]')).toBeNull()
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(trigger())
    expect(document.querySelector('[data-composer-overflow-panel]')).not.toBeNull()
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
    expect(trigger().getAttribute('aria-label')).toBe('More settings')
  })

  it('mounts the panel outside the trigger, so a scrolling tool row cannot clip it', () => {
    const { view, trigger } = mount()
    fireEvent.click(trigger())
    const panel = document.querySelector<HTMLElement>('[data-composer-overflow-panel]')!
    // Portalled: the row the trigger sits in carries `overflow-x: auto`, and
    // CSS forces the other axis with it, so a panel inside that row is clipped.
    expect(view.container.contains(panel)).toBe(false)
    expect(panel.parentElement).toBe(document.body)
    expect(panel.style.position === '' ? getComputedStyle(panel).position : panel.style.position).not.toBe('absolute')
    // Placed against the trigger rather than at the page origin.
    expect(panel.style.left).toMatch(/px$/)
    expect(panel.style.bottom).toMatch(/px$/)
  })

  it('places the composer\'s own access chip rather than building one', () => {
    const { trigger } = mount()
    fireEvent.click(trigger())
    const panel = document.querySelector('[data-composer-overflow-panel]')!
    expect(panel.querySelector('[data-access-chip]')?.textContent).toBe('Workspace Write')
  })

  it('names both settings, and offers the chat\'s brain beside the access mode', () => {
    const { trigger } = mount()
    fireEvent.click(trigger())
    const panel = document.querySelector('[data-composer-overflow-panel]')!
    expect(panel.textContent).toContain('Project access')
    expect(panel.textContent).toContain('Brain')
    expect(panel.querySelector('[data-brain-switcher]')).not.toBeNull()
  })

  it('closes on a pointer landing outside it, and stays open for a menu it opened', () => {
    const { trigger } = mount()
    fireEvent.click(trigger())
    const menu = document.createElement('div')
    menu.setAttribute('role', 'menu')
    document.body.appendChild(menu)
    fireEvent.pointerDown(menu)
    expect(document.querySelector('[data-composer-overflow-panel]')).not.toBeNull()
    fireEvent.pointerDown(document.body)
    expect(document.querySelector('[data-composer-overflow-panel]')).toBeNull()
  })

  it('a removed session shuts the panel and refuses the trigger', () => {
    const { trigger } = mount({ locked: true })
    expect(trigger().disabled).toBe(true)
    fireEvent.click(trigger())
    expect(document.querySelector('[data-composer-overflow-panel]')).toBeNull()
  })
})
