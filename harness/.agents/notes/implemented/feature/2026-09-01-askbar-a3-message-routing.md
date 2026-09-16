# Agent Note: A3 second commit — message routing rules (FR-P0-09/10)

Status: implemented

`@idealize/studio` now enforces the askbar plan's routing rules: every message invokes exactly one participant, and an unaddressed message proposes the running lead instead of guessing a recipient.

## Problem

The timeline accepted `kind: 'message'` two ways with different meanings: `deliver` recorded it and attempted the mailbox, while the plain event route recorded it silently — an invocation in the timeline that never reached anyone. And an unaddressed deliver answered a bare `missing target`, leaving each future surface (A4's composer, the CLI) to invent its own answer to "who gets an unmentioned message?".

## Decision

**Deliver is the one message path (FR-P0-09).** The event route refuses `kind: 'message'` whatever its target, pointing at deliver; `record()` refuses the same way, so no typed caller bypasses it (the executor enforces, not the route alone). `deliver` appends its message through a private `commit()` — the same append-and-announce `record()` uses after its check.

**An unaddressed message is proposed, never guessed (FR-P0-10).** A deliver without `target` records nothing and answers 400: with the running lead as `proposal: { target, label }` when the composed messaging service's roster has one, else demanding an explicit target. The proposal is advisory — the producer resubmits naming the target, so the confirmation stays with whoever speaks. `leadProposal()` serves typed callers the same answer.

**The comm seam stays structural.** `CommSendLike` widened to `CommLike` (`send` + `list`), still read via `ctx.get` so `@idealize/comm` keeps its package dependency on studio, not the reverse.

## Alternatives considered

**Auto-deliver unmentioned messages to the lead.** Rejected: the plan says propose, and silently rerouting a message the author never addressed puts words in front of the lead nobody chose to send there. The refusal-with-proposal keeps the human (or producing surface) in the loop at one resubmit's cost.

**Enforce only at the route.** Rejected: comm's `studioCommand` and any future plugin call the service directly; a route-only check is schema omission, not enforcement. `record()` refuses too, and the spec proves it (`rejects.toThrow`).

**Retire `broadcast` in the same commit.** Deferred: comm's broadcast floods mailboxes but invokes nobody (only `wakeCoordinator` and spawn call `followup`), and it belongs to the rung-era surface whose retirement is a product change awaiting JJ's call on the role-guide rewrite.

**A dedicated roles query on the structural seam.** Rejected: comm's existing `list` already carries `role` per session; a second query shape would be a parallel value with no owner.

## Consequences

- Old behavior change with its tests: the event route no longer records messages; `routes.spec.ts`'s generic fixtures became `kind: 'system'`.
- The `deliver` 400 for a missing target now carries routing guidance; A4's composer gets the proposal shape for free.
- A message recorded before this rule stays in the timeline untouched; the fold still renders `message` rows (the pane's timeline shows them), only their intake tightened.
- `MESSAGE_ROUTE_RULE` is exported beside the route paths so refusal text has one owner.
