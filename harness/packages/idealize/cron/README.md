# @idealize/cron

The person's one calendar: durable scheduled agent runs and reminders behind `ctx.idealizeCron`. Tasks (name, schedule, prompt, workspace, optional model, `remind`) persist in one JSON document under the Harness home (`idealize-cron.json`, whole-document atomic writes). At fire time the service creates an agent in-process in the task's workspace, the same recipe as the headless runner, sends the prompt as one user message, waits for the turn, and records the outcome and the session id in run history. A task with an empty prompt is a reminder and runs no agent. The `idealize-cron` row of the `idealize` profile bundle mounts it; `@idealize/ui-schedule` is the calendar that shows and edits it, every agent writes it through the `calendar_add` / `calendar_list` / `calendar_remove` tools, and `@idealize/host-bridge` forwards each finished run and each task-list change to the notification feed.

## Schedules

Four shapes, validated by `invalidReason`: `at` (one ISO-8601 instant; the task fires once, records `done`, and stays listed so the person sees it happened), `every` (a fixed interval of at least 60 seconds), `daily` (`HH:mm` in an explicit IANA zone) and `weekly` (the same time and zone on chosen `days`, 0 = Sunday to 6 = Saturday; `WEEKDAYS` is Monday to Friday). `nextFire` computes repeating rules against the wall clock at each arm, so a sleeping laptop reschedules on wake instead of firing a burst; a one-off returns its instant, so an overdue one-off arms with no delay. `saveTask` refuses a one-off whose instant has passed unless the task already carries `done`, so renaming a fired reminder still saves.

## Run semantics

One run per task at a time: an overdue fire while one runs is recorded `skipped-busy`. Fires missed while the server was down are recorded `missed` and never replayed; the next live fire re-arms from the wall clock. An executed run records `ok` or `error` with `durationMs` and the session id, plus `detail` from the turn's error when there is one; a reminder's run records `ok` with `detail: reminder` and no session. Every finished run emits `idealize/cron-run(run, task)`; the invariant companion fails the run if an executed run carries no duration or a skipped one carries a duration. `CronStore` keeps the newest 500 runs.

A task marked `remind` (every reminder is) raises a desktop notification at each fire, title = the task name, body = the fire time in the task's zone (`Tue 8 Sep, 14:00`), through the desktop shell's `desktopActions.notify` face, the same face `@idealize/notify`'s `/idealize/notify/native` route uses. The notification goes out before the agent run starts, so a slow run does not delay it. With no desktop shell composed the notification is dropped; the run and the feed entry are unaffected.

A one-off fire writes `done` on the task before the run is announced, so a pane refetching on the change already reads it fired. Every committed task-list write (add, edit, toggle, delete, done) emits `idealize/cron-changed`, which the host bridge forwards as a `cron-changed` feed event.

The task's `provider` and `model` select the run's model; absent, the deployment default (`agentDefaultModel`) applies at fire time.

## Routes (loopback; mutations need `x-idealize-auth: 1`)

- `GET /idealize/cron/tasks` → every task with `nextFireAt` (enabled, not done) and `running`.
- `POST /idealize/cron/tasks` → JSON body creates (no `id`) or updates a task; refuses an invalid schedule, a past one-off, an empty prompt without `remind`, or a relative `cwd` with 400.
- `POST /idealize/cron/delete?id=`, `POST /idealize/cron/toggle?id=` (flips `enabled`), `POST /idealize/cron/run-now?id=`.
- `GET /idealize/cron/runs?task=` → run history, optionally filtered.

## Model Experience

### The calendar section

#### What the model sees

