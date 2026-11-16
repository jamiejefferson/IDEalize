---
name: fold-learnings
description: Draft a revised SKILL.md for one skill from the learnings agents recorded about it, and save the draft as <skill>.proposed.md beside the learnings file for the user to review. Use when the user asks to fold, apply or review a skill's learnings, or to improve a skill from what agents learned.
---

# Fold a skill's learnings into a proposed revision

Agents record what they learn about a skill with the `skill_learning` tool. Each learning is one dated line in `Reference/playbook-learnings/<skill>.md` inside the user's documentation folder. This skill turns those lines into a proposed revision of the skill. The user reviews the proposal and decides whether it replaces the skill.

## The one file you write

You write exactly one file: `Reference/playbook-learnings/<skill>.proposed.md` inside the user's documentation folder, beside the learnings file. When that file already exists, replace it.

You write nothing else:

- Never edit, move or delete the learnings file `<skill>.md`. It is an append-only log.
- Never edit the skill's own files: its `SKILL.md`, its references, its `.skill` package, or anything in the skills folder or the folder the skill was loaded from.
- Never call the `skill_learning` tool while following this skill.
- Never create any other file, in the documentation folder or anywhere else.

## Steps

1. **Settle which skill.** Use the skill the user named. When the user named none, list the `.md` files in `Reference/playbook-learnings/` whose names do not end in `.proposed.md`, and ask the user which one to fold.
2. **Read the learnings.** Read `Reference/playbook-learnings/<skill>.md`. Each learning is a line of the form `- YYYY-MM-DD (<brain>/<model>): <text>`. When the file is missing or holds no such line, tell the user there is nothing to fold and stop without writing a file.
3. **Read the skill as it stands.** Call the `skill` tool with the skill's name. Its result names the skill's base directory; read `SKILL.md` in that directory so you have the frontmatter as well as the instructions. When the skill is not available in this chat, tell the user and stop without writing a file.
4. **Decide what each learning changes.** Apply a learning when it corrects a step, adds a missing step, or removes a step that is out of date. When two learnings disagree, follow the later one and say so in the proposal. Leave out a learning that describes one task's circumstances and says nothing about the skill; list it as left out with the reason. Make the smallest edit each learning needs. Keep every other line of the skill word for word, and keep the frontmatter `name` unchanged.
5. **Write the proposal** to `Reference/playbook-learnings/<skill>.proposed.md` in the format below.
6. **Tell the user** where the proposal is, how many learnings you applied and how many you left out. Tell them that nothing has changed in the skill, and that to accept the proposal they replace the skill's `SKILL.md` with the proposed text and repack it.

## Format of the proposal

Use four backticks around the proposed file, because a skill often holds three-backtick code blocks of its own.

`````markdown
---
type: proposal
created: <today, YYYY-MM-DD>
description: Proposed revision of the <skill> skill from its recorded learnings. Nothing in the skill has changed.
---
# Proposed revision: <skill>

Folds <N> learnings recorded up to <date of the newest learning line>, from Reference/playbook-learnings/<skill>.md.

## Changes

- <what changed in the skill, in one sentence>. From: "<the learning line it came from>"

## Left out

- "<the learning line>". Reason: <why it does not change the skill>

## Proposed SKILL.md

````markdown
<the complete revised SKILL.md, frontmatter included>
````
`````

Write `None.` under a heading that has no entries.
