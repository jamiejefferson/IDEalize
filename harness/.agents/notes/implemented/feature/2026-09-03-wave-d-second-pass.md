# Agent Note: Wave D second pass — Studio is a pinned chat, generated media saves where the user can see it

Status: implemented

JJ's 3 Sep answers to the two open questions in `.idealize/plans/feedback-wave-d-plan.md` (items 2 and 8 of the 2 Sep review). This pass ships both across the harness; the desktop landing that follows carries them.

## Problem

Studio sat on the tool rail as a drawer pane, so a project's group chat opened as a side panel on top of whatever chat was current and had no place in the sidebar's model of "one project, its chats". Generated images saved to `<project>/.idealize/artefacts/<yyyy-mm>/<id>.png`, a hidden folder the user never chose, and the Gallery repeated each image's prompt, type and size under a small tile. Aspect and count sat on their own row above the composer. Nothing recorded whether an image was worth keeping.

## Decision

- **Studio is a `studio` space that nothing launches** (`@idealize/spaces`). `SpaceDefinition.launchable?: false` marks it; `LAUNCHABLE_SPACES` / `LAUNCHABLE_SPACE_IDS` feed the chooser, the roster and `parseSpaces`, so no brain lists it and the chooser never offers it. `POST /idealize/spaces/select` accepts it, which is how a Studio chat is minted: `connectWorkspace` for a blank chat, then the space record, then open. The ring seed lands the chat on the `studio` view; the composer seat is retired by CSS the way Terminal's is.
- **One pinned card above every project** (`@idealize/ui-bar`'s `StudioCard` on the new `sidebar.workspaces.pinned` seat that `WorkspaceBrowser` renders while wide and unsearched). V0's lead-agent card shape (JJ's screenshot), without its toggle or dismiss: Studio, the project's title, a presence dot from the Studio host, an attention count, `aria-current` while the project's Studio chat is the current chat. The project is the current chat's, else the first listed. Clicking finds the project's `studio` chat or mints one.
- **Studio chats are hidden from the tree and skipped by New chat's blank reuse** (`tree.ts` `sessionVisible`, runtime `workspaces/service.ts`). The card is the chat's only door; a blank-for-life chat must never be recycled as someone's next chat.
- **The Askbar's Group chat hops through the host bridge.** `POST /idealize/askbar/transform {to:'maxi', open:'studio', project}` pushes an `open-studio` bridge event before the transform; ui-bar listens on `/idealize/events/stream?since=<latest>` and opens the named project's Studio.
- **Media saves to visible project folders the user names** (`@idealize/artefacts`). The `idealize-artefacts` settings section holds `images`/`sounds`/`video`/`other`/`archive` (defaults `Images`, `Sounds`, `Video`, `Artefacts`, `Archive`), validated by `FOLDER_PATTERN` (project-relative, no `..`). Files are `<folder>/<yyyy-mm-dd>_<id8>.<ext>` so Finder sorts by day. A `settings.general.item` row edits them; a change applies to the next generation. The raw route's fence widens to the project root because the folders are now anywhere inside it.
- **Keep / Archive is a disposition on the record.** `setDisposition(id, 'archived')` moves the file under `<folder>/<archive>/`, `'kept'` moves it back; the record's path follows and `artefact/disposition {artefactId, disposition, relPath, sourceTask}` (ignorable) is appended to the producing chat while it is live. `POST /idealize/artefacts/disposition` (loopback + `x-idealize-auth`) is the Gallery's verb. The event carries `sourceTask` so the Gallery's per-call Definition can match it without a second index.
- **Gallery tiles are image-only at 240px minimum.** Prompt, type, size, aspect and path live in the enlarged view with Keep / Archive; archived tiles fold under "Archived (n)". Aspect and count move to the composer's tool row (`conversation.input.left`).

## Alternatives considered

- A Studio toggle in the Projects header, as V0 had: a project's group chat is open at all times, so a card that can be dismissed would only add a way to lose it.
- Listing Studio chats in the tree under their project: they would read as ordinary chats with rename/fork/archive, none of which a per-project singleton should offer.
- Keeping `.idealize/artefacts` and adding a Finder "Reveal": the user's request was a conscious choice of save location, which a hidden folder cannot be.
- Deleting on Archive: irreversible from the Gallery with no confirmation flow; moving is reversible and the file stays in the project.
- Tagging disposition on the session log only: the store is the source of truth for an archived chat's records, so the record carries it and the event mirrors it.

## Consequences

- `SPACE_IDS` has six entries and roster/chooser code must map `LAUNCHABLE_SPACES`, never `SPACES`, when offering a launch.
- Three upstream touches logged in FORK.md: `ui-workspace` `WorkspaceBrowser.tsx` (pinned seat), `tree.ts` (hide `studio`), runtime `workspaces/service.ts` (reuse skip).
- `ARTEFACTS_DIR` is gone; `@idealize/gen-tools` and `@idealize/ui-soundstage` fixtures name `Images/…` and `Sounds/…` paths.
- The `sidebar.workspaces.pinned`, `conversation.input.left` and `settings.general.item` seats gain IDEalize occupants; the client slot catalog regenerates.
- Proofs: `studio-proof.mts` (card, canvas open, one Studio chat per project, both themes) and `gallery-proof.mts` (enlarged view path, Archive and Keep through the real route, both themes).
