/**
 * The in-window "open the Studio" signal. The floating bar reaches the Studio
 * through the transform route, which relays `open-studio` over the host
 * bridge feed to the main window; the sidebar rail already sits in the main
 * window, so it raises the request on the document instead and the same
 * listener (`@idealize/ui-bar`, the one Studio-opening rule) answers both.
 *
 * A document event rather than a service because the rail and the bar's
 * client share a document and nothing else: neither may value-import the
 * other's bundle. This module holds one constant and two DOM calls so any
 * plugin bundle can inline it without sharing runtime state.
 * @module @idealize/askbar/src/client/studio-request
 */

/** The event name, raised on `document`. */
export const OPEN_STUDIO_EVENT = 'idealize:open-studio'

/** What one request carries: the Studio event to land on, when it has one. */
export interface StudioRequestDetail {
  /** A Studio event id the view should land on (an answered alert names one). */
  studioEvent?: string
}

/**
 * Ask whoever owns the Studio chat to open it in this window.
 * @param studioEvent - the Studio event to land on; omitted opens the Studio as it stands.
 */
export function requestStudio(studioEvent?: string): void {
  const detail: StudioRequestDetail = studioEvent === undefined ? {} : { studioEvent }
  document.dispatchEvent(new CustomEvent<StudioRequestDetail>(OPEN_STUDIO_EVENT, { detail }))
}

/**
 * Run `listener` on each request until the returned disposer is called.
 * @param listener - what to run on a request; it receives the named Studio event, when one was named.
 * @returns the disposer.
 */
export function onStudioRequest(listener: (studioEvent?: string) => void): () => void {
  const handle = (event: Event): void => {
    listener((event as CustomEvent<StudioRequestDetail | null>).detail?.studioEvent)
  }
  document.addEventListener(OPEN_STUDIO_EVENT, handle)
  return () => { document.removeEventListener(OPEN_STUDIO_EVENT, handle) }
}
