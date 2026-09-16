# @idealize/ui-schedule

The Schedule calendar: a pane in the tool rail's drawer, carrying the Day lane, the Week grid and the Month picker over `@idealize/cron`'s tasks, the task editor, and Create-with-chat.

Schedule was a `schedule` tab in the conversation view ring. It returned to the rail because the ring became the space mechanism and Schedule is not a space — JJ, 26 Aug 2026: "move them both out of the tab bar. move both to the rail." The drawer renders it beside the conversation rather than replacing it, and the calendar is the same one whichever chat it sits beside.

## What the pane contains

**The Day lane, the default.** Rebuilt against JJ's "calendar wires" Paper frame (28 Aug review: "rebuild the Schedule pane against the frame"). A Monday-first week strip picks the day; interval tasks sit in an ALL DAY row; timed tasks are blocks on an hour grid (72px an hour, 08:00–14:00 widened until the day's tasks fit) carrying the name, the repeat badge and a detail line (time · model · run folder); the soonest enabled fire is the accent block. A block drags to another time, snapping to the quarter hour and saving through the cron routes on release, with the outcome stated under the strip ("Daily product brief moved to 10:30"); the subtitle reads "Drag a task to change its schedule." while a drag is live. Tapping an empty slot opens Create-with-chat seeded with that day at the tapped half hour. The arrows step one day.

**The Week grid, behind the switcher.** Seven columns; each task under its day with its time (or *all day* for interval tasks), the soonest fire highlighted; tapping an empty column opens Create-with-chat at 09:00; the arrows step a week.

**The Month grid, behind the switcher.** Six whole weeks, Monday first, so the grid keeps its height as the months change and the adjacent months' days fill out the first and last rows, dimmed. A cell carries its date and a dot when anything is scheduled that day; the count is on the cell's accessible label, not drawn, because a daily task would otherwise print the same number in every cell. Clicking a cell sets the date and opens the Day lane on it, which is where a day's work is read and changed; the arrows step a month; the week strip is hidden here, since the grid is already the day picker. Nothing is dragged, created or edited in this grain: the month picks a day.

**One-off entries.** A task whose schedule is `at` (an instant) shows on its own day only, badged ONCE, in the Day lane, the Week grid and the Month count. Once it has fired the cron service marks it `done`; the pane keeps it on its day badged DONE, drawn dashed with the name struck through, and the editor's footer reads when it fired. Most one-offs arrive through an agent's `calendar_add`; the editor's REPEAT row also offers Once, which turns RUN AT into a date and time.

**The task editor.** Name, run time and time zone (or date and time for Once), repeat rule, the instructions the agent runs each time (blank for a reminder that only notifies), the model, the folder the run executes in, and the NOTIFY toggle for a desktop notification at each fire (fixed on for a reminder), with the next run stated in the footer and Delete behind a confirm.

**Create-with-chat.** A real agent session in the task's folder turns a plain-language description into a draft carried as a fenced JSON block; the draft card shows what will be created, the composer refines it, and **Edit fields** hands the same draft to the editor.

## What it owns, and what it does not

`@idealize/cron` owns every task: the JSON document under the Harness home, the ids it mints, the fire scheduling, the run history, and the loopback route fence that mutations pass through. This package holds none of that. It reads `GET /idealize/cron/tasks` and writes `POST /idealize/cron/tasks` and `POST /idealize/cron/delete` with the `x-idealize-auth` marker, which is what the ring view did before it. Tasks created before the move therefore keep their ids, their schedules and their permissions with no migration at all — `tests/data-continuity.client.spec.tsx` proves it by reading a document written through cron's own `CronStore` straight into this view.

The pane is one of two writers. Every agent writes the same document through cron's `calendar_add` / `calendar_list` / `calendar_remove` tools, so the pane follows the store: besides refetching on mount and after its own writes, it listens to `@idealize/host-bridge`'s feed (`/idealize/events/stream`, attached after `since` the newest retained sequence so a reload replays nothing) and refetches on `cron-changed` (any task-list write) and `cron-run` (a fire, which may mark a one-off done). An entry an agent adds appears without closing and reopening the pane (JJ, 8 Sep 2026: "Calendar action, once created, doesn't appear in the calendar"). Without the bridge in the composition the mount and own-write refreshes are the only ones.

The package registers **no session event type** and needs no host half; its host entry exists only so the Loader can mount it.

## The section service

