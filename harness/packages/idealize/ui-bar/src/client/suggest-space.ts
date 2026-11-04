/**
 * The welcome card's guess that a message belongs in a media space (Paper
 * "Brains rethink", board 06). It only offers: the person chooses with one
 * click, or carries on where they are. So it reads for an ask to make the
 * thing, because "fix the logo on my site" is not a request for a picture.
 * @module @idealize/ui-bar/client/suggest-space
 */

import type { SpaceId } from '@idealize/spaces/client'

/** The spaces the guess can point at. */
export type SuggestedSpace = Extract<SpaceId, 'gallery' | 'soundstage' | 'motion'>

const MAKE = String.raw`^\s*(?:please\s+|can you\s+|could you\s+)?(?:make|create|generate|draw|paint|render|design|produce|compose)\s+(?:me\s+|us\s+)?(?:an?\s+|some\s+|the\s+|\w+\s+|\d+\s+)*?`

const ASKS: readonly (readonly [SuggestedSpace, RegExp])[] = [
  ['motion', new RegExp(`${MAKE}(?:video|clip|animation|film|reel)s?\\b`, 'i')],
  ['soundstage', new RegExp(`${MAKE}(?:sound|sound effect|song|jingle|voiceover|music|soundtrack|melody)s?\\b`, 'i')],
  ['gallery', new RegExp(`${MAKE}(?:image|picture|photo|poster|logo|illustration|drawing|painting|icon|wallpaper)s?\\b`, 'i')],
]

/**
 * Read a draft for an ask to make media.
 * @param draft - the composer's text.
 * @returns the space it suits, or undefined when it reads as anything else.
 */
export function suggestSpace(draft: string): SuggestedSpace | undefined {
  return ASKS.find(([, ask]) => ask.test(draft))?.[0]
}
