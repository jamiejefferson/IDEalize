import { describe, expect, it } from 'vitest'
import { en, zh } from '../src/client/locales.ts'
import { DEFAULT_SELECTORS, runnableSteps, TOUR_STEPS } from '../src/client/tour-script.ts'
import { TourView } from '../src/client/tour-store.ts'

describe('runnableSteps', () => {
  it('keeps the opening card and drops steps whose target is off screen', () => {
    const steps = runnableSteps(target => target === 'composer' || target === 'rail')
    expect(steps.map(step => step.target)).toEqual([null, 'composer', 'rail'])
  })

  it('runs the full script when every target resolves', () => {
    expect(runnableSteps(() => true)).toHaveLength(TOUR_STEPS.length)
  })
})

describe('the tour copy', () => {
  it('keeps the eight step targets in order', () => {
    expect(TOUR_STEPS.map(step => step.target)).toEqual([null, 'sidebar', 'studio', 'composer', 'files', 'brains', 'askbar', 'rail'])
  })

  it('names the model chip and the Models pane, and never a brain or a space', () => {
    expect(en['tour.composer.body']).toContain('The chip on the box names the model that is answering. Open it to choose Auto, Ask me or Fixed.')
    expect(en['tour.brains.title']).toBe('Models')
    expect(en['tour.rail.body']).toContain('Trajectory, Models, Plugins')
    for (const [key, value] of Object.entries(en)) {
      expect(value, key).not.toMatch(/brain/i)
      expect(value, key).not.toMatch(/\bspaces\b/i)
    }
    for (const [key, value] of Object.entries(zh)) expect(value, key).not.toContain('大脑')
  })

  it('finds the pane by its Models label first, and by its earlier label after', () => {
    expect(DEFAULT_SELECTORS.brains[0]).toBe('[data-slot="shell.rail"] button[aria-label="Models"]')
    expect(DEFAULT_SELECTORS.brains).toContain('[data-slot="shell.rail"] button[aria-label="Brains"]')
  })
})

describe('tour view store', () => {
  it('steps forward and back, ends after the last step, and the sheet toggles', () => {
    const store = new TourView()
    const steps = runnableSteps(() => true).slice(0, 2)
    store.openSheet()
    store.start(steps)
    expect(store.getSnapshot()).toMatchObject({ index: 0, sheet: false })
    store.back()
    store.next()
    expect(store.getSnapshot().index).toBe(1)
    store.back()
    expect(store.getSnapshot().index).toBe(0)
    store.next()
    store.next()
    expect(store.getSnapshot().steps).toBeNull()
    store.next()
    store.finish()
    store.toggleSheet()
    expect(store.getSnapshot().sheet).toBe(true)
    store.closeSheet()
    expect(store.getSnapshot().sheet).toBe(false)
  })
})
