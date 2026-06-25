---
name: flow-review
description: Review the user's sketched Flow and write structured feedback back into .idealize/flow.json
---

The user has sketched a **Flow** — a job broken into plain-language steps — in the
IDEalize Flow editor. It is saved as JSON at `.idealize/flow.json` in this
project. Your task is to review it and write your feedback back into that same
file. The editor watches the file and renders your review onto the canvas.

## Ownership zones (load-bearing — do not violate)

The file has three top-level fields: `title`, `flow`, and `review`.

- `title` and `flow` belong to the **user**. **Never modify them.** Not the
  blocks, not the connections, not the text, not the title. Read them only.
- `review` belongs to **you**. Write only this field.

If you touch `title` or `flow`, you corrupt the user's work. Read → think →
write `review`. Nothing else.

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
  }
}
```

- `type` is one of `start`, `decision`, `tool` (an action), `end`.
- `text` is always plain language. A `tool` block has **no** schema — the user
  writes what they want in words and you interpret intent. Do not ask them to
  pick a tool or fill in fields.
- Layout is implied by block order + connections. There are no coordinates.

## What to judge

The structure has already passed a deterministic pre-flight (no orphans, no
loops, decisions branch, etc.) — do **not** re-report structural errors. Your job
is the **meaning** the pre-flight can't see:

1. **Clarity** — could you actually carry out each step as written? Flag vague
   steps ("handle it", "do the thing") and suggest a concrete rewrite.
2. **Completeness** — does the flow accomplish what the `title` promises? Are
   there missing steps, unhandled cases, or a decision branch that leads nowhere
   sensible?
3. **Correctness** — do the decision branches and their labels match the
   question? Is anything contradictory or out of order?
4. **Right-sized** — call out steps that are doing too much and should be split,
   or redundant steps.

Be encouraging and concrete. One issue + one suggestion per note, one line each,
in plain language (the user is non-technical).

## What to write

Replace (or add) the `review` field with exactly this shape, then save the file
with the rest of the JSON byte-for-byte unchanged:

```jsonc
"review": {
  "verdict": "ready",            // "ready" if it could run as-is, else "needs-work"
  "summary": "One or two warm sentences on the flow as a whole.",
  "notes": [
    {
      "block": "b3",             // the id of the block this note is about
      "issue": "One line: what's unclear or missing here.",
      "suggestion": "One line: how to fix it."
    }
  ]
}
```

Rules:
- Pin every note to a real block `id` from `flow.blocks`. Never invent ids.
- `verdict` is `ready` only if the flow would do its job with no changes; any
  note worth acting on means `needs-work`.
- An empty `notes` array with `verdict: "ready"` is the ideal outcome — say so in
  the summary.
- Keep the JSON pretty-printed. Do not reorder or rewrite `title`/`flow`.

After writing, reply to the user in one short, plain sentence — e.g. "Looks ready
to run" or "I left two small suggestions on the canvas." Do not paste the JSON.
