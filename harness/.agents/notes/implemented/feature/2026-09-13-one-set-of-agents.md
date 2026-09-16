# Agent Note: one set of agents in three sidebar states, and a bar Stage Manager leaves alone

Status: implemented

JJ, on the landing-32 build: "the agents that show in the three sidebar states are all still different. and minimode completely blanks the rest of the screen and is positioned incorrectly as well."

## Problem

**Each home read a different set.** The expanded sidebar lists every workspace's visible rows and then the loose ones, in a per-workspace order it persists (`dsh.workspace.view.v5`, ui-workspace's view store). The collapsed rail asked the host for every project grouped (`all=1`), and the host grouped comm's roster: every persisted session with a name, including the five blank chats the sidebar hides. The floating bar followed the project of its own current session, which differed from the main window's. Three reads, three sets.

**The landing-32 build shipped the old host.** `pnpm --filter @idealize/askbar run bundle` bundles `lib/types/*.js`, which only `tsc -b` emits; a `--noEmit` typecheck leaves it stale, so the packaged `lib/index.js` predated `assembleGroupsOf` while every test passed against `src/`.

**Stage Manager owned the bar.** JJ's Mac runs Stage Manager. It shoves a regular window off its strip (the bar's `x` went 0 → 153, and `askbarPosition` was saved that way) and, when the main window hides on collapse, it leaves the stage empty: a black screen with the bar on it.

## Decision

**One selection, read by both rails.** `selectEverything` returns what the expanded sidebar shows: each workspace's first five rows (the sidebar's cap before Show more, which resets on every remount) in the order the sidebar renders, then the first five loose rows. The rendered order is the persisted order with the sidebar's promotion applied: under `updated` ordering, rows touched since the sidebar last synced lead, newest first. That promotion is what made the order differ: the sidebar re-syncs only while it is mounted, so after a collapse the rail showed the stale persisted order and the next expand promoted the chats that had worked meanwhile. It excludes what the sidebar excludes (subagent children, archived, Studio chats, blank chats other than the current one) so the blank chats comm still names never reach a chip, while the sidebar's New Session row does. The floating bar is a second page on the same origin, so `readSidebarOrder` and `readCurrentSession` read the view store's and the selection store's localStorage entries directly, and `follow()` re-selects on the page's `storage` event.

**The host groups only what it is sent.** `GET /idealize/askbar/roster?all=1&sessions=…` runs `assembleGroupsOf`, which keeps the ids' order and groups them by their project; without `sessions=` the route still serves comm's whole roster for a caller that wants it.

**The bar is a panel, and the collapse hands activation on.** On macOS the bar's BrowserWindow is `type: 'panel'`, which Stage Manager does not manage. A panel alone does not empty the stage problem: an active app whose last regular window hid stays active with nothing to show, and Stage Manager shows the desktop — the black screen JJ saw on the second collapse (the first came from a click that had not activated the app). Once the main window has hidden, `AskbarWindow.yieldActivation` calls `app.hide()`, which activates the next app, and shows the bar again with `showInactive()`; the expand calls `app.focus({ steal: true })` before showing the main window. Hiding the bar gives a panel's extra width back first. `remember()` re-asserts the placed bounds for two settle windows after `place()` so an OS shove does not become the saved position, and `widen()` returns to the exact rest bounds. The `askbarPosition` Stage Manager wrote is removed from JJ's live settings at install.

## Alternatives considered

**Publish the sidebar's rendered rows from the WorkspaceBrowser.** An effect there could write the displayed order into a shared client store the rails read. The floating bar is a second page, so an in-memory store never reaches it, and the sidebar unmounts while the column is collapsed, so the rail would read a store nobody updates. The persisted order is already the displayed order, and both pages can read it.

**Apply the sidebar's ordering rules in the bar.** Recency promotion, the manual order and the Updated/Manual switch live in ui-workspace's view state; copying them means two implementations of one rule. Reading the persisted result keeps one.

**Keep the bar as a regular window and fight Stage Manager with levels.** `setAlwaysOnTop` levels and `setHiddenInMissionControl` were tried in the main process; Stage Manager still moved the window. A panel it leaves alone, but a panel alone left the app active on an empty stage, so the collapse also hides the app: measured on a scratch instance, `app.hide()` made the next app frontmost and `showInactive()` put the bar back on screen (CGWindowList) without making this app frontmost.

## Consequences

- Scratch instances over copies of live data (Notes, then JJ's own workspaces): the host's grouped roster held the same ids the bar sent, and the expanded sidebar, the collapsed rail and the floating bar read the same rows in the same order. 140 askbar tests and 64 desktop askbar/runtime tests pass.
- Landing 33 shipped without the cap and the promotion, and its Stage Manager proof was a non-test: the transform was driven over CDP without the app ever being active, so the app behind "staying frontmost" was the starting state.
- The bar reads two localStorage keys other packages own (`dsh.workspace.view.v5`, `dsh.sessions.current`). A rename there changes the bar's order or its New Session row without a type error; `readSidebarOrder` and `readCurrentSession` fall back to the account order and the page's own selection.
- A client-face package's `bundle` script reads `lib/types`; run `npx tsc -b <package>/tsconfig.json` (emit) before `bundle` and `pack`, and grep the tarball's `lib/*.js` for a symbol the change introduced before vendoring it.
