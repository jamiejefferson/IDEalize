# Agent Note: Mini mode as V0's five-tab frame

Status: implemented

English | [中文](2026-08-24-desktop-mini-shell-five-tabs.zh.md)

## Problem

Mini mode docked correctly (mini-dock.ts) but the frame rendered only the conversation and the overlay layer: no banner, no session list, no panes — and its layout service lacked `openDrawer`/`openDeck`, so the vendored appearance follower's ⌘⌥A path threw in mini. V0's mini is a compact five-tab column (Chat, Chats, Files, Doc, Style) with a chat switcher, an expand control, and ⌃⌥M toggling the mode from anywhere.

## Decision

**MiniFrame renders V0's frame.** A banner strip (`shell.banner`), a drag header with the new `MiniChatSwitcher` and the expand button, one surface at a time over a bottom five-tab bar. The root registration declares all seven children — `sidebar`, `conversation`, `details`, `shell.overlay`, `shell.banner`, `shell.drawer`, `shell.deck` — and the vendored occupants (announcement banner, rail panes, deck viewer, sidebar) seat themselves through deferred slot injection. Every surface stays mounted with only the active one visible, so the conversation keeps its draft and scroll; the chat surface takes `zoom: 0.72` under `body[data-dsh-desktop-mode="mini"]` (the appearance system's per-surface scale mechanism, not a token override).

**`MiniViewStore` + `MiniLayoutAdapter` (mini-view.ts) turn `ctx.layout` transitions into tab switches.** `openDeck` lands on Doc, a drawer open lands on Files, closes return to Chat, and Doc is gated while no file is open. `DesktopLayoutService` (contracts.ts) is widened with the drawer/deck methods; the advanced `DesktopLayoutState` implements them as no-ops because its frame hosts no drawer column. Followers inside `ctx.inject(['idealizeBar', 'appearance'], …)` refine the drawer tab (Style while the appearance pane is open) and mirror the deck's file into the Doc gate; every write passes the store's idempotence guards, so follower and adapter never loop.

**Exit stays restart-based.** The expand button POSTs the existing `/idealize/bar/minimode` route; ⌃⌥M (`isModeToggleShortcut`, matched on the physical key in `before-input-event` beside the zoom shortcuts) toggles mini⇄advanced (compatibility on Linux) through `spec.requestModeChange`. Mode is baked into profile composition, the renderer URL and the window options, so the settings watcher restarts the app; the persisted pre-mini frame restore carries the perceived continuity. Accepted gap: no in-place animation.

**Proof:** `scripts/mini-frame-proof.mjs` (`verify:mini-frame`) boots the full profile against a temp DSH home whose settings select `mode: mini`, loads the mini renderer URL in a hidden BrowserWindow, and asserts the body marker, banner node, header controls and the five-tab bar, writing a PNG and a JSON report.

## Alternatives considered

- **In-place mode switching without a restart.** Rejected: mode is baked into profile composition, the page URL, and BrowserWindow construction; the pre-mini frame restore already covers V0's perceived continuity.
- **Mini-owned pane state.** Rejected: the vendored rail's `ctx.idealizeBar` and `ctx.appearance` stay the single writers of which pane is open; mini follows their state instead of forking it.
