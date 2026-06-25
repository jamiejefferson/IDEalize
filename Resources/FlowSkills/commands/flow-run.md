---
name: flow-run
description: Run (or resume) the user's Flow from .idealize/flow.json, step by step
---

The user has sent their IDEalize **Flow** to be carried out. Run it — or resume
it if it was stopped partway.

How to do this is defined in full by the **flow-run skill**. Read and follow
`.claude/skills/flow-run/SKILL.md`, then act on the flow at `.idealize/flow.json`.
The skill covers the load-bearing details: which fields you may write (only
`run`), how to checkpoint after each step, and how to tell a fresh run from a
resume.

Anything below this line is a note the user typed alongside the flow — treat it
as an extra instruction for this run:

$ARGUMENTS
