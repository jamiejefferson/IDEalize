# @idealize/comm

The `idealize` command surface: one host route, `POST /idealize/comm`, plus the `idealize` CLI shim that chats and their agents use to talk to each other.

| Command | Does |
|---|---|
| `list [--json]` | every chat: id, name, folder, role, unread count |
| `send <session> <text>` | post to a chat's mailbox (capped at 800 characters) |
| `inbox [--wait] [--timeout S] [--json]` | read and clear my mailbox |
| `peek [--json]` | read without clearing |
| `rung <piece> <rung> [--blocker B] [--note T]` | record where a piece stands; the status line also posts to the project's group chat |
| `board [--path DIR] [--json]` | every piece's rung for a project |
| `spawn <task> [--name LABEL] [--path DIR] [--model M]` | start a chat with a brief, in the background; prints its id |
| `spawn --coordinator [--path DIR]` | start, resume or surface the Project Coordinator; prints its id |
| `spawn --studio` | start, resume or surface the Studio Coordinator, which belongs to no project; prints its id. A stored coordinator from an earlier app run is resumed on its own history, composed as a fresh one would be, and woken once when its mailbox already holds mail |
| `notify <text> [--title T] [--sound]` | raise a system notification |
| `post <text>` | post to the project's group chat on the Studio timeline (everyone sees it; nobody is invoked) |
| `chat [--last N]` | read the project's recent group-chat messages |
| `transcript <session> [--last N] [--json]` | a chat's recent Q&A |
| `status <text>` | set my status label |
| `focus <session>` | ask the shell to bring a chat to the front |
| `reveal <path> [--open]` | point the person at a file |
| `task <goal> --to <session>` | assign a Studio task; the assignment lands on the project timeline and in the owner's mailbox |
| `progress <taskId> [note]` / `blocked <taskId> <cause> [--owner T]` / `done <taskId> <outcome>` | report a Studio task's state as structured timeline events |
| `need <taskId> <question> [--owner T] [--action]` | raise a resolvable request; default owner is the user |
| `studio [--path DIR] [--json]` | the project's Studio tasks, states and open attention |
| `handoff <taskId> --to <session> [reason]` / `accept <taskId>` / `reject <taskId>` | offer a task's ownership to a peer; only the named recipient can take or decline it |
| `decide <text>` | record a project decision on the timeline (it wakes the coordinator and stales the synthesis) |
| `synthesis <text>` | publish the project view; coordinator only, and `studio` prints it with its staleness |

