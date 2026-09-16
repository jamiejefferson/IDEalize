# Agent Note: the Studio card reuses only a Studio chat a listed project still holds

Status: implemented

Found 8 Sep 2026 by the landing-13 walk over a fresh copy of JJ's live data: the Studio card opened a chat whose composer read "Pick a project to start", with no textarea on screen, so the walk's Studio section failed six checks.

## Problem

`openStudio` in `@idealize/ui-bar` reused the first unarchived session in the `studio` space. JJ had removed the two projects those Studio chats were minted in ("My first project", then Notes) and created a third; the workspace registry listed one project and neither Studio chat belonged to it. A chat with no workspace renders the launcher's no-project card in place of its composer, so the one Studio the card promises opened on a chooser and nothing could be posted.

## Decision

The reuse scan asks a listed project to hold the chat: a Studio chat is reused only when some workspace's `sessionIds` includes it and it is not archived; otherwise `openStudio` mints a fresh Studio chat in the first listed project, as it does on a first press. The orphaned chats stay where they are; they were never sidebar rows and no workspace lists them.

## Alternatives considered

**Re-home the orphan onto a listed project.** A session's workspace is recorded on the host and the client has no verb to move it; minting a fresh chat is the existing first-press path and needs nothing new.

**Archive the orphans.** They hold no timeline of their own (posts live on the project's Studio timeline), so nothing is lost by leaving them, and archiving would touch the host for no user-visible gain.

## Consequences

`studio-card.client.spec.tsx` gains the removed-project case. The walk's Studio section passes on JJ's current data. A person who removes every project and adds one sees a fresh Studio chat on the next press.
