// @vitest-environment jsdom
/**
 * The composer's model chip: it names the model answering and how the router
 * behaves, and its panel holds the three-way choice, the Cheaper to Smarter
 * slider, the company's models with a tick each, and the way into the model
 * browser. The notice above the composer says what the router did or asks, and
 * what the chat's model is missing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import type { SpaceId } from '@idealize/spaces/client'
import {
  BrainChip, excludedAfter, modeWord, priceLabel, readableModel,
  type BrainChipProps, type ChipBrowserRequest, type ChipChoices,
} from '../src/client/BrainChip.tsx'
import { BrainNotice, type BrainNoticeProps } from '../src/client/BrainNotice.tsx'
import type { BrainOption, BrainSwitcherState } from '../src/client/brain-switcher.ts'
import { en, zh } from '../src/client/locales.ts'

const t = makeTranslate(en, commonEn) as unknown as BrainChipProps['t']

function preset(id: string, name: string, over: Partial<BrainOption> = {}): BrainOption {
  return {
    id,
    name,
    model: { provider: 'openrouter', model: 'anthropic/claude-sonnet-5' },
    instructions: '',
    description: '',
    isDefault: false,
    restarts: false,
    ...over,
  }
}

const HAIKU = { provider: 'openrouter', model: 'anthropic/claude-haiku-4.5', label: 'Anthropic: Claude Haiku 4.5' }
const SONNET = { provider: 'openrouter', model: 'anthropic/claude-sonnet-5', label: 'Anthropic: Claude Sonnet 5' }
const OPUS = { provider: 'openrouter', model: 'anthropic/claude-opus-5', label: 'Anthropic: Claude Opus 5' }
const NEXT = { provider: 'openrouter', model: 'anthropic/claude-next', label: 'Claude Next' }

function choicesOf(over: Partial<ChipChoices> = {}): ChipChoices {
  const excluded = over.excluded ?? []
  const answering = over.answering ?? SONNET
  return {
    mode: 'auto',
    lean: 35,
    company: 'anthropic',
    answering,
    models: [
      { ...HAIKU, price: { input: 1, output: 5 } },
      { ...SONNET, price: { input: 3, output: 15 } },
      { ...OPUS, price: { input: 15, output: 75 } },
      { ...NEXT, price: null },
    ].map(row => ({
      ...row,
      allowed: !excluded.includes(`${row.provider}/${row.model}`),
      answering: row.model === answering.model,
    })),
    excluded,
    ...over,
  }
}

const EFFORTS = { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'low' }

interface MountOptions {
  space?: SpaceId
  /** The presets of the chat's space; none by default, as for a chat that records no preset. */
  presets?: readonly BrainOption[]
  currentId?: string
  router?: unknown
  /** What the router answers; null stands for a shell without the router. */
  choices?: ChipChoices | null
  block?: unknown
  locked?: boolean
  app?: string
}

function faceFor(options: MountOptions) {
  const space = options.space ?? 'chat'
  const state = createSnapshotStore<BrainSwitcherState>({
    status: 'ready', space, brains: options.presets ?? [], currentId: options.currentId ?? '', busy: null, error: null,
  })
  const sessions = createSnapshotStore({
    byId: {
      s1: { id: 's1', blank: true, projectionValues: { space: { space }, router: options.router } },
    },
  })
  const directory = createSnapshotStore({
    current: { provider: 'openrouter', model: 'anthropic/claude-sonnet-5' },
    groups: [{
      id: 'openrouter',
      name: 'OpenRouter',
      models: [{ id: 'anthropic/claude-sonnet-5', name: 'Anthropic: Claude Sonnet 5', reasoning: EFFORTS }],
    }],
    status: 'ready',
  })
  const block = createSnapshotStore<unknown>(options.block)
  // The router as the chip meets it: a write changes what the next read answers.
  let stored = options.choices === undefined ? choicesOf() : options.choices
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
    openBrains: vi.fn(),
    addKey: vi.fn(),
    signIn: vi.fn(),
    renderModelBrowser: vi.fn((request: ChipBrowserRequest) => (
      <button type="button" data-test-browser="" data-heading={request.brainName} onClick={() => { request.onApply({ provider: 'openrouter', model: 'other' }) }}>browser</button>
    )),
    router: {
      lock: vi.fn(() => Promise.resolve()),
      back: vi.fn(() => Promise.resolve()),
      accept: vi.fn(() => Promise.resolve()),
      stay: vi.fn(() => Promise.resolve()),
      drop: vi.fn(() => Promise.resolve()),
    },
    routerChoices: vi.fn(() => Promise.resolve(stored)),
    routerSettings: vi.fn((patch: Partial<ChipChoices>) => {
      if (stored !== null) {
        const { models: _recomputed, ...held } = stored
        stored = choicesOf({ ...held, ...patch })
      }
      return Promise.resolve()
    }),
    terminalApp: vi.fn(() => Promise.resolve(options.app ?? 'Claude Code')),
    t,
  }
}

