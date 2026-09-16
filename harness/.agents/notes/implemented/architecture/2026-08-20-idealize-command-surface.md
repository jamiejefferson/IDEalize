# Agent Note: IDEalize command surface as host routes plus a CLI shim

Status: implemented

## Problem

IDEalize V0 let chats (and the coding agents inside them) address each other through an `idealize` binary: list sessions, post to mailboxes, report where a piece of work stands, spawn worker chats with a brief, keep a shared project note, read transcripts, and point the person at files. V0 spoke to its app over a Unix socket with a capability token. The V1 fork runs as a web host, the agent guides written against V0's command names and output shapes still circulate, and a chat's shell has no way to reach the host.

## Decision

`@idealize/comm` (`packages/idealize/comm`) owns the surface. The host half is one route, `POST /idealize/comm`, taking a JSON request whose field names match V0's `IPCRequest` (`command`, `from`, `target`, `body`, `title`, `sound`, `open`, `limit`, `name`, `path`, `model`, `piece`, `rung`, `blocker`) and answering V0's `IPCResponse` envelope (`ok`, `error`, `info`, `warning`, `sessions`, `messages`, `exchanges`, `rungs`). The CLI half is the `idealize` bin (`lib/cli.js`), which parses V0's grammar, posts one request, and prints V0's text shapes or `--json`.

Commands: `ping`, `list`, `notify`, `send`, `broadcast`, `inbox`, `peek`, `rung`, `board`, `spawn`, `note` (`--set`, `--mine`, `--path`), `transcript`, `status`, `focus`, `reveal`. `exec`/`type`, `image`, and `blocks` are deliberately absent (no terminal, no Kitty, no block model in V1); `spawn --isolated`, `--verify`, `--coordinator`, `diff`, `survey`, `verify`, and `combine` wait for the safe-copies piece.

Identity and transport: the request's `from` is the caller's session id, read by the CLI from `IDEALIZE_SESSION_ID` or the harness's `DSH_SESSION_ID` (present in every bash-tool shell through `shell-env`). The host origin reaches the CLI through a `shell-env` contribution, `DSH_IDEALIZE_HOST`, with `<DSH_HOME>/idealize/comm-host.json` as the fallback for shells started outside a session, and `IDEALIZE_HOST` as an explicit override. The route is loopback-fenced and every command except `ping` demands `x-idealize-auth: 1`, the fence every other `/idealize/*` mutating route uses.

Roster: live root agents (`ctx.agents.roots()`, subagents excluded) joined with persisted session headers (`sessionPersistence.list()`). Each entry carries an agent name and a task label: the task is the live title, else the title `spawn` recorded, else the folder name. Addressing resolves id, then the `lead`/`lead-agent` and `coordinator`/`project-agent` aliases (the coordinator alias prefers the caller's own project), then agent name, then task label, then folder name; several matches are an error that lists the candidates.

Agent names: every session draws a name on `session/created` from JJ's twelve name pools (`name-pools.ts`, 496 unique names). A project takes the least-used pool on its first chat and keeps it, so names never repeat inside a project and projects on different pools never clash; an exhausted pool spills into the next, and with all 496 held a numbered form keeps the chat addressable. The draw is logged as the session event `idealize/agent-name` (the chat is told its name at session start, so the fact is model-visible), appended with the envelope's `ignorable` marker because the comm store is the name's source of truth ([naming-event reload note](../bug-fix/2026-08-24-agent-name-event-blocks-session-reload.md)), and projected as `agentName` for clients; `@idealize/comm/client` carries the type merge so the sidebar rows show the name over the task.

Roles: the settings section `idealize-comm` names which two Activity Agents (presets) carry the roles, `leadPreset` (default `lead-agent`) and `projectAgentPreset` (default `project-agent`). On boot the plugin seeds both presets into the user's preset root when absent, derived from the deployment's default composition with the persona row replaced, and never overwrites them: the persona is the user's personalisation prompt. A session running a role preset (observed through `agent-preset/selected` and at session start) is recorded with that role and titled `Lead Agent` / `Project Coordinator`; at session start it also receives the matching V0 role guide (the `lead-agent` / `project-agent` skill bodies, shipped under `skills/`) as model-facing context. `spawn --coordinator [--path]` and `spawn --lead` start the role chat on its preset with a role opening turn (a chat with no turn would stay a hidden blank), or answer the existing one's id (one coordinator per project, one lead overall). The mapping is edited from the Brains pane's Roles rows (`@idealize/ui-bar` Models panel), which read and write `GET/POST /idealize/comm/roles`.

State: mailboxes, rungs, status labels, each chat's `--mine` line, roles, and spawn names live in `<DSH_HOME>/idealize/comm.json`, written atomically and serialised, so mail outlives restarts and unread counts are durable. The shared note is the project's `.idealize/project-note.md`, as in V0.

Shell-facing effects are events, not UI: `idealize/comm-mail`, `idealize/comm-notify`, `idealize/comm-focus`, `idealize/comm-reveal` are typed Cordis events, and the same facts land in the host bridge feed as the new kinds `mail`, `notify`, `focus`, `reveal`, so the desktop shell and the browser read one feed. The sidebar unread badge and the reveal-in-files-panel wiring are later pieces reading these.

`spawn` creates the child through `agents.create` in the target folder (the caller's cwd unless `--path`), attaches it to the matching workspace (creating one when the folder is new), names it from `--name` or the brief through V0's `chatName(fromTask:)` port, and posts the brief as a follow-up without awaiting the turn. No focus event is raised: the child opens in the background and the caller keeps the person's attention.

## Alternatives considered

- A Unix socket as in V0: the host already serves HTTP on loopback with the same fence; a second transport would be a second thing to secure.
- One route per command: the single envelope keeps the CLI a thin table-driven shim and the wire shapes identical to V0's, which is what keeps the guides working.
- Reading titles for persisted sessions by folding each log: correct, and proportional to the session count on every `list`; the spawn-name cache plus folder fallback answers the addressing need without it.

## Consequences

Cost: a persisted session created before this plugin existed carries no agent name until it is next opened (the name is drawn on `session/created`), and a preset renamed or deleted leaves the role row showing the stale id until the user picks another. Bought: the V0 guides run unchanged against the V1 host, every chat is addressable by a stable name the person can say aloud, mail survives restarts, roles resolve without anyone typing one, and the shell integrations (badges, toasts, focus, reveal) are one subscription each.

## Testing

Unit tests cover the wire helpers and title derivation, the name pools and the draw (pool choice, spill, numbering), role mapping, preset seeding (never overwriting), the guides, the store's durability and burst serialisation, addressing including ambiguity and name matching, transcript and name folding, the fence, and request validation (`packages/idealize/comm/tests`). A real shell run of `list`, `send`, and `inbox` against a scratch host on port 31252 is the acceptance check for the piece.
