// @vitest-environment jsdom
// The launch park/play machine: parked while another shell.overlay occupant
// renders, plays exactly once when the last one clears, and settles instantly
// under prefers-reduced-motion.
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createLaunchMachine, LAUNCH_BODY_ATTRIBUTE, LAUNCH_DWELL_MS, LAUNCH_LAYER_ATTRIBUTE, LAUNCH_SEQUENCE_MS,
} from '../src/client/launch-machine.ts'

const CONTAINER_SELECTOR = 'div[data-slot="shell.overlay"]'

/** Flush MutationObserver delivery (microtask checkpoints) under fake timers. */
async function flushObservers(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

function makeContainer(...children: HTMLElement[]): HTMLElement {
  const container = document.createElement('div')
  container.setAttribute('data-slot', 'shell.overlay')
  for (const child of children) container.append(child)
  document.body.append(container)
  return container
}

function foreign(): HTMLElement {
  return document.createElement('div')
}

function ownLayer(): HTMLElement {
  const layer = document.createElement('div')
  layer.setAttribute(LAUNCH_LAYER_ATTRIBUTE, '')
  return layer
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
  document.body.removeAttribute(LAUNCH_BODY_ATTRIBUTE)
})

describe('launch machine', () => {
  it('plays once the overlay container appears and stays clear', async () => {
    vi.useFakeTimers()
    const machine = createLaunchMachine()
    machine.start()
    await vi.advanceTimersByTimeAsync(LAUNCH_DWELL_MS + LAUNCH_SEQUENCE_MS + 1)
    expect(machine.phases.getSnapshot()).toBe('parked')

    makeContainer(ownLayer())
    await flushObservers()
    expect(machine.phases.getSnapshot()).toBe('parked')
    await vi.advanceTimersByTimeAsync(LAUNCH_DWELL_MS - 1)
    expect(machine.phases.getSnapshot()).toBe('parked')
    await vi.advanceTimersByTimeAsync(1)
    expect(machine.phases.getSnapshot()).toBe('playing')
    expect(document.body.getAttribute(LAUNCH_BODY_ATTRIBUTE)).toBe('playing')

    await vi.advanceTimersByTimeAsync(LAUNCH_SEQUENCE_MS)
    expect(machine.phases.getSnapshot()).toBe('done')
    expect(document.body.hasAttribute(LAUNCH_BODY_ATTRIBUTE)).toBe(false)
    machine.dispose()
  })

  it('stays parked while another occupant renders and plays when it clears', async () => {
    vi.useFakeTimers()
    const container = makeContainer(ownLayer())
    const occupant = foreign()
    container.append(occupant)

    const machine = createLaunchMachine()
    machine.start()
    await vi.advanceTimersByTimeAsync(LAUNCH_DWELL_MS + 100)
    expect(machine.phases.getSnapshot()).toBe('parked')
    expect(document.body.hasAttribute(LAUNCH_BODY_ATTRIBUTE)).toBe(false)

    // An occupant arriving during the dwell cancels the pending play.
    occupant.remove()
    await flushObservers()
    await vi.advanceTimersByTimeAsync(LAUNCH_DWELL_MS - 50)
    container.append(foreign())
    await flushObservers()
    await vi.advanceTimersByTimeAsync(LAUNCH_DWELL_MS + 100)
    expect(machine.phases.getSnapshot()).toBe('parked')

    // The last occupant leaving starts the dwell again.
    for (const child of Array.from(container.querySelectorAll(':scope > div'))) {
      if (!child.hasAttribute(LAUNCH_LAYER_ATTRIBUTE)) child.remove()
    }
    await flushObservers()
    await vi.advanceTimersByTimeAsync(LAUNCH_DWELL_MS)
    expect(machine.phases.getSnapshot()).toBe('playing')
    machine.dispose()
  })

  it('plays exactly once: occupants after the sequence never re-arm the beats', async () => {
    vi.useFakeTimers()
    makeContainer(ownLayer())
    const machine = createLaunchMachine()
    machine.start()
    await flushObservers()
    await vi.advanceTimersByTimeAsync(LAUNCH_DWELL_MS + LAUNCH_SEQUENCE_MS)
    expect(machine.phases.getSnapshot()).toBe('done')

    const container = document.querySelector(CONTAINER_SELECTOR)
    container?.append(foreign())
    await flushObservers()
    await vi.advanceTimersByTimeAsync(LAUNCH_DWELL_MS + LAUNCH_SEQUENCE_MS)
    expect(machine.phases.getSnapshot()).toBe('done')
    expect(document.body.hasAttribute(LAUNCH_BODY_ATTRIBUTE)).toBe(false)
    machine.dispose()
  })

  it('ignores a crashed occupant\'s empty crash face', async () => {
    vi.useFakeTimers()
    const crash = document.createElement('div')
    crash.setAttribute('data-slot-error', 'shell.overlay')
    makeContainer(ownLayer(), crash)
    const machine = createLaunchMachine()
    machine.start()
    await flushObservers()
    await vi.advanceTimersByTimeAsync(LAUNCH_DWELL_MS)
    expect(machine.phases.getSnapshot()).toBe('playing')
    machine.dispose()
  })

  it('settles immediately under prefers-reduced-motion: no layer phase, no beats', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    vi.useFakeTimers()
    makeContainer(ownLayer())
    const machine = createLaunchMachine()
    expect(machine.phases.getSnapshot()).toBe('done')
    machine.start()
    await flushObservers()
    await vi.advanceTimersByTimeAsync(LAUNCH_DWELL_MS + LAUNCH_SEQUENCE_MS)
    expect(machine.phases.getSnapshot()).toBe('done')
    expect(document.body.hasAttribute(LAUNCH_BODY_ATTRIBUTE)).toBe(false)
    machine.dispose()
  })

  it('dispose while parked or playing disarms the beats for good', async () => {
    vi.useFakeTimers()
    makeContainer(ownLayer())
    const parked = createLaunchMachine()
    parked.start()
    parked.dispose()
    await flushObservers()
    await vi.advanceTimersByTimeAsync(LAUNCH_DWELL_MS + LAUNCH_SEQUENCE_MS)
    expect(parked.phases.getSnapshot()).toBe('parked')
    expect(document.body.hasAttribute(LAUNCH_BODY_ATTRIBUTE)).toBe(false)

    const playing = createLaunchMachine()
    playing.start()
    await flushObservers()
    await vi.advanceTimersByTimeAsync(LAUNCH_DWELL_MS)
    expect(playing.phases.getSnapshot()).toBe('playing')
    playing.dispose()
    await vi.advanceTimersByTimeAsync(LAUNCH_SEQUENCE_MS)
    expect(document.body.hasAttribute(LAUNCH_BODY_ATTRIBUTE)).toBe(false)
    expect(playing.phases.getSnapshot()).toBe('playing')
  })
})
