---
name: flow-run
description: Carry out the user's IDEalize Flow from .idealize/flow.json step by step, checkpointing progress after each step so a stopped run can be resumed exactly where it left off. Use when asked to run, execute, continue, or resume a flow.
---

The user has built a **Flow** — a job broken into plain-language steps — in the
IDEalize editor and sent it to you to **carry out**. It lives as JSON at
`.idealize/flow.json` in this project. Your job is to walk it from start to end,
doing what each step says, **and to checkpoint your progress into the file as you
go** so the run can be paused and picked up later.

## Ownership zones (load-bearing — do not violate)

The file has four top-level fields: `title`, `flow`, `review`, and `run`.

- `title` and `flow` belong to the **user**. **Never modify them.** Read only.
- `review` belongs to the review step. Read it for context; don't write it here.
- `run` belongs to **you**, and only during a run. This is the single field you
  write. Everything else in the file must stay byte-for-byte unchanged.

Read → act → write `run`. Nothing else.

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
- `text` is always plain language. A `tool` block has **no** schema — interpret
  the intent and carry it out with whatever real tools you have (shell, files,
  MCP, etc.).
- Layout is implied by block order + connections. There are no coordinates.

## Start vs. resume — decide this first

1. Read `.idealize/flow.json`.
2. Look at `run`:
   - **No `run`, or `status` is `done`/`failed`** → this is a **fresh run**.
     Start at the `start` block.
   - **`status` is `running`, `paused`, or `failed` and `nextBlock` is set** →
     this is a **resume**. Do **not** restart. Continue from `nextBlock`, treating
     every step already in `completed` as finished — never redo them. (For a
     `failed` run, `nextBlock` is the step to retry now the blocker may have
     cleared.) Tell the user in one line that you're picking up where you left off
     (e.g. "Resuming from step 3 — sending the email").
3. If the user passed a note alongside the command, treat it as an extra
   instruction for this run.
4. Glance at `review` for context. It is **optional** — a flow can be sent
   without a review. If a review says `needs-work`, proceed but flag anything
   that looks genuinely unsafe before acting. Never refuse purely because a
   review is missing.

## The run-state contract (`run`)

This is the only thing you write. Shape:

```jsonc
"run": {
  "status": "running",          // running | paused | done | failed
  "nextBlock": "b3",            // the block to do NEXT; null only when done
  "completed": [                // finished steps, in order, one outcome line each
    { "block": "b1", "result": "Noted the trigger: a deal marked closed-won." },
    { "block": "b2", "result": "Deal was £12,000 — over the threshold, took 'yes'." }
  ],
  "branches": { "b2": "yes" },  // decision id -> the branch label you chose
  "updatedAt": "2026-06-25T10:00:00Z"
}
```

Rules:
- `nextBlock` always names a real block `id` from `flow.blocks`, or is `null`
  when `status` is `done`.
- Append to `completed` as each block finishes — never rewrite earlier entries.
- Record each decision's chosen label in `branches` as you take it.
- Keep the JSON pretty-printed; do not reorder or touch `title`/`flow`/`review`.

## How to run it — checkpoint after every step

Walk the graph following connections. **After finishing each block, write the
file** with that block appended to `completed` and `nextBlock` set to the block
you're about to do (status `running`). This is what makes the run resumable: the
checkpoint *is* the pause point, so if the run is stopped at any moment, the file
already says exactly where to continue.

For each block type:

1. **start** — note the trigger/context. Checkpoint: add it to `completed`, set
   `nextBlock` to the next block.
2. **tool** — do what the text says with real tools. If a step is ambiguous,
   make the most reasonable interpretation and say what you did; only stop to ask
   if you genuinely cannot proceed safely. Checkpoint when done.
3. **decision** — work out the answer to the question, state which branch you're
   taking and why, record it in `branches`, set `nextBlock` to that branch's
   target. Checkpoint.
4. **end** — stop. Set `status` to `done` and `nextBlock` to `null`, append the
   end block to `completed`, and checkpoint a final time.

## Pausing

There is no special pause action — **every checkpoint is a safe place to stop.**
If the user asks you to pause, finish the block you're on, set `status` to
`paused` (keeping `nextBlock`), checkpoint, and stop. Resuming later continues
from `nextBlock` as above.

If you truly cannot continue (a step needs something you can't get, an action was
declined), set `status` to `failed`, leave `nextBlock` at the step you were on so
it can be retried after the blocker clears, checkpoint, and explain in the chat.

## Safety

- Follow the graph; don't loop forever. The editor's pre-flight blocks loops, so
  revisiting a completed block shouldn't happen — if it would, stop and report it.
- For anything destructive or outward-facing (deleting, sending, publishing,
  spending), confirm with the user before doing it, exactly as you would normally
  — even mid-flow.

## Reporting

Narrate as you go in plain, non-technical language — one short line per step as
you complete it (the user isn't a programmer). When you reach an `end` block,
give a brief summary of what the flow did and its outcome. Don't paste the JSON.
