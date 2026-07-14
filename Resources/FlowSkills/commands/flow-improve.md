---
name: flow-improve
description: Apply your own review suggestions to the user's IDEalize Flow, rewriting the flow steps in place
---

The user reviewed their **Flow** with you and now wants you to **apply your
suggestions** — actually improving the steps, not just commenting on them. The
flow is JSON at the global path `~/Library/Application Support/IDEalize/flow.json`
(expand `~` to your home directory; a single global file, not per-project). The
editor watches the file and re-renders the moment you save.

## What you may write (this skill is the exception)

Unlike `/flow-review` — where `title` and `flow` are read-only — here you **do**
edit them. The file has up to four fields: `title`, `flow`, `review`, `run`.

- `title` and `flow` — **rewrite these** to apply your improvements.
- `review` — after applying, refresh it: set `verdict` to `ready`, set `notes` to
  `[]`, and write a one-line `summary` of what you changed.
- `run` — **never touch it.** Leave it byte-for-byte as found (it is the
  execution checkpoint, and is often absent).

## How to improve

1. Read `flow` and your existing `review` notes.
2. Apply each note's suggestion to the steps: rewrite a vague `text`, add a
   missing step, split a step that does too much, fix a decision's branches or
   labels, reorder where it helps. Address every note worth acting on.
3. Keep the structure valid (the same rules the editor enforces):
   - `type` is one of `start`, `decision`, `tool` (an action), `end`.
   - Exactly one `start`, and every other block reachable from it. No loops.
   - A `decision` has 2+ outgoing `connections`, each with a `label`
     (e.g. `"yes"` / `"no"`); every other block has at most one outgoing.
   - `text` is always plain language. A `tool` block has **no** schema — write
     what to do in words.
4. **Preserve block ids** for steps that survive — reuse the same `id`, so
   nothing pinned to it is lost. A new step gets a fresh id `b<n>`, one higher
   than the highest existing number. Never reuse or renumber an existing id.
5. Keep `connections` consistent with the new block set — every `from` and `to`
   is a real block `id`.

## What a Flow is

```jsonc
{
  "title": "Email me about big deals",
  "flow": {
    "blocks": [
      { "id": "b1", "type": "start",    "text": "When a new deal is marked closed-won" },
      { "id": "b2", "type": "decision", "text": "Is the deal value over £10,000?" },
      { "id": "b3", "type": "tool",     "text": "Send an email to me" },
      { "id": "b4", "type": "end",      "text": "Stop, do nothing" }
    ],
    "connections": [
      { "from": "b1", "to": "b2" },
      { "from": "b2", "to": "b3", "label": "yes" },
      { "from": "b2", "to": "b4", "label": "no" }
    ]
  },
  "review": { "verdict": "ready", "summary": "Applied your suggestions.", "notes": [] }
}
```

Keep the JSON pretty-printed.

## After saving

Reply in one short, plain sentence naming what you changed — e.g. "Tightened the
two vague steps and added a confirmation at the end." Do not paste the JSON.
