# Session-local Schedule

Schedule owns durable reminders that return to the original live Session as ordinary later conversation turns. The [durable Schedule Agent Note](../../.agents/notes/implemented/feature/2026-08-05-durable-web-schedule.md) owns the persistence and lifecycle decisions, [conversational delivery](../../.agents/notes/implemented/simplification/2026-08-09-conversational-schedule-delivery.md) owns the no-receipt boundary, the [explicit time-zone boundary](../../.agents/notes/implemented/simplification/2026-08-09-explicit-schedule-time-zone.md) owns browser-local interpretation, and [bounded fixed-rate Schedule](../../.agents/notes/implemented/simplification/2026-08-09-bounded-fixed-rate-schedule.md) owns recurrence. This page records the durable and model-facing shapes from [`packages/schedule/schedule/src/types.ts`](../../packages/schedule/schedule/src/types.ts); the [package README](../../packages/schedule/schedule/README.md) owns composition, tool behavior, and the exact reminder framing.

## Durable records

`ScheduleId` is a [branded id](core.md#branded-ids), unique and never reused within one Session. Version 1 supports a positive safe-integer `after_seconds` delay, an explicit absolute `at` target, or a safe-integer `every_seconds` interval of at least five minutes. Creation canonicalizes every first target into a four-digit-year RFC 3339 UTC `scheduledAt`; an `after` record retains its submitted delay, an `at` record stores only the resulting instant, and an `every` record retains its fixed interval and next target.

```ts type-equiv
/** Durable one-shot reminder created from a positive delay. */
interface AfterScheduleRecord {
  /** Session-local stable identity. */
  readonly id: ScheduleId
  /** Rule discriminator for a delayed one-shot reminder. */
  readonly kind: 'after'
  /** Trimmed reminder content supplied at creation. */
  readonly prompt: string
  /** Positive safe-integer delay accepted at creation. */
  readonly afterSeconds: number
  /** Four-digit-year RFC 3339 UTC target. */
  readonly scheduledAt: string
}
```

```ts type-equiv
/** Durable one-shot reminder created from an absolute instant. */
interface AtScheduleRecord {
  /** Session-local stable identity. */
  readonly id: ScheduleId
  /** Rule discriminator for an absolute one-shot reminder. */
  readonly kind: 'at'
  /** Trimmed reminder content supplied at creation. */
  readonly prompt: string
  /** Four-digit-year RFC 3339 UTC target. */
  readonly scheduledAt: string
}
```

```ts type-equiv
/** Durable fixed-rate reminder whose next target remains creation-anchor-aligned. */
interface EveryScheduleRecord {
  /** Session-local stable identity. */
  readonly id: ScheduleId
  /** Rule discriminator for a fixed-rate recurring reminder. */
  readonly kind: 'every'
  /** Trimmed reminder content supplied at creation. */
  readonly prompt: string
  /** Fixed safe-integer interval, never below five minutes. */
  readonly everySeconds: number
  /** Earliest anchor-aligned occurrence not yet dispatched. */
  readonly scheduledAt: string
}
```

```ts type-equiv
/** One-shot record variants that terminate on an id-only dispatch. */
type OneShotScheduleRecord = AfterScheduleRecord | AtScheduleRecord
```

```ts type-equiv
/** The v1 durable reminder record union. */
type ScheduleRecord = OneShotScheduleRecord | EveryScheduleRecord
```

## Absolute-time input

The `at` selector is either a strict offset-bearing RFC 3339 string or an exact local-calendar object. The local form keeps its interpretation explicit at the tool boundary:

```ts type-equiv
/** Structured local-calendar input accepted by `schedule_create`. */
interface LocalAtInput {
  /** Four-digit ISO calendar date. */
  readonly date: string
  /** Local wall-clock time with optional one-to-three digit milliseconds. */
  readonly time: string
  /** Explicit UTC or IANA Area/Location zone. */
  readonly time_zone: string
}
```

```ts type-equiv
/** Absolute selector accepted by `schedule_create`. */
type AtInput = string | LocalAtInput
```

The official Web overlay samples the browser's IANA zone for every prompt. Time-context tells the model to interpret otherwise-unqualified natural-language dates and times in that request-local zone when the open turn has one unambiguous browser zone; mixed or missing provenance tells the model to ask. That guidance is not a durable Session default: the model must still pass an offset in the string form or `time_zone` in the local form, and Schedule never reads browser, Session, process, or model context.

Schedule rejects invalid offsets and zones, offset-free strings, non-future targets, and local times inside daylight-saving gaps. A daylight-saving overlap chooses its first, earlier instant. Successful creation stores only canonical UTC `scheduledAt`, so replay never depends on ambient time-zone state.

## Fixed-rate input and catch-up

`every_seconds` is a per-record interval of at least 300 seconds, anchored to creation time. It is fixed-rate recurrence only: the protocol has no calendar or Cron expression, recurrence time zone, shared cooldown, or cross-record admission gate.

When a Session was cold or busy across several targets, one Every record contributes only its latest due occurrence. The dispatch advances it directly to the first creation-anchor-aligned target after the dispatch decision time, without enumerating, persisting, or replaying missed intervals. If that next target cannot fit in a four-digit UTC year, the final dispatch terminates the record.

When multiple distinct Every records are overdue and no one-shot is due, each contributes one occurrence to the same follow-up batch in target and creation order. Every record keeps independent state, while all dispatches in that admitted batch use the same decision time. Batching bounds model turns; the five-minute minimum bounds each record's timer frequency.

## Durable changes and replay

The version-1 `schedule/change` Session event is the only durable Schedule authority. Create stores the complete record, and delete is a terminal id-only transition. A one-shot dispatch is also terminal and id-only. An Every dispatch carries the wall-clock decision time used to select its latest due occurrence and normally advances the active record instead of terminating it. Dispatch means the follow-up was synchronously queued, not that a model answer succeeded or the user read it.

```ts type-equiv
/** Creates one durable reminder record. */
interface ScheduleCreateChange {
  readonly version: 1
  readonly operation: 'create'
  readonly schedule: ScheduleRecord
}
```

```ts type-equiv
/** Deletes one currently active reminder. */
interface ScheduleDeleteChange {
  readonly version: 1
  readonly operation: 'delete'
  readonly id: ScheduleId
}
```

```ts type-equiv
/** Records that one active one-shot reminder entered the durable dispatch history. */
interface OneShotScheduleDispatchChange {
  readonly version: 1
  readonly operation: 'dispatch'
  readonly id: ScheduleId
}
```

```ts type-equiv
/** Records one fixed-rate decision and advances directly past missed occurrences. */
interface EveryScheduleDispatchChange {
  readonly version: 1
  readonly operation: 'dispatch'
  readonly id: ScheduleId
  /** Wall-clock decision time used to select the latest due occurrence. */
  readonly acceptedAt: string
}
```

```ts type-equiv
/** Durable dispatch shapes supported by the current rule set. */
type ScheduleDispatchChange = OneShotScheduleDispatchChange | EveryScheduleDispatchChange
```

```ts type-equiv
/** Strict version-1 durable Schedule mutation union. */
type ScheduleChange = ScheduleCreateChange | ScheduleDeleteChange | ScheduleDispatchChange
```

The strict decoder and fold reject unknown versions, extra fields, reused ids, mismatched one-shot or Every dispatch shapes, and delete or dispatch transitions against inactive records. A normal Session folds its complete event stream. A fork folds only events at or after `SessionHeader.seedLength`, so it retains history without adopting the parent Session's active reminders. The `schedule/change` declaration and source location are also indexed in the [persistence catalog](../persistence-catalog.md#schedulechange--log-only).

## Active views and management

Tool values combine the durable record with delivery state derived from the current wall clock. `session-local` means the original Session must be live: no external notification channel or cold-session scheduler exists.

```ts type-equiv
/** Current delivery timing derived from the durable record and wall clock. */
type ScheduleState = 'scheduled' | 'overdue'
```

```ts type-equiv
/** Fixed v1 delivery boundary: the original session must be live. */
type ScheduleDeliveryMode = 'session-local'
```

```ts type-equiv
/** Complete model-facing view of one active reminder. */
type ScheduleView = ScheduleRecord & {
  /** Whether the target remains in the future. */
  readonly state: ScheduleState
  /** Reminder delivery never leaves the owning session. */
  readonly deliveryMode: ScheduleDeliveryMode
}
```

The generated [tool catalog](../tool-catalog.md#deepseek-aidsh-schedule) owns the argument and result schemas for `schedule_create`, `schedule_list`, and `schedule_delete`. Management calls serialize with due work in one Agent-scoped queue. Every read or decision first waits for the shared Session persistence barrier; create and an actual delete wait again after appending. A barrier failure reports `persistence_uncertain` instead of guessing whether an eager write committed. The other stable error codes are `invalid_prompt`, `invalid_selector`, `invalid_rule`, `invalid_time_zone`, `not_future`, `time_out_of_range`, `frequency_too_high`, `corrupt_schedule_log`, and `internal_error`.

## Live delivery

The process-local owner derives its earliest timer from the durable fold and rereads the wall clock after every bounded wait. Cold Sessions do no work; reopening one reconstructs timers and makes past targets overdue. Due one-shots take priority and enter one later turn at a time. When no one-shot is due, all overdue Every records form the single batch described above.

Due work waits for the Agent to become fully idle and claims the maintenance phase before it refolds state, samples the decision, queues one `followup()`, and appends the corresponding dispatch changes. It never calls `steer()` and never interrupts a current turn.

The admitted one-shot or fixed-rate batch starts one normal later turn and appears only through the ordinary conversation transcript; Schedule has no independent durable Web receipt or browser renderer. If framing or synchronous queue admission fails, no dispatch is recorded and the reminder stays active. The narrow crash interval after admission but before durable dispatch can repeat reminder content after recovery, so the boundary is best-effort at-least-once rather than exactly-once delivery.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxidealizecron--idealizecron"></a>

### `ctx.idealizeCron` — `IdealizeCron`

The scheduler: durable tasks, armed timers, and run history behind `ctx.idealizeCron`.

```ts cordis-catalog
/**
 * Tasks with computed next fires, for the HTTP surface.
 * @returns every stored task with its next fire time and running flag.
 */
async taskViews(): Promise<TaskView[]>

/**
 * Validate + persist one task and re-arm it. A prompt may be empty only
 * for a reminder (`remind` set): the fire then notifies and runs nothing.
 * A one-off whose instant has passed is refused unless the task already
 * recorded `done`, so renaming a fired reminder still saves.
 * @param input - Task fields from the calendar form or a calendar tool; `id` absent creates a new task.
 * @returns the stored task after defaults are applied.
 */
async saveTask(input: Partial<CronTask>): Promise<CronTask>

/**
 * Disarm and remove one task; its run history stays.
 * @param id - The task to delete.
 * @returns whether a task with that id existed.
 */
async deleteTask(id: string): Promise<boolean>

/**
 * Flip one task's enabled flag and re-arm it.
 * @param id - The task to toggle.
 * @returns the updated task, or undefined when no task has that id.
 */
async toggleTask(id: string): Promise<CronTask | undefined>

/**
 * Run one task now (used by fires; callable for a manual "run now"). A
 * reminder (empty prompt) runs no agent; a `remind` task raises the desktop
 * notification (title = task name, body = the time) beside whatever ran. A
 * one-off records `done` before its run is announced, so the pane's refetch
 * already shows it fired.
 * @param taskId - The task to run.
 * @returns the recorded run, `skipped-busy` when the task is already running.
 */
async fire(taskId: string): Promise<CronRun>
```

Source: [`packages/idealize/cron/src/index.ts:135`](../../packages/idealize/cron/src/index.ts)

<a id="idealize-events"></a>

### `idealize/*` events

<a id="idealizecomm-focus--emit"></a>

#### `idealize/comm-focus` — emit

A chat asked the shell to bring a session to the front (`idealize focus`).

```ts cordis-catalog
/**
 * A chat asked the shell to bring a session to the front (`idealize focus`).
 * @mode emit
 * @param sessionId - the session to show.
 */
'idealize/comm-focus'(sessionId: string): void
```

Source: [`packages/idealize/comm/src/service.ts:68`](../../packages/idealize/comm/src/service.ts)

<a id="idealizecomm-mail--emit"></a>

#### `idealize/comm-mail` — emit

A message landed in a session's mailbox; the unread count is the badge.

```ts cordis-catalog
/**
 * A message landed in a session's mailbox; the unread count is the badge.
 * @mode emit
 * @param sessionId - the recipient.
 * @param message - what arrived.
 * @param unread - the recipient's mailbox size after delivery.
 */
'idealize/comm-mail'(sessionId: string, message: CommMessage, unread: number): void
```

Source: [`packages/idealize/comm/src/service.ts:54`](../../packages/idealize/comm/src/service.ts)

<a id="idealizecomm-notify--emit"></a>

#### `idealize/comm-notify` — emit

A chat asked for a system notification (`idealize notify`).

```ts cordis-catalog
/**
 * A chat asked for a system notification (`idealize notify`).
 * @mode emit
 * @param title - the notification title, already carrying the sender's label.
 * @param body - the notification text.
 * @param sound - whether the sender asked for a sound.
 */
'idealize/comm-notify'(title: string, body: string, sound: boolean): void
```

Source: [`packages/idealize/comm/src/service.ts:62`](../../packages/idealize/comm/src/service.ts)

<a id="idealizecomm-reveal--emit"></a>

#### `idealize/comm-reveal` — emit

A chat pointed the person at a file (`idealize reveal`).

```ts cordis-catalog
/**
 * A chat pointed the person at a file (`idealize reveal`).
 * @mode emit
 * @param path - the absolute, symlink-resolved file path.
 * @param open - whether to open it in the viewer as well as select it.
 * @param sessionId - the session whose project holds the file.
 */
'idealize/comm-reveal'(path: string, open: boolean, sessionId: string): void
```

Source: [`packages/idealize/comm/src/service.ts:76`](../../packages/idealize/comm/src/service.ts)

<a id="idealizecron-changed--emit"></a>

#### `idealize/cron-changed` — emit

The task list changed (a task was added, edited, toggled, deleted, or a one-off recorded done); the host bridge forwards it so the Schedule pane refetches. Carries no payload: the pane reads the routes.

```ts cordis-catalog
/**
 * The task list changed (a task was added, edited, toggled, deleted, or a
 * one-off recorded done); the host bridge forwards it so the Schedule pane
 * refetches. Carries no payload: the pane reads the routes.
 * @mode emit
 */
'idealize/cron-changed'(): void
```

Source: [`packages/idealize/cron/src/index.ts:82`](../../packages/idealize/cron/src/index.ts)

<a id="idealizecron-run--emit"></a>

#### `idealize/cron-run` — emit

One scheduled run finished (any status); the host bridge forwards it to the shell's notification feed.

```ts cordis-catalog
/**
 * One scheduled run finished (any status); the host bridge forwards it
 * to the shell's notification feed.
 * @mode emit
 * @param run - The recorded run: status, timing, and the session it ran in.
 * @param task - The task definition that fired.
 */
'idealize/cron-run'(run: CronRun, task: CronTask): void
```

Source: [`packages/idealize/cron/src/index.ts:75`](../../packages/idealize/cron/src/index.ts)

<a id="idealizestudio-event--emit"></a>

#### `idealize/studio-event` — emit

A Studio event committed to its project's timeline; announced after the append is on disk, never for a suppressed duplicate.

```ts cordis-catalog
/**
 * A Studio event committed to its project's timeline; announced after the
 * append is on disk, never for a suppressed duplicate.
 * @mode emit
 * @param event - the recorded event, with its assigned id, seq and time.
 */
'idealize/studio-event'(event: StudioEvent): void
```

Source: [`packages/idealize/studio/src/index.ts:55`](../../packages/idealize/studio/src/index.ts)

<a id="idealizeterminal-activity--emit"></a>

#### `idealize/terminal-activity` — emit

A terminal agent started or stopped working, from its shell's output.

```ts cordis-catalog
/**
 * A terminal agent started or stopped working, from its shell's output.
 * @mode emit
 * @param change - the terminal's id and whether it is working now.
 */
'idealize/terminal-activity': (change: { id: string; working: boolean }) => void
```

Source: [`packages/idealize/ui-terminal/src/index.ts:167`](../../packages/idealize/ui-terminal/src/index.ts)
<!-- END GENERATED cordis-surface -->
