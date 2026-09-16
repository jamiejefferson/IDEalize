# Agent Note: Wave C3 — files that can be moved, renamed, edited and dropped into the chat

Status: implemented

The Files slice of JJ's 28 Aug review (plan: `.idealize/plans/feedback-wave-c-plan.md`): "Files should be draggable between the finder and the browser views and into the chat", "Right-click should include" (the line stops there), "File should be editable", "Header icons for add to chat, reveal in finder", and, from the layout items, "every column, including the file viewer and its menu, becomes draggable; drag handles exist but sit in the wrong place". The pane, the viewer and the routes are `@idealize/ui-bar`'s; the handles are upstream `@deepseek-ai/dsh-client-ui-layout`'s, logged in `FORK.md`.

## Problem

The Files pane could list, create, reveal and hand a path to the chat, and nothing else: no rename, no move, no delete, and the only way to get a path into the composer was the row's hover action. The viewer was read-only, with Reveal as a text button and no Add to chat at all. The frame's deck and drawer handles were placed at `frameWidth − deck − drawer` and `frameWidth − drawer`, which is the border between the rail and the pane; the rail rides the pane's inner edge, so the border a person sees for that pane is the one between the centre content and the rail, one rail-width to the left. Grabbing the visible edge grabbed nothing.

## Decision

**Five fenced routes carry the file operations**: `write` (text, refused with 409 when the file's size no longer matches the size the editor loaded), `rename` (one validated path component, 409 on a taken name), `duplicate` (`name copy`, `name copy 2`, …, folders recursively), `move` (into a fenced folder, never into itself or a descendant, 409 on a taken name) and `trash` (the desktop shell's `desktopActions.trashItem`, Electron's `shell.trashItem`, when the shell is composed; else `osascript` asking the Finder to delete on macOS, which raises a one-time automation prompt; the item lands in the Trash and can be put back). Every path resolves through the existing home-plus-roots viewer fence. `GET /idealize/bar/capabilities` gains `trash`.

**Rows drag.** A row sets `application/x-idealize-path` and `text/plain` to its path. Folder and root rows in both trees accept the payload as a move and light an accent ring while hovered; a drop on the entry's own folder posts nothing. A document-level listener in the bar's client treats a drop on `[data-composer-card]` as Add to chat, through the same draft-append the row action uses, and prevents the textarea's native paste of the path, which would bypass the composer's draft machine.

**The row menu grows.** Files: Open, Add to chat, Reveal in Finder, Copy path, Rename…, Duplicate, Move to Trash. Folders: Reveal, Copy path, New file here, New folder here, Rename…, Duplicate, Move to Trash. Rename reuses the name sheet seeded with the current name. Move to Trash arms on the first click and goes on the second, the item reworded in between ("Click again to move to Trash"), and appears only where the capabilities row reports `trash`. JJ's list was cut off, so this is the assumed set; the plan carries the open question.

**The viewer edits.** Add to chat and Reveal in Finder are header icons with tooltips. A complete text envelope offers Edit: a monospace textarea over the file's text, Save (also ⌘S) through `write` with the loaded size, Cancel and Escape discarding. A 409 keeps the editor and its text up with "The file changed on disk. Close the editor to reload it." A truncated read offers no Edit, because saving it would write the truncation back.

**The deck and drawer handles sit on the visible border.** Deck: `frameWidth − rail − deck − drawer`. Drawer: `frameWidth − drawer` while the deck is open (the deck | drawer border has no rail), `frameWidth − rail − drawer` otherwise. The frame measures itself in layout px (`offsetWidth`), because the appearance size applies CSS `zoom` to `#root`: `getBoundingClientRect` scales with it while the grid tracks and the handles' inline `left` do not, so at interface size 12 (zoom 0.923) the handles sat 8% too far right and a drag moved the column faster than the pointer. Pointer deltas are divided by the measured zoom for the same reason.

## Alternatives considered

- **A dedicated code editor in the viewer.** The request is "editable"; a textarea saves the file without a dependency, and the highlighted read view returns on save. An editor with highlighting is a later decision if editing turns out to be frequent.
- **Delete outright, with an in-app confirmation dialog.** The Finder's Trash is reversible and the dialog would be one more modal; the two-click item keeps the confirmation in place.
- **Native HTML5 drag onto the textarea only.** Browsers paste `text/plain` into a textarea on drop, which would insert the path behind the composer's draft controller. The document listener owns the drop so the draft stays one fact.
- **`rename()` for move across devices.** `fs.rename` fails across filesystems (`EXDEV`); the fence is home plus the workspace roots, which sit on one volume in every composition seen so far. Recorded under Known Limitations in the README if it bites.

## Consequences

`files-panel.client.spec.tsx` pins the two menus, rename through the sheet, duplicate's failure surface, the two-click trash and the drag-move with its own-folder refusal; `file-viewer.client.spec.tsx` pins the header icon, Edit/⌘S/Save with the loaded size, the 409 path and Cancel, and no Edit on a truncated read; `aliases.client.spec.ts` drives the five routes on a real temp tree, including the fence refusals; `app-frame.client.spec.tsx` pins the handle positions with the rail measured.

A file changed by the agent while the editor is open is refused on save rather than clobbered; the person closes the editor and reopens it. Moving a folder into the vault or the projects root is a real filesystem move the agent will see on its next listing.
