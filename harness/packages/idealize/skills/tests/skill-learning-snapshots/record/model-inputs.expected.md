# What the model is sent, and what the call leaves on disk

## Standing prompt line

When a step in a skill you loaded proves wrong, missing or out of date, complete the task the correct way, then call the skill_learning tool once with the skill's name and one sentence that says what the step said and what was true instead. Record only what you observed in this chat. Never edit a skill's own files to correct it.

## Tool schema

```json
{
  "name": "skill_learning",
  "description": "Record one thing you learned about a skill while using it: a step that proved wrong, missing or out of date. The learning is appended as one dated line to that skill's learnings file in the user's documentation folder, where the user reviews it before the skill changes. This tool only adds a line; it never changes the skill or an earlier learning.",
  "parameters": {
    "type": "object",
    "properties": {
      "skill": {
        "type": "string",
        "description": "The exact name of the skill the learning is about, as the available skills list gives it."
      },
      "learning": {
        "type": "string",
        "description": "One sentence, at most 500 characters: what the skill's step said and what was true instead."
      }
    },
    "required": [
      "skill",
      "learning"
    ]
  }
}
```

## Session catalogue entry of the shipped skill

- `fold-learnings`: Draft a revised SKILL.md for one skill from the learnings agents recorded about it, and save the draft as <skill>.proposed.md beside the learnings file for the user to review. Use when the user asks to fold, apply or review a skill's learnings, or to improve a skill from what agents learned.

## Tool result

Recorded in Reference/playbook-learnings/fold-learnings.md:
- <date> (unknown/replay-model): Step 3 says the skill tool names a base directory; its result calls it the base directory for this skill.

## Reference/playbook-learnings/fold-learnings.md

---
type: log
created: <date>
description: What agents learned while using the fold-learnings skill, one dated line each. IDEalize appends to this file.
---
# Learnings: fold-learnings

- <date> (unknown/replay-model): Step 3 says the skill tool names a base directory; its result calls it the base directory for this skill.
