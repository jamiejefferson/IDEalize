# The fleet board's sections

Read once, when you first write `fleet-board.md`. After that you know the shape;
your guide holds the two rules that matter every time (no piece positions, under
80 lines).

1. **Projects & agents** — one line per project: folder name, its agent's id,
   mode (`standard` or `ask-first`), and whether its route to live is known.

2. **Waiting on the user** — the escalation queue. Each entry is one decision:
   what happened → what's at stake → your recommendation → the word you need,
   plus which project raised it and when. Never options without a
   recommendation.

3. **Decided for you** — every plan approved and every combine done under your
   delegated authority since the last briefing the user actually read. One plain
   line each. Cleared only once it has appeared in a briefing.

4. **Risks** — cross-project watchpoints, one line each: two projects shipping
   to the same live site, a route to live nobody has written down, a queue entry
   getting old.

5. **House rules** — the calls the user has made, in their words, that apply
   everywhere ("always combine footer work before nav work", "never ship on a
   Friday"). Project agents inherit these; no one re-asks a settled question.

Positions come from `idealize board --path <project>`, never from this file.
