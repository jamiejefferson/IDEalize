/** Shared localised recovery copy for generating-space availability verdicts. */
import type { BarKey } from './locales.ts'

/** The route fields needed to explain an unavailable generating space. */
interface MediaRecoveryVerdict {
  /** The host's structured reason, or another space-level refusal. */
  reason?: string
  /** The host sentence retained for unknown ids and non-generation refusals. */
  recovery?: string
}

/** Known space and persisted media ids mapped to their generated artefact. */
const ARTEFACT_BY_ID: Record<string, 'image' | 'audio' | 'video' | undefined> = {
  gallery: 'image',
  images: 'image',
  soundstage: 'audio',
  sound: 'audio',
  motion: 'video',
}

const COMPATIBILITY_KEY: Record<'image' | 'audio' | 'video', BarKey> = {
  image: 'brains.media.recovery.image',
  audio: 'brains.media.recovery.audio',
  video: 'brains.media.recovery.video',
}

/**
 * Render the same localised sentence in the launcher and Brains pane.
 * @param id - a space id or its persisted media-preset id.
 * @param verdict - the host's structured reason and fallback sentence.
 * @param t - the ui-bar namespace translator.
 * @returns localised generation recovery, or the host fallback for another refusal.
 */
export function mediaRecoveryText(
  id: string,
  verdict: MediaRecoveryVerdict,
  t: (key: BarKey) => string,
): string {
  if (verdict.reason === 'no-backend') return t('brains.media.recovery.noBackend')
  if (verdict.reason === 'no-compatible-model') {
    const artefact = ARTEFACT_BY_ID[id]
    if (artefact !== undefined) return t(COMPATIBILITY_KEY[artefact])
  }
  return verdict.recovery ?? ''
}