A `<session>` is an id, an agent name, a task title, a project folder name, or the aliases `coordinator`/`project-agent` (your own project's) and `studio-agent` (the one Studio Coordinator). Several matches are an error listing the candidates.

Every chat is named on creation from its project's pool of names (twelve pools, 496 names; one pool per project, so names never repeat within a project). The name is logged to the session as `idealize/agent-name` with the envelope's `ignorable` marker (the comm store holds the name, so a harness without this vocabulary still reads the log), told to the chat at start, projected as `agentName`, and shown over the task on the sidebar card. The Studio chat (a blank chat holding the `studio` space, read live from its events or cold from the projection cache) is the one exception: `roster` leaves it out and session start skips its name, because the host owns its turns and no agent should address it.

Two roles come from Activity Agents, at different altitudes. The preset named by the `idealize-comm` settings as `projectAgentPreset` (default `project-agent`) carries the Project Coordinator: a chat running it coordinates one project folder, is titled `Project Coordinator`, is found by that folder, and is handed `skills/project-agent/SKILL.md`. The preset named as `studioAgentPreset` (default `studio-agent`) carries the Studio Coordinator: it runs in the harness home rather than any project, is titled `Studio Coordinator`, is found by the role alone because there is one, takes every untagged post the person types in the Studio, is handed `skills/studio-agent/SKILL.md`, and acts on the Studio's own timeline (the `studio` key) for `post`, `chat`, `decide`, `synthesis`, `deliver` and `studio`, never on the harness home it runs in, so its replies reach the Studio chat and the phone relay. Both presets are seeded on first boot with an editable persona; both mappings are readable and settable over `GET/POST /idealize/comm/roles`, which no pane surfaces since 7 Sep 2026 — the Brains pane's coordinator rows are the roles, edited like any brain. The lead-agent role was retired for the group chat (JJ, 1 Sep): agent-to-agent traffic that everyone should see is a `post` on the Studio timeline.

Identity comes from `DSH_SESSION_ID` (stamped fresh on every tool shell), else V0's `IDEALIZE_SESSION_ID`, which reaches a V1 shell only as login-environment residue and used to win with a stale V0 id, so every `idealize` call from a chat answered `unknown sender session` (JJ, 14 Sep 2026). The host origin comes from `DSH_IDEALIZE_HOST` (set in every tool shell), else `IDEALIZE_HOST`, else `<DSH_HOME>/idealize/comm-host.json`. The route is loopback-only and needs `x-idealize-auth: 1` for everything but `ping`.

State lives in `<DSH_HOME>/idealize/comm.json`. The Studio commands write and read `@idealize/studio`'s per-project timeline through `ctx.idealizeStudio` (composed by the same bundle); a report records a structured event and invokes nobody. A note the person types in the Studio chat arrives through `send` as the sender `user`: its inbox line carries the label `Studio` plus a line saying to answer with `idealize post`, and the wake notice says the same, since the person reads the reply in the Studio. The finished-turn safety net closes the gap when an agent forgets the prompt's posting rule: on every session's `turn/end`, a turn that called `generate_image`, `generate_video` or `generate_audio` and stored artefacts (`artefact/created`), with no `message` authored by that session on its project's timeline since the turn started, earns one `idealize`-authored `message` ("Watto generated 2 images (id, id)") linked to the chat through `source.thread`; a turn with no generation, a generation that stored nothing, a chat outside a project, and the Studio chat record nothing, and the system author keeps the coordinator asleep. The same net covers a `run_in_background` generation, whose artefacts land after the turn has ended: an `artefact/created` event a generation tool stored, whose own turn (`sourceTask.turnSeq`) has already ended, joins that session's pending batch, every further artefact restarts the batching window (`backgroundPostDelayMs`, 2000 by default), and the closed batch earns one line ("Watto finished generating 2 videos (id, id) in the background"); disposing the session or the plugin drops a pending batch unposted. The defined wake triggers are the exception: an unowned blocker, a `done`, a `decision`, a `delivery`, or an accepted handoff puts one `[studio]` line in the project coordinator's mailbox, and — when that coordinator is live, idle, and had an empty mailbox — injects one wake notice so it reads the inbox and the board; everything during a busy spell piles up quietly. The event's own author is never woken. Shell-facing effects arrive as the Cordis events `idealize/comm-mail`, `idealize/comm-notify`, `idealize/comm-focus`, `idealize/comm-reveal` and as `mail`/`notify`/`focus`/`reveal` events on the host bridge feed.

Decision record: [.agents/notes/implemented/architecture/2026-08-20-idealize-command-surface.md](../../../.agents/notes/implemented/architecture/2026-08-20-idealize-command-surface.md).

## Model Experience

### The `idealize` command section

#### What the model sees

One prompt section (`COMMANDS_SECTION`, name `idealize:commands`, order 120 in the tool-guidance band) registered through `dsh-system-prompt` on every composition that mounts this package, so every chat's agent carries it on every request. It says which chats exist, how the `idealize` command reaches them, that "@Name" from the person means asking that chat's agent with `idealize send` and `idealize inbox --wait` rather than searching for its work, that finished work earns one `idealize post` line, and that a note from the Studio is answered in the Studio. The text is fixed:

##### The command section

```markdown
IDEalize runs several chats on this project, each with its own agent. The `idealize` command in your shell reaches them: `idealize list` names every chat and its agent; `idealize send <agent> <text>` puts a note in that agent's inbox and wakes it if it is idle; `idealize inbox --wait --timeout 120` waits for notes sent to you; `idealize post <text>` posts to the project's Studio timeline, which everyone reads and nobody is woken by; `idealize chat` reads the recent Studio posts; `idealize reveal <path>` points the person at a file; `idealize help` lists the rest. When the person writes @Name they mean that chat's agent: ask it with `idealize send Name "<question>"`, then `idealize inbox --wait`, and pass its answer on. If no answer comes, say so instead of searching for its work. When you finish a piece of work the person asked for (a generation, an edit, a task), post one line to the Studio with `idealize post` saying what you did and where it is. When a note reaches you from the Studio (its sender is the person, via the Studio), answer in the Studio with `idealize post`, not only in your own chat.
```

#### Token effect

Fixed: one paragraph on every request of every session.

#### KV Cache effect

Prefix-stable: the section is constant text in the system prompt.

### Session-start notice

#### What the model sees

One plugin-sourced user message (`source.kind: 'plugin'`, `plugin: 'idealize-comm'`, form `notice`) injected on `agent/session-start`. Its first paragraph is the line below with the chat's name filled in. A chat running a coordinator preset receives a second paragraph after a `---` separator: the body of that role's `skills/<role>/SKILL.md` with its frontmatter stripped, clipped at 24,000 characters with a trailing `… (clipped)` marker.

##### The naming line

```markdown
Your name in IDEalize is <name>. Other chats and the person address you by it; the `idealize` command (run `idealize help`) lists chats, sends messages, reads your inbox, and reports progress.
```

#### Token effect

Fixed: one short paragraph per session for an ordinary chat; a role chat additionally pays the guide body once, capped by the clip. Mailbox traffic (`idealize inbox`, `send`, `board`) reaches the model only as the output of shell commands the agent runs, so it costs what those tool results cost and nothing here.

#### KV Cache effect

Append-only: the notice enters the conversation after the system prompt on the first turn and stays in place; nothing rewrites it later. Renaming never happens after creation, and a role adopted through `agent-preset/selected` changes only future sessions' notices.

### Studio wake notice

#### What the model sees

One plugin-sourced user message (`source.kind: 'plugin'`, `plugin: 'idealize-comm'`, form `notice`) injected into the project coordinator's chat when a defined Studio trigger fires while the coordinator is live, idle, and its mailbox was empty. The text is fixed:

##### The wake notice

```markdown
Studio changed while you were idle. Run `idealize inbox` for what happened and `idealize studio` for the board.
```

#### Token effect

Conditional: one short paragraph per quiet-period wake; the triggering detail costs only what the `idealize inbox` and `idealize studio` tool results cost when the coordinator runs them.

#### KV Cache effect

Append-only: the notice enters the coordinator's conversation as a new user turn; nothing earlier is rewritten.

### Mail wake notice

#### What the model sees

One plugin-sourced user message (`source.kind: 'plugin'`, `plugin: 'idealize-comm'`, form `notice`, summary `Mail`) injected into a recipient's chat when `idealize send` delivers to it while it is live, idle, and its mailbox was empty; a running recipient reads the note on its own next `idealize inbox`, a cold chat when the person next opens it, and a note to oneself wakes nobody. The text is fixed:

##### The mail notice

```markdown
A note from another agent arrived while you were idle. Run `idealize inbox` to read it and `idealize send <agent> <text>` to answer.
```

#### Token effect

Conditional: one short paragraph per quiet-period delivery; the note itself costs what the `idealize inbox` tool result costs.

#### KV Cache effect

Append-only: the notice enters the recipient's conversation as a new user turn; nothing earlier is rewritten.

### Studio mail wake notice

#### What the model sees

The same plugin-sourced user message (form `notice`, summary `Studio mail`) in place of the mail notice when the delivered note's sender is `user`, which is how `@idealize/studio` delivers a note the person typed in the Studio chat. The inbox line the agent later reads carries the label `Studio` and a second line, `(sent from the Studio: answer there with `idealize post <text>`)`. The text is fixed:

##### The Studio mail notice

```markdown
A note from the person, sent from the Studio, arrived while you were idle. Run `idealize inbox` to read it, then answer in the Studio with `idealize post <text>`, not only here.
```

#### Token effect

Conditional: one short paragraph per quiet-period delivery from the Studio; the note costs what the `idealize inbox` tool result costs, one line more than an agent's note.

#### KV Cache effect

Append-only: the notice enters the recipient's conversation as a new user turn; nothing earlier is rewritten.

### Role personas

#### What the model sees

Each seeded coordinator preset (`projectAgentPreset`, `studioAgentPreset`) carries a `@deepseek-ai/dsh-persona` row whose text is the deployment prompt's persona section for a chat composed on it. `{{model}}` and `{{cwd}}` are the persona plugin's placeholders, filled at assembly.

##### Project Coordinator persona

```markdown
You are the Project Coordinator for the project in {{cwd}}, powered by the {{model}} model. Other chats each do a piece of the work in this folder; you coordinate them and keep the user informed in plain language.
```

##### Studio Coordinator persona

```markdown
You are the Studio Coordinator, powered by the {{model}} model. The user talks to you in the Studio, which watches every project at once. You hold the picture across all of them, work through each project's coordinator rather than doing the work yourself, and answer in the Studio in plain language.
```

#### Token effect

Fixed and small, on every request of a chat composed on a role preset; ordinary chats pay nothing. The user may edit the row text from the Brains pane, which changes the cost with it.

#### KV Cache effect

Prefix-stable: the persona is part of the system prompt and unchanged across a chat's turns. Editing the preset's persona row changes the prefix of every later request on chats composed on it.

## Known Limitations and Deferred Work

- **The role guide is injected whole, clipped at 24,000 characters.** A guide longer than the clip loses its tail silently; the guides are maintained to fit rather than paged.
- **Mail interrupts no running turn.** An idle live recipient is woken once per quiet period; a running recipient reads its mail only when it runs `idealize inbox` (or `--wait`), and a cold chat only when the person next opens it.
- **`idealize/agent-name` is logged with the `ignorable` marker and the name also lives in `comm.json`.** A log read by a build without this vocabulary keeps working, but the projection and the store can disagree if the store file is edited by hand; the store is authoritative for the roster.
