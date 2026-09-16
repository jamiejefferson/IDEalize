# Agent Note: Askbar chip — working means a running turn

Status: implemented

## Problem

The chip fold read `working` only from a Studio task whose execution state was `working`. A plain chat answering a message has no Studio task, so its chip read Ready with a still green dot for the whole turn; the orbit ring the design spec gives the working state never showed. JJ, 15 Sep 2026, with a screenshot of Venka mid-turn: "i thought we'd discussed having an animation when agents were working - the green circle doesn't signify 'working'". Venka's log showed turn 6 open from 18:05:09 to 18:05:31, the screenshot at 18:05:25.

## Decision

comm's `list` row already carries two facts the fold ignored: `running` is true only while the agent runs a turn, and `live` is true while an agent holds the session in this app run. `chipStateOf` now folds, after `wrong` and `needs-input`: `running` (or a working terminal CLI) is `working`; a live agent between turns is `ready`, or `working` when its Studio task is still `working`; a cold chat is `idle`. The roster row type gains `live`. The chip component is unchanged: `working` already animates the orbit ring, `ready` keeps the green dot, `idle` the dashed ring. The ring now sits on the avatar's own edge (`inset: 0`, 2px) and paints under the corner dot, which is a later positioned sibling; at its earlier 6px outset the rail clipped it and it ran over the dot and the name (JJ, 15 Sep 2026: "aligned with the avatar circle edge and went under the corner notification circle"). Owners: `packages/idealize/askbar` (`chip-state.ts`, `roster.ts`).

## Alternatives considered

**A new host signal for an open turn.** comm's `running` is that signal already (`AgentStatus` is `idle` or `running`, and `running` holds only inside a turn); adding a second one would duplicate it.

**Animating the ready state instead.** Ready would then read as working on every loaded chat, which is the reverse confusion; the spec's ring means the agent is doing something now.

**Keeping the Studio task as the sole source of working.** Only coordinated work has a task; JJ's chats answer directly most of the time, so the ring would stay rare.

## Consequences

`ready` now means an agent is loaded and waiting, which a cold chat cannot claim, so more chats read Idle than before (every stored chat nothing has opened this run). A running turn outranks a Studio task's `done` or `waiting` state, so a coordinator that keeps talking after its task ended reads Working until the turn ends. Evidence: `askbar/tests/chip-state.spec.ts` (each state's trigger and the precedence), `askbar/tests/roster.spec.ts` (running turn with and without a Studio task; a working terminal), `askbar/tests/routes.spec.ts` (the grouped roster reads a running row as working).
