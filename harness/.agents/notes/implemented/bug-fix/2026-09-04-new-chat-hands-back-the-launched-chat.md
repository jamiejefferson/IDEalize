# Agent Note: New chat handed back the chat the launcher was still configuring

Status: implemented

JJ, 4 Sep 2026, on the landing-8 walk finding: "new chat handback please fix".

## Problem

Pressing New chat immediately after launching a chat reopened that same chat instead of minting a fresh one.

`connectWorkspace`'s reuse scan (`packages/client/runtime/src/client/workspaces/service.ts`) decides whether a blank session is a fresh one. Every input it reads is Host-authored: the `blank` bit, workspace membership, the archive set, and the `brain` and `space` projection values. The 28 Aug fix added the `brain` clause so a launched chat would stop being reused, which is correct once the projection exists.

The projection exists one round trip after the write that produces it. The launcher writes the brain (`agentPresets.select`), the Host computes the projection, the client's session summary updates. New chat pressed inside that window reads a session with no brain recorded, decides it is fresh, and hands the caller the chat they just launched.

Found by the landing-8 walk (`(j) the chat New chat opened is a different session`) and reproduced twice by hand against the packaged app with a CDP probe. Intermittent: it needs the window to still be open, so a loaded machine shows it and an idle one usually does not. Two of three walk runs on 4 Sep 2026 failed it.

## Decision

`IWorkspaces` gains `noteSessionConfigured(sessionId): () => void`. The workspaces runtime holds the marked ids in a page-lifetime `Set` and the reuse scan skips them. The returned disposer lifts the marker, for a caller whose work then failed.

`@idealize/ui-bar` marks the target in two places:

- the launcher's `spaces.enter`, before `selectBrain` rather than after it, lifting the marker when that write refuses;
- `openStudio`'s fresh-chat path, because the scan's `studio` exclusion reads the same projection and New chat could otherwise take a project's one group chat.

## Consequences

`SessionSummary.blank` and its computation are untouched, so the hero, the welcome card and the sidebar read blankness exactly as before. The durable rule stays the authority: the marker is page-lifetime, so a reload falls back to the projection, which by then has landed. A launch that fails without lifting its marker leaves one blank chat unreusable until the next reload, which is why the disposer exists and why both call sites use it or run to completion.

One upstream touch, logged in FORK.md: the reuse scan is the only place that decides reuse, and every input it reads is Host-authored, so a caller has no way to say "I have started work on this one" without a seat on the face.

## Alternatives considered

**Wait for the projection before returning from the launch.** It would slow every launch to protect a case that only matters when the user acts inside the gap, and it would still race, because the wait has to end somewhere.

**Flip `blank` locally at launch.** The blank bit mirrors the Host's empty-log fact and only ever lowers on the client; flipping it early would surface the chat in the sidebar, change the hero and the welcome card, and strip reuse eligibility permanently rather than for the window that needs it.

**Use the `space` projection as the marker.** Every chat derives a space, so it cannot distinguish a configured chat from a fresh one — the same reason the 28 Aug fix chose `brain`.

## Evidence

- `packages/client/runtime/tests/workspaces-service.client.spec.ts`: a blank session carrying only the derived `space` projection — the exact row the race leaves behind — is skipped once marked, `session.create` runs instead, and lifting the marker makes it the reuse hit again. 25 tests pass.
- `packages/idealize/ui-bar/tests/apply.client.spec.ts`: the composed plugin's launcher seat records `note` before `select`, and lifts on the refused write. 7 tests pass.
