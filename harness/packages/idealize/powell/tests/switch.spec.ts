// A project switch is read before the model runs.
import { describe, expect, it } from 'vitest'
import { readProjectSwitch } from '../src/projects.ts'

describe('readProjectSwitch', () => {
  it('reads the project from the common phrasings', () => {
    expect(readProjectSwitch("We're working on idea lies today.")).toEqual({ said: 'idea lies', rest: '' })
    expect(readProjectSwitch('Switch to JACQ')).toEqual({ said: 'JACQ', rest: '' })
    expect(readProjectSwitch("Okay, let's work on the Hatch project. Open the brief.")).toEqual({ said: 'Hatch', rest: 'Open the brief.' })
    expect(readProjectSwitch('Set the project to the audit')).toEqual({ said: 'the audit', rest: '' })
  })

  it('leaves ordinary requests alone', () => {
    expect(readProjectSwitch('Put the research into the docs')).toBeUndefined()
    expect(readProjectSwitch('We are working on making the onboarding feel faster and simpler for new users')).toBeUndefined()
  })
})
