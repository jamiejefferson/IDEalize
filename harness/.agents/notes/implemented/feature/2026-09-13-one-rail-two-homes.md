# Agent Note: one rail in two homes, and a panel that fits

Status: implemented

JJ, on the landing-30 build: "the narrow side bar is too narrow and shows many non live agents. the two bars should both be the same and both be working. Also the minimode has lost the new chat icon and the pop-outs are cropped."

## Problem

**The two rails were two rails.** `@idealize/askbar` renders one `Rail` component in two homes — the floating bar's own window and the collapsed sidebar — but almost everything about the sidebar home was overridden to fit a 56px column: 36px portraits, an 8px caption, no state, no empty or error line. Landing 30 widened the floating bar to 108px and gave its chips names and states; the collapsed column kept the old treatment, so the same agents read as two different things.

**The collapsed rail listed every project's agents.** Its store asked for the grouped column (`all=1`, a 10 Sep decision), while the floating bar followed the project the sidebar was on. In a workspace with several projects that put chats from folders the person was not in beside the ones they were.

**The floating bar had no New chat.** The sidebar carries one above the rail seat; the bar never had one, and starting a chat meant expanding the window first.

**A panel was cut off at the window edge.** A chip's panel is 300px and the bar's window is the width of its column, so everything past 108px was clipped by the window, not by CSS. Nothing inside the page could fix it.

## Decision

**One rail, one treatment, one width.** `SIDEBAR_COLLAPSED` becomes 108 (the bar's width, and `ASKBAR_WIDTH`'s), the collapsed column's controls centre, and every sidebar-home override in the askbar's sheet goes except one: the project cell's name, which the sidebar's own logo already carries. A chip renders identically in both homes, so `Chip` no longer takes `compact`.

**Both rails follow the project the sidebar is on.** The `all=1` read is retired from the client; the route still serves the grouped column for a caller that wants it.

**The bar's New chat grows the window and starts the chat there.** The bar has no chat surface of its own, so `POST /idealize/askbar/transform { to: 'maxi', open: 'new' }` relays `new-chat` over the host bridge and the main window calls `workspaces.startSession()` — the same path the Studio entry already took.

**The window makes room for a panel.** `POST /idealize/askbar/width { width }` reaches a new `desktopActions.setBarWidth`, which resizes the bar's window and keeps the column on its screen edge: a right-docked bar moves its origin left by what it gains, so the chips never move under the pointer that opened the panel. The renderer pins the column to the same edge inside the wider window and offsets the panel past it. A composition with no desktop shell answers 501 and the bar is a browser tab, where a panel had room all along.

## Alternatives considered

**Render the panel inside the 108px column.** No native change at all, and a 300px panel's task line, summary and ask field do not fit in 108px.

**A second always-on-top window for the panel.** It would follow the bar on every move, drag and display change, and would need its own focus and z-order handling, to solve a problem one `setBounds` solves.

**Leave the collapsed column at 56px and shrink the floating bar to match.** It makes both rails equally unreadable, which is what JJ reported in the first place.

## Consequences

- Two upstream touches, logged in FORK.md: `SIDEBAR_COLLAPSED` and the collapsed column's control alignment. The app-frame spec's drawer concession moves from 336 to 320 because the sidebar takes 52px more.
- `DesktopActions` gains `setBarWidth`, so every bootstrap that constructs the service supplies it.
- `BridgeEventKind` gains `new-chat`.
- The bar posts a width only when the width changes, so an idle bar makes no round trips.

## Evidence

`packages/idealize/askbar/tests/askbar-css.spec.ts` asserts the sheet's only sidebar-home override is the project name and that the bar and its panel are pinned inside the bar's window; `rail.client.spec.tsx` asserts the sidebar home renders name-then-state like the floating one; `askbar-root.client.spec.tsx` asserts the column's order with New chat in it, and that opening a panel asks for a 416px window; `apply.client.spec.tsx` asserts the sidebar rail's read carries no grouped column. `dsh-plugin-desktop/tests/askbar-window.spec.ts` and `desktop-actions.spec.ts` cover the window side.
