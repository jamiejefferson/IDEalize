# @idealize/ui-terminal

The embedded terminal, both halves: the Terminal space's view inside the conversation column, the tool rail's Terminal pane over one plain shell, the loopback routes that drive their xterm.js grids, and the `terminalMode` service other plugins open or restart a chat's shell through. Mounted by the `idealize` profile as the `idealize-ui-terminal` row. The shell itself belongs to the desktop shell's `desktopTerminals` service (`dsh-plugin-desktop`); this package probes for it and registers nothing when it is absent, so a plain browser never sees a Terminal view.

## Configuration

| Field | Default | Meaning |
|---|---|---|
| `launchCommand` | `claude --dangerously-skip-permissions` | The command typed into a fresh shell once its prompt has finished drawing; empty disables the auto-launch. |
| `launchByActivity` | `{}` | Per-brain launch command keyed by the agent preset id the open request names; an absent id falls back to `launchCommand`. |
| `appendKnowledge` | `true` | Whether a Claude Code, Pi or Codex launch is typed with IDEalize's standing rules passed on its command line; `false` types the command as written. |
| `clis` | Claude Code, Codex CLI, Gemini CLI, Kimi CLI, Pi, Herdr, OpenCode, Aider, Plain shell | The command-line agents probed as launch choices; `''` is a plain shell. The Brains pane offers the installed ones. |

`launchCommandFor` (`src/launches.ts`) is the one pure read over both, shared by the host's open route and the `GET /idealize/terminal/launches` payload, so a surface deciding whether a brain switch restarts the shell compares the commands the shell will actually run. The config is also a settings section (`idealize-ui-terminal`), so the Brains pane's launch choices persist in the settings document over the composition values.

## Routes (loopback only; mutations need `x-idealize-auth: 1`)

