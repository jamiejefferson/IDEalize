# Agent Note: the Studio coordinator resumes after a restart

Status: implemented

JJ, 14 Sep 2026, after pairing Telegram and getting no reply: "the issue is with the studio not with the telegram connection - nothing happens when you message in the app".

## Problem

Every note typed in the Studio, from the app or from the phone, reached the Studio Coordinator's mailbox (`comm.json` held five unread from the person) and nothing answered. The coordinator, "Poe Dameron", was a session from an earlier run of the app: its last turn failed at 15:29 on the ChatGPT route (the stray key, see the keys-file note), the app was quit and reinstalled twice for landings, and after that the session existed only in persistence. `@idealize/studio` finds its coordinator by role through `comm list`, which includes persisted sessions, and `comm spawn --studio` answered the stored id without reviving it, so every delivery landed in a mailbox no agent read. `send` invokes only a live idle recipient with exactly one unread note, so even a resumed coordinator would have sat on a backlog until the person's next note, and then still not read it.

## Decision

Two more gaps sat in front of that one. `@idealize/studio` took any listed `studio-agent` row as its coordinator, running or not, so it never asked comm to spawn once a stored one existed; it now requires `running: true` and otherwise asks for `spawn --studio`. And the HTTP request parser never copied the `studio` flag, so `idealize spawn --studio` from a shell reached the service as a plain worker spawn with no folder; the flag is parsed as a boolean beside `coordinator`.

On the landed build the resume itself worked and the coordinator's turn still died: its profile carried the `apiKeyEnv` line left from the removed ChatGPT key, and `@deepseek-ai/dsh-llm-pi-ai` fails a named-but-unset reference before pi-ai sees the request. That rule guards against an ambient key billing another tenant, and no such key can reach an OAuth-only provider (pi-ai's `openai-codex` has no api-key method and ignores an override), so an OAuth-only route now ignores the reference and resolves from the stored sign-in. The wire row also grew `live`, distinct from `running` (which is true only mid-turn), because the Studio needs to know whether an agent holds the session at all.

With the model answering, two more faults stood between its reply and the person. Its `idealize post` recorded on its working folder, the harness home, because every Studio command took the caller's `cwd` as the project; the Studio coordinator's commands now act on the Studio's own timeline (`studio`), which the Studio chat reads and the phone relay forwards. And its first `idealize inbox` answered `unknown sender session`: the CLI preferred V0's `IDEALIZE_SESSION_ID`, which JJ's login environment still carries with a stale V0 `t-…` id, over the harness-stamped `DSH_SESSION_ID`; a diagnostic turn on the landed build printed both. The CLI now trusts the harness's variables first, for the host origin too. Another chat's log from 10 Sep held eighteen of the same failures, so no chat had been able to use `idealize` as itself.

`spawn` for a role chat answers a live match as before; a stored match that is not live is resumed on its own persisted history through `agents.resume`, composed as a fresh spawn is (the role's Activity Agent preset and the default model, shared through one `composition` helper so the two never drift), and woken once with the mail notice when its mailbox already holds mail. A resume that fails is logged and a fresh coordinator starts. The Project Coordinator takes the same path.

## Alternatives considered

Spawning a fresh coordinator whenever the stored one is not running would have answered the person, at the cost of the timeline and mailbox continuity the stored session carries; resuming it on its own persisted history keeps both. Clearing the stale `apiKeyEnv` from the profile by hand would have fixed one Mac and left the rule that fails a named-but-unset reference in place for every OAuth-only route.

## Consequences

A stored Studio coordinator that is not running is resumed rather than left silent, composed as a fresh spawn is, and woken once when mail already waits. Studio commands from the coordinator act on the Studio's own timeline, not the caller's folder. An OAuth-only route ignores a stale `apiKeyEnv` and authenticates from the stored credential.

## Evidence

`resumes a stored Studio coordinator that is not running, and wakes it once when mail waits` in comm's `service.spec.ts`, `asks comm to resume a stored Studio coordinator that is not running` in the Studio's `studio-chat.spec.ts`, the `studio` flag in the `parseRequest` case, and `lets an OAuth-only route ignore a stale apiKeyEnv and authenticate from the stored credential` in llm-pi-ai's `adapter.spec.ts` (whose mock server now decodes the zstd request body the Codex client sends); 368 tests across the three packages pass. On the landed build, `comm spawn --studio` against JJ's stored coordinator resumed it and it worked through the waiting notes.
