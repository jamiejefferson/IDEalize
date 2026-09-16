/**
 * `@idealize/ui-soundstage` — the Sound Stage's Host face.
 *
 * It contributes no host behaviour. The Sound Stage renders one chat's own
 * generation rows out of the conversation snapshot, and `@idealize/artefacts`
 * serves the bytes and records the Keep / Archive verdict, so this face exists
 * only to give the plugin a Host entry point beside its Client one.
 *
 * Until 4 Sep 2026 it served `/idealize/soundstage/sounds`, a project-wide
 * listing of every audio artefact in the workspace. JJ settled the galleries
 * for sound, image and video as chat-specific that day, which left the route
 * with no reader; it was deleted rather than shimmed.
 * @module @idealize/ui-soundstage
 */

import type { Context } from '@deepseek-ai/cordis'

/** Cordis plugin name. */
export const name = 'idealize-ui-soundstage'

/**
 * Mount the Sound Stage's host face.
 * @param _ctx - Host context; unused, this face registers nothing.
 */
export function apply(_ctx: Context): void {
  // Deliberately empty: see the module note.
}
