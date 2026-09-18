# @idealize/ui-studio

The Studio view: every project's coordination at a glance (JJ, 3 Sep 2026: "the studio is for all projects"), filling the conversation column — per project, the coordinator's synthesis, the tasks holding unresolved attention, every task with its state, each participant's work view with reachability (its active task, else "Finished, safe to close" when the fold names a finished task, else Idle) — and one timeline merged across projects, each addressed row offering the way back to its source chat. Under it sits the chat's ordinary composer. The header is the title alone: the Studio belongs to no one project and needs no explainer under its name.

There is one Studio chat: a chat in the `studio` space (`@idealize/spaces`), opened from the pinned Studio card in the sidebar (`@idealize/ui-bar`, which mints the chat the first time). This package registers the `studio` entry of the conversation view ring, the composer's `@` agents source, and the `studioSection` service the card reads.

## What it owns, and what it does not

`@idealize/studio` owns every coordination record: the durable per-project event timeline, the ids it mints, the task-state fold, presence, and the loopback route fence. This package holds none of that. It reads `GET /idealize/studio/overview` (every stored project's state, presence and recent timeline) and `GET /idealize/notify/attention` (where the person has read to); the composer's sends reach `@idealize/studio` through the host's own `agent/pre-step` listener, never through a route this package calls.

The one thing it writes is the read position (`POST /idealize/notify/attention/read`), because showing the Studio is what reads it. It resolves nothing: a request stays open until the answer it asked for is recorded, whatever the person has read or dismissed (FR-P0-19).

## Reading, landing, and what a request's row says

Rows past a project's stored read position carry `data-studio-unread`, and the pinned Studio card counts them beside — never instead of — the tasks holding unresolved attention. While the view is mounted it moves each project's position to the newest event it shows.

The newest timeline rows sit at the foot, as in a chat, so the view opens scrolled to its foot (JJ, 15 Sep 2026) and follows new rows while the reader is there; a reader who scrolled up keeps their place until they return to the foot, and an empty Studio has nothing to scroll to. An alert the person opened names its Studio event: `@idealize/notify` asks this window for it, `@idealize/ui-bar` hands it to the store, and the view lands on that row once (`data-studio-focused`, scrolled into the middle) and then lets go, so a later poll does not move the page under the reader. A request-shaped row (`needs-input`, `needs-action`, `blocked`) carries its recorded resolution — **Waiting for you** while the fold still holds it against a task, **Answered** once it does not — so an alert opened after the answer shows the answer and offers nothing to answer again.

The package registers **no session event type** and needs no host half; its host entry exists only so the Loader can mount it.

## The section service

The client bundle purity gate forbids cross-plugin value imports, so the pinned card in `@idealize/ui-bar` reaches the Studio state through the Context, exactly as `scheduleSection` and `trajectorySection` do (FORK.md).

`ctx.studioSection` carries:

| Member | What it is |
|---|---|
| `Component` | the `StudioView` component |
| `face()` | the wired props: the store-bound `useStudio` selector hook, `sync`, `openThread` (source navigation: `conversation.revealAt` aimed at the event's instant, then `sessions.open`), `takeFocus`, `markRead`, and the bound translate |
| `store` | the shared Studio store, so a consumer can poll (presence, attention, unread) without mounting the view, and `focus(event)` lands the view on one event |

One store serves the one Studio, so `face()` takes no session and the store-bound hook is stable across calls. The service's disposer is the view's lifecycle: dropping it removes the ring entry and the `@` source with it.

## The composer and the `@` menu

The Studio chat keeps the ordinary composer (JJ, 3 Sep 2026: "the same ask bar as other views"). The view sets `data-conversation-composer-overlay`, ui-conversation's contract for a view that scrolls itself, so the seat overlays the view's foot and the body clears the seat's live height (`--dsh-composer-height`). A send never reaches a model: `@idealize/studio` takes a `studio`-space chat's message at `agent/pre-step`, delivers a leading `@name` to that participant on its own project or records the rest as a group post on every project, and rejects the step.

Typing `@` opens the composer's trigger menu (`@deepseek-ai/dsh-client-ui-input-trigger`); this package registers the "Agents" source: every chat carrying an `agentName` projection across every project, the project folder's name as the hint, inserting `@Name ` as plain text. The source is not gated to the Studio chat, since any chat may address an agent.

## What survives, and for how long

Leaving the Studio chat unmounts the view, so its data (every project's folded state and recent timeline) lives in a plugin-owned store rather than component state: coming back lands on the same view without a blank flash, and the next poll refreshes it. Nothing persists in the browser; the host's timeline is the record.

A sync landing after a newer one has started is dropped rather than written, so a slow response cannot overwrite the current view.

## Load states

The first read says so; a failed read states its own cause (`Cause: HTTP 503`) and offers **Retry** while keeping the last good view visible, because stale coordination beats none. With no tasks, no events and no synthesis anywhere, the view shows the owl (`StudioOwl`, `data-studio-owl`: the shared `OwlMark` from `@deepseek-ai/dsh-client-ui-primitives` at 120px, which plays V0's run cycle once on appear and again on hover, and holds its resting frame under `prefers-reduced-motion`) over one line, "Nothing here yet. Message everyone below, or @name to ask one agent." (JJ, 8 Sep 2026: "I'd like the owl to live here, rather than the placeholder copy").

## Rendered proofs

`packages/idealize/ui-studio/proof/studio-proof.mts` boots the whole assembled `idealize` profile — the shipped sidebar, tool rail and composer — against a scratch `HOME` and `DSH_HOME` it refuses to run without, at 1280x840 in both themes:

```sh
OUT=.idealize/proof pnpm exec tsx packages/idealize/ui-studio/proof/studio-proof.mts
```

It seeds the coordination record through `@idealize/studio`'s own routes in a first boot the browser never touches (assignments and task updates through `/event`, one addressed message through `/deliver`), so what the pane later reads is genuinely a pre-existing record. It writes `studio-{open,reveal,composer,error}-{light,dark}.png` plus `studio-audit-{light,dark}.json`, and fails the run unless the pinned card sits above the projects naming the active chat's project while the rail buttons enumerated off the DOM carry no Studio, pressing the card opens the Studio view in the centre column with the composer seat retired and the card reading current, the project tree lists no row for the Studio chat, the host lists exactly one `studio` chat for the project after each theme's boot (the dark theme reopens the light theme's chat), the view renders the stale-marked synthesis, the unresolved-attention row apart from the full task list, both seeded tasks under their ids, per-agent rows with presence honestly unreachable (no seeded owner is a live session), and the delivered message's Open chat link; a 503 on both routes produces a stated cause and a Retry **while the stale view stays visible**, Retry recovers once the routes answer again, and the timeline file on disk is byte-identical after the whole round trip (the pane is a reader; reading is not a migration).

## Model Experience

None, as the pane is a browser-only view over `@idealize/studio`'s loopback routes: it reads state, opens chats, and registers nothing model-facing.

#### KV Cache effect

Independent: the package produces no request and touches no request prefix.

## Known Limitations and Deferred Work

- **`openThread` lands at the turn, not the exact event.** Open chat aims `conversation.revealAt` at the studio event's instant and the chat mount scrolls to the turn nearest it (FR-P0-23). Two gaps remain: a reveal aimed at the already-current chat waits for its next mount, and a target older than the loaded history lands on the transcript head rather than auto-paging.
- **Read position is per project, not per event.** One number per project says how far the person got; an event read out of order still leaves everything after it unread.
- **The pane polls.** `@idealize/studio` publishes no client change stream; a 3-second interval is the freshness. A subscription seam would remove the round trips and the interval both.
- **Deliveries render only through task attention.** The fold's per-event delivery states (`queued`/`delivered`/`acknowledged`/`expired`) are read but not listed as their own section; a delivery only becomes visible when it raises a task's attention. A dedicated delivery ledger is deferred until a consumer needs one.
