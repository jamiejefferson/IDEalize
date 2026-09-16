/**
 * The "show me this file" signal a gallery raises for one artefact: the
 * Images grid, the Video grid and the Sound Stage each carry a Reveal beside
 * their Archive, and the tool rail answers by opening the Files pane on the
 * file (JJ, 7 Sep 2026: "a 'reveal' that opens the file pane showing you
 * where the file is").
 *
 * A document event rather than a service because the galleries and the rail
 * share a document and nothing else: neither may value-import the other, and
 * the galleries know the file only by the project-relative path the artefact
 * record carries. The listener resolves that path against the project root it
 * already tracks. This module holds one constant and two DOM calls so any
 * plugin bundle can inline it without sharing runtime state.
 */

/** The event name, raised on `document`. */
export const REVEAL_ARTEFACT_EVENT = 'idealize:reveal-artefact'

/** What a reveal request carries: the artefact's storage path, relative to the project root. */
export interface RevealArtefactDetail {
  relPath: string
}

/**
 * Ask whoever owns the Files pane to show one artefact's file.
 * @param relPath - the artefact's project-relative storage path (`storage.relPath`).
 */
export function requestReveal(relPath: string): void {
  document.dispatchEvent(new CustomEvent<RevealArtefactDetail>(REVEAL_ARTEFACT_EVENT, { detail: { relPath } }))
}

/**
 * Run `listener` with each requested path until the returned disposer is called.
 * @param listener - what to run on a request.
 * @returns the disposer.
 */
export function onRevealRequest(listener: (relPath: string) => void): () => void {
  const handle = (event: Event): void => { listener((event as CustomEvent<RevealArtefactDetail>).detail.relPath) }
  document.addEventListener(REVEAL_ARTEFACT_EVENT, handle)
  return () => { document.removeEventListener(REVEAL_ARTEFACT_EVENT, handle) }
}

/** The event name raised on `document` when an artefact's file has landed in the project. */
export const ARTEFACT_LANDED_EVENT = 'idealize:artefact-landed'

/**
 * Tell whoever lists the project's files that an artefact has landed, so a
 * listing that predates it (its folder may be new) is read again.
 * @param relPath - the artefact's project-relative storage path (`storage.relPath`).
 */
export function announceArtefact(relPath: string): void {
  document.dispatchEvent(new CustomEvent<RevealArtefactDetail>(ARTEFACT_LANDED_EVENT, { detail: { relPath } }))
}

/**
 * Run `listener` with each landed artefact's path until the returned disposer is called.
 * @param listener - what to run on a landing.
 * @returns the disposer.
 */
export function onArtefactLanded(listener: (relPath: string) => void): () => void {
  const handle = (event: Event): void => { listener((event as CustomEvent<RevealArtefactDetail>).detail.relPath) }
  document.addEventListener(ARTEFACT_LANDED_EVENT, handle)
  return () => { document.removeEventListener(ARTEFACT_LANDED_EVENT, handle) }
}