One prompt section (`CALENDAR_SECTION`, name `idealize:calendar`, order 122 in the tool-guidance band, after `@idealize/artefacts`' folders section) registered through `dsh-system-prompt` on every composition that mounts this package.

##### The calendar section

```markdown
The calendar tools (calendar_add, calendar_list, calendar_remove) are the person's calendar, shown in the Schedule pane; a reminder or scheduled task set any other way does not reach it and will not fire once this chat closes.
```

#### Token effect

Fixed: one sentence on every request of every session.

#### KV Cache effect

Prefix-stable: the text is constant, so it does not invalidate reuse.

### The `calendar_add` tool

#### What the model sees

One tool definition with a required `title`, exactly one of `at` (ISO-8601 datetime, one-off), `every_seconds` (integer, at least 60), `daily_at` (`HH:mm`) or `weekly_at` (`HH:mm`) with `weekly_days` (0 = Sunday to 6 = Saturday), an optional `time_zone` (the description names the host's zone as the default), an optional `prompt`, and an optional `remind`. The description says the entry is the person's calendar, appears in the Schedule pane at once, fires whether or not the chat is open, that an entry without a prompt is a reminder that notifies with the title, and that a past `at` is refused. The entry runs in the calling chat's project (`cwd` from the session header); a chat without one fails the call.

#### Token effect

A fixed schema cost on every request of every session.

#### KV Cache effect

Prefix-stable while the host's zone is unchanged; the zone appears in one parameter description.

### The `calendar_add` result

#### What the model sees

One line: `Added "<title>" to the calendar (<id>): <rule>; next <instant>; the person will be notified.` (the two trailing clauses when they apply), backed by the entry object (`id`, `title`, `schedule` as a sentence, `nextFireAt`, `done`, `enabled`, `remind`, `prompt`, `cwd`). A refused call (past `at`, two selectors, no project folder, weekly without days, an interval under 60 seconds) fails with the scheduler's reason.

#### Token effect

Small and fixed-shape per call.

#### KV Cache effect

Append-only: results follow the reusable prefix.

### The `calendar_list` tool and result

#### What the model sees

One tool with an optional `include_done` (default true) whose description tells the model to call it before answering any question about what is scheduled. The result is one line per entry, `- <title> (<id>): <rule>; fired <instant>` / `; next <instant>` / `; paused`, or `The calendar is empty.`, backed by an array of the entry object above. Every entry in the document is listed, whichever project it belongs to; `cwd` names the project.

#### Token effect

One line per calendar entry per call.

#### KV Cache effect

Append-only.

### The `calendar_remove` tool and result

#### What the model sees

One tool with a required `id`; the result is `Removed calendar entry <id>.` or `No calendar entry has the id <id>.`, backed by `{ id, removed }`.

#### Token effect

Fixed and small per call.

#### KV Cache effect

Append-only.

### The scheduled task prompt

#### What the model sees

Exactly one user message per fire whose text is the task's `prompt` verbatim, sent into a fresh session created in the task's `cwd` with the task's or the default model. A reminder (empty prompt) sends nothing to any model. Everything else in that request (system prompt, tools, workspace context) belongs to the composed plugins the agent factory mounts, not to this package.

#### Token effect

The prompt's own length once per fire; nothing is retained between fires because every fire is a new session.

#### KV Cache effect

Independent: each fire is a new session with its own prefix, so no other session's reuse is affected and none is inherited.

## Known Limitations and Deferred Work

- **Cron-expression parsing is not offered.** The four schedule shapes cover the Schedule pane's controls and the calendar tools; a raw cron string has no field to land in and `invalidReason` rejects any other shape.
- **A missed fire is never replayed.** A task whose fire passed while the server was down records `missed` and waits for its next slot; a one-off whose instant passed while the server was down fires as soon as the server arms it, which is the only catch-up.
- **Runs are in-process and serial per task.** A long-running task blocks its own next fire (`skipped-busy`) and shares the host process with interactive chats; there is no worker isolation or concurrency limit across tasks.
- **Notifications need the desktop shell.** A plain-browser composition has no `desktopActions`, so a reminder's fire reaches the feed and the pane but raises no notification; the browser half's Web Notifications fallback covers the chime only.
- **The calendar tools list every project's entries.** The document is one calendar; a chat in one project sees another project's entries with their `cwd`. Per-project scoping would need a filter the pane also applies.
