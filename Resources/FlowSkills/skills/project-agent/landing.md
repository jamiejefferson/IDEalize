# Landing the work

Read this when a piece needs accepting, or when every piece is *checked* and the
project is ready to land. It is the procedure your guide points at — the rest of
the time it costs you nothing.

## Accepting a piece of work

Never accept a piece on the chat's word — run `idealize verify <id>` first and
let the check decide. On a fail, send the failing output back to the same chat
**once** — `idealize type <id> "The check failed. Fix these and tell me when to
re-run: <the tail>"` — then re-run the check when it says it's ready.

If it fails again after that one retry, stop looping: tell the user in plain
language what was tried and what still fails, with your recommendation. Don't
silently spawn replacements or retry forever. Either way, record the outcome
(`idealize rung "<piece>" checked`) — a piece can't pass the *checked* rung
without its check having actually run.

## The path to live

Track every piece against this ladder, in these terms with the user:

*being made → viewable in a preview → saved to history → checked (symptom
verified) → combined into the main version → live → confirmed live → closed
(loose ends listed)*

Never report a later rung when an earlier one hasn't happened — "done" for
anything user-facing means **confirmed live**, not "the build passed."

Combining pieces and going live are steps the user reviews: say plainly what
will change, give your recommendation, and wait for the go-ahead. Nothing you do
should feel like a one-way door — but driving a piece *up to* that gate needs no
permission; it's the crossing that does.

Two rungs you drive yourself, so neither stalls waiting on the user nor tempts
you into the project's files:

- **checked** — `idealize verify <id>`, above.
- **combined** — these two:
  - `idealize combine plan` — proposes a safe order to bring the separate copies
    together and flags anything to review first. It changes nothing, so run it
    as soon as two copies are in flight, not the moment before combining.
  - `idealize combine apply <id>` — brings one copy's work into the main
    version. It saves the chat's copy to a checkpoint first, refuses if the main
    version has unsaved changes, stops untouched and shows you the clashing
    files on a conflict, and reports the point the main version was at
    beforehand so it can be put back. A conflict goes back to the chat that owns
    the piece — never to your own editing.

    **It does not judge whether the piece is finished.** Whatever is in that
    copy gets combined, half-done work included — so *you* are the readiness
    gate. Read the chat's recent transcript, and get the symptom verified (rule
    4), before you combine anything.

## The landing sequence

**You start this yourself.** Nobody has to tell you the work is finished — you
can see it. When `idealize board` shows every piece at *checked* and no chat is
mid-task, say so and begin. A project that sits at "all the pieces work" is not
finished; it is finished when it is live, tidy, and closed.

Don't start early. Not while a chat is still working, not while a piece is
*saved* but unchecked, and not while an open thread is owned by a chat — chase
those first. Half a landing is worse than none.

1. **Check it's really done.** For each piece: `idealize verify <id>`, plus the
   chat's recent transcript to see it actually finished rather than stopped, and
   rule 4 for anything visual — the rendered thing, foregrounded, at the
   reported size. Anything that fails goes back to its chat per **Accepting a
   piece of work** before you go further.

2. **Combine on your own authority; ask once for going live.** Combining
   finished, *checked* work into the main version is your call — that's the
   jurisdiction you and the lead agent share: *you may approve a plan and
   combine finished, checked work into the project. Nothing crosses to the
   public without the user's word.* Log every combine upward
   (`idealize rung "<piece>" combined`), so it lands on the lead's "Decided for
   you" list.

   Two exceptions send the gate back to a person: the project is in `ask-first`
   mode (the lead will have told you), or there is no lead and the user asked to
   review combines.

   The one ask is **going live**: one message — what's about to go live, piece
   by piece in plain words; anything you'd flag; your recommendation; the
   go-ahead you need. Route it through the lead when one is running, directly to
   the user with `idealize notify` when not. One finished project costs the user
   one decision, not five.

   If the answer is no, or silence: park the landing, say plainly what's safe
   and where it's sitting, and don't ask again unprompted. Nothing is lost by
   waiting, and a nagged user stops reading you.

3. **Combine neatly.** `idealize combine plan` first, then `combine apply` in
   the order it gives. A conflict goes back to the chat that owns the piece,
   never to your own editing. Re-check the combined result before treating it as
   done — two pieces that each worked can still be wrong together.

4. **Put it live** — only with the go-ahead, only by the *route to live* on the
   board, and never from a copy that might be stale. If the route isn't written
   down yet, find it out before shipping, not after.

5. **Confirm it's actually live.** Look at the live thing itself, the way a
   visitor would. "The deploy reported success" is not confirmation, and this is
   the rung where "done" finally means done.

6. **Tidy up, without being asked.** This is part of landing, not a favour:
   - **The board** — close what's closed; keep decisions, traps and the route to
     live. Move history to `.idealize/project-board-archive.md` and keep the
     board under 150 lines.
   - **The user's notes** in their Obsidian vault under
     `Projects/<this project>/` — bring status, open threads and next actions up
     to date, following that vault's own conventions (read its `VAULT-INDEX.md`
     first).
   - **Ways of working** — see `closing.md`.
   - **The project's own documentation** — a README, a docs folder, comments in
     the work itself: those are *the project's files*, so you don't touch them.
     Spawn a chat for it (`--name "Docs tidy-up"`) with a brief saying what
     changed, and land that piece like any other.

7. **Close it out.** One plain paragraph: what's live, what changed, what you
   tidied, and anything still open with who owns it. Then say what you'd suggest
   next — you've just watched the whole project, so you're the one who knows.
