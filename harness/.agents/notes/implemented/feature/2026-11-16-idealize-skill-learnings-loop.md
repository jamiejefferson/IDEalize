# Agent Note: Skill learnings, appended by agents and folded by the person

Status: implemented

JJ approved the knowledge and playbooks scope on 16 Nov 2026, including decision D3: skill learnings live in `Reference/playbook-learnings/<skill>.md`.

## Problem

A skill is written once and then used by many chats. When a step in it turns out wrong, missing or out of date, the agent that found out works around it, finishes the task and the knowledge ends with the chat. The next chat meets the same step. Nothing carried what a run taught back to the skill, and the person who owns the skill never heard that it had drifted.

Letting agents edit skills directly is the obvious fix and the wrong one. A model that rewrites a whole context each round erodes its detail: the ACE paper (ICLR 2026) measured that collapse and found small itemised additions lifted results by 10.6% on agent tasks. A skill package is also the person's file, shared between brains and often between people.

## Decision

**An agent appends one line; nothing else.** [`@idealize/skills`](../../../../packages/idealize/skills/README.md) registers the `skill_learning` tool. A call appends `- YYYY-MM-DD (<brain>/<model>): <text>` to `Reference/playbook-learnings/<skill>.md` in the documentation folder, creating the file with `type: log` frontmatter when it is missing. `appendLearning` creates with the exclusive `wx` flag and writes with `appendFile`, so no code path opens an existing line for writing.

**The skill name is the path guard.** The tool accepts a `skill` only when `isSkillName` passes (lowercase letters, digits, single hyphens), which leaves no separator or dot to leave the folder with, and only when the calling chat's registry view holds that skill, which keeps invented names from creating files.

**No documentation folder, no write.** The tool answers with one sentence saying so and tells the model to tell the user what it learned.

**A standing prompt line says when.** The `idealize:skill-learnings` section (order 123, constant text) tells every agent to record a learning when a loaded skill's step proved wrong, missing or out of date, and never to edit the skill's own files. The section and the tool register together.

**Folding is a skill the package ships.** `fold-learnings` lives in the package's `skills/` directory and is mounted through `skill-filesystem`'s `bundledSkillDir` as `idealize-built-in-skills`, the way [`@idealize/comm`](../../../../packages/idealize/comm/README.md) ships its role guides as `skills/<name>/SKILL.md` beside its code. Its instructions have the model write one file, `<skill>.proposed.md` beside the learnings file, holding the changes, the learnings left out and the complete revised `SKILL.md`. The person reviews it and repacks.

**The line is attributed from the session log.** The brain is the one the log records, else the preset the chat runs on; the model is the one in the latest `request/header`.

## Alternatives considered

- **Let the tool take a path or a file name.** One validated name is the whole write surface, and a path argument would need containment checks this design does not have to get right.
- **Record learnings as session events or in a storage domain.** The person could not read or edit them, the weekly review could not list them, and they would not travel with the documentation folder.
- **Have the fold skill write the revised package.** The package is the person's, and a proposal beside the log keeps the append-only log, the proposal and the live skill as three separate files with one writer each.
- **Enforce the fold skill's one-file rule in code.** A skill is instructions to a model that writes through the ordinary file tools; a guard would have to recognise that the model is "inside" a skill, which the harness does not track. The rule is stated in the skill and pinned in tests as text.
- **Register `fold-learnings` as a runtime skill from a string.** A file under `skills/` is the format every other skill uses, can be read and edited as one, and reaches the registry through the provider that already parses `SKILL.md`.

## Consequences

- Every chat's request carries one more tool schema (758 characters) and one more prompt line (330 characters), both constant.
- Every chat with the `skill` tool lists `fold-learnings`, whatever its brain's skill list says.
- A learning's quality is the model's: the tool bounds its length and its target, and the person's review of the proposal is the check on its content.
- A deployment with no preset roster attributes learnings to `unknown`.

## Verification

- `packages/idealize/skills/tests/learnings.spec.ts`: two learnings make two lines and the first is byte-identical afterwards; names that would leave the folder, unknown skills, empty and over-long text are refused and write nothing; no folder writes nothing; the schema and the prompt line are pinned verbatim; `fold-learnings` is offered and names the proposal file as its only write.
- `packages/idealize/skills/tests/skill-learning.snapshot.ts`: the assembled application, through the real Loader with a replayed model, sends the line, the schema and the catalogue entry, and the call leaves exactly one file with one learning line ([expected output](../../../../packages/idealize/skills/tests/skill-learning-snapshots/record/model-inputs.expected.md)).