const settle = async (): Promise<void> => {
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}

async function mountChip(options: MountOptions = {}) {
  const face = faceFor(options)
  const view = render(<BrainChip {...({ ...face, locked: options.locked ?? false } as unknown as BrainChipProps)} />)
  await settle()
  const trigger = (): HTMLButtonElement => view.container.querySelector('[data-brain-chip-trigger]')!
  const open = async (): Promise<void> => {
    await act(async () => { fireEvent.click(trigger()); await Promise.resolve() })
    await settle()
  }
  return { ...face, view, trigger, open }
}

const panel = (): Element | null => document.querySelector('[data-brain-chip-panel]')
const modeButton = (mode: string): HTMLButtonElement => document.querySelector(`button[data-router-mode="${mode}"]`)!
const modelRow = (model: { provider: string; model: string }): Element =>
  document.querySelector(`[data-chip-model="${model.provider}/${model.model}"]`)!
const tickOf = (model: { provider: string; model: string }): HTMLInputElement => modelRow(model).querySelector('input')!

afterEach(cleanup)

describe('the chip', () => {
  it('names the model answering, without the maker’s prefix, then how the router behaves', async () => {
    const { trigger } = await mountChip()
    expect(trigger().querySelector('[data-chip-name]')?.textContent).toBe('Claude Sonnet 5')
    expect(trigger().querySelector('[data-chip-mode]')?.textContent).toBe('Auto')
    expect(trigger().getAttribute('aria-label')).toBe('Claude Sonnet 5, Auto. Model settings')
  })

  it('says Ask me when the router asks first, and nothing when the model is fixed', async () => {
    const asking = await mountChip({ choices: choicesOf({ mode: 'ask' }) })
    expect(asking.trigger().querySelector('[data-chip-mode]')?.textContent).toBe('Ask me')
    cleanup()
    const fixed = await mountChip({ choices: choicesOf({ mode: 'fixed' }) })
    expect(fixed.trigger().querySelector('[data-chip-mode]')).toBeNull()
    expect(fixed.trigger().textContent).toBe('Claude Sonnet 5')
    expect(fixed.trigger().getAttribute('aria-label')).toBe('Claude Sonnet 5. Model settings')
  })

  it('renders for a chat that records no preset, and for one whose space lists its preset', async () => {
    const bare = await mountChip()
    expect(bare.view.container.querySelector('[data-brain-chip]')).not.toBeNull()
    cleanup()
    const listed = await mountChip({ presets: [preset('core', 'IDEalize')], currentId: 'core' })
    expect(listed.trigger().textContent).toContain('Claude Sonnet 5')
    expect(listed.trigger().textContent).not.toContain('IDEalize')
  })

  it('asks the router about this chat and its own model', async () => {
    const { routerChoices } = await mountChip()
    expect(routerChoices).toHaveBeenCalledWith('s1', { provider: 'openrouter', model: 'anthropic/claude-sonnet-5' })
  })

  it('names the routed model while a switch holds, and marks the chat as moved', async () => {
    const moved = { last: { outcome: 'switched', from: SONNET, to: OPUS } }
    const { view, trigger } = await mountChip({ router: moved, choices: choicesOf({ answering: OPUS }) })
    expect(trigger().querySelector('[data-chip-name]')?.textContent).toBe('Claude Opus 5')
    expect(view.container.querySelector('[data-brain-chip-moved]')).not.toBeNull()
  })

  it('falls back to the chat’s own model, with no mode word, where the router is absent', async () => {
    const { trigger } = await mountChip({ choices: null })
    expect(trigger().textContent).toBe('Claude Sonnet 5')
  })

  it('reads a chat locked by Switch back as fixed', async () => {
    const { trigger } = await mountChip({ router: { locked: true } })
    expect(trigger().querySelector('[data-chip-mode]')).toBeNull()
  })

  it('renders nothing for a session with no model reads', () => {
    const face = faceFor({})
    const { container } = render(<BrainChip {...({ ...face, available: false, locked: false } as unknown as BrainChipProps)} />)
    expect(container.querySelector('[data-brain-chip]')).toBeNull()
    expect(face.routerChoices).not.toHaveBeenCalled()
  })

  it('stays amber and live under a block', async () => {
    const { trigger } = await mountChip({ block: { reason: 'no route' }, locked: true })
    expect(trigger().hasAttribute('data-brain-chip-blocked')).toBe(true)
    expect(trigger().disabled).toBe(false)
    expect(trigger().textContent).toBe('Claude Sonnet 5Needs an account')
  })

  it('turns amber before the first message when the chat’s preset has no model set up', async () => {
    const presets = [preset('free', 'Free', { access: { state: 'unavailable', reason: 'no-model' } })]
    const { trigger } = await mountChip({ presets, currentId: 'free' })
    expect(trigger().textContent).toContain('Needs setting up')
  })

  it('refuses the press when the seat is locked and nothing is blocked', async () => {
    expect((await mountChip({ locked: true })).trigger().disabled).toBe(true)
  })

  it('names the command-line app in a Terminal chat, and offers nothing to press', async () => {
    const { view, terminalApp, routerChoices } = await mountChip({ space: 'terminal', presets: [preset('core', 'IDEalize')], currentId: 'core' })
    expect(view.container.querySelector('[data-brain-chip-app]')?.textContent).toBe('Claude Code')
    expect(view.container.querySelector('button')).toBeNull()
    expect(terminalApp).toHaveBeenCalledWith(undefined)
    expect(routerChoices).not.toHaveBeenCalled()
    cleanup()
    const unknown = await mountChip({ space: 'terminal', app: '' })
    expect(unknown.view.container.querySelector('[data-brain-chip-app]')?.textContent).toBe('Terminal')
  })

  it('stands down in a Studio chat, whose box names the model that does the making', async () => {
    const { view } = await mountChip({ space: 'gallery' })
    expect(view.container.querySelector('[data-brain-chip]')).toBeNull()
  })
})