- `GET /idealize/terminal/capabilities` returns `{embedded}`: whether `desktopTerminals` is composed here.
- `GET /idealize/terminal/launches` returns `{default, byActivity, catalog}`: the configured launch commands plus the CLI catalogue, each entry probed for its executable through the login zsh (`installed`; null where the probe cannot run, true for a plain shell; cached a minute).
- `POST /idealize/terminal/launch` `{activity?, command}` persists a launch choice: the named brain's override, or the default without `activity`. The command must be one line of at most 200 characters; running shells keep their command until restarted.
- `POST /idealize/terminal/open` `{key, cwd, cols, rows, activity, plain?}` returns `{id, launch?}`. One shell per key (the chat's session id); reopening reattaches. The directory is fenced to home plus the workspace roots with symlinks resolved. A fresh shell gets the named activity's launch command typed once it has been quiet for 300 ms, or at a 2 s deadline for a shell that reports nothing or never falls quiet; a reattach whose replay buffer already holds output never does. `plain: true` opens a bare shell (the rail's Terminal pane, key `idealize-terminal-pane`): no launch command, and no chat recorded for the activity watcher, so its output never counts as an agent's run. Grids past 500 by 300 are refused.
- `GET /idealize/terminal/stream?id=` is SSE: one `replay` event with the recent output, then live `data` events and one `exit`.
- `POST /idealize/terminal/input` `{id, data}`, `POST /idealize/terminal/resize` `{id, cols, rows}`, `POST /idealize/terminal/close` `{id}`.

## Browser half

After one capability probe, and only when it answers `embedded: true`, the plugin registers the `terminal` entry of the conversation view ring (order 5) and an invisible occupant of `conversation.session.header.actions` (`ModeShortcut`, order 100) that binds ⌘J (Ctrl+J elsewhere) to flipping the chat between the Chat and Terminal views. The view owns its whole column and carries its own input, so on a still-blank chat it retires the composer seat from its own stylesheet by matching the active view id `ui-conversation` publishes on `data-blank-view`. The grid follows `@idealize/appearance`'s Terminal section through `ctx.appearance.terminalPaint()` while that service is composed, and sits on the page's alias tokens otherwise.

`ctx.terminalMode` is provided in every composition, probed or not: `embedded()` returns the memoised probe answer, `open(sessionId)` flips the chat's ring onto the Terminal view through the same per-session chat store the rendered ring reads, `restart(sessionId, brainId)` closes the running shell and reopens it on that brain's launch command, and `Pane` is the same grid over one plain shell for the tool rail's Terminal pane (`@idealize/ui-bar` seats it; JJ, 15 Sep 2026: "a plain terminal - no cli etc. just for running commands"). The pane's shell starts in the directory the pane is first opened in (the current chat's project, else home), is cached like every chat grid so closing the pane keeps the shell and its scrollback, and takes the appearance panel's Terminal paint like the main view. Restarting loses the scrollback and the running agent's context, so callers confirm with the user first; `@idealize/activity-pills`' brain switcher does, with the line "The terminal restarts. You may lose some context.". Archiving a Terminal chat is how it closes (JJ, 2 Sep 2026): the client watches `workspaces.list`'s archived ids and ends the archived chat's shell, so no process runs on behind a row that has left the sidebar. A Terminal chat never sends a prompt, so the sidebar (`@deepseek-ai/dsh-client-ui-workspace`) counts it as started from its launch — its recorded `terminal` space — and lists it with the row verbs like any chat.

## Standing rules for a terminal agent

A harness agent reads IDEalize's standing rules from its system prompt. The CLIs a Terminal chat runs read none of it, so a Claude Code chat was never told where documentation goes (JJ, 17 Sep 2026). On a fresh launch the open route asks each service in `KNOWLEDGE_SERVICES` (`docPolicy` today) for `terminalKnowledge(cwd)`, writes the answers to `<DSH_HOME>/idealize/terminal-knowledge/<terminal id>.md`, and types the launch with that file passed on the command line. The file is removed when the shell exits. A service joins by offering the method; this package probes and never imports it.

`PROMPT_CHANNELS` (`src/knowledge.ts`) lists the CLIs with an option for it, keyed by executable name:

| CLI | Typed as |
|---|---|
| `claude` | `<command> --append-system-prompt "$(cat '<file>')"` |
| `pi` | `<command> --append-system-prompt "$(cat '<file>')"` |
| `codex` | `codex -c developer_instructions="$(cat '<file>')" <rest of command>` (Codex reads options before its subcommand or prompt) |

Each was proved on 17 Sep 2026 against the real program (Claude Code, Pi 0.85.1, Codex 0.153.4): with the option the agent named the project's note and folder, and a control run without it answered that it had not been told. A command that already sets its own instructions (`--system-prompt`, `--append-system-prompt`, `developer_instructions`) is the user's and is typed as written. Another CLI, `appendKnowledge: false`, a deployment whose services have nothing to say, or a failed write all type the command as configured. The open route's `launch` and the launches route still report the configured command, because that is what a brain switch compares.

## Model Experience

None for the chat's own model: the embedded shell runs its own process and its output never enters the chat's session log or any model request; the chat's brain and model are chosen by `@idealize/activity-pills` and `@idealize/spaces`.

The Claude Code, Pi or Codex process the shell launches does receive text from this package: the knowledge file above, added to its system prompt (Codex: its developer instructions) once at launch. With `@idealize/doc-policy` composed and a folder set, that is the preamble line plus the documentation rule and the project's note path, about 960 characters plus three copies of the folder path.

#### KV Cache effect

Independent for the chat's request: opening, restarting or closing a shell changes nothing in it. For the launched process the added text is fixed for the life of the process, so its prefix stays stable.

## Known Limitations and Deferred Work

- **⌘J still flips a started desktop chat between Chat and Terminal.** The space is fixed for the life of a chat and the tab row is gone, so this shortcut is the one control left that moves a chat between two spaces; it stays because the packaged-window proof needs a way to start a Terminal chat and the shortcut lives in this package, whose proof cannot run headless.
- **A restart replaces the shell, never resumes the agent.** `restart` closes the PTY and reopens it on the new launch command; the previous agent's context is gone, which is why the confirm dialog exists.
- **The launch command is typed on a timer, not on a prompt protocol.** It goes in after the shell has been quiet for 300 ms, or at a 2 s deadline whichever comes first, so a shell that prints nothing until after 2 s, or one that never falls quiet, still receives the command while it is drawing. There is no prompt-detection protocol to do better.
- **Kimi, Gemini, OpenCode, Aider and Herdr receive no standing rules.** Kimi 0.41.0 offers only `--agent-file`, which replaces the whole agent profile; Herdr is a workspace manager with no agent of its own; the other three were not installed to prove an option against. A reattached shell keeps the rules it launched with, so a changed documentation folder reaches a terminal agent at its next fresh launch.
- **Desktop only.** Without the desktop shell's `desktopTerminals` service the routes answer 409 and the view is never registered; there is no browser-side fallback shell.
