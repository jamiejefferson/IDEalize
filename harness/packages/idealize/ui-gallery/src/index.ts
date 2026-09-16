/**
 * @idealize/ui-gallery — Host loader entry for the browser-only Gallery mode.
 *
 * The Gallery reads what it renders from the session log the host already
 * writes (`tool/call`, `tool/result`, `artefact/created`, `artefact/failed`)
 * and fetches artefact bytes from `@idealize/artefacts`' existing
 * `GET /idealize/artefacts/raw?id=` route, so this half contributes no host
 * behaviour and serves no routes of its own.
 * @module @idealize/ui-gallery
 */

/** Stable Cordis plugin name. */
export const name = 'idealize-ui-gallery'

/** Contributes no host-side behaviour; the whole mode is the browser half. */
export function apply(): void {}
