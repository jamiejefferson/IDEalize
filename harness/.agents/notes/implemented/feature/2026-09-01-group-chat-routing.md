# Agent Note: group-chat routing — an unaddressed message is a group post

Status: implemented

JJ retired the lead-agent concept in favour of a group chat (1 Sep): the Studio timeline is the group chat, visible to the user; agents and users address each other with `@names`. This note covers the routing half — `@idealize/studio` and the pane's composer. The lead role's retirement in `@idealize/comm` and the role-guide rewrite land separately.

## Problem

FR-P0-10 as built answered an unaddressed message with a refusal proposing the running lead. With the lead retired there is nobody to propose, and the group-chat decision gives the unaddressed message a meaning of its own: a post everyone sees and nobody is invoked by.

## Decision

**An unaddressed message is a group post.** It records through the event route (and `record()`) like any other event: on the timeline, invoking nobody. `MESSAGE_ROUTE_RULE` now states both halves — addressed messages invoke exactly one participant through deliver; unaddressed messages go through the event route.

**Deliver still refuses the unaddressed form.** No silent re-routing: the producer chooses between posting and invoking, and both routes answer the same rule so the choice stays explicit at either door.

**The lead proposal is deleted.** `leadProposal()` goes, and `CommLike` shrinks back to the send-only face deliver actually rides.

**The composer branches on its own address.** A leading `@name` delivers; anything else posts to the event route directly — it never round-trips through a deliver refusal to learn what it already knows.

## Alternatives considered

**Auto-post an unaddressed deliver as a group post.** Rejected: a producer that names the deliver route asked to invoke someone; silently downgrading the send to a post hides the miss. The refusal keeps the meaning of each route single.

**Propose the project coordinator instead of the lead.** Rejected: JJ's decision makes the unaddressed message a first-class group post, not a mis-addressed invocation needing a guessed recipient. The coordinator reads the group chat like everyone else.

## Consequences

- The FR-P0-09 invariant survives in its sharper form: only deliver invokes, and it invokes exactly one participant.
- Group posts wake nobody. A coordinator that should react to group chatter needs a wake trigger of its own — that belongs to the lead-retirement slice, alongside `project-note.md`'s retirement into a coordinator group post.
- The pane's proposal strip (`data-studio-compose-proposal`, `studio.composer.{proposal,confirm,keep}`) is gone; the rendered proof now proves the group post landing on the timeline with no `→` target instead of the explicit-target demand.
