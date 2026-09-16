# @idealize/host-bridge

The notification feed behind `ctx.idealizeBridge`: one place where the host turns an event a person cares about into a feed a shell surfaces as toasts and badges. The Electron desktop app and the plain browser tab (`@idealize/notify`) read the same feed. The `idealize-host-bridge` row of the `idealize` profile bundle mounts it.

## Sources

- `idealize/cron-run` from `@idealize/cron` → `cron-run`, titled `<task name> — <status> in <seconds>s` with the run's `detail` as body. The invariant companion fails the run if a finished schedule is not in the buffer by the time the emit's listeners have run.
- `idealize/cron-changed` from `@idealize/cron` → `cron-changed`, titled `Calendar changed` with an empty body: the task list was written (added, edited, toggled, deleted, or a one-off recorded done), so the Schedule pane refetches it. No shell toasts it.
- `agent/status` → `agent-finished` when an agent that was running goes idle.
- `agent/error` → `agent-error` with the error message.
- The approval waterfall → `approval-pending` on `approval/request`, then `approval-decided` after `next()` returns; the bridge observes and never decides.
- `@idealize/notify` pushes `attention` when a recorded Studio event alerts the person under the MVP policy table, carrying the alert's words, its `project` and the `studioEvent` it names; the window raises one notification and opening it opens that event.
- `@idealize/comm` pushes `mail`, `notify`, `focus` and `reveal` events into the same buffer; `@idealize/askbar` pushes `open-studio` (with the bar's `project` as context when it has one; the main window opens the one Studio chat, which spans every project) when the Askbar's Group chat button is pressed.

## Buffer

`BridgeBuffer` is a capped in-memory ring of 200 events with live subscriber fan-out. Each event carries a monotonic per-process `seq`, an ISO-8601 `at`, `kind`, `title`, `body`, the `sessionId` it belongs to when it has one, on an `attention` event the `studioEvent` it names, and on an `open-folder` event the `folder` the shell is asked to open as a project. A throwing subscriber is contained so the others still receive the event. Nothing persists: a restart begins at `seq` 1 with an empty ring.

## Routes (loopback, read-only)

- `GET /idealize/events/recent?since=<seq>` → retained events after the cursor, oldest first (`0` for everything retained).
- `GET /idealize/events/stream?since=<seq>` → server-sent events: the retained backlog after the cursor, then one `data:` JSON line per new event until the client disconnects.

## Model Experience

None, as the package observes host events and serves them to shells; nothing it holds enters a model request.

#### KV Cache effect

Independent: no request is touched, so no prefix changes and no reuse is invalidated.

## Known Limitations and Deferred Work

- **The ring holds 200 events and forgets them on restart.** A shell that reconnects with a `since` cursor older than the retained window, or after a host restart, misses whatever fell out; the cap is a constant rather than a configuration field.
- **Agent finish detection is a status heuristic.** An agent is reported finished on the first idle after a running spell, so a turn that pauses for an approval and resumes produces one finish per pause.
