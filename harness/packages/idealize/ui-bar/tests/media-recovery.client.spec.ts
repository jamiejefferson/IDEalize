// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { en, zh } from '../src/client/locales.ts'
import { mediaRecoveryText } from '../src/client/media-recovery.ts'

describe('generating-space recovery copy', () => {
  it('uses one localised sentence for space ids and persisted media ids', () => {
    const enT = (key: keyof typeof en): string => en[key]
    const verdict = { reason: 'no-compatible-model', recovery: 'host fallback' }
    expect(mediaRecoveryText('motion', verdict, enT)).toBe(en['brains.media.recovery.video'])
    expect(mediaRecoveryText('sound', verdict, enT)).toBe(en['brains.media.recovery.audio'])

    const zhT = (key: keyof typeof zh): string => zh[key]
    expect(mediaRecoveryText('images', verdict, zhT)).toBe(zh['brains.media.recovery.image'])
  })

  it('localises the shared adapter refusal and retains other host sentences', () => {
    const t = (key: keyof typeof en): string => en[key]
    expect(mediaRecoveryText('gallery', { reason: 'no-backend', recovery: 'host fallback' }, t))
      .toBe(en['brains.media.recovery.noBackend'])
    expect(mediaRecoveryText('terminal', { reason: 'desktop-only', recovery: 'Use the desktop app.' }, t))
      .toBe('Use the desktop app.')
  })
})
