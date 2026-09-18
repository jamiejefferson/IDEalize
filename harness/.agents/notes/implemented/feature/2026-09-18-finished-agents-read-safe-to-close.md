# Agent Note: A finished agent reads Finished, safe to close

Status: implemented

## Problem

JJ, filed against the previous app and still open: "lead agents need to be able to trigger a 'Done' status on the task agents so the user knows they're safe to close". The lead tier is retired; the need that remains is telling a chat that has finished its task from one that waits between turns. The Studio fold already records it (`task-update`/`done` sets `state: 'done'`, `attention: 'completion'`), and `chipStateOf` already accepted an `execution` input, but the value never arrived: the roster read only the fold's `displayed` task, which is the active task or the first queued one and so is never a closed task. A finished agent's chip read Ready, the same as an idle one, and the Studio's agents row read Idle.

## Decision

`foldStudioState` gives each `StudioAgentView` a `finished` task id: the owner's latest task that was not cancelled, when that task is `done` and nothing is active or queued. A new assignment to the agent sets `displayed` and so clears it; acknowledging the completion does not, because acknowledgement does not change whether the chat can be closed. A later `failed` task blocks it and a later `cancelled` task is read past.

`assembleChips` reads `displayed ?? finished`, so a `done` execution reaches `chipStateOf` only through `finished`, and the chip's task line keeps the finished task's goal. `chipStateOf` returns the new `finished` state after `wrong`, `needs-input` and a running turn, and before `idle` and `ready`: a cold chat whose task is done is still finished. The chip captions it "Finished", wears a tick in the badge position on the success fill, and drops the presence dot. The caption is one word at 8px, so the longer wording "Finished, safe to close" (`state.finishedDetail`, through `stateDetailKey`) goes where a sentence fits: the chip's accessible name and the panel's head. Both rail homes render the one `Chip`. The Studio view's agents row reads "Finished, safe to close" (`studio.agents.finished`) where it read "Idle".

## Alternatives considered

**A `finished` flag on the chip input beside `execution`.** The fold's `displayed` task is never closed, so `execution: 'done'` was an input no caller could produce; routing the finished task through it uses the input the fold's author already declared and adds no second field.

**Deriving "latest task done" in the roster.** The Studio's agents row needs the same fact, and two derivations would drift; the fold is where per-agent views are built.

**Ending the state on acknowledgement.** Acknowledging clears the Studio's attention row; the chat is no less safe to close afterwards, and the chip would fall back to Ready and lose the signal JJ asked for.

**Leaving a cold finished chat Idle.** After a restart every chat is cold, so the chats that can be closed would stop saying so exactly when the person tidies up.

**An operating-system alert on `done`.** `@idealize/notify`'s policy keeps `done` quiet by design; the ask is a state to read at a glance.

## Consequences

`ChipState` has seven members; `STATE_LABEL_KEYS` and the chip's class map are `Record<ChipState, …>`, so a surface that adds a state fails to compile until it names it. The roster payload's `state` may now be `finished`, and its `task` may name a closed task. A chat that keeps talking after its task ended reads Working during each turn and Finished between them. The sidebar's session rows keep their own tick, which means a turn ended that the person has not viewed; it reads the session projection and shares nothing with this fold. A failed task still does not reach the chip through `displayed`; that gap is older than this change and is not closed here. Evidence: `studio/tests/fold.spec.ts`, `askbar/tests/{chip-state,roster}.spec.ts`, `askbar/tests/{rail,panel}.client.spec.tsx`, `ui-studio/tests/studio-view.client.spec.tsx`, and the both-theme walk `askbar/proof/finished-proof.mts`.

## Related

[Askbar chip: working means a running turn](2026-09-15-askbar-chip-working-means-a-turn.md) owns the rest of the fold's precedence.
