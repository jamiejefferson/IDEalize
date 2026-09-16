# Agent Note: Reveal on a generated artefact opens the Files pane on its file

Status: implemented

JJ, 7 Sep 2026: "the archive button is great - please add a 'reveal' that opens the file pane showing you where the file is."

## Problem

A generated image, clip or sound shows its project-relative path in the enlarged view and on the Sound Stage row, and nothing else. Finding the file meant reading that path, opening the Files pane, and clicking down the folders by hand. The pane already had Reveal in Finder per row, but nothing took a person from an artefact to its row.

Two seams were missing. `ctx.idealizeBar` could open a pane and a file in the deck, but could not point the Files pane at a path: the pane kept `expanded` and `selectedDir` as its own React state with no writer outside it. And the galleries could not call the bar at all: `@idealize/ui-gallery` and `@idealize/ui-soundstage` may not value-import `@idealize/ui-bar`, and a plugin bundle's `/client` entry is the loader bundle itself, which cannot be inlined.

## Decision

**`ctx.idealizeBar.revealFile(path)` on the service face.** It writes `reveal {path, nonce}` into the bar's view store and shows the Files pane. The pane picks the tab whose root holds the path, the project tab first because the projects root holds every project, makes the file's folder the creation target, and hands the request to that tab's tree. The tree unfolds the root, expands every folder between the root and the file, re-lists the file's folder (a fresh artefact postdates any listing the pane made earlier), then marks the row `data-revealed`, scrolls it into view and calls back so the store clears. The light goes out on the next click anywhere or after four seconds. The nonce is what makes revealing the same file twice two requests. A path under no tab's root leaves the pane open with a status line saying so.

**The galleries raise a document event, not a service call.** `@idealize/artefacts` exports `requestReveal(relPath)` and `onRevealRequest(listener)` over the `idealize:reveal-artefact` event from `src/client/reveal.ts`: one constant and two DOM calls, no state. Every consumer imports that module by its `src/client/reveal.ts` path, so each plugin bundle inlines it; the `/client` entry cannot be the import because it is the loader bundle. The choice follows `ui-bar`'s own `brains-changed.ts`: two surfaces that share a document and nothing else.

**`ui-bar` resolves the path.** The artefact record carries only the project-relative storage path, and `@idealize/artefacts` writes it under the workspace holding the producing chat. The listener takes the workspace whose `sessionIds` include the active chat, falling back to the chat's cwd while the workspace list has not placed it, and calls `revealFile` with the join. With no chat open it logs a warning and does nothing.

## Alternatives considered

**A `revealArtefact(relPath)` method on `ctx.idealizeBar`, called by the galleries.** Rejected: the galleries cannot value-import `@idealize/ui-bar`, and reaching the service through `ctx.get('idealizeBar')` would make each gallery restate the bar's face and the project-root resolution, which is the bar's knowledge, not theirs.

**Restating the event name in each gallery instead of importing the artefacts module.** Rejected: three copies of one string with no owner, and the payload field name beside it; the `src/client/reveal.ts` import keeps one home for the contract at the cost of one dependency edge.

**Sending the absolute path from the gallery.** Rejected: the artefact record carries only `storage.relPath`, and the galleries have no project root of their own; adding one would mean a second reader of the workspace list for a fact the bar already resolves for its project tab.

## Consequences

`@idealize/ui-bar` and `@idealize/ui-soundstage` gain `@idealize/artefacts` as a dependency for the one module. Reveal sits beside Archive on the Images and Video tiles and the enlarged view (`data-gallery-reveal`) and beside the Sound Stage verdict (`data-soundstage-reveal`), with the same button treatment; the tile corner became an actions group so the two share the hover reveal. The Files pane's `revealAncestors` and the lit row are proven in `files-panel.client.spec.tsx`; the service and the event resolution in `reveal.client.spec.ts`, which shares the composition bench with `apply.client.spec.ts` through `apply-bench.client.ts`.
