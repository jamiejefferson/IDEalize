# @idealize/ui-tasks

The agent's current task list as a full-height column beside the tool rail.

JJ, 24 Aug 2026: a chat working through several tasks should show its whole list next to the work. The composer used to carry a one-line plan strip (`@deepseek-ai/dsh-client-ui-conversation`'s `TodoPanel`), which folded the list away behind a summary; this column keeps the list open and, since 8 Sep 2026, is the one place it shows: the package registers an empty occupant on the strip's dock cell (`conversation.input.dock`, id `todo`, priority -1), so the composer shows no second copy.

## What it shows

One row per task, in the order the agent wrote them, each carrying its own status: a dashed ring for work not started, a spinning ring in the accent colour for the task being worked on, and a ticked ring with the line struck through for finished work. The header counts the finished ones against the whole list ("Tasks 1/3") and folds the list away, keeping the count visible.

## Where the list comes from

`useProjection('todos')` — the session projection `@deepseek-ai/dsh-tool-todo` computes from `todo_write`. Nothing here is fetched or stored: the tool writes the whole list on every call and the projection clears it on the next `turn/start`, so the column follows the agent's plan for the turn it is in and empties when a new turn begins.

An empty list, or no current chat, renders nothing at all. That is what keeps the column out of the layout — the frame's `shell.aside` track is sized by whatever occupies it, so a chat with no task list shows no column and loses no width.

## The seat

The frame's `shell.aside` slot: a fixed-content column immediately left of the tool rail, added to `@deepseek-ai/dsh-client-ui-layout` for this view. Like the rail it never joins the column concession solve, so opening the task column never squeezes the deck or the drawer below their floors — it takes its width from the frame's own edge.

The seat is `session-maybe` scoped, so the column stays mounted across a chat switch and keeps its own fold state.

## Configuration (`idealize-ui-tasks` row)

None. The column has one width and one behaviour; the list is the agent's.

## Runtime invariant

None. The host face registers nothing, and the client half's single slot registration is an effect the registration spec covers by disposing its fiber and watching the seat empty. The list belongs to `@deepseek-ai/dsh-tool-todo`, whose companion proves it.

## Model Experience

None, as the column renders a projection the model already wrote: it registers no tool, contributes no prompt text, writes no session event, and nothing a person does in it reaches a model request.

#### KV Cache effect

None: no prompt content, tool schema, or system-prompt section originates here.

## Known Limitations and Deferred Work

- **The composer's plan strip is shadowed, not removed.** `@deepseek-ai/dsh-client-ui-conversation`'s `TodoPanel` still registers; an install without this package shows it again, and a second shadow at priority -1 would throw at registration.
- **Nothing in the column is editable.** A person cannot tick, reorder or add a task: `todo_write` replaces the whole list and the agent is its only author, so an edit here would be overwritten by the next call with no way to tell the model what changed.
- **The list disappears at the start of the next turn.** That is the projection's own lifetime (the standing plan clears on `turn/start`), so a finished checklist is visible only until the person sends the next message. A history of past turns' lists would need a second projection nobody has asked for.
