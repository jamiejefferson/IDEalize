# Agent Note: Askbar A2 — the Studio event contract's record layer

Status: implemented

The first seven commits of slice A2 in the Askbar/Studio release plan (`.idealize/plans/askbar-plan.md`), which replaces mini-mode per JJ's spec (`idealize-askbar-studio-product-spec.md`). This commit is the record layer alone: the durable per-project timeline, the deterministic task fold, and the loopback routes. Presence, the outbox, task binding, membership and every surface come later in the slice ledger.

## Problem

The spec's Studio needs a durable, ordered, per-project timeline of structured coordination events with delivery guarantees (stable ids, deterministic order, no duplicate task binding from one logical message, restart survival — FR-P0-06/08/11/20, NFR-04/11/12). Nothing in the repo records that: `@idealize/comm`'s mailboxes are prose consumed on read, its rungs are one mutable row per session, and the host bridge's feed is a 200-event in-memory ring that forgets on restart. Every one of those is the wrong substrate for a record other machinery must replay.

## Decision

**A new package, `@idealize/studio`**, owning the event contract end to end: vocabulary (`events.ts`), store (`store.ts`), fold (`fold.ts`), service + routes (`index.ts`).

**One append-only JSONL file per project under `<DSH_HOME>/idealize/studio/`**, named `slug(basename)-sha256[:12].jsonl` so same-named folders cannot share a timeline. The store serialises appends per project, assigns `id`/`seq`/`at`, and resolves once the line is on disk; `idealize/studio-event` is emitted only after that (publish at the commit point), and the package invariant asserts the announce-after-commit relation. A `messageId` already recorded returns its event and writes nothing — duplicate suppression that survives restarts, because the map is rebuilt from the file. On load, a final line short of its newline is a torn write and is dropped; any other malformed or out-of-order line refuses the file loudly (pre-release stance: no compatibility shims).

**Kinds are closed at the wire, subtypes are open.** The nine spec kinds are a closed union (`satisfies never` exhaustiveness in the fold); subtypes are bounded strings, and a reader meeting an unknown subtype treats the event as a plain timeline item — the documented merge-extensible default, so later commits add `handoff` transfer states without a format bump.

**The fold is pure and exported** (`foldStudioState`): assignment → queued task; `working`/`paused`/`blocked`/`done`/`failed`/`cancelled` transitions; requests move to `waiting` with an owner and a `requestEvent` whose `resolve-request` returns the task to `working`; `done`/`failed` raise terminal attention that survives everything except its matching acknowledgement event, which records actor and time (FR-P0-13). The per-agent view derives `displayed = active ?? earliest queued`, which makes queue promotion a consequence of the data rather than a stored state.

**The store lives under DSH_HOME, not in the project folder.** comm's `project-note.md` sits in the project because it is prose for people; the timeline is app state with delivery semantics, and a user committing `.idealize/` to a repo must not publish or merge-conflict their coordination ledger.

