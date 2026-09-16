# Agent Note: the Ungrouped header archives all its chats

Status: implemented

JJ, 15 Sep 2026: "there are like 70 'ungrouped' chats that can't be closed. A. they should be closable. B can you close them as they all seem to be from testing".

## Problem

Chats whose project is no longer registered (or that were started with no project) sit under Ungrouped. Each row has an Archive action, but the bucket header had no menu by design, so JJ faced about 70 loose testing chats that could only be closed one at a time. On the day the installed app's workspace registry held one project (TeamAdmin), so 97 visible chats from the audit, Proposition, Notes and test folders were loose.

## Decision

`ProjectRowItem` (`packages/client/ui-workspace/src/client/rows/Rows.tsx`) takes an `archiveAll?: { count; run }` prop beside the real-project `actions`. When present, the header menu carries one row, **Archive all chats (n)** (`menu.archiveAll`, zh 归档全部会话（{n}）), with the archive glyph and no danger styling. `WorkspaceBrowser` passes it for the Ungrouped group only: `count` is the number of non-blank sessions in the group and `run` calls the existing `onSessionArchive` once per non-blank session, so failures keep the per-row posture (console diagnostic, tree unchanged). The blank placeholder is neither counted nor archived because archiving the current provisional chat would remove the row the user is typing into. Real project headers are unchanged. Menu dispatch is by id with no else fallback. Upstream `ui-workspace` touched; FORK.md row added.

83 of JJ's loose chats were archived through the `workspace.archiveSession` RPC at JJ's request; the 14 blank placeholders and the Studio coordinator chat were left alone.

## Alternatives considered

A bulk archive RPC on the host would have added a second archive path to test and to keep consistent with the per-row one; the header action reuses the per-row call, so one path stays. Re-registering the audit and Proposition as projects would have regrouped their chats instead of archiving them; JJ asked for them closed.

## Consequences

Loose chats can be closed in one action. Archive is registry-global and has no unarchive surface yet (README Known Limitations), so the RPC route was used once rather than added as a product path. Tests: `tests/rows.client.spec.tsx` (menu carries only the archive-all row with the count; select runs it) and `tests/workspace-browser.client.spec.tsx` (Ungrouped menu archives the two started loose chats and skips the blank one).