describe('the panel', () => {
  it('stays shut until pressed, mounts outside the chip, and closes on a pointer elsewhere or Escape', async () => {
    const { view, open } = await mountChip()
    expect(panel()).toBeNull()
    await open()
    expect(panel()).not.toBeNull()
    expect(view.container.contains(panel())).toBe(false)
    fireEvent.pointerDown(document.body)
    expect(panel()).toBeNull()
    await open()
    fireEvent.pointerDown(panel()!)
    expect(panel()).not.toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(panel()).toBeNull()
  })

  it('holds the three-way choice, the slider, the models and the way to the rest, and no other words', async () => {
    const { open } = await mountChip()
    await open()
    expect(panel()!.textContent).toBe([
      'Auto', 'Ask me', 'Fixed',
      'Cheaper', 'Smarter',
      'Claude Haiku 4.5', '$5 / M', 'Claude Sonnet 5', '$15 / M', 'Claude Opus 5', '$75 / M', 'Claude Next',
      'Thinking', 'Low',
      'Other models',
    ].join(''))
  })

  describe('the three-way choice', () => {
    it('shows the mode in force and writes the one chosen', async () => {
      const { open, routerSettings, trigger } = await mountChip()
      await open()
      expect(modeButton('auto').getAttribute('aria-checked')).toBe('true')
      expect(modeButton('ask').getAttribute('aria-checked')).toBe('false')
      await act(async () => { fireEvent.click(modeButton('ask')); await Promise.resolve() })
      expect(routerSettings).toHaveBeenCalledWith({ mode: 'ask' })
      expect(modeButton('ask').getAttribute('aria-checked')).toBe('true')
      expect(trigger().querySelector('[data-chip-mode]')?.textContent).toBe('Ask me')
    })

    it('writes Fixed, which takes the slider and the ticks away', async () => {
      const { open, routerSettings } = await mountChip()
      await open()
      await act(async () => { fireEvent.click(modeButton('fixed')); await Promise.resolve() })
      expect(routerSettings).toHaveBeenCalledWith({ mode: 'fixed' })
      expect(document.querySelector('[data-router-lean]')).toBeNull()
      expect(document.querySelector('[data-router-allow]')).toBeNull()
    })

    it('writes nothing when the mode in force is chosen again', async () => {
      const { open, routerSettings } = await mountChip()
      await open()
      fireEvent.click(modeButton('auto'))
      expect(routerSettings).not.toHaveBeenCalled()
    })

    it('unlocks a chat locked by Switch back when Auto or Ask me is chosen', async () => {
      const { open, router, routerSettings } = await mountChip({ router: { locked: true } })
      await open()
      expect(modeButton('fixed').getAttribute('aria-checked')).toBe('true')
      fireEvent.click(modeButton('auto'))
      expect(router.lock).toHaveBeenCalledWith('s1', false)
      // The app-wide mode was Auto already.
      expect(routerSettings).not.toHaveBeenCalled()
    })
  })

  describe('the slider', () => {
    const slider = (): HTMLInputElement => document.querySelector('[data-router-lean]')!

    it('runs from Cheaper to Smarter and sits where the router holds it', async () => {
      const { open } = await mountChip({ choices: choicesOf({ lean: 60 }) })
      await open()
      const row = document.querySelector('[data-chip-lean]')!
      expect(row.firstElementChild?.textContent).toBe('Cheaper')
      expect(row.lastElementChild?.textContent).toBe('Smarter')
      expect(slider().value).toBe('60')
      expect(slider().min).toBe('0')
      expect(slider().max).toBe('100')
    })

    it('writes its position once, when it is let go', async () => {
      const { open, routerSettings } = await mountChip()
      await open()
      fireEvent.change(slider(), { target: { value: '70' } })
      fireEvent.change(slider(), { target: { value: '80' } })
      expect(routerSettings).not.toHaveBeenCalled()
      expect(slider().value).toBe('80')
      await act(async () => { fireEvent.pointerUp(slider()); await Promise.resolve() })
      expect(routerSettings).toHaveBeenCalledTimes(1)
      expect(routerSettings).toHaveBeenCalledWith({ lean: 80 })
      fireEvent.blur(slider())
      expect(routerSettings).toHaveBeenCalledTimes(1)
    })

    it('writes from the keyboard too, and nothing when it comes back to where it was', async () => {
      const { open, routerSettings } = await mountChip()
      await open()
      fireEvent.change(slider(), { target: { value: '40' } })
      await act(async () => { fireEvent.keyUp(slider(), { key: 'ArrowRight' }); await Promise.resolve() })
      expect(routerSettings).toHaveBeenCalledWith({ lean: 40 })
      fireEvent.change(slider(), { target: { value: '45' } })
      fireEvent.change(slider(), { target: { value: '40' } })
      fireEvent.blur(slider())
      expect(routerSettings).toHaveBeenCalledTimes(1)
    })

    it('is absent when the model is fixed', async () => {
      const { open } = await mountChip({ choices: choicesOf({ mode: 'fixed' }) })
      await open()
      expect(document.querySelector('[data-chip-lean]')).toBeNull()
    })
  })

  describe('the model list in Auto and Ask me', () => {
    it('gives each model a tick, its name, its price, and a dot on the one answering', async () => {
      const { open } = await mountChip({ choices: choicesOf({ excluded: ['openrouter/anthropic/claude-opus-5'] }) })
      await open()
      expect(tickOf(HAIKU).checked).toBe(true)
      expect(tickOf(OPUS).checked).toBe(false)
      expect(modelRow(OPUS).textContent).toBe('Claude Opus 5$75 / M')
      expect(modelRow(NEXT).querySelector('[data-chip-price]')).toBeNull()
      expect(modelRow(SONNET).querySelector('[data-chip-answering]')?.getAttribute('aria-label')).toBe('Answering now')
      expect(document.querySelectorAll('[data-chip-answering]')).toHaveLength(1)
    })

    it('writes the unticked models when a tick is cleared, keeping the ones cleared before', async () => {
      const { open, routerSettings } = await mountChip({ choices: choicesOf({ excluded: ['openrouter/openai/gpt-5.5'] }) })
      await open()
      await act(async () => { fireEvent.click(tickOf(OPUS)); await Promise.resolve() })
      expect(routerSettings).toHaveBeenCalledWith({ excluded: ['openrouter/openai/gpt-5.5', 'openrouter/anthropic/claude-opus-5'] })
      expect(tickOf(OPUS).checked).toBe(false)
    })

    it('writes the list without a model when its tick is set again', async () => {
      const { open, routerSettings } = await mountChip({ choices: choicesOf({ excluded: ['openrouter/anthropic/claude-opus-5'] }) })
      await open()
      await act(async () => { fireEvent.click(tickOf(OPUS)); await Promise.resolve() })
      expect(routerSettings).toHaveBeenCalledWith({ excluded: [] })
      expect(tickOf(OPUS).checked).toBe(true)
    })

    it('reads the list again after a write, so the host’s answer is what shows', async () => {
      const { open, routerChoices } = await mountChip()
      await open()
      const before = routerChoices.mock.calls.length
      await act(async () => { fireEvent.click(tickOf(OPUS)); await Promise.resolve() })
      await settle()
      expect(routerChoices.mock.calls.length).toBeGreaterThan(before)
    })

    it('keeps the ticks in Ask me', async () => {
      const { open } = await mountChip({ choices: choicesOf({ mode: 'ask' }) })
      await open()
      expect(document.querySelectorAll('[data-router-allow]')).toHaveLength(4)
      expect(document.querySelector('[data-chip-pick]')).toBeNull()
    })
  })

  describe('the model list when the model is fixed', () => {
    it('makes each row one choice, marks the one answering, and puts the chat on the one chosen', async () => {
      const { open, selectModel, router } = await mountChip({ choices: choicesOf({ mode: 'fixed' }) })
      await open()
      expect(document.querySelector('[data-chip-models]')?.getAttribute('role')).toBe('radiogroup')
      expect(modelRow(SONNET).getAttribute('aria-checked')).toBe('true')
      expect(modelRow(OPUS).getAttribute('aria-checked')).toBe('false')
      await act(async () => { fireEvent.click(modelRow(OPUS)); await Promise.resolve() })
      expect(selectModel).toHaveBeenCalledWith({ provider: 'openrouter', model: 'anthropic/claude-opus-5' })
      expect(router.drop).not.toHaveBeenCalled()
      expect(router.stay).not.toHaveBeenCalled()
    })

    it('does nothing when the model answering is chosen again', async () => {
      const { open, selectModel } = await mountChip({ choices: choicesOf({ mode: 'fixed' }) })
      await open()
      fireEvent.click(modelRow(SONNET))
      expect(selectModel).not.toHaveBeenCalled()
    })

    it('lets go of a switch the router made, so the model chosen is the one that answers', async () => {
      const router = { last: { outcome: 'switched', from: SONNET, to: OPUS } }
      const { open, router: actions } = await mountChip({ router, choices: choicesOf({ mode: 'fixed', answering: OPUS }) })
      await open()
      await act(async () => { fireEvent.click(modelRow(SONNET)); await Promise.resolve() })
      expect(actions.drop).toHaveBeenCalledWith('s1')
    })

    it('turns an open offer down when another model is chosen', async () => {
      const router = { last: { outcome: 'offer', reason: 'needs-payment', from: SONNET, to: OPUS } }
      const { open, router: actions } = await mountChip({ router, choices: choicesOf({ mode: 'fixed' }) })
      await open()
      await act(async () => { fireEvent.click(modelRow(HAIKU)); await Promise.resolve() })
      expect(actions.stay).toHaveBeenCalledWith('s1')
      expect(actions.drop).not.toHaveBeenCalled()
    })

    it('leaves the router alone when the host refuses the model', async () => {
      const router = { last: { outcome: 'switched', from: SONNET, to: OPUS } }
      const chip = await mountChip({ router, choices: choicesOf({ mode: 'fixed', answering: OPUS }) })
      chip.selectModel.mockResolvedValueOnce(false)
      await chip.open()
      await act(async () => { fireEvent.click(modelRow(SONNET)); await Promise.resolve() })
      expect(chip.router.drop).not.toHaveBeenCalled()
    })
  })

  it('Other models opens the model browser under the chat’s space, and its choice goes to this chat', async () => {
    const { open, selectModel } = await mountChip()
    await open()
    fireEvent.click(document.querySelector('[data-chip-browse]')!)
    const browser = document.querySelector('[data-test-browser]')!
    expect(browser.getAttribute('data-heading')).toBe('Chat')
    await act(async () => { fireEvent.click(browser); await Promise.resolve() })
    expect(selectModel).toHaveBeenCalledWith({ provider: 'openrouter', model: 'other' })
    expect(document.querySelector('[data-test-browser]')).toBeNull()
  })

  it('keeps thinking effort for a model that has levels, and writes the level chosen', async () => {
    const { open, selectModel } = await mountChip()
    await open()
    const thinking = document.querySelector('[data-chip-thinking]')!
    expect(thinking.textContent).toBe('ThinkingLow')
    fireEvent.click(thinking.querySelector('button')!)
    const high = [...document.querySelectorAll('[role="menuitemradio"], [role="menuitem"]')].find(item => item.textContent === 'High')!
    fireEvent.click(high)
    expect(selectModel).toHaveBeenCalledWith({ provider: 'openrouter', model: 'anthropic/claude-sonnet-5', reasoningEffort: 'high' })
  })

  it('shows only the way to the model browser and thinking where the router is absent', async () => {
    const { open } = await mountChip({ choices: null })
    await open()
    expect(panel()!.textContent).toBe('ThinkingLowOther models')
  })
})