**Delivery and presence (second commit).** `deliver()` carries one addressed message: record the message event (duplicate-suppressed), attempt the mailbox through `ctx.idealizeComm` (`send` on the wire service, so target resolution, clamping and the mail toast stay comm's), and append a `system` `delivery-delivered`/`delivery-queued` record naming the message in `source.event`. A repeated `messageId` re-attempts a still-queued send and appends only the change to delivered, so a retry can neither duplicate the message nor grow the timeline while the target stays away (FR-P0-06/20 substrate). Presence is derived, not recorded: `presenceOf` marks a participant reachable exactly while a live root agent runs that session — in-process there is no heartbeat to expire, so no freshness budget exists yet; a remote runtime later introduces one as a config field.

**The CLI publishing path (third commit).** Specialists report through the `idealize` CLI (FR-P0-11): `task <goal> --to <chat>` assigns through `deliver()` (timeline + mailbox in one act), `progress`/`blocked`/`need`/`done` record structured events that invoke nobody, and `studio` prints the folded board with roster labels. The handlers live in comm's service, where target resolution and the roster already are; studio's read of `idealizeComm` became a structural `CommSendLike` (the ui-bar `DesktopActionsLike` pattern) so comm can depend on studio without a cycle. An unknown task id or empty outcome is refused loudly, and `need` defaults its owner to the user.

**Reconnection and expiry (fourth commit).** `agent/session-start` drains the queue: `retryQueued` re-attempts every queued delivery addressed to the starting session across every stored project (`storedProjects` reads each file's first line for its project, so hashed names never need reversing). A message older than `deliveryExpiryHours` (config, default 72) is recorded `delivery-expired` instead of attempted; an explicit `deliver` retry with its `messageId` still revives it, because a person asking again outranks the policy. The rung ladder's retirement — the role guides still teach rungs and markdown boards — is deliberately not folded in here; it changes how the Lead and Coordinator operate and gets its own decision.

**Handoffs (fifth commit, FR-P0-14).** `kind: handoff` joined the fold: `offered` raises `handoff-ready` attention on the recipient while the sender keeps ownership; only the named recipient's events move the transfer, `needs-clarification` flips the attention owner back to the sender, `accepted` transfers ownership, `rejected` returns the offer, and a terminal task state drops it. The CLI grew `handoff --to`, `accept` and `reject`; comm enforces at the operation that only the owner offers and only the recipient answers, and the offer itself travels through `deliver()` so the recipient's mailbox learns of it. Expiry (the spec's policy window) has no owner yet.

**Lead wake triggers (sixth commit, FR-P0-15).** comm listens to `idealize/studio-event`: the defined triggers (unowned blocker, `done`, `decision`, `delivery`, accepted handoff) put one `[studio]` line in the project coordinator's mailbox; a live, idle coordinator whose mailbox was empty additionally receives one fixed wake notice (pinned in comm's README Model Experience), so a burst invokes one model turn and the rest drains from the inbox. Routine events, system records and the event's own author never wake anyone — the empty-mailbox rule is the debounce, with no tunable to misconfigure.

**Synthesis and decisions (seventh commit).** The fold serves the latest `synthesis` publication with a `stale` flag: any later assignment, task-update, request, decision, handoff or delivery stales it, messages and system records never do, and republishing resets the watch. The CLI grew `decide` (any chat records a decision) and `synthesis` (refused unless the sender holds the lead or coordinator role — checked against the comm store, the operation that records it). `studio` prints the synthesis line with its staleness.

## Alternatives considered

- **Session events.** Model-visible ⟺ logged pushes that way, but a Studio timeline is project-owned and multi-session; agents will read it through shell commands (like comm's mailboxes), paying tool-result tokens there. A per-session log cannot serve deterministic per-project order.
- **Extending comm.json.** One mutable JSON document gives no append-only order, no stable per-event identity, and rewrites the whole file per event; the timeline's guarantees are exactly what JSONL append gives for free.
- **SQLite.** Real, but the repo's SQLite use carries `SCHEMA_VERSION` machinery this record does not need yet; one JSONL file per project is inspectable, greppable and enough until sizes prove otherwise (limitation recorded).

## Consequences

Store, fold and routes are covered by package specs (26 tests): monotonic gap-free seq, restart replay, duplicate suppression across restarts, torn-write recovery, loud corruption refusal, the fold's lifecycle table, promotion, acknowledgement kinds, wire refusals, the auth/loopback fences, and the commit-then-announce order. The `idealize-studio` row mounts in `@idealize/bundle-idealize` after host-bridge. No UI, no CLI, no model-visible output yet, so no snapshot lands with this commit; the first surface commit carries one.

The route fence trio (`refuse`/`sendJson`/`readBody`) is the fourth copy in `packages/idealize/*`; it is jscpd-marked with a TODO naming the extraction, which should lift all four copies at once. The repo `duplication` gate was already red on main (37 clones) before this change and stays at that count.
