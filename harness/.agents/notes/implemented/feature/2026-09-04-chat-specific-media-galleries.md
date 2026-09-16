# Agent Note: the three media galleries show one chat's work, and Video gets a view

Status: implemented

JJ, 4 Sep 2026: "galleries for sound, image and video should all be chat specific, but save contents in the project folder — with a keep/archive tag as discussed against the image gallery."

## Problem

The three media spaces disagreed about whose work they showed, and one of them showed nothing at all.

- **Images** (`@idealize/ui-gallery`) folded the session log into one row per generation and rendered this chat's images, with Keep / Archive on each tile.
- **Sound Stage** (`@idealize/ui-soundstage`) served its own host route, `GET /idealize/soundstage/sounds?cwd=`, listing every audio artefact in the workspace. A chat that had generated nothing still opened onto a full list, crediting it with work another chat did, and a sound had no verdict: nothing there could keep or archive.
- **Video** (`motion`) had no view package. A chat launched there could generate and never see the result.

Three spaces, two row sources, one gap. The row source Images already used carries every generation the chat ran, whatever it made, so the other two were re-deriving from a worse place.

## Decision

One row source, three views over it, each filtering to its own kind.

`@idealize/ui-gallery`'s Definition already publishes `GalleryRow[]` on the per-session `gallery` target with an `artefactKind` on every row. `rowsOfKind(snapshot, kind)` is now exported from its client contract, and:

- the `gallery` ring entry (Images, order 6) injects `kind: 'image'`;
- a new `motion` ring entry (Video, order 8) injects `kind: 'video'` into the same `GalleryView`;
- `@idealize/ui-soundstage` reads the same `gallery` target and renders the `audio` rows, with the Keep / Archive control the Images grid has.

Video therefore costs one registration and three locale keys rather than a package: the grid was never image-specific, only its empty state was, so the empty copy is per kind (`gallery.empty.{image,video,audio}`) and the rest is shared.

Files keep going to the project folder exactly as before — the artefact store writes them and `POST /idealize/artefacts/disposition` moves them under `…/Archive` — so a chat is where generations are seen and the project is where they live.

## What was deleted

The Sound Stage's whole host half: `src/routes.ts`, `src/types.ts`, its `limit` config field, and the client's `facts.ts` / `rows.ts` that shaped the route's answer. `src/index.ts` now registers nothing and exists only as the package's Host entry point. Under the pre-release stance the route went rather than gaining a shim; nothing outside the view read it. The package's dependencies shrank with it (webserver, workspace, storage, session, the artefact engine), since the client half now fetches only the disposition route by URL.

## Consequences

- **Coupling is type-only.** `ui-soundstage` imports `GalleryRow` / `GallerySnapshot` as types and inlines the one-line `audio` filter. A value import of `rowsOfKind` would make its client bundle resolve through `ui-gallery`'s built `lib/client.js`, coupling the two builds for a filter.
- **The Sound Stage no longer has a Refresh button.** The rows come from the live conversation snapshot, so there is nothing a refresh could fetch.
- **A generation whose `tool/call` fell out of the loaded window renders in no view.** That limit was already true of Images; it now applies to all three. Recovering older work means paging back, not a listing route.
- **The aspect and count controls stay on Images.** They gate on the `gallery` view id. Video needs aspect and length, which the strip does not carry yet.

## Alternatives considered

**Give Video its own package.** It would have duplicated the grid, the enlarge overlay, the fold and the verdict for a different `artefactKind` string. The kind is data, so it became a prop.

**Keep the project-wide sound listing beside the chat-specific one.** Two lists in one space would have to explain which is which, and the project-wide one has a better home: one media-type-parameterised listing on `@idealize/artefacts`, if a project-wide view is ever wanted for all three kinds at once.

## Evidence

Tests: `packages/idealize/ui-gallery` 40, `packages/idealize/ui-soundstage` 24 (`entry.client.spec.tsx` proves the entry shows this chat's audio and neither another kind nor a missing target), `packages/idealize/spaces` 73, plus `gen-fixture`; `pnpm run lint`, `pnpm run typecheck` and `pnpm run doc-sync` clean.

Both rendered proofs were rewritten onto the new source and re-run:

- `ui-gallery`'s proof gains a chat that generates an image, a clip and a sound, and renders it through both ring entries. Images showed one tile and no video or audio element; Video showed one tile whose `<video>` streamed `/idealize/artefacts/raw?id=` and no image or audio element; the aspect and count controls were present on Images and absent on Video; the Video empty state read "No video yet".
- `ui-soundstage`'s proof no longer boots a listing route. It runs the real `generate_audio` tool into four chats and folds the log through ui-gallery's Definition, then asserts three rows naming files under `Sounds/`, a tone reaching `readyState` 4 at 1.0s with `currentTime` advancing off the raw route, Archive moving the file under `Sounds/Archive` and the row into the fold with Keep moving both back, the in-flight row, the provider's cause with one Retry, and an empty state that says the chat is empty.

The Sound Stage proof caught a layout fault no test could: the new verdict button was a third child of a two-column grid, so it wrapped underneath and overlapped each row's file path. The row is now three columns and the verdict shows on hover like the Images grid's, and the archived fold gained the styling it had never had.
