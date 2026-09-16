# Agent Note: A3 first commit — the Studio pane on the tool rail

Status: implemented

The askbar plan's A3 slice starts with the shared surface: `@idealize/ui-studio`, a browser-only drawer pane rendering one project's coordination — the lead's synthesis with its staleness, the tasks holding unresolved attention, every task with state and owner, each participant's work view with presence, and the recent timeline with a way back into each source chat.

## Problem

A2 built the coordination record (`@idealize/studio`: the durable per-project event timeline, the task fold, presence, three loopback routes) with no surface over it. The only reader was the Askbar roster's fold summary; nobody could see a project's tasks, attention, or timeline inside the app.

## Decision

**A section-service pane, the Schedule template exactly.** The client bundle purity gate forbids cross-plugin value imports, so the package provides `studioSection` (`Component` + `face()`) and `@idealize/ui-bar` renders it from the Context, as `scheduleSection` and `trajectorySection` before it. The host half is a Loader-mount stub; the invariant companion records `No runtime invariant` (the package owns no events or durable data).

**The pane follows the active chat's project.** `face()` exposes `currentCwd` off the sessions list; the view polls `sync(currentCwd())` every 3 seconds while mounted. One Studio view serves every chat, so the face takes no session.

**The store owns the view, not the component.** The drawer unmounts a closed pane; a plugin-owned snapshot store (project, folded state, timeline tail, error) means reopening lands on the same view with no blank flash. Sync reads `GET /idealize/studio/state` whole and `GET /idealize/studio/timeline?since=` incrementally, keeps the newest 200 events, carries a monotonic token so a slow response for a superseded project is dropped, and keeps stale data visible under a stated failure cause with Retry.

**Source navigation opens the chat.** The timeline's `source.thread` drives `sessions.open` (rebranded to `SessionId` at the wire re-entry). FR-P0-23's position restore waits on a conversation scroll-to-event seam; the README's Known Limitations records it.

## Alternatives considered

**A conversation view-ring tab.** Rejected: the ring became the space mechanism, and Schedule and Trajectory already left it for the rail for exactly that reason (JJ, 26 Aug). Coordination is not a space.

**Rendering deliveries as their own section.** Deferred: the fold's per-event delivery states arrive with the state read, but no consumer needs a delivery ledger yet; a delivery surfaces through the task attention it raises. The README records the gap.

**A change stream instead of polling.** Rejected for this commit: `@idealize/studio` publishes no client stream, and building one for a 3-second freshness need is premature — and the landing found each SSE stream costs a scarce loopback connection in the packaged app, so a new app-lifetime stream needs the connection budget argued first. The README records the poll as a limitation.

**Scroll-to-event navigation now.** Deferred to a later A3/A4 commit: it needs a seam on the conversation surface, not on this package.

## Consequences

- The rail gains a Studio entry between Schedule and Trajectory; `BarPanel` gains `'studio'`; JJ may re-seat it on review.
- `studioSection` joins the fork's client section services: catalog row in `gen-cordis-catalog.ts`, README-owned API, ui-bar injection.
- The pane's registration spec proves the built `lib/client.js` artifact (ModuleLoader handoff, DI require, service provide/dispose, plugin-tagged CSS), so `pnpm --filter @idealize/ui-studio bundle` must precede it or it skips.
- Timeline rows older than the newest 200 fall off the pane; the source chats keep them.
- The packaged-window proof for the pane lands with a later A3 commit, per the plan's slice order.
