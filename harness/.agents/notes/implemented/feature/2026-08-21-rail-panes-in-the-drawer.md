# Agent Note: Rail panes in the drawer

Status: implemented

English | [中文](2026-08-21-rail-panes-in-the-drawer.zh.md)

## Problem

JJ's review of the session screen (2026-08-21) pinned five amends on the right-edge rail. Two rail entries opened modals (the Service hatch settings modal on the wrench, the settings dialog renamed to match), the contrast entry cycled light/dark/system while the six-tab Appearance panel floated on the overlay layer, a Terminal entry duplicated the Chat/Terminal choice already made in the composer and the session tabs, the session header carried a blue Chat/Terminal capsule beside the Chat | Terminal | Trajectory tabs, and the drawer forgot its dragged width on every close.

## Decision

**Every rail entry opens a pane in `shell.drawer`.** `@idealize/ui-bar` keeps one bare snapshot store (`bar-store.ts`) whose `panel` field is written only by the plugin body: `showPanel`/`closePanel`/`togglePanel` move the drawer through `ctx.layout` and the rail, drawer and deck read the store through one `useBarView` hook. The Service hatch is a pane with a Service tab (V0's hatch chat over a real session in the source checkout) and a Composition tab (the `/idealize/hatch` page). The `settings.section` registrations and the "Service hatch" trigger/header shadows are gone, so the sidebar-foot button opens an ordinary Settings modal again; ui-settings' `settingsOpen` seam stays in place unused.

**The Appearance pane is the appearance plugin's panel, seated by the bar.** `@idealize/appearance` no longer registers into `shell.overlay`; its `ctx.appearance` service carries `Component`, `face()` and `store`, and the bar binds `useAppearance` and the `idealize-appearance` copy once and renders the component inside the drawer. Visibility is the service's own `open` flag: the bar subscribes to the store and mirrors it (open → show the pane, close → close the drawer), and the rail button calls `togglePanel('appearance')`, which opens or closes the service. ⌘⌥A, `ctx.appearance.open()` and the rail button therefore land in the same place. The panel's root fills its host instead of positioning itself.

**No Terminal entry on the rail.** The composer's launcher and the view ring own the Chat/Terminal choice.

**The header capsule is gone; ⌘J stays.** `@idealize/ui-terminal` registers `ModeShortcut`, a null-rendering occupant of `conversation.session.header.actions` that shares the chat entry's store so the shortcut can call `setView`. The ring's tabs are the visible switch.

**The drawer remembers its width.** `ui-layout`'s store reads the last dragged width from `localStorage` (`dsh.layout.drawer`, clamped into the drawer range) on `openDrawer` and writes it on `setDrawer`; storage failures read as unset. The other panels keep forgetting theirs.

**The drawer can move at the desktop window's default size.** `CENTER_MIN` is 480 (was 640): at 1280 wide, with the 280 sidebar and the 48 rail, the 640 floor left the drawer clamped to its 320 minimum in both directions, so a drag changed nothing. At 480 the drawer moves between 320 and 472 with the sidebar open, and up to 696 with it collapsed. The details, deck and drawer handles always show a 4×32 pill on the column border; hovering the 10px strip or dragging widens it to 6×48 in the accent colour and tints the strip, and the cursor is `col-resize`. The pill used to appear only on hover, which read as "not draggable".

## Alternatives considered

**Keep the bar's own `open` flag for the Appearance pane and call the service only to load fonts.** Rejected: two flags for one visible state drift the moment ⌘⌥A or `openAppearancePanel()` fires from elsewhere.

**Move ⌘J into the plugin body with a window listener.** Rejected: the chat store's bound `setView` action is only handed to slot occupants, and the invisible occupant reuses the existing registration path.

**Persist every panel width.** Rejected for this piece: JJ asked for the drawer; widening the change to the sidebar and details columns changes upstream behaviour nobody reviewed.

## Consequences

The settings modal carries General and plugin sections only. Anything that wants the Service chat or the composition page opens the drawer through the rail. A future caller of `ctx.appearance.open()` gets the drawer pane without knowing about the bar. FORK.md records the `ui-layout` store touch.
