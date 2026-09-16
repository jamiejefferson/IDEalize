/**
 * The signal that the brains changed: the Brains pane raises it after any
 * save that alters what the welcome card offers — a brain added, renamed or
 * moved between spaces, a model or CLI chosen, a service key stored, the
 * provider editor closed — and the first-run wizard raises it after its
 * agents and tools steps commit (`@idealize/onboarding` restates the name);
 * the welcome card reloads its roster and access map on it.
 *
 * A document event rather than store state because the two surfaces share a
 * document and nothing else: the pane lives in the drawer, the card in the
 * conversation hero, and neither holds the other's data. Without it the card
 * kept saying "No brains yet" after its own Add-a-brain flow had saved one
 * (JJ, 7 Sep 2026), until the next chat re-mounted it.
 */

/** The event name, raised on `document`. */
export const BRAINS_CHANGED_EVENT = 'idealize:brains-changed'

/**
 * Tell every listening surface that the brains, their models or their routes changed.
 */
export function notifyBrainsChanged(): void {
  document.dispatchEvent(new Event(BRAINS_CHANGED_EVENT))
}

/**
 * Run `listener` on every change until the returned disposer is called.
 * @param listener - what to run on a change.
 * @returns the disposer.
 */
export function onBrainsChanged(listener: () => void): () => void {
  document.addEventListener(BRAINS_CHANGED_EVENT, listener)
  return () => { document.removeEventListener(BRAINS_CHANGED_EVENT, listener) }
}
