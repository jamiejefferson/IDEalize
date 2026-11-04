// @vitest-environment jsdom
/**
 * The composer's brain chip: it names the brain and the model, opens one panel
 * for the brain list, the model, thinking and auto-switch, and states what a
 * switch costs before it happens. The notice above the composer says what
 * auto-switch did and what a brain is missing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import type { SpaceId } from '@idealize/spaces/client'
import { BrainChip, costKey, readableModel, type BrainChipProps, type ChipBrowserRequest, type RouterAvailability } from '../src/client/BrainChip.tsx'
import { BrainNotice, type BrainNoticeProps } from '../src/client/BrainNotice.tsx'
import type { BrainOption, BrainSwitcherState } from '../src/client/brain-switcher.ts'
import { en } from '../src/client/locales.ts'

const t = makeTranslate(en, commonEn) as unknown as BrainChipProps['t']

function brain(id: string, name: string, over: Partial<BrainOption> = {}): BrainOption {
  return {
    id,
    name,
    model: { provider: 'openrouter', model: 'deepseek/v4-flash' },
    instructions: 'Be exact.',
    description: '',
    isDefault: false,
    restarts: false,
    ...over,
  }
}

const BRAINS: BrainOption[] = [
  brain('coding', 'Coding', { isDefault: true }),
  brain('design', 'Design'),
  brain('free', 'Free', { model: { provider: 'free-tokens', model: 'auto' } }),
  brain('mine', 'Mine', { description: 'Reads the small print' }),
]

const EFFORTS = { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'low' }

interface MountOptions {
  space?: SpaceId
  brains?: readonly BrainOption[]
  currentId?: string
  blank?: boolean
  router?: unknown
  availability?: RouterAvailability | null
  block?: unknown
  locked?: boolean
  mediaModel?: { name: string; service: string } | null
}

function faceFor(options: MountOptions) {
  const space = options.space ?? 'chat'
  const state = createSnapshotStore<BrainSwitcherState>({
    status: 'ready', space, brains: options.brains ?? BRAINS, currentId: options.currentId ?? 'coding', busy: null, error: null,
  })
  const sessions = createSnapshotStore({
    byId: {
      s1: {
        id: 's1',
        blank: options.blank ?? true,
        agentPreset: 'coding',
        projectionValues: { space: { space }, router: options.router },
      },
    },
  })
  const directory = createSnapshotStore({
    current: { provider: 'openrouter', model: 'deepseek/v4-flash' },
    groups: [{
      id: 'openrouter',
      name: 'OpenRouter',
      models: [{ id: 'deepseek/v4-flash', name: 'DeepSeek: DeepSeek V4 Flash', reasoning: EFFORTS }],
    }],
    status: 'ready',
  })
  const block = createSnapshotStore<unknown>(options.block)
  return {
    sessionId: 's1',
    useBrainSwitcher: bindSnapshotSelector(state),
    useSessions: bindSnapshotSelector(sessions),
    load: vi.fn(() => Promise.resolve()),
    select: vi.fn(() => Promise.resolve()),
    available: true,
    directory,
    loadModels: vi.fn(),
    selectModel: vi.fn(() => Promise.resolve(true)),
    composerBlock: () => block,
    addBrain: vi.fn(),
    openBrains: vi.fn(),
    addKey: vi.fn(),
    signIn: vi.fn(),
    editBrain: vi.fn(),
    renderModelBrowser: vi.fn((request: ChipBrowserRequest) => (
      <button type="button" data-test-browser="" onClick={() => { request.onApply({ provider: 'openrouter', model: 'other' }) }}>browser</button>
    )),
    startChat: vi.fn(() => Promise.resolve()),
    router: { lock: vi.fn(() => Promise.resolve()), back: vi.fn(() => Promise.resolve()), accept: vi.fn(() => Promise.resolve()) },
    routerState: vi.fn(() => Promise.resolve(options.availability === undefined ? { canRun: true, offBrains: [] } : options.availability)),
    planRoutes: vi.fn(() => Promise.resolve(new Set<string>())),
    mediaModel: vi.fn(() => Promise.resolve(options.mediaModel === undefined ? { name: 'FLUX.1 [schnell]', service: 'fal.ai' } : options.mediaModel)),
    t,
  }
}

function mountChip(options: MountOptions = {}) {
  const face = faceFor(options)
  const view = render(<BrainChip {...({ ...face, locked: options.locked ?? false } as unknown as BrainChipProps)} />)
  const trigger = (): HTMLButtonElement => view.container.querySelector('[data-brain-chip-trigger]')!
  const open = async (): Promise<void> => {
    await act(async () => { fireEvent.click(trigger()); await Promise.resolve() })
  }
  return { ...face, view, trigger, open }
}

const panel = (): Element | null => document.querySelector('[data-brain-chip-panel]')
const row = (id: string): Element => document.querySelector(`[data-brain="${id}"]`)!
const rowButton = (id: string): HTMLButtonElement => row(id).querySelector('button')!

afterEach(cleanup)

describe('the chip', () => {
  it('says so when no connected account can run a media brain', async () => {
    const { open } = mountChip({ space: 'gallery', mediaModel: null, brains: [brain('gallery', 'Gallery')], currentId: 'gallery' })
    await open()
    await act(async () => { await Promise.resolve() })
    expect(document.querySelector('[data-brain-model]')?.textContent).toBe('No connected account makes this yet')
    expect(document.querySelector('[data-brain-cost]')?.textContent).toBe('')
  })

  it('names the brain and the model it runs on, without the maker\'s prefix', () => {
    const { trigger } = mountChip()
    expect(trigger().textContent).toContain('Coding')
    expect(trigger().textContent).toContain('DeepSeek V4 Flash')
    expect(trigger().textContent).not.toContain('DeepSeek:')
  })

  it('renders nothing for a brain this space does not offer, or a session with no model reads', () => {
    expect(mountChip({ currentId: 'ghost' }).view.container.querySelector('[data-brain-chip]')).toBeNull()
    cleanup()
    const face = faceFor({})
    const { container } = render(<BrainChip {...({ ...face, available: false, locked: false } as unknown as BrainChipProps)} />)
    expect(container.querySelector('[data-brain-chip]')).toBeNull()
  })

  it('names the brain alone on a media chat: the model stays off the row (13 Sep ruling)', () => {
    const { trigger } = mountChip({ space: 'gallery', brains: [brain('gallery', 'Gallery')], currentId: 'gallery' })
    expect(trigger().textContent).toContain('Images')
    expect(trigger().textContent).not.toContain('Gallery')
    expect(trigger().textContent).not.toContain('DeepSeek')
  })

  it('marks a chat auto-switch moved, and stays amber and live under a block', () => {
    const moved = { last: { outcome: 'switched', from: { provider: 'a', model: 'a', label: 'A' }, to: { provider: 'b', model: 'b', label: 'B' } } }
    expect(mountChip({ router: moved }).view.container.querySelector('[data-brain-chip-moved]')).not.toBeNull()
    cleanup()
    const { trigger } = mountChip({ block: { reason: 'no route' }, locked: true })
    expect(trigger().hasAttribute('data-brain-chip-blocked')).toBe(true)
    expect(trigger().disabled).toBe(false)
    expect(trigger().textContent).toContain('Needs an account')
  })

  it('refuses the press when the seat is locked and nothing is blocked', () => {
    expect(mountChip({ locked: true }).trigger().disabled).toBe(true)
  })
})

describe('the panel', () => {
  it('stays shut until pressed, mounts outside the chip, and closes on a pointer elsewhere', async () => {
    const { view, open } = mountChip()
    expect(panel()).toBeNull()
    await open()
    expect(panel()).not.toBeNull()
    expect(view.container.contains(panel())).toBe(false)
    fireEvent.pointerDown(document.body)
    expect(panel()).toBeNull()
  })

  it('says what each seeded brain is for, and a brain somebody wrote reads its own description', async () => {
    const { open } = mountChip()
    await open()
    expect(row('coding').textContent).toContain('Builds and changes software')
    expect(row('mine').textContent).toContain('Reads the small print')
    expect(row('free').textContent).toContain('Free')
    expect(row('coding').hasAttribute('data-brain-selected')).toBe(true)
  })

  it('states the model, how it is paid for, and that Change is for this chat', async () => {
    const { open } = mountChip()
    await open()
    const section = document.querySelector('[data-brain-runs-on]')!
    expect(section.textContent).toContain('Coding runs on')
    expect(section.querySelector('[data-brain-model]')?.textContent).toBe('DeepSeek V4 Flash')
    expect(section.querySelector('[data-brain-cost]')?.textContent).toBe('Pay as you go')
    expect(section.textContent).toContain('Changes this chat only')
  })

  it('Change opens the model browser and its choice goes to this chat', async () => {
    const { open, selectModel } = mountChip()
    await open()
    fireEvent.click(document.querySelector('[data-brain-change]')!)
    fireEvent.click(document.querySelector('[data-test-browser]')!)
    expect(selectModel).toHaveBeenCalledWith({ provider: 'openrouter', model: 'other' })
  })

  it('auto-switch reads as on, and turning it off locks this chat', async () => {
    const { open, router } = mountChip()
    await open()
    await act(async () => { await Promise.resolve() })
    const toggle = document.querySelector<HTMLInputElement>('[data-router-lock]')!
    expect(toggle.checked).toBe(true)
    fireEvent.click(toggle)
    expect(router.lock).toHaveBeenCalledWith('s1', true)
  })

  it('leaves no auto-switch ticked when it cannot run, and says what it needs', async () => {
    const { open } = mountChip({ availability: { canRun: false, offBrains: [] } })
    await open()
    await act(async () => { await Promise.resolve() })
    const toggle = document.querySelector<HTMLInputElement>('[data-router-lock]')!
    expect(toggle.checked).toBe(false)
    expect(toggle.disabled).toBe(true)
    expect(document.querySelector('[data-brain-auto-switch]')?.textContent).toContain('Needs an OpenRouter account')
  })

  it('auto-switch says what stands in its way', async () => {
    const { open } = mountChip({ availability: { canRun: false, blockedBy: 'model', offBrains: [] } })
    await open()
    await act(async () => { await Promise.resolve() })
    expect(document.querySelector('[data-brain-auto-switch]')?.textContent).toContain('Needs a second connected model')
  })

  it('a media chat states its generation model, offers Change into the sheet, and drops the chat rows', async () => {
    const { open, editBrain } = mountChip({ space: 'gallery', brains: [brain('gallery', 'Gallery')], currentId: 'gallery' })
    await open()
    await act(async () => { await Promise.resolve() })
    expect(document.querySelector('[data-brain-list]')).toBeNull()
    expect(document.querySelector('[data-brain-model]')?.textContent).toBe('FLUX.1 [schnell]')
    expect(document.querySelector('[data-brain-cost]')?.textContent).toBe('fal.ai · Pay as you go')
    expect(document.querySelector('[data-brain-auto-switch]')).toBeNull()
    expect(document.querySelector('[data-brain-thinking]')).toBeNull()
    fireEvent.click(document.querySelector('[data-brain-change]')!)
    expect(editBrain).toHaveBeenCalledWith('gallery')
  })

  it('opens the Brains pane and the add flow from its foot', async () => {
    const { open, openBrains, addBrain } = mountChip()
    await open()
    fireEvent.click(document.querySelector('[data-brain-manage]')!)
    expect(openBrains).toHaveBeenCalled()
    await open()
    fireEvent.click(document.querySelector('[data-brain-add]')!)
    expect(addBrain).toHaveBeenCalledWith('chat')
  })
})

describe('choosing a brain', () => {
  it('applies at once on a blank chat, and re-picking the current brain does nothing', async () => {
    const { open, select } = mountChip()
    await open()
    fireEvent.click(rowButton('coding'))
    expect(select).not.toHaveBeenCalled()
    fireEvent.click(rowButton('design'))
    expect(select).toHaveBeenCalledWith('design', expect.objectContaining({ id: 's1' }))
  })

  it('on a started chat, says what it does before doing it, and offers a new chat', async () => {
    const { open, select, startChat } = mountChip({ blank: false })
    await open()
    fireEvent.click(rowButton('design'))
    expect(select).not.toHaveBeenCalled()
    const note = document.querySelector('[data-brain-started-note]')!
    expect(note.textContent).toContain('Uses Design\'s model from here on. This chat keeps Coding\'s instructions.')
    fireEvent.click(note.querySelector('[data-brain-use-model]')!)
    expect(select).toHaveBeenCalledWith('design', expect.objectContaining({ id: 's1' }))
    await open()
    await open()
    fireEvent.click(rowButton('design'))
    fireEvent.click(document.querySelector('[data-brain-new-chat]')!)
    expect(startChat).toHaveBeenCalledWith('design', 'chat', 's1')
  })

  it('names the restart on the row and asks once more in Terminal, and Cancel writes nothing', async () => {
    const brains = [brain('coding', 'Coding'), brain('codex', 'Codex', { restarts: true })]
    const { open, select } = mountChip({ space: 'terminal', brains })
    await open()
    expect(row('codex').querySelector('[data-brain-meta]')?.textContent).toBe('Restarts the terminal with this brain')
    fireEvent.click(rowButton('codex'))
    expect(document.querySelector('[data-brain-restart-line]')?.textContent).toBe('The terminal restarts. You may lose some context.')
    fireEvent.click(document.querySelector('[data-brain-cancel]')!)
    expect(select).not.toHaveBeenCalled()
    fireEvent.click(rowButton('codex'))
    fireEvent.click(document.querySelector('[data-brain-confirm]')!)
    expect(select).toHaveBeenCalledWith('codex', expect.objectContaining({ id: 's1' }))
  })
})

describe('the helpers', () => {
  it('keeps a model name that carries no maker', () => {
    expect(readableModel('GPT-6 Astra')).toBe('GPT-6 Astra')
    expect(readableModel('Anthropic: Claude Opus 5')).toBe('Claude Opus 5')
  })

  it('reads how a model is paid for', () => {
    const plans = new Set(['openai-codex'])
    expect(costKey({ provider: 'free-tokens', model: 'auto' }, plans)).toBe('cost.free')
    expect(costKey({ provider: 'openrouter', model: 'x:free' }, plans)).toBe('cost.free')
    expect(costKey({ provider: 'openai-codex', model: 'gpt' }, plans)).toBe('cost.plan')
    expect(costKey({ provider: 'openrouter', model: 'x' }, plans)).toBe('cost.payg')
  })
})

function mountNotice(options: MountOptions = {}) {
  const face = faceFor(options)
  const view = render(<BrainNotice {...(face as unknown as BrainNoticeProps)} />)
  return { ...face, view }
}

const FROM = { provider: 'openrouter', model: 'flash', label: 'DeepSeek V4 Flash' }
const TO = { provider: 'anthropic', model: 'opus', label: 'Claude Opus 5' }

describe('the notice', () => {
  it('stays away while there is nothing to say', () => {
    expect(mountNotice().view.container.querySelector('[data-brain-notice]')).toBeNull()
  })

  it('says what auto-switch did, takes it back, and can be dismissed', () => {
    const { view, router } = mountNotice({ router: { last: { outcome: 'switched', from: FROM, to: TO } } })
    expect(view.container.textContent).toContain('Switched from DeepSeek V4 Flash to Claude Opus 5 for this reply.')
    fireEvent.click(view.container.querySelector('[data-router-back]')!)
    expect(router.back).toHaveBeenCalledWith('s1', FROM)
    fireEvent.click(view.container.querySelector('[data-brain-notice-dismiss]')!)
    expect(view.container.querySelector('[data-brain-notice]')).toBeNull()
  })

  it('offers a paid model with the choice left to the person', () => {
    const { view, router } = mountNotice({ router: { last: { outcome: 'offer', reason: 'needs-payment', from: FROM, to: TO } } })
    expect(view.container.textContent).toContain('Claude Opus 5 suits this work better. It is a paid model, so the choice is yours.')
    fireEvent.click(view.container.querySelector('[data-router-accept]')!)
    expect(router.accept).toHaveBeenCalledWith('s1', TO)
  })

  it('names what a blocked brain is missing, with the fix and the way out', () => {
    const brains = [
      brain('coding', 'Coding', { access: { state: 'unavailable', reason: 'no-access' } }),
      brain('free', 'Free', { access: { state: 'ready' }, model: { provider: 'free-tokens', model: 'auto' } }),
    ]
    const { view, addKey, select } = mountNotice({ brains })
    expect(view.container.textContent).toContain('Coding needs an account before it can answer.')
    fireEvent.click(view.container.querySelector('[data-brain-connect]')!)
    expect(addKey).toHaveBeenCalledWith('openrouter')
    fireEvent.click(view.container.querySelector('[data-brain-use-free]')!)
    expect(select).toHaveBeenCalledWith('free', expect.objectContaining({ id: 's1' }))
  })

  it('sends a sign-in route to the sign-in surface, and offers no Free when Free cannot answer either', () => {
    const brains = [
      brain('coding', 'Coding', { access: { state: 'unavailable', reason: 'no-sign-in' } }),
      brain('free', 'Free', { access: { state: 'unavailable', reason: 'no-model' } }),
    ]
    const { view, signIn } = mountNotice({ brains })
    fireEvent.click(view.container.querySelector('[data-brain-connect]')!)
    expect(signIn).toHaveBeenCalled()
    expect(view.container.querySelector('[data-brain-use-free]')).toBeNull()
  })
})
