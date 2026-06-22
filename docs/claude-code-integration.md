# Driving IDEalize from Claude Code

IDEalize gives Claude Code (and any CLI agent) three superpowers through the
`idealize` command, which is always on `PATH` inside an IDEalize terminal:

1. **Notifications** — tell the human something happened.
2. **Messaging** — hand work to (or ask) another agent, in another project.
3. **Inline visuals** — show an image right in the scrollback.

This guide gives copy-paste hook configurations. Hooks live in
`~/.claude/settings.json` (global) or `.claude/settings.json` (per project).

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

## 4. Show an image inline

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

## 5. Auto-launch Claude in every new terminal

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

Guard hooks so they no-op outside IDEalize:

```bash
[ -n "$IDEALIZE" ] && idealize notify "Done"
```
