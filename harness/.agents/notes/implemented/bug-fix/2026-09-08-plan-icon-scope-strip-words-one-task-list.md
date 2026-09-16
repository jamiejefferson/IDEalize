# Agent Note: JJ's 8 Sep review — the plan icon serves Chat and Terminal, the compact strip keeps its words, the task list shows once, and the caret stays on the glyphs

Status: implemented

JJ, 8 Sep 2026, on the landing-12 build: "plan mode only relevant in chat and terminal"; "plan mode toggle is the wrong way round - should be highlighted if its on!"; on the Video and Images composers, "labels missing"; on a Coding chat with a task list, "its great to have the task view but we seem to have two of them"; and while typing, "the cursor is straying as i write".

## Problem

`PlanToggle` in `@idealize/ui-bar` rendered on every chat, so a Video or Images composer offered plan mode to a brain whose composition holds only the generation tools, and a click there ended in "plan mode failed". Its tooltip named the click's effect alone ("Plan mode off" while pressed), so a pressed icon read as the opposite state. The generation settings strip, when the tool row ran short, hid its labels and kept tooltips, which at JJ's window width left three selects and two bare checkboxes with no words. The `todos` projection rendered twice: in `@idealize/ui-tasks`' column beside the rail and in ui-conversation's `TodoPanel` above the composer. The composer draws its glyphs in a backdrop div and its caret in a transparent textarea over it; JJ's appearance letter-spacing (-0.1px) reached the div by inheritance while the browser's textarea stylesheet held the textarea at `normal`, so over 61 characters the caret ran 6px ahead of the text (measured by the landing walk on the packaged build).

## Decision

**The plan icon reads the ring.** The registration waits for ui-conversation's chat view entry and registers the seat with that entry's store, so the icon receives `useStore` and renders only while the ring's active view is `chat` or `terminal` (`PLAN_VIEWS`) or none is chosen yet. **The caption states the mode, then the effect:** "Plan mode on. Click to turn off." / "Plan mode off. Click to turn on." (`plan.state.on` / `plan.state.off`), the pressed look unchanged. **A compact strip stacks its labels** above the controls in 10px type rather than dropping them; a switch stays box-then-word. Stacking costs no width, which is what the compact row lacks. **The task list shows once:** `@idealize/ui-tasks` registers an empty occupant on the plan strip's dock cell (`conversation.input.dock`, list id `todo`, priority -1), the registry's own shadowing rule, so no upstream file changes and an install without the column shows the strip again. **The three composer layers share spacing:** `InputBar.module.css` declares `letter-spacing: inherit; word-spacing: inherit` on the textarea, mirror and backdrop (an upstream touch, logged in FORK.md), so whatever the surface sets reaches all three. The compact strip also stacks its switches in one column (`data-gen-switches`), since two box-then-word switches side by side pushed the Video row 22px over its width.

## Alternatives considered

**Labels beside the controls at every width.** At 1280px the Video row has about 360 logical pixels for the strip and a labelled inline strip needs about 540; the mode chip's box then shrank under its text (the 7 Sep overlap). Since landing 15 the chip's box is `flex: none` and the tool row scrolls sideways (`overflow-x: auto`, scrollbar hidden) when even the compact strip asks for more, so the chip never runs under the strip at any width; the row keeps reporting its overflow, which is what the compact measurement reads.

**Hide the plan icon by composition rather than by view.** The brain's tool set is host state the client does not see per session; the ring view is the space, and the space is what JJ named.

## Consequences

The walk checks the icon on the Chat landing and its absence on the Images, Video and Sound Stage composers, and reads the composer's three layers for one letter-spacing. The appearance rule `font-family: inherit` on the chat surface still overrides the layers' `DshChipCell` stack on all three at once, so chip cells fall back to the surface font's U+FFFC glyph; the layers agree, so nothing drifts, and that stays open. Tests: `ui-bar/tests/plan-toggle.client.spec.tsx`, `ui-gallery/tests/view.client.spec.tsx`, `ui-tasks/tests/registration.client.spec.ts`.
