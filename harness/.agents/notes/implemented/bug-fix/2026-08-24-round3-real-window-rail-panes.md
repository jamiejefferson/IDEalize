# Agent Note: Round-3 real-window fixes for the rail panes

Status: implemented

## Problem

JJ's round-3 review ran the packaged Electron app (1280×840, compatibility mode) where the headless checks had passed, and hit four faults: the drawer's visible drag handle would not drag; the files pane's actions (add to chat, new file, reveal) read as missing and right-click did nothing; the service hatch chat read as "not working"; and a feedback submit gave no felt confirmation. Reproduction on the packaged surface (playwright-core's Electron launcher over `dsh-plugin-desktop/lib/main.js`, isolated `DSH_HOME` + `--user-data-dir`) localised each one.

## Decision

**Drag: the sidebar concedes to its rail (`columns.ts` step 4).** On the real window the drag machinery worked; the concession chain froze the rendered width. At 1280 (1232 beside the tool rail) the expanded sidebar (280) plus the centre floor (480) capped the drawer at 472 — 52px of travel from its 420 default, which reads as a dead handle — while the store preference silently kept growing past the rendered width. Headless checks passed because they asserted the store value or dragged within the cap. Now, when an open deck/drawer plus `CENTER_MIN` no longer fit, the sidebar drops to `SIDEBAR_COLLAPSED` as a derived value (preference untouched; closing the panel or widening the window restores it), and `AppFrame` renders the conceded sidebar as the collapsed rail (`sidebarRail = cols.sidebar === SIDEBAR_COLLAPSED` drives the attribute, the slot params, and the sidebar handle's visibility). The drawer now drags 320–696 at the default window. Logged in FORK.md (upstream `packages/client/ui-layout`).

**Files: persistent toolbar icons plus a row context menu.** The toolbar gains Refresh (re-lists every loaded directory via a nonce) and a browse-pane toggle (V0's header pattern: browse, new folder, refresh — new file kept), both compact icon buttons; row actions stay hover-revealed and every row additionally opens a right-click menu — Add to chat (files), Reveal in Finder (macOS), Copy path (clipboard with a status confirmation) — because JJ right-clicked and got nothing. V0 reference: `FileExplorerPanel.swift`'s header buttons and `.contextMenu` (Show in Finder / Copy Path).

**Hatch: the missing-model failure becomes actionable.** The pane itself worked; with no model connected the send surfaced only a small error line under the transcript. `MISSING_CREDENTIAL`/`AUTH` prompt failures now render as a notice with a Connect-a-model button that opens the Brains pane (new `openModels` on the injected face). Recorded against the [service-hatch note](../feature/2026-08-24-service-hatch-full-chat.md).

**Feedback: the submit is felt.** On a 200 the pane keeps its "Sent. Thank you." line and additionally raises the done chime plus a notification through a new `ctx.idealizeNotify` service (`@idealize/notify` client half: `notify(title, body)` + `chime()`, honouring the chime settings). ui-bar reaches it through the sanctioned `ctx.get` probe (restated face), so a composition without the notify plugin stays silent rather than broken. The submit itself was already landing (Supabase 200s; the report is in the local backup) — the fault was feedback, not persistence.

**Calendar taps open Create-with-chat** — recorded in the [schedule tap-to-add note](../feature/2026-08-24-schedule-tap-to-add.md) (amended there).

## Alternatives considered

**Let the centre go below its floor while dragging the drawer.** Rejected: the composer becomes unusable, and the pane is usually opened to work beside the chat.

**Shrink the sidebar continuously (280→…→56).** Rejected: the mid-widths render a squeezed, broken sidebar; the binary rail is the shape the sidebar already has for narrow viewports, and the track transition animates the jump.

**Clamp the drag preference to the rendered width.** Rejected: the pure-preference model is what makes recovery automatic on re-widening; with the rail concession the divergence window is a few px at the true ceiling.

**Import `@idealize/notify`'s notifier directly from ui-bar.** Rejected: the client bundle purity gate forbids cross-plugin value imports; a Context service is the sanctioned channel.

## Consequences

Opening the drawer/deck wide on a small window now visibly collapses the sidebar to the rail — deliberate, animated by the existing track transition, and reversible the moment the panel closes. The files pane owns a context menu implementation (fixed-position overlay, Escape/click-away close) that other panes could adopt. `ServiceSectionInjected` and `DrawerPanelInjected` grew one member each (`openModels`, `notifyDone`); `FeedbackPanel` takes `notifyDone` as a prop. Coverage: `columns.client.spec.ts` (rail concession + 1280 window), `files-panel.client.spec.tsx` (menu, copy, refresh), `service-section.client.spec.tsx` (connect notice), `feedback-panel.client.spec.tsx` (notification on success only), `schedule-panel.client.spec.tsx` (seeded create). Packaged-window proofs under `.idealize/proof/r3-*.png`.
