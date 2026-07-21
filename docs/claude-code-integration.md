# Driving IDEalize from Your Agent

IDEalize gives any agent CLI three superpowers through the `idealize` command,
which is always on `PATH` inside an IDEalize terminal:

1. **Notifications** — tell the human something happened.
2. **Messaging** — hand work to (or ask) another agent, in another project.
3. **Inline visuals** — show an image right in the scrollback.

This guide gives copy-paste configurations for Claude Code. For other agents,
see the first-run agent setup in the app — IDEalize will capture the agent's
integration details (transcript location, prompt style, working signals) and
adapt the chat UI accordingly.

---

## 1. Notify when Claude finishes or needs input

```jsonc
{
  "hooks": {
    // Fires when Claude finishes responding.
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "idealize notify \"Done\" --title \"$(basename \"$PWD\")\" --sound"
          }
        ]
      }
    ],
    // Fires when Claude is waiting for permission / input.
    "Notification": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "idealize notify \"$CLAUDE_NOTIFICATION\" --title \"Claude needs you\" --sound"
          }
        ]
      }
    ]
  }
}
```

Because IDEalize sets `IDEALIZE_SESSION_ID`, notifications are automatically
tagged with which terminal they came from.

---

## 2. Set a live tab status

Make the tab reflect what the agent is doing. Combine with the `PreToolUse`
hook, or just call it inline from within a session:

```bash
idealize status "running test suite"
idealize status "waiting on review from frontend"
idealize status ""           # clear
```

The status shows in the tab strip and pane header, alongside the live
foreground-process indicator.

---

## 3. Two agents collaborating across projects

Open two terminals (e.g. one in `api/`, one in `web/`), each running Claude
Code. Give each project a `CLAUDE.md` note so the agent knows it can talk to
peers:

```md
## Talking to other terminals
You are running inside IDEalize. You can coordinate with agents in other
projects:
- `idealize list` — see the other terminals and their ids/labels.
- `idealize send <label> "<message>"` — send a peer a message.
- `idealize inbox` — read messages other agents sent you (run this when you
  start a task and whenever you're waiting).
- `idealize broadcast "<message>"` — tell everyone.
```

Example flow:

```bash
# api agent finishes a schema change:
idealize send web "User.created_at is now ISO-8601; regenerate the TS types"

# web agent, before starting work:
idealize inbox
#   [14:02:11] api: User.created_at is now ISO-8601; regenerate the TS types
```

For a blocking handoff, the waiting agent can use:

```bash
idealize inbox --wait     # blocks until a message arrives
```

---

## 4. The project agent (a coordinator for chats in one project)

IDEalize can open a **project agent** for a project: a chat whose job is to
watch the other chats working in the same folder, notice when their work might
collide, ask the user (in plain language) to make the call, and relay the
decision back so every chat pivots together. Start it from the toolbar's
speech-bubbles toggle, or the suggestion that appears when several chats share
a project. It runs Claude with the `project-agent` skill (installed into
`~/.claude` alongside the Flow skills).

What this means for an agent running in a coordinated project:

- **The project agent can read you.** It uses `idealize list`,
  `idealize transcript <id> --last N` (your recent Q&A), and
  `idealize blocks <id>` (the commands you ran) to understand what you're
  doing. `transcript` works from any chat, for any chat.
- **You can reach it** by the alias `coordinator`
  (`idealize send coordinator "…"`) or, in chats started after it, by
  `$IDEALIZE_PROJECT_AGENT`. Report decisions that affect other pieces of the
  project: `idealize send coordinator "I changed the menu to a top bar — the
  landing-page chat should know"`.
- **It can talk to you.** Messages typed by the project agent arrive as if the
  user typed them (`idealize type`), usually carrying a decision the user just
  made — treat them with the same weight as user input.

---

## 5. Show an image inline

Anything that produces an image — a chart, a screenshot, a diff render — can be
shown inline:

```bash
idealize image ./coverage-chart.png --width 60
idealize image /tmp/screenshot.png
```

`--width` / `--height` are in terminal cells. Any format macOS can read (PNG,
JPEG, GIF, HEIC, …) is converted to PNG and rendered via the Kitty graphics
protocol, which IDEalize renders natively.

A handy pattern in a hook or script:

```bash
# After generating a plot with matplotlib/gnuplot/etc:
idealize image "$PLOT_PATH" --width 80
```

---

## 6. Auto-launch Claude in every new terminal

In **IDEalize ▸ Settings ▸ Launch**, enable *"Run a command automatically in new
terminals"* and set it to:

```
claude --dangerously-skip-permissions
```

Now every new tab/split drops you straight into Claude Code.

---

## Environment variables available to hooks

| Variable | Meaning |
|---|---|
| `IDEALIZE` | `1` when running inside IDEalize |
| `IDEALIZE_SESSION_ID` | this terminal's id (e.g. `t-a6a6`) |
| `IDEALIZE_SOCK` | path to the app's IPC socket |
| `IDEALIZE_PROJECT_AGENT` | id of the project's coordinating chat, when one is running |

Guard hooks so they no-op outside IDEalize:

```bash
[ -n "$IDEALIZE" ] && idealize notify "Done"
```

---

## Security notes

- **Keep hook variables double-quoted.** Always expand hook variables like
  `"$CLAUDE_NOTIFICATION"` with the quotes on, exactly as shown above. Never
  use them unquoted, and never route them through `eval` — the quoted
  expansion is safe (the shell does not re-scan it), but unquoted expansion
  and `eval` would let notification text run as shell syntax.
- **`IDEALIZE_TOKEN` is the real capability.** Anything running in the
  terminal can read it (along with `IDEALIZE_SOCK` and `IDEALIZE_SESSION_ID`)
  and use it to drive the app — notifications, messages, cross-terminal exec,
  inline images. Mutating IPC commands are rejected without a valid token.
  That is the intended trust model: processes you run in your terminal are
  already trusted with far more.
- **`--dangerously-skip-permissions` is a deliberate opt-in.** The auto-launch
  example in section 5 includes it for convenience, and it turns Claude Code's
  permission checks OFF — Claude can then run any tool without asking. Drop it
  from the launch command if you'd rather approve actions yourself.
