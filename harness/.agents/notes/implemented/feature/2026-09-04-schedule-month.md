# Agent Note: the Schedule pane gets its Month, and it only picks a day

Status: implemented

JJ, 4 Sep 2026: "schedule month - i didn't delete anything. as long as you can move through the days its fine. please remove anything extraneous."

## Problem

The Schedule pane offered Day and Week. Month was in JJ's "calendar wires" frame and had never been drawn: the project agent removed Day and Month on 27 Aug narrating JJ's "i'm happy with just a week view", Day came back with wave C, and Month stayed absent. There was no way to see a month at all, so moving more than a week required stepping the arrows a week at a time.

## Decision

A third grain, `month`, whose entire job is landing on a day.

Six whole weeks, Monday first: the grid keeps its height as the months change, and the adjacent months fill out the first and last rows, dimmed. A cell carries its date and, when work falls that day, a 4px dot. Clicking a cell sets the date and switches to the Day lane. The arrows step a month, the navigator names the month rather than the day, and the week strip is hidden in this grain.

## Consequences

Everything a day's work needs — the hour lane, the drag, tap-to-create, the editor — stays in Day and Week. The month adds no second place to schedule from, so there is nothing new to keep in step with the cron routes.

Six rows always means a month starting mid-week can show two rows from its neighbours. That is the trade for a grid that does not resize as you step through it; the dimming says which days are not this month's.

## Alternatives considered

**Draw each day's tasks in its cell, as the Week grid does.** At the drawer's 424px cap a cell is 60px wide, which fits neither a name nor a time, so the cell would carry a truncation of a truncation. The Day lane already reads a day properly, one click away.

**Print the number of tasks in each cell.** Built first, and the rendered proof showed why not: a single daily task prints the same count in all 42 cells, so the numbers said nothing and the grid read as a wall of badges. The dot answers the question the month asks — is there anything that day — and the count stays on the accessible label and the `data-schedule-count` attribute for assistive tech and for the proof.

**Let the grid scroll.** A month you scroll is not a month you can read, so the six rows share the pane's height and the proof measures that they fit.

## Evidence

- `packages/idealize/ui-schedule/tests/schedule-view.client.spec.tsx`: 42 cells starting Monday 27 July for August 2026, the days outside the month marked, today and the navigated day marked, the counts on the labels, the week strip gone, the arrows stepping whole months, and a click landing the Day lane on 25 August. 23 tests pass.
- `packages/idealize/ui-schedule/proof/schedule-proof.mts` in the real assembled app at 1280×840, both themes: the grid's 42 cells, its 11 outside days, one today, the dots, no week strip, `scrollHeight` within `clientHeight`, the last row sitting 16px inside the pane, a shortest row of 90px, and a picked day opening the Day lane on that date. Captures `schedule-rail-month-{light,dark}.png` and `schedule-rail-month-picked-{light,dark}.png` in `.idealize/proof/schedule-2026-09-04/`.