describe('the helpers', () => {
  it('keeps a model name that carries no maker', () => {
    expect(readableModel('GPT-6 Astra')).toBe('GPT-6 Astra')
    expect(readableModel('Anthropic: Claude Opus 5')).toBe('Claude Opus 5')
  })

  it('says how the router behaves in a word, or nothing', () => {
    expect(modeWord('auto', t)).toBe('Auto')
    expect(modeWord('ask', t)).toBe('Ask me')
    expect(modeWord('fixed', t)).toBe('')
    expect(modeWord(undefined, t)).toBe('')
  })

  it('prices a model by a million written tokens, without cents a whole number does not need', () => {
    expect(priceLabel({ input: 3, output: 15 }, t)).toBe('$15 / M')
    expect(priceLabel({ input: 0.5, output: 2.5 }, t)).toBe('$2.50 / M')
    expect(priceLabel({ input: 0.05, output: 0.25 }, t)).toBe('$0.25 / M')
    expect(priceLabel({ input: 0.01, output: 0.04 }, t)).toBe('$0.04 / M')
    expect(priceLabel('free', t)).toBe('Free')
    expect(priceLabel(null, t)).toBe('')
  })

  it('rewrites the unticked models for one tick', () => {
    expect(excludedAfter(['a/x'], { provider: 'b', model: 'y' }, false)).toEqual(['a/x', 'b/y'])
    expect(excludedAfter(['a/x'], { provider: 'a', model: 'x' }, false)).toEqual(['a/x'])
    expect(excludedAfter(['a/x', 'b/y'], { provider: 'a', model: 'x' }, true)).toEqual(['b/y'])
  })

  it('ticking a model behind a key gateway clears the tick of the route it fronts', () => {
    const viaGateway = { provider: 'gateway-openrouter', model: 'anthropic/claude-opus-5' }
    expect(excludedAfter(['openrouter/anthropic/claude-opus-5', 'c/z'], viaGateway, true)).toEqual(['c/z'])
    expect(excludedAfter([], viaGateway, false)).toEqual(['gateway-openrouter/anthropic/claude-opus-5'])
  })
})

