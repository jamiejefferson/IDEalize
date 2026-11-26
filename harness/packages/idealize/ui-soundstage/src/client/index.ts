/**
 * Sound, browser half. It registers nothing.
 *
 * Until 26 Nov 2026 this package held the `soundstage` seat in the
 * conversation view ring and drew the chat's sounds as their own list. Image,
 * Video and Sound are now one history in one grid (JJ: "i want it to retain
 * the previous prompts and outputs"), so `@idealize/ui-gallery` holds all
 * three seats and this half is left with the plugin's entry point alone.
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

/** Required services: none. */
export const inject: readonly string[] = []

/**
 * Client plugin body.
 * @param _ctx - client root context; unused, this half registers nothing.
 */
export function apply(_ctx: ClientContext): void {
  // Deliberately empty: see the module note.
}
