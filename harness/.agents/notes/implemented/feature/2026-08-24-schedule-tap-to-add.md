# Agent Note: Schedule tap-to-add

Status: implemented

## Problem

The Schedule pane created tasks only through the header's + button. JJ's review (round 2, P6) asked for the calendar itself to take the tap: an empty slot should open the task editor already set to that slot, in every view.

## Decision

**A tap on an empty slot opens Create-with-chat seeded with that slot** (amended in round 3 — JJ: "tapping new task in calendar should launch the new task chat"; the tap originally opened the field editor, which stays reachable from the draft card's Edit fields). `tappedSchedule(day, at, timeZone)` in `schedule-model.ts` maps the tap to a weekly schedule on the tapped day; the create state passes it to `seededMessage()` so the model defaults the draft to the tapped slot, and shows a "Planned for {day} at {time}" line until the first reply. `newDraft(schedule?)` keeps seeding cwd and falls back to its weekday-09:00 default for the + button.

- **Day lane**: the lane's `onClick` converts `clientY` minus the lane's rect through the existing `timeAtOffset()` (5-minute snap). It fires only when `event.target` is the lane itself — blocks, hour lines and the empty-day note are children — and a one-shot `suppressLaneClick` ref eats the click a reschedule drag releases when pointer capture failed (captured drags land their click on the block).
- **Week day-columns** and **empty month cells** draft at a fixed 09:00: neither view has hour granularity. A month cell with tasks keeps opening its Day view, so navigation survives; the empty cell is the month's empty slot.

## Alternatives considered

**Seed the tapped day into the weekday set** (weekdays at the tapped time). Rejected: the editor's REPEAT row broadens a single day in one click, while a weekend tap seeding weekdays would not contain the tapped day at all.

**Make every month cell draft and drop day navigation.** Rejected: the pane's only path into a past or future Day view is the month cell.

## Consequences

The lane, week columns and month cells are click targets without keyboard equivalents; the header + button remains the keyboard path to a new task. P4's restyle can add affordance (cursor, hover slot marker) without touching the handlers. Proof: `.idealize/proof/schedule-tap-*.png` via `.idealize/proof-schedule-tap.mjs`.
