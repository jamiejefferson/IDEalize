# Agent Note: one calendar for agents and the pane — calendar tools over the cron store, a one-off kind that records done, a fire that notifies, and a pane that follows the store

Status: implemented

JJ, 8 Sep 2026, on the landing build: "Calendar action, once created, doesn't appear in the calendar." and "Calendar action - also set a reminder and it didn't fire."

## Problem

The Schedule pane read and wrote `@idealize/cron`'s task document over its routes and was the only writer. An agent asked for a reminder had no tool that reached that document: the vendored `@deepseek-ai/dsh-schedule` tools (`schedule_create` and friends) are session-local live timers folded from session events, and the IDEalize bundle does not compose them, so whatever the agent did in chat was either a promise or a timer that died with the chat. Nothing fired a desktop notification when a cron task ran: `POST /idealize/notify/native` had one caller, the browser's chime banner. The pane refetched on mount and after its own writes only, so a task written by anyone else stayed invisible until the drawer was closed and reopened. `Schedule` had no one-off kind, so "remind me at 2" had no field to land in.

## Decision

**The cron store is the calendar, and the agent writes it through tools.** `@idealize/cron` gains `calendar_add` (title; exactly one of `at`, `every_seconds`, `daily_at`, `weekly_at` + `weekly_days`; optional `time_zone`, `prompt`, `remind`), `calendar_list` and `calendar_remove`, registered on every composition with a tools registry, writing through the same `saveTask` / `taskViews` / `deleteTask` the routes call, in the calling chat's project (`cwd` from the session header; a chat without one fails the call). Render intent is `generic`. **`Schedule` gains `at`**, one ISO-8601 instant; `nextFire` returns it whatever the arm time, `saveTask` refuses a past instant unless the task already carries `done`, and a fire writes `done` on the task before announcing the run, so the task stays listed as fired rather than vanishing. **A fire notifies.** A task marked `remind`, and every task with an empty prompt (a reminder, which runs no agent), raises `desktopActions.notify` with the task name and the fire time in the task's zone, before the agent run starts; the sink is a constructor option so tests pass a recorder, and the default probes the desktop shell the way `@idealize/notify`'s route does. **The store announces writes.** `CronStore` takes an `onTasksChanged` hook that the service turns into `idealize/cron-changed`; `@idealize/host-bridge` forwards it as a `cron-changed` feed event with no payload. **The pane follows the feed.** `ScheduleView` opens `/idealize/events/stream` after the newest retained sequence and refetches on `cron-changed` and `cron-run`; one-offs render on their own day badged ONCE, then DONE (dashed, struck through) once fired; the editor offers Once in REPEAT with a date-and-time RUN AT, a NOTIFY toggle, and lets a blank-prompt reminder save with `remind` set. **The prompt says so.** One sentence at order 122 (`idealize:calendar`) tells every agent the calendar tools are the person's calendar and that a reminder set any other way does not reach it.

## Alternatives considered

**Bridge `dsh-schedule`'s tools onto the cron store.** Their contract is session-local (ids, list and delete scoped to the live agent; persistence through session events); the calendar is one document for every chat and the pane. Rewriting their semantics under their names would mislead a model trained on the description. New names with a calendar vocabulary were cheaper and truer; the bundle composes neither `dsh-schedule` row, so there is no collision to disable.

**Call `/idealize/notify/native` over HTTP from the cron service.** The route and the service run in one process; the route's whole body is a probe of `desktopActions`. Cron probes the same face directly, which also frees the host face of a dependency on a client-face package (`@idealize/notify` compiles under the client tsconfig).

**A `SessionEventMap` member for calendar changes.** The change is host state with no owning session; the bridge feed already reaches the pane, and a new session event would have needed the `ignorable` envelope for nothing.

**Remove a one-off after it fires.** The person would not see that the reminder happened; JJ's report was that a reminder "didn't fire", which a vanished entry cannot answer. Listed-as-done is the evidence.

## Consequences

Two writers share one document, so the pane's own-write refresh is now redundant with the feed refresh and stays as the fallback for a composition without the bridge. The host bridge's `cron-run` invariant (newest buffer event after the emit is the run) holds because the one-off's `done` write, and its `cron-changed`, are committed before `cron-run` is emitted. `calendar_list` lists every project's entries with their `cwd`; per-project scoping is deferred. Tests: `cron/tests/calendar.spec.ts` (tools happy path and refusals, fire → recorded notification, done and event order, prompt section), `cron/tests/store.spec.ts`, `cron/tests/schedule.spec.ts` (one-off cases), `ui-schedule/tests/schedule-view.client.spec.tsx` (one-off on its day, DONE tone and badge, the editor's fired footer and notify row, refetch on a `cron-changed` frame through a fake EventSource).
