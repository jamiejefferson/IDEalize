import { describe, expect, it } from 'vitest'
import { runnableSteps, TOUR_STEPS } from '../src/client/tour-script.ts'
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
