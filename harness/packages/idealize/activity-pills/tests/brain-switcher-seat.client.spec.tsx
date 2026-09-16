// @vitest-environment jsdom
/**
 * The composer's brain control: what the menu SAYS before the click (which
 * brains restart the shell), the confirm dialog's exact copy, and Cancel
 * leaving the chat untouched.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import type { SpaceId } from '@idealize/spaces/client'
import { BrainSwitcher, type BrainSwitcherProps } from '../src/client/BrainSwitcher.tsx'
import type { BrainOption, BrainSwitcherState } from '../src/client/brain-switcher.ts'
import { en } from '../src/client/locales.ts'

const t = makeTranslate(en, commonEn) as unknown as BrainSwitcherProps['t']

function brain(id: string, name: string, over: Partial<BrainOption> = {}): BrainOption {
  return {
    id,
    name,
    model: { provider: 'openrouter', model: 'pi-1' },
    instructions: 'Be exact.',
    isDefault: false,
    restarts: false,
    ...over,
  }
}

const BRAINS: BrainOption[] = [
  brain('pi', 'pi', { isDefault: true }),
  brain('coding', 'Claude Code', { model: { provider: 'anthropic', model: 'sonnet' }, restarts: true }),
  brain('codex', 'Codex', { restarts: true }),
  brain('writing', 'Writing', { instructions: '' }),
]

function mount(
  options: { space?: SpaceId; brains?: readonly BrainOption[]; addBrain?: boolean; currentId?: string } = {},
) {
  const space = options.space ?? 'terminal'
  const brains = options.brains ?? BRAINS
  const state = createSnapshotStore<BrainSwitcherState>({
    status: 'ready', space, brains, currentId: options.currentId ?? 'pi', busy: null, error: null,
  })
  const sessions = createSnapshotStore({
    byId: {
      s1: {
        id: 's1',
        blank: false,
        agentPreset: 'pi',
        projectionValues: { space: { space }, brain: { brain: 'pi' } },
      },
    },
  })
  const select = vi.fn(() => Promise.resolve())
  const addBrain = vi.fn()
  const props = {
    locked: false,
    sessionId: 's1',
    useBrainSwitcher: bindSnapshotSelector(state),
    useSessions: bindSnapshotSelector(sessions),
    load: vi.fn(() => Promise.resolve()),
    select,
    ...options.addBrain === false ? {} : { addBrain },
    t,
  } as unknown as BrainSwitcherProps
  const view = render(<BrainSwitcher {...props} />)
  const open = (): void => { fireEvent.click(view.container.querySelector('[data-brain-switcher]')!) }
  return { view, open, select, addBrain }
}

/** One menu row's trailing line, read off the rendered DOM. */
function metaOf(id: string): string | null {
  const row = document.querySelector(`[data-brain="${id}"]`)
  return row?.querySelector('[data-brain-meta]')?.textContent ?? null
}

afterEach(cleanup)

describe('BrainSwitcher trigger', () => {
  it('names the brain the chat is running', () => {
    const { view } = mount()
    const trigger = view.container.querySelector('[data-brain-switcher]')!
    expect(trigger.textContent).toContain('pi')
    expect(trigger.getAttribute('data-brain-current')).toBe('pi')
    expect(trigger.getAttribute('data-space')).toBe('terminal')
  })

  it('renders nothing while this chat has no brains to offer', () => {
    const { view } = mount({ brains: [] })
    expect(view.container.querySelector('[data-brain-switcher]')).toBeNull()
  })

  // The 27 Aug landing walk found the raw id `gallery` on a relaunched chat's
  // trigger: an id is a log value and never a label.
  it('shows nothing rather than an id for a brain this space does not offer', () => {
    const { view } = mount({ space: 'chat', currentId: 'gallery-brain' })
    expect(view.container.querySelector('[data-brain-switcher]')).toBeNull()
    expect(view.container.textContent).not.toContain('gallery-brain')
  })
})

describe('the menu, before any click', () => {
  it('labels the restart on exactly the brains whose shell command differs', () => {
    const { open } = mount()
    open()
    expect(metaOf('coding')).toBe('restarts the shell')
    expect(metaOf('codex')).toBe('restarts the shell')
    expect(metaOf('pi')).toBe('openrouter')
    expect(metaOf('writing')).toBe('No instructions')
    expect(document.querySelectorAll('[data-brain-restarts]')).toHaveLength(2)
  })

  it('says nothing about restarts in a Chat chat', () => {
    const { open } = mount({
      space: 'chat',
      brains: BRAINS.map(option => ({ ...option, restarts: false })),
    })
    open()
    expect(document.querySelectorAll('[data-brain-restarts]')).toHaveLength(0)
    expect(document.body.textContent).not.toContain('restarts the shell')
  })

  it('heads the list with the space, and offers to add a brain for it', () => {
    const { open, addBrain } = mount()
    open()
    expect(document.body.textContent).toContain('Brains that work in Terminal')
    const add = [...document.querySelectorAll('[role="menuitem"]')]
      .find(row => row.textContent?.includes('Add a brain for Terminal'))
    fireEvent.click(add!)
    expect(addBrain).toHaveBeenCalledWith('terminal')
  })

  it('drops the add row where no tool rail is composed', () => {
    const { open } = mount({ addBrain: false })
    open()
    expect(document.body.textContent).not.toContain('Add a brain for')
  })
})

describe('choosing a brain', () => {
  it('applies a brain that costs nothing without asking', () => {
    const { open, select } = mount()
    open()
    fireEvent.click(document.querySelector('[data-brain="writing"]')!)
    expect(select).toHaveBeenCalledWith('writing', expect.objectContaining({ id: 's1', space: 'terminal' }))
    expect(document.querySelector('[data-brain-restart-line]')).toBeNull()
  })

  it('re-picking the current brain does nothing', () => {
    const { open, select } = mount()
    open()
    fireEvent.click(document.querySelector('[data-brain="pi"]')!)
    expect(select).not.toHaveBeenCalled()
  })

  it('asks first for a restart, in one line, with Cancel and Continue', () => {
    const { open, select } = mount()
    open()
    fireEvent.click(document.querySelector('[data-brain="coding"]')!)
    const dialog = document.querySelector('[role="dialog"]')!
    expect(dialog.getAttribute('aria-label')).toBe('Switch to Claude Code?')
    expect(dialog.querySelector('[data-brain-restart-line]')?.textContent)
      .toBe('The terminal restarts. You may lose some context.')
    expect(dialog.querySelector('[data-brain-cancel]')?.textContent).toBe('Cancel')
    expect(dialog.querySelector('[data-brain-confirm]')?.textContent).toBe('Continue')
    expect(select).not.toHaveBeenCalled()
  })

  it('Cancel closes the dialog and writes nothing', () => {
    const { open, select } = mount()
    open()
    fireEvent.click(document.querySelector('[data-brain="coding"]')!)
    fireEvent.click(document.querySelector('[data-brain-cancel]')!)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(select).not.toHaveBeenCalled()
  })

  it('Continue applies the switch', () => {
    const { open, select } = mount()
    open()
    fireEvent.click(document.querySelector('[data-brain="coding"]')!)
    fireEvent.click(document.querySelector('[data-brain-confirm]')!)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(select).toHaveBeenCalledWith('coding', expect.objectContaining({ id: 's1' }))
  })
})
