# @idealize/studio

The Studio event contract's host half: a durable per-project coordination timeline, the deterministic task fold over it, and the loopback routes surfaces read and write. This is slice A2 of the Askbar/Studio release plan (`.idealize/plans/askbar-plan.md`): the record layer that Askbar chips, the Studio pane, typed address and voice all build on. The `idealize-studio` row in `@idealize/bundle-idealize` mounts it.

## The timeline

One append-only JSONL file per project under `<DSH_HOME>/idealize/studio/`, named by `projectKey`: a readable slug of the folder's basename plus a 12-hex hash of its full path, so two folders sharing a basename cannot share a timeline. Each line is one `StudioEvent`:

| Field | Meaning |
|---|---|
| `id` | Stable identity, minted on append (`se-<uuid>`). |
| `seq` | Per-project order: 1-based, monotonic, no gaps. |
| `at` | ISO-8601 append instant. |
| `project` | The resolved project folder (also implied by the file; kept so a line is self-describing). |
| `author` | The writing participant: a session id, or `user`. |
| `kind` | One of `message`, `assignment`, `task-update`, `request`, `decision`, `handoff`, `delivery`, `synthesis`, `system` — closed at the wire. |
| `subtype` | Open refinement (`new-task`, `blocked`, `needs-input`, …); a reader that meets an unknown subtype treats the event as a plain timeline item. |
| `target` | The addressed participant, or the owner an assignment or request names. |
| `taskId` | The task the event belongs to; task ids are chosen by the assigning author. |
| `body` | Message text, task goal, or request question (≤4000 characters at the wire). |
| `source` | Evidence links: `thread` (a session id) and `event` (an earlier Studio event this one resolves or revises). |
| `messageId` | The producer's logical message id. Appending the same id to the same project again returns the recorded event and writes nothing, so a retried delivery cannot bind twice — across restarts too. |
| `visibility` | `studio` (every event is Studio-wide in the MVP; the field exists so private scopes are not designed out). |

Appends are serialised per project and resolve when the line is on disk; `idealize/studio-event` is emitted only after that, and never for a suppressed duplicate. On load, a final line cut short of its newline is a torn write and is dropped; any other malformed or out-of-order line refuses the file loudly.

## The fold

`foldStudioState(events)` is the deterministic project-state view (pure, exported). It reads `assignment`, `task-update`, `request` and `system`; the other kinds are timeline items until their state machines land.

- **Execution** per task: `queued` → `working`/`waiting`/`paused` → `done`/`failed`/`cancelled`. An assignment creates a queued task (`target` is the owner, `body` the goal, its author the `requester` — who asked for the work, which the notification policy reads); `reassign` moves ownership.
- **Attention**: `needs-input`/`needs-action` (from `request`, owner in `target`) and `blocked` (owner optional — an unassigned blocker) move the task to `waiting` and record the request event; `system`/`resolve-request` with `source.event` naming it returns the task to `working`. `done` and `failed` raise `completion`/`failure` attention that survives every later event until its matching `acknowledge-delivery`/`acknowledge-failure`, which records the acknowledging author and time.
- **Handoffs** (`kind: handoff`): `offered` (owner → `target`) raises `handoff-ready` attention on the recipient while the sender keeps ownership; only the named recipient's events move the transfer — `needs-clarification` puts the ball back with the sender, `accepted` transfers ownership and clears the offer, `rejected` returns it. `cancelled` clears it too (who may cancel is the recording operation's check). A terminal task state drops any open offer.
- **Synthesis** (`kind: synthesis`): the latest publication is served as `synthesis` ({event, author, at, body, stale}); it goes stale when any later `assignment`, `task-update`, `request`, `decision`, `handoff` or `delivery` arrives — messages and system records never stale it — and republishing resets the watch.
- **Per-agent view**: `active` is the one task in `working`/`waiting`/`paused` (earliest created when a log claims several), `queued` is creation-ordered, and `displayed` — the chip's routing target — is the active task, else the first queued. Queue promotion is therefore inherent: closing the active task promotes the earliest queued to displayed. `finished` names the owner's latest task that was not cancelled, when it is `done` and nothing is active or queued: the Askbar chip and the Studio's agents row read it as "finished, safe to close". A new assignment clears it; acknowledgement does not.

## Service (`ctx.idealizeStudio`)

`record(input)` appends and announces; `timeline(project, since?)` and `state(project)` read; `lastSeq(project)` serves cursors and the invariant. The wire validates (`studioEventInputSchema`); the service trusts its typed callers.

## Configuration

| Field | Default | Meaning |
|---|---|---|
| `deliveryExpiryHours` | `72` | How long a queued delivery stays retryable on reconnection before it is recorded `delivery-expired`. The spec's expiry policy is an open product decision; this field is its owner until JJ tunes it. |

## Delivery and presence

`deliver(input)` carries one addressed message end to end: the message event is recorded (duplicate-suppressed on `messageId`), the body goes to the target's mailbox through the composed `idealizeComm` service, read structurally so `@idealize/comm` can depend on this package (comm clamps mailbox copies at its own 800-character cap; the timeline holds the full body), and a `system` record with `source.event` naming the message stores the outcome: `delivery-delivered`, or `delivery-queued` with the refusal when the send failed or no messaging service exists. A repeated `messageId` never records a second message event: a still-queued delivery is re-attempted (appending only the change to delivered), a delivered or acknowledged one returns its recorded state without touching the mailbox. The fold serves `deliveries` (message event id → `queued`/`delivered`/`acknowledged`/`expired`, latest record wins).

