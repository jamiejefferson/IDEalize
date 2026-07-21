# IDEalize

An AI-focused, multi-terminal macOS app — a leaner, Claude-Code-native take on
Warp. IDEalize hosts many terminals in one window, lets the coding agents
running inside them talk to each other (even across different projects), and
gives those agents first-class ways to notify you and show you things.

No built-in AI, no cloud, no file search. It just makes `claude`, `pi`, and
friends dramatically nicer to live in.

> **Platform:** macOS 14+ on Apple Silicon. Built with SwiftUI + AppKit and
> [SwiftTerm](https://github.com/migueldeicaza/SwiftTerm).

---

## Download & install

**Always-latest release:
[github.com/jamiejefferson/IDEalize/releases/latest](https://github.com/jamiejefferson/IDEalize/releases/latest)**

### One-line install / update (recommended)

Open **Terminal** and paste:

```bash
curl -fsSL https://raw.githubusercontent.com/jamiejefferson/IDEalize/main/install.sh | bash
```

It downloads the latest release, replaces any existing copy in `/Applications`,
clears the macOS quarantine flag, and launches it. **Run the same command again
any time to update to the newest version** — it replaces the old app in place.

> The installer sends one anonymous ping recording the installed version, your
> macOS version, and a one-way hash of your machine's hardware id (not
> reversible, not personally identifying) — just so we can see which versions
> are in use. Nothing else is collected. It's the `report_install` function in
> [`install.sh`](install.sh) if you want to read or remove it.

### Manual install

1. Download the `.zip` from the
   [latest release](https://github.com/jamiejefferson/IDEalize/releases/latest),
   unzip it, and drag **IDEalize.app** into **Applications**.
2. IDEalize is a small indie app, self-signed (not notarized), so the first time
   you open it macOS says it "can't be verified." Clear that **once** with:
   ```bash
   xattr -dr com.apple.quarantine /Applications/IDEalize.app
   ```
   or via **System Settings → Privacy & Security → Open Anyway**.

---

## Features

### Warp-style core

| Feature | What you get |
|---|---|
| **Blocks** | Each command + its output is tracked as a block with **exit-status** (✓/✗), duration, and cwd — via shell integration. Browse them in the Blocks sidebar (⌘B). |
| **Command palette** (⌘P) | Fuzzy launcher for actions, themes, workflows, recent commands, and open terminals. |
| **Workflows** | Saved, parameterized commands (`{{param}}` prompts). Run from the palette; manage in Preferences. |
| **Command composer** (⌘L) | A bottom input bar — type a command, ↩ to run, ↑/↓ to recall history. |
| **History** | Every command is recorded per session; searchable in the palette, re-runnable from the sidebar. |
| **Splits & tabs** | Recursive split panes (⌘D / ⇧⌘D) and tabs, each with live status. |

### IDEalize additions (on top of Warp)

| Feature | What you get |
|---|---|
| **Cross-terminal / cross-project IPC** | Agents message each other via `idealize send`/`broadcast`/`inbox` — across tabs, panes, and projects. |
| **Cross-terminal exec** | `idealize exec <session> <cmd>` runs a command in *another* terminal — agent orchestration. |
| **Block inspection over IPC** | `idealize blocks` lets an agent read what ran and the exit codes. |
| **Real text entry + mouse** | Full SwiftTerm input: selection, copy/paste, mouse reporting for TUIs. |
| **Typography & theming** | Any monospaced font + size + color scheme in Preferences. |
| **Tabs show process status** | Live status dot + foreground process (`claude`, `node`, `vim`). |
| **Notifications from Claude Code** | `idealize notify "…"` → native macOS notification. |
| **Default launch command** | Auto-run e.g. `claude --dangerously-skip-permissions` in every new terminal. |
| **Inline visuals** | `idealize image foo.png` renders images inline (Kitty graphics, native). |

---

## Build & run

```bash
# Build the app bundle (release) into ./dist/IDEalize.app
./scripts/build-app.sh

# Build and launch immediately
./scripts/build-app.sh --open

# Debug build
./scripts/build-app.sh --debug
```

Then move `dist/IDEalize.app` to `/Applications` (optional) and launch it.

For development you can also run straight from SwiftPM:

```bash
swift run IDEalize        # GUI app
swift build               # everything
swift test                # core unit tests
```

### The `idealize` CLI

Every terminal IDEalize spawns gets an `idealize` command on its `PATH`
automatically (a shim is installed at
`~/Library/Application Support/IDEalize/bin/idealize`). To use it from *outside*
IDEalize too:

```bash
ln -sf "/Applications/IDEalize.app/Contents/Helpers/idealize-cli" /usr/local/bin/idealize
```

---

## `idealize` command reference

```
idealize notify <text> [--title T] [--sound]   show a system notification
idealize send <session> <text>                 message another terminal's inbox
idealize broadcast <text>                       message every other terminal
idealize inbox [--wait] [--timeout S] [--json] read & clear my messages
idealize peek  [--json]                          read my messages without clearing
idealize list  [--json]                          list active terminals
idealize blocks [session] [--json]               list recorded command blocks + exit codes
idealize exec <session> <command>                run a command in another terminal
idealize type <session> <text>                   type text into another terminal
idealize image <path> [--width W] [--height H]  render an image inline
idealize status <text>                           set this tab's status label
idealize focus <session>                         bring a terminal to the front
idealize whoami                                  print my session id
idealize ping                                    check the app is reachable
```

A "session" can be referenced by its id (`t-a6a6`), its tab/label, or its
project-directory name.

### Inter-agent messaging example

Two Claude Code instances in different projects:

```bash
# In project A's terminal (session t-a6a6):
idealize list
#   * t-a6a6  api        [claude]
#     t-1f3d  frontend   [claude]

idealize send frontend "the /users endpoint now returns `created_at`"

# In project B's terminal (frontend), the agent checks its inbox:
idealize inbox
#   [11:26:27] api: the /users endpoint now returns created_at
```

`idealize inbox --wait` blocks until a message arrives — handy for an agent that
should pause for input from a peer.

---

## Claude Code integration

IDEalize is designed to be driven by Claude Code hooks. See
[`docs/claude-code-integration.md`](docs/claude-code-integration.md) for ready-to-paste
hook configs that:

- 🔔 notify you when Claude finishes or needs input,
- 🤝 let two agents hand off work to each other,
- 🖼️ show generated charts/screenshots inline.

The short version — add to `~/.claude/settings.json`:

```jsonc
{
  "hooks": {
    "Stop": [
      { "hooks": [ { "type": "command",
        "command": "idealize notify \"Claude finished\" --title \"$(basename \"$PWD\")\" --sound" } ] }
    ],
    "Notification": [
      { "hooks": [ { "type": "command",
        "command": "idealize notify \"$CLAUDE_NOTIFICATION\" --title \"Claude needs you\" --sound" } ] }
    ]
  }
}
```

---

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| ⌘P | Command palette |
| ⌘B | Toggle Blocks sidebar |
| ⌘L | Toggle command composer |
| ⌘T | New terminal tab |
| ⌘O | New terminal in a chosen project folder |
| ⌘D | Split right |
| ⇧⌘D | Split down |
| ⌘W | Close focused pane |
| ⇧⌘] / ⇧⌘[ | Next / previous tab |
| ⇧⌘C | Copy last command |
| ⌃R | Re-run last command |
| ⌘, | Preferences |

---

## Architecture

```
Sources/
  IDEalizeCore/     Shared IPC protocol, Unix-socket helpers, image encoders
                    (used by both the app and the CLI)
  idealizeCLI/      The `idealize` command (talks to the app over a socket)
  IDEalizeApp/      The SwiftUI/AppKit app
    Model/          Workspace (tabs + split tree), TerminalSession, settings,
                    theme, process inspector, CLI shim installer
    IPC/            IPCHub (socket server), NotificationManager
    UI/             Tab bar, split panes, terminal host, settings
scripts/build-app.sh   Builds & packages dist/IDEalize.app
```

**Blocks / shell integration.** SwiftTerm has no semantic-prompt support, so
`IDEalizeTerminalView` subclasses `LocalProcessTerminalView` and taps the PTY
byte stream in `dataReceived`. A generated shell-integration script (zsh via a
redirected `ZDOTDIR`, bash via `--rcfile`) emits a custom `OSC 1771` marker at
each command's start/end carrying the command text and exit code; the parser
turns those into `CommandBlock`s. The bytes still flow to SwiftTerm unchanged
(it ignores the unknown OSC), so rendering is unaffected.

**IPC transport.** The app listens on a Unix domain socket at
`~/Library/Application Support/IDEalize/ipc.sock`. Each spawned shell gets
`IDEALIZE_SESSION_ID` (its identity), `IDEALIZE_SOCK`, and `IDEALIZE_TOKEN` in
its environment. The `idealize` CLI connects, sends one JSON request, and
reads one JSON response. Mutating commands (send/exec/inbox/…) require a valid
`IDEALIZE_TOKEN` — a per-app-instance secret also stored at
`~/Library/Application Support/IDEalize/ipc.token` (mode 0600) so a CLI
symlinked outside the app keeps working. `ping` and `list` stay open.

**Why a CLI shim.** macOS filesystems are case-insensitive, so the app binary
`IDEalize` and a CLI named `idealize` cannot coexist in one directory. The CLI
ships as `Contents/Helpers/idealize-cli` and is exposed under the name
`idealize` via a symlink the app maintains on each terminal's `PATH`.

## License

Personal project. SwiftTerm is MIT-licensed.
