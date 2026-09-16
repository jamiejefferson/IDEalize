# Agent Note: every agent's prompt names its peers and the project's folders, a note wakes an idle agent, and every session reaches Paper

Status: implemented

JJ, 8 Sep 2026, on the landing-12 build: "tagging the other agent isn't working - one agent created an image and the other can't find it. there are two issues here, first that the assets for a project are given a known location so should be easily findable. if i can tag another agent i expect the agent to be able to ask it"; "i think we may need to bake in the ability for any agent to use the paper mcp as the current one is struggling"; and, after an agent asked to post to the Studio ran a `buzz` CLI on their Mac, "i think we have some rogue Buzz code?!".

## Problem

Three agents failed the same way: nothing standing in their prompt told them how IDEalize works. The one fact about the `idealize` command arrived once, as the session-start notice, and compaction or a long transcript left it behind; a chat asked to "post to the studio" guessed at an unrelated `buzz` command it found on PATH, and a chat asked about "@Name" searched the other chat's transcripts for an image instead of asking. The image sat in the project's `Images/` folder the whole time, a location the settings fix but no prompt named. `idealize send` delivered to a mailbox nobody read until the person next spoke to the recipient, so even a correctly addressed question waited on the person. Paper's MCP server (`http://127.0.0.1:29979/mcp`) was reachable from one chat that had been told about it by hand; every other chat had no route to it and an agent improvised raw JSON-RPC.

## Decision

**Two standing prompt sections in the tool-guidance band.** `@idealize/comm` registers `COMMANDS_SECTION` (`idealize:commands`, order 120) through `dsh-system-prompt`: the chats on this project each have an agent, the `idealize` command reaches them (`list`, `send`, `inbox --wait --timeout 120`, `post`, `chat`, `reveal`, `help`), and "@Name" from the person means asking that chat's agent with `idealize send` then `idealize inbox --wait`, saying so if no answer comes rather than searching for its work. `@idealize/artefacts` registers `FOLDERS_SECTION` (`idealize:artefacts`, order 121) whose `{{idealize_artefact_folders}}` variable renders `describeFolders(settings)` at each assembly, so the folders in force are named (`images in Images/, sounds in Sounds/, video in Video/, anything else in Artefacts/ (archived files under each folder's Archive/)`), along with the file naming and `artefacts_get`. Both sections are registered from `ctx.inject(['systemPrompt'])`, so a composition without the registry mounts the packages unchanged.

**`idealize send` wakes an idle recipient once.** After `deliver`, a recipient that is live, idle, not the sender, and whose mailbox held nothing before this note receives one plugin-sourced user message (`MAIL_NOTICE`, form `notice`, summary `Mail`) through `live.followup`, the coordinator's wake rule applied to mail. Later notes pile up quietly until `idealize inbox` drains the box; a running recipient reads on its own next `inbox`; a cold chat waits for the person.

**Paper is a bundle row.** `cordis.patch.yml` inserts `idealize-mcp-paper` (`@deepseek-ai/dsh-mcp-client`, streamable HTTP, `serverName: paper`, `failOnStartupError: false`, reconnect 2 s to 60 s, effectively unbounded attempts) at the root, so every session's tool list carries `mcp__paper__*` while Paper runs and nothing while it is closed.

**The packaged app puts `idealize` on PATH.** The desktop's runtime-commands installer writes an `idealize` shim beside `pnpm` (`exec <node shim> <@idealize/comm/lib/cli.js> "$@"`, a `.cmd` on Windows), so the command the prompt names exists in every agent's shell; before this the packaged app shipped the CLI without a bin entry and only a source checkout could run it.

## Alternatives considered

**Say it all in the session-start notice.** That notice already carries the name and one sentence about the command; the failures happened in chats that had it and lost it to compaction or never read it. A prompt section is present on every request.

**A tool (`ask_agent`) instead of the CLI.** The CLI exists, is documented, and works from any shell the agent already has; a tool would duplicate `send`/`inbox` and add a schema to every request. The prompt teaches the CLI instead.

**Wake on every note.** A recipient mid-task would be interrupted by each line of a conversation; the coordinator's rule (once per quiet period, while the mailbox was empty) already exists and is applied unchanged.

**Paper per brain or per space.** Paper is a design tool JJ uses from any chat; a root row reaches every session, and `failOnStartupError: false` keeps a closed Paper from blocking a session.

## Consequences

Every request grows by two fixed paragraphs, prefix-stable while the folder settings hold; Paper's tool definitions join the prefix while Paper runs. `@idealize/comm` and `@idealize/artefacts` gain `@deepseek-ai/dsh-system-prompt`; `@idealize/bundle-idealize` gains `@deepseek-ai/dsh-mcp-client`. Tests: `comm/tests/prompt.spec.ts` (the section reaches the assembled prompt after the persona), `comm/tests/service.spec.ts` (`IdealizeComm.send` wakes an idle recipient once, never a running one or the sender), `artefacts/tests/artefacts.host.spec.ts` (the folders section renders the settings in force through the real Loader composition). Paper's loopback server carries no credential; the client connects to whatever answers on port 29979.