Reconnection drains the queue: when a session starts, `retryQueued` re-attempts every queued delivery addressed to it across every stored project. A message older than `deliveryExpiryHours` is recorded `delivery-expired` instead of attempted; an explicit `deliver` retry with its `messageId` still revives it, because a person asking again outranks the policy.

### Routing (FR-P0-09/10)

An addressed message invokes exactly one participant, and only `deliver` invokes: the event route and `record` refuse `kind: 'message'` carrying a `target`, so a producer cannot put an invocation in the timeline that never reached anyone. An unaddressed message is a group post — recorded on the timeline for everyone, invoking nobody — and goes through the event route like any other event; the deliver route refuses it with the same rule, keeping the choice between posting and invoking explicit. The former lead-proposal answer is retired with the lead agent (JJ, 1 Sep): the group chat replaced it.

`presenceOf(state)` answers runtime presence per task owner: `reachable` exactly while a live root agent runs that session. In-process there is no heartbeat to expire, so the answer is current by construction and no freshness budget applies yet; a remote runtime later introduces one as a config field. Non-session participants (`user`) read as unreachable — the surface decides how to render them.

## Routes (loopback only; mutations need `x-idealize-auth: 1`)

- `GET /idealize/studio/timeline?project=<folder>&since=<seq>` → `{ events, lastSeq }`, events with `seq` greater than the cursor, oldest first.
- `GET /idealize/studio/state?project=<folder>` → the folded `{ tasks, agents, deliveries }` plus live `presence`.
- `POST /idealize/studio/event` (one `StudioEventInput`) → `{ ok, event, duplicate }`; 400 names the wire refusal. A `message` is refused here and pointed at `deliver`, whatever its target.
- `POST /idealize/studio/deliver` (one `StudioEventInput` with `target` required) → `{ ok, event, duplicate, delivery }`. Unaddressed, it records nothing and answers 400 pointing at the event route: an unaddressed message is a group post.
- `GET /idealize/studio/overview` → `{ projects }`, one entry per stored project (`project`, `lastSeq`, the folded `state` with `presence`, and the newest 60 timeline events oldest first); the Studio view and the pinned Studio card read it so one poll covers every project.

`project` is resolved (`path.resolve`) at the route so one folder cannot split into two timelines by spelling.

## The Studio chat

The Studio chat is a blank chat holding the `studio` space (folded by `@idealize/spaces`); the person types into its ordinary composer and no model ever answers, because the host owns that chat's turns. An `agent/pre-step` waterfall listener runs on every turn: it delegates unless the session's space is `studio`, and for a Studio chat it takes the user-sourced text of the message (`source.kind === 'user'` only, so `@idealize/comm`'s injected name notice never counts), hands it to `postFromChat` and returns `{ kind: 'reject' }`, so the turn ends `blocked` and no `user/message` reaches a model. `postFromChat` resolves a leading `@`: `resolveAddress` matches the longest agent name, task title or session id at a word boundary among the participants of every stored project and delivers the rest to that one agent through `deliver` on its project. A post without an `@` goes to the one Studio Coordinator, on the Studio's own timeline (the key `studio`, which no project folder can collide with because every other key is an absolute path): the service finds a running chat with comm's `studio-agent` role, asks comm for `spawn --studio` when none runs (comm resumes a stored coordinator from an earlier app run on its own history, or starts a fresh one), and delivers to it. It used to be recorded on every stored project's timeline instead, which put the typed line on every timeline and woke every project's coordinator at once (JJ, 11 Sep 2026). An `@` nobody matches (or two match), and a Studio Coordinator that cannot be started, record nothing and push a bridge `notify` saying so. The chat is excluded from `@idealize/comm`'s roster and is never named, so agents cannot address it.

## Invariant

The package companion asserts the announce-after-commit relation: on every `idealize/studio-event`, the store must already retain that event's seq for its project — a consumer must never learn of a record a restart would not replay.

## Model Experience

None, as the package stores and serves project coordination records over loopback HTTP; nothing it holds enters a model request. Agents read and write the timeline through `@idealize/comm`'s `idealize` CLI, whose tool-result tokens that package's commands own.

#### KV Cache effect

Independent: no model request is touched, so no prefix changes and no reuse is invalidated.

## Known Limitations and Deferred Work

- **No membership or grant enforcement yet.** Every event is Studio-wide (`visibility: 'studio'`) and any loopback caller with the auth header may write as any author; FR-P0-17/18 land with the participant record.
- **`message`, `decision` and `delivery` are timeline items only.** Decision revision propagation (FR-P0-26's acknowledgement half) has no machinery yet; decisions and deliveries do already mark the synthesis stale and wake the coordinator. Handoff expiry (the spec's `Expired` state) has no owner yet — an open offer stands until answered, cancelled or the task closes.
- **One active task per agent is derived, not enforced.** The fold picks the earliest-created active task when a log claims several; the binding rules that prevent the second `working` arrive with the task-binding commit.
- **No user-facing expiry extension.** The spec lets the user extend a queued delivery's life; today the only revival of an expired delivery is an explicit `deliver` retry with its `messageId`.
- **A symlinked spelling still splits a timeline.** The routes `path.resolve` the `project` value, so relative spellings collapse, but a path through a symlink (macOS's `/tmp` → `/private/tmp`) hashes to a different `projectKey` than its canonical twin. Producers must send the canonical path; a `realpath` at the route is the fix when a real consumer hits it.
- **The timeline never compacts.** Long-lived projects grow one file without bound; a retention or archive policy is deferred until real sizes exist.
