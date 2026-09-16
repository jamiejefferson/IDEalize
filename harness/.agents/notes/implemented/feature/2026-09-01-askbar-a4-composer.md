# Agent Note: A4 first commit — the Studio pane's addressing composer

Status: implemented

The pane gains typed direct address: one input whose leading `@name` token addresses a participant, sent through the one message path (`POST /idealize/studio/deliver`) as `author: 'user'` with a minted `sm-` message id.

## Problem

A3 built the reading surface; nothing let the user speak into the coordination record. The routing rules (FR-P0-09/10) existed only at the wire — no surface yet showed a person the proposal flow they define.

## Decision

**Resolve the address at send time, against the live roster.** The longest roster name, title, or session id prefixing the text after `@` wins (case-insensitive, whitespace boundary) — the rendered proof caught a single-token parse truncating the drawn two-word agent names (`@Depa` out of "Depa Billaba") on its first run. An unresolvable or ambiguous address names who is present and sends nothing.

**The refusal is the UI.** An unaddressed send posts without a target; the route's FR-P0-10 refusal renders as the lead proposal with a confirming **Send to {label}** press, or as the explicit-target demand. The confirm reuses the same logical message id, so the two presses are one message and a retry cannot bind twice.

**The draft survives the drawer.** It lives in the pane's store beside the view; the proposal, sending flag, and notices are component state and reset with the pane.

## Alternatives considered

**An autocomplete @mention popover.** Deferred to a later A4 commit with the chip panel's Type action: the send-time resolver delivers the addressing semantics first, and the popover is presentation over the same roster read.

**Resolving the token client-side against the pane's fold.** Rejected: the fold's agents are task owners only; the roster is the presence authority (comm listing + Studio fold), and the askbar route already serves it.

**Sending unaddressed messages to the fold's lead directly.** Rejected: the deliver route owns FR-P0-10, and the composer deliberately rides its refusal rather than duplicating the lead lookup client-side — one owner for the routing decision.

## Consequences

- The composer strip renders whenever the pane has a project; `StudioViewInjected` gains `setDraft`, the store gains `draft`.
- The rendered proof covers both outcomes on the assembled app: the @name send lands `user → agent-alpha` in the timeline, the unaddressed send is refused on screen and delivers nothing (no lead runs in the proof), and the byte-provenance check now admits the walk's own `sm-` sends.
- Deliveries to non-live participants record `delivery-queued`, honestly visible in the timeline's system rows.
