// @vitest-environment jsdom
// The wizard over the real flow controller: gating renders nothing for a done
// seed, Continue writes the step outcome and fires the burst (skips never
// do), Back retraces without writing, skip-all persists done and closes, the
// finish step persists done + completedAt and closes after the final burst,
// and the reduced-motion variant swaps rings for a static tint. The agents
// step's body gates Continue on a connection, which the stub route client
// supplies.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { createOnboardingFlow } from '../src/client/flow.ts'
import type { OnboardingFlow } from '../src/client/flow.ts'
import { OnboardingOverlay } from '../src/client/OnboardingOverlay.tsx'
import type { OnboardingOverlayProps } from '../src/client/OnboardingOverlay.tsx'
import type { OnboardingApi } from '../src/client/api.ts'
import { en } from '../src/client/locales.ts'
import type { OnboardingSeedLike } from '../src/client/steps.ts'
import { owlClipUrl } from '../src/owl-clip-urls.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const t = (key: string): string => en[key as keyof typeof en] ?? key

/** Flush pending route promises and their effects. */
const flush = async (): Promise<void> => { await act(async () => {}) }

/** The default route stub: Claude Code installed, so the agents step's Continue engages. */
function stubApi(): OnboardingApi {
  return {
    loadAgents: vi.fn(async () => ({ claudeCode: { installed: true, path: '/usr/local/bin/claude' }, openrouter: { connected: false } })),
    connectOpenRouter: vi.fn(async () => ({ ok: true }) as const),
    loadTools: vi.fn(async () => ({ providers: [], activities: [], media: [], freeRoute: false, terminal: null })),
    saveActivityModel: vi.fn(async () => ({ ok: true }) as const),
    saveMediaModel: vi.fn(async () => ({ ok: true }) as const),
    saveTerminalDefault: vi.fn(async () => ({ ok: true }) as const),
    probeFolder: vi.fn(async () => ({ ok: true }) as const),
    orient: vi.fn(async () => ({ ok: true }) as const),
  }
}

function mount(seed: OnboardingSeedLike | undefined, reduced = false) {
  const writes: Record<string, unknown> = {}
  const releaseHold = vi.fn()
  const flow: OnboardingFlow = createOnboardingFlow({
    persist: (field, value) => { writes[field] = value },
    releaseHold,
  })
  const opened = flow.open(seed)
  const props = {
    useView: bindSnapshotSelector(flow.view),
    t,
    api: stubApi(),
    pickDirectory: () => Promise.resolve(null),
    readSetupAliases: () => ({}),
    selectProject: vi.fn(),
    completeStep: flow.completeStep,
    skipStep: flow.skipStep,
    quitAll: flow.quitAll,
    back: flow.back,
    setToolDrafts: flow.setToolDrafts,
    finish: flow.finish,
    celebrationDone: flow.celebrationDone,
    prefersReducedMotion: () => reduced,
  } as unknown as OnboardingOverlayProps
  render(<OnboardingOverlay {...props} />)
  return { flow, writes, releaseHold, opened }
}

/** The primary navigation button, named by its copy like the setup spec does. */
const continueButton = (): HTMLElement => screen.getByText(en['nav.continue'])