There is no slot registration: the client bundle purity gate forbids cross-plugin value imports, so a drawer pane in another package reaches the calendar through the Context, exactly as `modelsSettingsSection`, `agentPresetSection` and `trajectorySection` do (FORK.md).

`ctx.scheduleSection` carries:

| Member | What it is |
|---|---|
| `Component` | the `ScheduleView` component, rendered by the consuming surface |
| `face()` | the wired props: the store-bound `useSchedule` selector hook, `setDate`/`setMode`, the workspace list, the current chat's folder, the Create-with-chat session plumbing, and the bound translate |

One calendar serves every chat, so `face()` takes no session and the store-bound hook is stable across calls. The service's disposer is the pane's lifecycle: dropping it removes the pane.

## What survives, and for how long

The drawer unmounts a closed pane, so the view's position lives in a plugin-owned store rather than component state.

| State | Survives closing the drawer | Survives a relaunch |
|---|---|---|
| The navigated day and the grain | yes | no, deliberately: a calendar opens on today's Day lane |
| An open editor and its half-typed draft | yes | no |
| The task list | refetched on mount and on each `cron-changed` / `cron-run` feed event | n/a |

Nothing persists to storage: the grain, like the navigated day, lives in the store and resets to the Day lane on relaunch.

## Load states

A fetch in flight says so; an empty week shows its dashes only once the answer has landed; a failed fetch states its own cause (`Cause: tasks 503`) and offers **Retry**, because a scheduler that cannot be reached is a fact the user can act on.

## Rendered proofs

`packages/idealize/ui-schedule/proof/schedule-proof.mts` boots the whole assembled `idealize` profile — the shipped tool rail, view ring and composer — against a scratch `HOME` and `DSH_HOME` it refuses to run without, at 1280x840 in both themes:

```sh
OUT=.idealize/proof pnpm exec tsx packages/idealize/ui-schedule/proof/schedule-proof.mts
```

It creates the tasks through `@idealize/cron`'s own routes in a first boot the browser never touches, so what the pane later reads is genuinely a pre-existing record. It writes `schedule-rail-{open,day,rescheduled,min,cap,tap-create,month,month-picked,error}-{light,dark}.png` plus `schedule-navigation-audit-{light,dark}.json`, and fails the run unless every rail button enumerated includes Schedule (the audit reads them off the DOM, so the seat is evidence), the chat renders **no** view tab at all (the ring lost its tab row when the space became fixed, so Schedule cannot be one), the week strip stays legible at the drawer's 320px minimum and at the content's 424px cap, the seeded tasks render under their cron-minted ids, the Day lane places the interval task in ALL DAY and the timed task as a block that a real mouse drag moves and reports, the Month grid draws six whole weeks that fit the pane without scrolling and lands the Day lane on the day clicked, tapping an empty week column opens the seeded creation flow, a 503 on the task route produces both a stated cause and a Retry, and every task in the cron document reads as seeded after the round trip (the drag and its reversal are the only writes).

## Model Experience

Indirectly, through the one seeded user message Create-with-chat sends into a session made for that purpose (the user's words, then a `---` separator and a `Task format:` seed of roughly 150 tokens asking for one or two sentences plus one fenced JSON task block); the pane registers no tool and contributes nothing to any system prompt.

#### KV Cache effect

Independent: the seeded message is the first user turn of its own session, appended after that session's reusable prefix; nothing here touches the prefix of any other chat.

## Known Limitations and Deferred Work

- **The calendar caps at 424px in the drawer.** The week geometry was measured off 420px-wide wireframes; rather than re-deriving every constant for a 720px drawer the content centres inside a cap. A drawer-native wide layout (taller week columns, more per item) is a redesign, not a port.
- **The drag reschedules within a day only.** Moving a block changes its time; moving a task to another weekday goes through the editor's REPEAT row. The Week grid's coarse columns have nothing to drag through.
- **The frame's EMAIL delivery row is not built.** `@idealize/cron` has no delivery seam; a task runs in its folder and saves what it writes there. The editor carries MODEL and SAVE TO only.
- **Create-with-chat parses a fenced JSON block out of the reply.** A model that answers without the block simply produces no draft card; the agent's `calendar_add` tool is the path that needs no block. A structured-output seam on the session would remove the parser.
- **The feed event carries no payload, so every change refetches the whole list.** The list is small; a diff stream would remove the round trip if the task count ever grows.
- **A one-off cannot be dragged to another day.** The Day lane drag moves its clock time on its day, as for the weekly blocks; the editor's RUN AT date and time is the way to another day.
