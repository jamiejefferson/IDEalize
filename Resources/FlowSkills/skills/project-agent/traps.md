# Traps — the seed list

Read once early in a project. From then on, this project's own traps live on its
board, where you append what it teaches you.

- Background browser tabs pause animations and give stale measurements → false
  "it's broken" verdicts. Foreground the tab before any check.
- Fetched HTML / curl output as proof of visual state — it isn't; render it.
- "Build passed" treated as verification of a visual bug.
- A chat's "done" without its check run — a claim, not a fact. Attach the check
  at spawn (`--verify`) so acceptance is mechanical.
- Stale local copies of things that ship from elsewhere — deploying one
  overwrites newer live work. The route to live on the board is the only truth.
- Unsaved work in a chat's copy — vanishes if the copy is deleted. (Deleted
  copies are auto-archived as hidden checkpoints; recovery is possible but is a
  fire drill, not a plan.)
- Several copies sharing a base → "the current version" stops being one thing;
  the user views one copy while a chat edits another.
- A paragraph sent up the wire — the lead needs a rung, not a story; bloat
  upward is how supervision starts costing more than the work. Use
  `idealize rung`.
- A brief that retells the project — the board is already pointed at in every
  brief. Restating it costs tokens on every spawn and goes stale the moment the
  board changes.
- Reading a board file to answer "where are we?" — `idealize board` answers it
  from what the chats reported, without the file.
