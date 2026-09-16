// @vitest-environment jsdom
// The reveal signal: a request reaches every listener with its
// project-relative path, and a disposed listener hears nothing more.
import { describe, expect, it, vi } from 'vitest'
import { announceArtefact, onArtefactLanded, onRevealRequest, requestReveal, REVEAL_ARTEFACT_EVENT } from '../src/client/index.ts'

describe('the reveal-artefact signal', () => {
  it('carries the relative path to each listener until disposed', () => {
    const heard: string[] = []
    const dispose = onRevealRequest((relPath) => { heard.push(relPath) })
    requestReveal('Images/2026-09-07_abc12345.png')
    expect(heard).toEqual(['Images/2026-09-07_abc12345.png'])
    dispose()
    requestReveal('Sounds/x.wav')
    expect(heard).toEqual(['Images/2026-09-07_abc12345.png'])
  })

  it('travels as one document event under its published name', () => {
    const seen = vi.fn()
    document.addEventListener(REVEAL_ARTEFACT_EVENT, seen)
    requestReveal('Video/clip.mp4')
    expect(seen).toHaveBeenCalledTimes(1)
    expect((seen.mock.calls[0]![0] as CustomEvent<{ relPath: string }>).detail).toEqual({ relPath: 'Video/clip.mp4' })
    document.removeEventListener(REVEAL_ARTEFACT_EVENT, seen)
  })
})

describe('the artefact-landed signal', () => {
  it('carries the relative path to each listener until disposed', () => {
    const heard: string[] = []
    const dispose = onArtefactLanded((relPath) => { heard.push(relPath) })
    announceArtefact('Video/2026-09-16_abc12345.mp4')
    expect(heard).toEqual(['Video/2026-09-16_abc12345.mp4'])
    dispose()
    announceArtefact('Sounds/x.wav')
    expect(heard).toEqual(['Video/2026-09-16_abc12345.mp4'])
  })
})
