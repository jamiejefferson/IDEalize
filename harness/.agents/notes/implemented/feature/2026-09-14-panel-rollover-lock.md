# Agent Note: the panel follows the pointer, a click locks it, and a rollover can be typed into

Status: implemented

JJ, 14 Sep 2026, minimode feedback: "1. when it reveals on rollover, please focus on the text input. you can rollover and type without needing to click. 2. click should lock the panel so you can interact with it, clicking again or outside should contract it again. 3. rolling or clicking on another agent should switch panel content to theirs. 4. currently it's breaking - not possible to re-open, after its closed."

## Problem

The rail kept two panels apart: a hover reveal that closed the instant the pointer left the chip, and an opened panel that a reveal yielded to. In the bar's own window the panel sits 8px past the column, so crossing to it left the chip and closed the reveal before the pointer arrived, which read as a panel that could not be reopened. A revealed panel's ask field was focused in the page, but the bar's window did not hold the keyboard, so typing went to whatever app was in front. With a panel open, rolling over another chip showed nothing, and nothing outside the panel closed it.

## Decision

**One panel, locked or not.** The rail keeps one `OpenPanel` (`{ id, locked, fromHold, draft }`). A rollover that outlasts `hoverRevealMs` shows that chip, keeping any lock; an unlocked panel closes only once the pointer has been off both the chip and the panel for `PANEL_LEAVE_GRACE_MS` (250ms), so the gap between them is crossable. A click or Enter locks the panel on that chip; the same chip clicked again, a `pointerdown` outside `[data-askbar-panel]` and `[data-chip-id]`, or Escape closes it. Another chip rolled over or clicked switches the panel to that agent; the `Panel` is keyed by chip, so it remounts with that chat's exchanges. A hold's card takes the panel's place while the hold runs, as before.

**The keyboard comes with the room.** `AskbarRoot` already asks the desktop for width when a panel shows; it now also posts `{ focus }` to `/idealize/askbar/focus`, which `desktopActions.focusBar` answers with `window.focus()` or `window.blur()` on the bar's window. The window is a non-activating panel: measured on a scratch instance, `focus()` made it the focused window with the app behind still frontmost, and `blur()` gave that up. The panel's own effect focuses the ask field on mount, so a rollover can be typed into.

## Alternatives considered

**Keep two panels and add a grace period to the reveal only.** The lock and the switch (feedback 2 and 3) need one owner of which chip shows; two states would still have to be reconciled on every hover and click.

**Activate the app to take the keyboard.** `app.focus({ steal: true })` would bring IDEalize forward, and with the main window hidden Stage Manager would show an empty stage — the black screen of landing 35.

**Persist the panel's draft across a switch.** A draft belongs to the chat it was typed for; switching chips remounts the panel and the words are not carried to another agent.

## Consequences

- 145 askbar tests pass, including the grace-period reveal, the reopen after a close, the switch on rollover, the lock, the second click, the outside press, and the focus route's 200/400/403/501.
- 68 desktop tests pass; `focusBar` joins the desktop actions the shell publishes.
- A locked panel closes on any press outside it, including on the transparent part of the widened window.
