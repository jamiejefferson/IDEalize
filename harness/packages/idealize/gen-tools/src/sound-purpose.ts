/**
 * What a sound model is for. A speech model reads its input aloud, so a
 * music or sound-effects prompt sent to one comes back as a voice reading
 * the prompt; the two kinds never stand in for each other.
 */

import type { GenModelInfo } from '@idealize/generate'

/** The words a catalogue uses for a model that makes music, effects or ambience. */
const SOUND = /music|song|sfx|sound[- ]?effects?|instrumental|soundtrack|text-to-audio|ambien[ct]/
/** The words a catalogue uses for a model that speaks its input. */
const SPEECH = /\btts\b|text[- ]to[- ]speech|speech|dialogue|podcast|voice[- ]clon|narrat|voice-?over/

/**
 * Whether one piece of catalogue text settles the question.
 * @param text - lower-case text.
 * @returns true for speech, false for sound, undefined when it says neither.
 */
function reading(text: string): boolean | undefined {
  if (SOUND.test(text)) return false
  if (SPEECH.test(text)) return true
  return undefined
}

/**
 * Whether an audio model reads text aloud. The id decides first, then the
 * name and tags, then the description; a model none of them describes is
 * taken to make sound, the commoner case.
 * @param model - the catalogue row.
 * @returns true for a speech model.
 */
export function speaks(model: Pick<GenModelInfo, 'id' | 'name' | 'tags' | 'description'>): boolean {
  return reading(model.id.toLowerCase())
    ?? reading([model.name, ...model.tags ?? []].join(' ').toLowerCase())
    ?? reading((model.description ?? '').toLowerCase())
    ?? false
}
