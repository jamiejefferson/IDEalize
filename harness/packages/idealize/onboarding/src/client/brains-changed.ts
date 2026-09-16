/**
 * The document event the welcome card reloads its brain roster and access map
 * on, raised here after the wizard's agents and tools steps commit. Restated
 * from `@idealize/ui-bar/client` (`brains-changed.ts`, the event's home): the
 * wizard and the card share a document and nothing else, and a client bundle
 * inlines every workspace import, so the name travels as the protocol it is.
 *
 * Without it the first New chat after the wizard read "No key for
 * deepseek-official yet" on every brain until a reload, because the card had
 * read its access map once, under the wizard, before any key or model was
 * saved (walked on the packaged build, 14 Sep 2026).
 * @module @idealize/onboarding/client/brains-changed
 */

/** The event name, raised on `document`. */
export const BRAINS_CHANGED_EVENT = 'idealize:brains-changed'

/**
 * Tell every listening surface that the brains, their models or their routes changed.
 */
export function notifyBrainsChanged(): void {
  document.dispatchEvent(new Event(BRAINS_CHANGED_EVENT))
}