describe('the copy', () => {
  it('holds the same keys in both dictionaries', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })

  it('never says brain, and never exclaims', () => {
    for (const text of Object.values(en)) {
      expect(text).not.toMatch(/brain/iu)
      expect(text).not.toContain('!')
    }
    for (const text of Object.values(zh)) expect(text).not.toMatch(/brain|大脑/iu)
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

  it('says what the router did in a chat that records no preset, takes it back, and can be dismissed', () => {
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
    expect(view.container.querySelector('[data-router-accept]')?.textContent).toBe('Try Claude Opus 5')
    fireEvent.click(view.container.querySelector('[data-router-accept]')!)
    expect(router.accept).toHaveBeenCalledWith('s1', TO)
  })

  it('asks before a dearer model, and Switch takes it', () => {
    const { view, router } = mountNotice({ router: { last: { outcome: 'offer', reason: 'ask', dearer: true, from: FROM, to: TO } } })
    const line = view.container.querySelector('[data-brain-notice="ask"]')!
    expect(line.textContent).toBe('Use Claude Opus 5 for this? It costs more.SwitchStay')
    expect(line.querySelector('[data-brain-notice-dismiss]')).toBeNull()
    fireEvent.click(line.querySelector('[data-router-accept]')!)
    expect(router.accept).toHaveBeenCalledWith('s1', TO)
  })

  it('asks plainly about a model that costs no more, and Stay turns it down and clears the line', () => {
    const { view, router } = mountNotice({ router: { last: { outcome: 'offer', reason: 'ask', dearer: false, from: TO, to: FROM } } })
    expect(view.container.querySelector('[data-brain-notice="ask"]')?.textContent).toBe('Use DeepSeek V4 Flash for this?SwitchStay')
    fireEvent.click(view.container.querySelector('[data-router-stay]')!)
    expect(router.stay).toHaveBeenCalledWith('s1')
    expect(router.accept).not.toHaveBeenCalled()
    expect(view.container.querySelector('[data-brain-notice]')).toBeNull()
  })

  it('shows an offer in an image chat, and keeps a switch to itself there', () => {
    const offered = mountNotice({ space: 'gallery', router: { last: { outcome: 'offer', reason: 'said-cannot', from: FROM, to: TO } } })
    expect(offered.view.container.textContent).toContain('DeepSeek V4 Flash said it couldn\'t do this. Claude Opus 5 may be able to.')
    cleanup()
    const switched = mountNotice({ space: 'gallery', router: { last: { outcome: 'switched', from: FROM, to: TO } } })
    expect(switched.view.container.querySelector('[data-brain-notice]')).toBeNull()
  })

  it('names the model a blocked chat cannot reach, in a chat that records no preset, with the fix', () => {
    const { view, addKey } = mountNotice({ block: { reason: 'no route' } })
    expect(view.container.textContent).toContain('Claude Sonnet 5 needs an account before it can answer.')
    expect(view.container.querySelector('[data-brain-use-free]')).toBeNull()
    fireEvent.click(view.container.querySelector('[data-brain-connect]')!)
    expect(addKey).toHaveBeenCalledWith('openrouter')
  })

  it('offers the free way out when the chat’s space has one that can answer', () => {
    const presets = [
      preset('coding', 'Coding', { access: { state: 'unavailable', reason: 'no-access' } }),
      preset('free', 'Free', { access: { state: 'ready' }, model: { provider: 'free-tokens', model: 'auto' } }),
    ]
    const { view, select } = mountNotice({ presets, currentId: 'coding' })
    fireEvent.click(view.container.querySelector('[data-brain-use-free]')!)
    expect(select).toHaveBeenCalledWith('free', expect.objectContaining({ id: 's1' }))
  })

  it('sends a sign-in route to the sign-in surface, and a missing model to the Models pane', () => {
    const signedOut = mountNotice({
      presets: [
        preset('coding', 'Coding', { access: { state: 'unavailable', reason: 'no-sign-in' } }),
        preset('free', 'Free', { access: { state: 'unavailable', reason: 'no-model' } }),
      ],
      currentId: 'coding',
    })
    fireEvent.click(signedOut.view.container.querySelector('[data-brain-connect]')!)
    expect(signedOut.signIn).toHaveBeenCalled()
    expect(signedOut.view.container.querySelector('[data-brain-use-free]')).toBeNull()
    cleanup()
    const noModel = mountNotice({ presets: [preset('coding', 'Coding', { access: { state: 'unavailable', reason: 'no-model' } })], currentId: 'coding' })
    fireEvent.click(noModel.view.container.querySelector('[data-brain-connect]')!)
    expect(noModel.openBrains).toHaveBeenCalled()
  })

  it('says free models need setting up, and opens their page', () => {
    const opened = vi.spyOn(window, 'open').mockReturnValue(null)
    const presets = [preset('free', 'Free', { access: { state: 'unavailable', reason: 'no-model' }, model: { provider: 'free-tokens', model: 'auto' } })]
    const { view } = mountNotice({ presets, currentId: 'free', block: { reason: 'no route' } })
    expect(view.container.textContent).toContain('Free models aren\'t set up yet.')
    fireEvent.click(view.container.querySelector('[data-brain-connect]')!)
    expect(opened).toHaveBeenCalledWith('/idealize/freetokens', '_blank', 'noopener')
    opened.mockRestore()
  })
})
