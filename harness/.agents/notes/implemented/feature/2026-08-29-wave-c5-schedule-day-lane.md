# Agent Note: Wave C5 — the Schedule pane rebuilt against the calendar frame

Status: implemented

The Calendar slice of JJ's 28 Aug review (plan: `.idealize/plans/feedback-wave-c-plan.md`): "Rebuild the Schedule pane against JJ's Paper frame `01M0F17YJ7SYPE67GXDKDARQHG`, page 1-0, node `27M-0`. Read the frame before changing anything; the current pane was built from the plan, not the drawing." The pane is `@idealize/ui-schedule`'s; no upstream file changes.

## Problem

The "calendar wires" artboard draws four 420×766 states: **Schedule — Calendar** (a Day | Week | Month switcher with Today at the right, a date navigator over a Monday-first week strip, an ALL DAY row of interval tasks, and an hour lane from 08:00 to 14:00 at 72px an hour with task blocks that carry the name, a repeat badge and a detail line such as "09:00 · Codex · Email team"), **Schedule — Reschedule** (the same lane, subtitle "Drag a task to change its schedule.", a block shown at its new time), **Schedule — Edit task** and **Schedule — Create with chat**. The pane carried the editor and Create-with-chat as drawn, but its calendar was a seven-column Week grid with no hour lane, no all-day row, no switcher and no drag: the Day view had been removed on 26 Aug ("i'm happy with just a week view") and the drawing never rebuilt.

## Decision

**The Day lane is the calendar's default and follows the frame.** The week strip picks the day; the arrows step one day. Interval tasks (`kind: 'every'`) sit in the ALL DAY row with their EVERY 30 MIN badge; timed tasks are absolutely positioned blocks on an hour grid (`HOUR_PX` 72, `BLOCK_PX` 56) whose span is the frame's 08:00–14:00 widened until the day's tasks fit with an hour of air below the last (`laneHours`). Blocks whose starts fall inside an earlier block step one 90px column right (`laneBlocks`), as the frame's overlapping Release-notes block does. The soonest enabled fire is the accent block. The detail line is time · model (or Default) · run folder; the frame's "Email team" has no seam behind it.

**A block drags to another time.** Pointer capture on the block, the offset drawn live, the subtitle switching to the Reschedule frame's copy while the drag is live, and on release the start snaps to the quarter hour and saves through `POST /idealize/cron/tasks` with the same schedule at the new `at`; a status line under the strip reports "Daily product brief moved to 10:30". A press that travels under 4px is a click and opens the editor. A failed save surfaces through the existing failure block with its cause.

**A tap on an empty lane slot opens Create-with-chat at that half hour** (`tappedSchedule(day, timeOf(snapped), zone)`), so the seed the model receives names the slot the user pointed at.

**The Week grid stays, behind a Day | Week switcher.** Its columns, 09:00 taps and week-stepping arrows are unchanged. The frame's Month tab has no Month layout behind it, so the pane carries two tabs; a tab that opens nothing would be worse than its absence. Today moves to the switcher row, right-aligned, where the frame puts it.

**The grain joins the position store** (`ScheduleViewState.grain`, `setGrain`), so closing the drawer keeps Day or Week as it keeps the navigated day and an open editor, and a relaunch opens today's Day lane. Nothing persists to storage.

## Alternatives considered

- **Replace the Week grid with the Day lane outright.** JJ accepted the Week grid on 26 Aug and the frame draws a Week tab; both stay.
- **Build a Month tab from the frame's label.** There is no Month drawing to build from; deferred until one exists.
- **Drag across days by dropping a block on the week strip.** The frame shows a within-lane move only; cross-day moves go through the editor's REPEAT row. Kept out of this slice.
- **An EMAIL delivery row in the editor.** `@idealize/cron` has no delivery seam; the row would be a field that does nothing. Logged as a Known Limitation.

## Consequences

`schedule-view.client.spec.tsx` pins the lane geometry (`laneHours`, `laneBlocks`, `snapMinutes`, `detailLine`), the Day default with ALL DAY and blocks at their hour, the drag-to-reschedule save and the click-under-slop editor open, the tapped half hour, the Week grid behind its tab and the grain surviving a remount but not a relaunch; `data-continuity.client.spec.tsx` reads a cron document into both grains. `proof/schedule-proof.mts` gains the Day lane checks and a real mouse drag that moves the seeded block and puts it back before the document comparison. The pane's README describes both grains and the two limitations above.
