# Agent Note: finished work reaches the Studio, and a Studio note is answered there

Status: implemented

JJ, 8 Sep 2026: "When an agent completes an action I want them to post a note into the studio, and if an agent is asked via a tag to interact, they can do it in the studio."

## Problem

Agents posted to the Studio only when told to, through `idealize post`; no rule in their prompt said a finished piece of work earns a post, and nothing in the host posted for them. A person typing `@Watto how is the hero?` in the Studio composer had the note delivered to Watto's mailbox as the sender `user`, but the wake notice (`MAIL_NOTICE`) said "a note from another agent" and pointed at `idealize send` as the reply, and `resolveTarget` has no `user` participant, so the reply went to Watto's own chat where the person was not looking. The Studio read as write-only from the person's side.

## Decision

**The prompt states both rules.** `COMMANDS_SECTION` in `@idealize/comm` (order 120, every request of every chat) ends with two sentences: finish a piece of work the person asked for and post one line with `idealize post` saying what you did and where it is; a note that reaches you from the Studio is answered in the Studio with `idealize post`, not only in your own chat. The coordinator's guide (`skills/project-agent/SKILL.md`, "The group chat") carries the same two rules and tells the coordinator to brief workers with them.

**A Studio-origin note says where it came from.** `send` with `from: 'user'` (how `@idealize/studio` delivers the Studio chat's addressed post) labels the mailbox message `Studio`, the inbox prints a second line, `(sent from the Studio: answer there with `idealize post <text>`)`, and an idle recipient is woken with `STUDIO_MAIL_NOTICE` instead of `MAIL_NOTICE`. Agent-to-agent notes keep `MAIL_NOTICE`.

**A safety net posts when the agent forgets.** `IdealizeComm.reportFinishedTurn(session, turn)` runs on every session's `turn/end` (`session/event`, the same subscription level as comm's `agent/session-start` listener). It reads the ended turn's log slice: a `tool/call` named `generate_image`, `generate_video` or `generate_audio`, plus the `artefact/created` records in the same turn, earn one `message` on the project's timeline when no `message` authored by that session landed on the timeline since the turn started. The line reads `<name> generated 2 images (id, id)` (`describeArtefacts` groups by media kind), its author is `idealize`, and `source.thread` names the chat so the Studio row offers Open chat. The system author is deliberate: `wakeLine` ignores it, so the coordinator sleeps through a line that reports an act and asks nobody to do anything, and the Studio view shows `idealize` beside a body that names the agent. Nothing is posted for a turn with no generation call, a generation that stored nothing (its failure is in the agent's own chat), a chat outside a project, or the Studio chat.

**The net's second path covers a background generation.** A `generate_*` call made with `run_in_background` returns a job id at once and stores its artefacts after the turn has ended, where the turn read never sees them (JJ, 8 Sep 2026, on that gap: "not sure what this means but it doesn't sound right"). `IdealizeComm.noteBackgroundArtefact(session, event)` runs on every session's `artefact/created`: a record whose `sourceTask.toolName` is a generation tool and whose own turn has already ended joins that session's pending batch. The turn decides it, not the session's current state: a job can store its outputs while the person is mid-conversation, and reading "no open turn" would drop that case. Every further artefact restarts the window (`backgroundPostDelayMs`, 2000 ms by default, a validated `Config` field), so a job that stores several outputs reads as one line: `<name> finished generating 2 videos (id, id) in the background`, on the same system author and `source.thread`. `forgetSession` drops a batch when the session is disposed, and the service's own `ctx.effect` disposer clears every pending timer with the plugin. The comm settings section carries the window beside the coordinator preset, so `IdealizeComm.roleConfig` is now `config`.

## Alternatives considered

**Author the safety-net line as the agent.** The Studio view renders `author` raw, so the row would read as the agent's own words; a group post from an agent also wakes the coordinator (JJ, 2 Sep), and a line the host wrote on the agent's behalf should not.

**Detect a finished action by any tool call.** Every edit would earn a line and the timeline would become a tool log; the generation tools are the one act whose result is a file the person wants pointed at, and their `artefact/created` records carry the ids to point with.

**Route the reply into the Studio by adding a `user` participant to `resolveTarget`.** A `send` to the person would need a delivery target the Studio has none of; the Studio timeline is already the place the person reads, and `idealize post` already reaches it.

## Consequences

`@idealize/comm` gains a type-only dependency on `@idealize/artefacts` for the `artefact/created` event type. Every session's `artefact/created` reaches comm, which reads one field of the record and keeps at most one timer per session. The two consumers that probe comm through `ctx.get` (`@idealize/spaces`, `@idealize/activity-pills`) call `config()` where they called `roleConfig()`. Tests: `comm/tests/prompt.spec.ts` (section text), `service.spec.ts` (Studio-origin label and notice), `turn-end.spec.ts` (both paths of the safety net and their wiring). The desktop landing walk should read a Studio-timeline `idealize` line after a generation whose chat posted nothing, and a `Studio`-labelled inbox line after an `@name` send from the Studio composer.
