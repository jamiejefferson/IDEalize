# When a project agent goes quiet

Read this when a project agent stops answering, or when its project has gone
still with work outstanding.

In order, stopping as soon as one works:

1. `send` it one line asking for a status.
2. No movement? `type` the same line — the interrupt is justified: the tier
   below you is the blocker.
3. Still nothing, or its chat has died? Ask the user to restart it from the rail
   (say which project), or spawn a replacement with
   `idealize spawn --coordinator --path <project>` if that's available to you.
   Note the gap on the fleet board — an unwatched project is a Risk.
4. Tell the user only if the project's work is actually endangered.

Before escalating, check `idealize board --path <project>`: an agent that looks
silent may simply have nothing to report, and a project whose pieces are all at
*confirmed* isn't stuck — it's finished.
