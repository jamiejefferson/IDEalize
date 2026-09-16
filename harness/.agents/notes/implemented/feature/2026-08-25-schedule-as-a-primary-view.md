# Agent Note: Schedule leaves the tool rail for the conversation view ring

Status: implemented

Reversed two days later by [Schedule returns to the rail, Week only](2026-08-27-schedule-returns-to-the-rail.md): the ring became the space mechanism and Schedule is not a space. This note keeps the record of the decision that change replaced; the facts below describe the ring seat, which no longer exists.

## Problem

Schedule was a `calendar` pane in `@idealize/ui-bar`'s drawer: a rail button, a `BarPanel` union member, a `DrawerPanel` branch, and a `scheduleHost` face wiring workspaces and sessions into `SchedulePanel`. It rendered in a 320–720px column beside the conversation. SCH-01..10 / AC-39..47 of the architecture-setup spec ask for it to become a primary view instead — the same hierarchy as the other activities, opening in the main canvas, reached from the View list rather than a tool icon, with nothing in the tool rail still offering it (AC-40 is a navigation audit, so the absence has to be provable).

Three facts shaped the work.

The conversation view ring unmounts every inactive view. `SchedulePanel` held its grain, its navigated day and its whole editor mode in `useState`, so as a ring entry it would forget everything the moment the user glanced at the chat (SCH-09).

`@idealize/cron` owns every task — the `idealize-cron.json` document under the harness home, the ids it mints, the fire scheduling, the loopback route fence. Leaving that package untouched is what makes SCH-05/06/07 and AC-43/44 true by construction rather than by migration.

The lanes were drawn for a narrow drawer. On the canvas the day grid is 24 × 72px, and `ui-conversation` gives a blank chat's view area an auto height, so dropping the pane in unchanged stretched the whole conversation column and pushed the composer off screen.

## Decision

**A new browser-only package, `@idealize/ui-schedule`.** `ScheduleView` (the renamed `SchedulePanel`), `ScheduleEditor`, `ScheduleCreateChat`, `schedule-model.ts`, their stylesheet and the `sched.*` copy moved out of `ui-bar` under a locale namespace of their own. `ui-bar` keeps zero schedule knowledge: the pane, its rail button, its `BarPanel` member, its `PANEL_TITLE` row, `scheduleHost`, `freshSession`, `BarIconCalendar` and the `bar.calendar` key are all gone, and its rail spec now asserts the absence.

**The primary-view contribution is documented, not built.** There is no registry to add: a primary view IS a `conversation.view` list entry carrying `id`, `order`, a `label` thunk, a `locale` namespace, a component, and an `inject` factory called per chat — with the registration's disposer as the whole lifecycle (that disposer is AC-47). The package README states that shape as a table beside the generated slot catalog, which already documents the seat. `ui-conversation` only projects entries to tabs, so AC-42 holds with no work.

**The entry takes order 12, not the planned 8.** The plan reasoned about chat, terminal (5), gallery (6) and soundstage (7) and concluded 8 was last. It is not: `client-ui-trajectory` registers at 10. Since the decision recorded against OQ-15 was "last position in the ring", the number follows the decision. The booted app renders `Chat, Gallery, Sound Stage, Trajectory, Schedule`.

**View-local state moved into a plugin-owned snapshot store.** `createScheduleStore()` holds `{ view, dateMs, mode }` and exposes the complete write set. Only the grain persists, straight to `localStorage['idealize.schedule.view']` on each write, mirroring `ui-layout`'s remembered drawer width; the navigated day and any open editor stay in memory. `dateMs: null` means today, read at mount rather than at plugin apply, so an app left running overnight still opens on the current day.

**The view opts into the composer overlay.** `data-conversation-composer-overlay` is an existing upstream seam a view sets on its own root (`ui-trajectory` uses it); it turns the composer seat into an absolute overlay and hands the view its own bounded column. With it the day grid scrolls inside itself and the composer stays on screen, and the view reserves 210px at the foot of each scroller so the last hour can be scrolled clear of it.

**Load states are explicit.** `loading | ready | failed(cause)` replaces the `loadError` boolean: the calendar says it is loading, an empty day only says so once the answer has landed, and a failure prints the cause the fetch reported (`Cause: tasks 503`) above a Retry in the shared control style.

**`ctx.scheduleView.open(sessionId?)`** mirrors `terminalMode.open`, writing the chat entry's per-session store through `hostFace().storeOf`. Nothing in-repo called `idealizeBar.show('calendar')`, so this is the seam for whatever wants to open Schedule next.

## Alternatives considered

**A `defineStore` root-scope store on the registration.** Rejected: the `conversation.view` seat is session-scoped, so the engine would suffix the persist key per session and give each chat its own calendar. Schedule is one calendar however you reach it.

**Persisting the whole store.** Rejected: whole-value persistence would bring back the navigated date, and a calendar that reopens on a day three weeks ago is wrong. Persisting one field explicitly is smaller than filtering a persisted blob.

**Re-deriving the lane geometry for the canvas.** Rejected for this slice: the drag maths, the stagger step and the block height are all measured off the wireframes, and a canvas-native layout is a redesign. The content caps at 880px and centres.

**Leaving the composer to scroll with the page.** Rejected once the booted app showed it: opening Schedule put the composer roughly a thousand pixels below the fold, which is not "the composer stays available beside it".

**Keeping `order: 8` as written.** Rejected: it would put Schedule in front of Trajectory, contradicting the recorded decision. Flagged rather than assumed — one number reverses it.

## Consequences

`@idealize/cron` is byte-for-byte unchanged, and so is every task record. `tests/data-continuity.client.spec.tsx` writes a document, reads it back through cron's own `CronStore`, renders it through the new view, and then asserts the file is untouched; the proof run does the stronger version, creating tasks over the real `/idealize/cron/tasks` route in a first boot the browser never sees.

`ui-bar` shrinks by roughly 1,300 lines and drops the last non-rail concern from its drawer. Its `BarPanel` union is one member shorter, which the rail and drawer specs now assert.

The view's height cap names 140px of chrome above it as a constant, because CSS cannot measure the view area's offset on a blank chat. A view-area height custom property upstream would retire it; the README's Known Limitations carries the note.

Proofs (`.idealize/proof/schedule-*.png` and `schedule-navigation-audit-*.json`, harness `packages/idealize/ui-schedule/proof/schedule-proof.mts`) boot the assembled `idealize` profile against a scratch `HOME` and `DSH_HOME` the run refuses to start without, at 1280×840 in both themes: Schedule last in the View list; the calendar in the main canvas with the composer on screen; every tool-rail button enumerated with no Schedule among them; the pre-created tasks rendering under their cron-minted ids; Week surviving a round trip to another tab; a tap on an empty lane slot opening the seeded creation flow at the tapped time; and a 503 producing a stated cause and a Retry.