describe('OnboardingOverlay', () => {
  it('renders nothing for a done seed', () => {
    const { opened, releaseHold } = mount({ done: true })
    expect(opened).toBe(false)
    expect(screen.queryByRole('dialog')).toBeNull()
    // A closed seed leaves the release to the plugin's gate, not the flow.
    expect(releaseHold).not.toHaveBeenCalled()
  })

  it('opens on the agents step for a fresh seed, with owl, sub and six dots', async () => {
    mount(undefined)
    await flush()
    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-label')).toBe(en['onboarding.title'])
    expect(document.querySelector('[data-onboarding-step]')?.getAttribute('data-onboarding-step')).toBe('agents')
    const owl = document.querySelector('[data-owl-art]')
    expect(owl?.getAttribute('data-owl-art')).toBe('agents')
    // The clip streams from the host route: the bundle carries its URL alone.
    expect(owl?.getAttribute('src')).toBe(owlClipUrl('agents'))
    expect(owl?.getAttribute('src')).toMatch(/^\/idealize\/onboarding\/owl\/agents\.[0-9a-f]{12}\.webm$/)
    expect(owl?.hasAttribute('autoplay')).toBe(true)
    expect(owl?.hasAttribute('loop')).toBe(true)
    expect(owl?.hasAttribute('playsinline')).toBe(true)
    expect((owl as HTMLVideoElement).muted).toBe(true)
    expect(screen.getByText(en['step.agents.sub'])).toBeDefined()
    expect(document.querySelector('[data-onboarding-dots]')?.childElementCount).toBe(6)
  })

  it('Continue marks the step done, fires the burst with its toast, and advances', async () => {
    const { writes } = mount(undefined)
    await flush()
    // The welcome card under the overlay reloads its brains on this event;
    // the agents and tools steps raise it, the folder steps do not.
    const changes: string[] = []
    const onChange = (): void => { changes.push(document.querySelector('[data-onboarding-step]')?.getAttribute('data-onboarding-step') ?? '') }
    document.addEventListener('idealize:brains-changed', onChange)
    fireEvent.click(continueButton())
    await flush()
    expect(changes).toEqual(['agents'])
    document.removeEventListener('idealize:brains-changed', onChange)
    expect(writes.steps).toEqual({ agents: 'done' })
    expect(document.querySelector('[data-onboarding-step]')?.getAttribute('data-onboarding-step')).toBe('tools')
    const burst = document.querySelector('[data-rainbow-burst]')
    expect(burst?.getAttribute('data-burst-step')).toBe('agents')
    expect(burst?.getAttribute('data-motion')).toBe('full')
    expect(document.querySelectorAll('[data-burst-ring]')).toHaveLength(3)
    expect(screen.getByRole('status').textContent).toBe(en['celebrate.agents'])
  })

  it('the burst clears after its lifetime while the flow stays on the next step', async () => {
    vi.useFakeTimers()
    mount(undefined)
    await flush()
    fireEvent.click(continueButton())
    await flush()
    expect(document.querySelector('[data-rainbow-burst]')).not.toBeNull()
    act(() => { vi.advanceTimersByTime(900) })
    expect(document.querySelector('[data-rainbow-burst]')).toBeNull()
    expect(document.querySelector('[data-onboarding-step]')?.getAttribute('data-onboarding-step')).toBe('tools')
  })

  it('Skip this step records the skip without a burst', () => {
    const { writes } = mount(undefined)
    fireEvent.click(screen.getByText(en['skip.step']))
    expect(writes.steps).toEqual({ agents: 'skipped' })
    expect(document.querySelector('[data-rainbow-burst]')).toBeNull()
    expect(document.querySelector('[data-onboarding-step]')?.getAttribute('data-onboarding-step')).toBe('tools')
  })

  it('Back retraces to the previous step without writing anything', async () => {
    const { writes } = mount(undefined)
    await flush()
    fireEvent.click(continueButton())
    await flush()
    fireEvent.click(screen.getByText(en['nav.back']))
    expect(document.querySelector('[data-onboarding-step]')?.getAttribute('data-onboarding-step')).toBe('agents')
    expect(Object.keys(writes)).toEqual(['steps'])
  })

  it('Skip setup persists done, closes, and releases the hold once', () => {
    const { writes, releaseHold } = mount(undefined)
    fireEvent.click(screen.getByText(en['skip.all']))
    expect(writes.done).toBe(true)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(releaseHold).toHaveBeenCalledTimes(1)
  })

  it('finish persists steps + done + completedAt and closes after the final burst', async () => {
    vi.useFakeTimers()
    // Walk the two folder steps (the finish commit needs the captured folders).
    const seed: OnboardingSeedLike = { steps: { agents: 'done', tools: 'done' } }
    const { writes, releaseHold } = mount(seed)
    await flush()
    for (const path of ['/Users/jj/Projects', '/Users/jj/Notes', '/Users/jj/Skills']) {
      fireEvent.click(screen.getByText(en['folder.manual']))
      fireEvent.change(document.querySelector('[data-folder-input]')!, { target: { value: path } })
      await act(async () => { vi.advanceTimersByTime(300) })
      await flush()
      fireEvent.click(continueButton())
      await flush()
    }

    expect(document.querySelector('[data-onboarding-step]')?.getAttribute('data-onboarding-step')).toBe('finish')
    // The finish step drops the per-step skip (it would duplicate Skip setup).
    expect(screen.queryByText(en['skip.step'])).toBeNull()

    fireEvent.click(screen.getByText(en['nav.finish']))
    await flush()
    expect(writes.done).toBe(true)
    expect(typeof writes.completedAt).toBe('string')
    expect(writes.steps).toEqual({
      agents: 'done', tools: 'done', 'projects-folder': 'done', 'documentation-folder': 'done', 'skills-folder': 'done', finish: 'done',
    })
    // The final burst celebrates over the finish step, which stays on stage.
    expect(screen.getByRole('status').textContent).toBe(en['celebrate.finish'])
    expect(screen.getByRole('dialog')).toBeDefined()
    expect(releaseHold).not.toHaveBeenCalled()

    act(() => { vi.advanceTimersByTime(900) })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(releaseHold).toHaveBeenCalledTimes(1)
  })

  it('reduced motion swaps the rings for the static tint and parks the owl', async () => {
    mount(undefined, true)
    await flush()
    // The clip stays parked on its first frame (no autoplay).
    expect(document.querySelector('[data-owl-art="agents"]')?.hasAttribute('autoplay')).toBe(false)
    fireEvent.click(continueButton())
    await flush()
    const burst = document.querySelector('[data-rainbow-burst]')
    expect(burst?.getAttribute('data-motion')).toBe('reduced')
    expect(document.querySelectorAll('[data-burst-ring]')).toHaveLength(0)
    expect(document.querySelector('[data-burst-tint]')).not.toBeNull()
    expect(screen.getByRole('status').textContent).toBe(en['celebrate.agents'])
  })
})
