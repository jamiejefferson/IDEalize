# Agent Note: the Studio's space record follows the open, and a launch answers for the chat until it lands

Status: implemented

Found 8 Sep 2026 by the landing-17 walk over a fresh copy of JJ's live data: pressing the Studio card opened a chat showing the welcome card's "Which space are we working in?" step, with no composer on screen and the card not marked current. Eight checks failed. The second press recorded the space and the same chat became the Studio.

## Problem

`openStudio` recorded the space before opening the chat: `connectWorkspace` → `POST /idealize/spaces/select` → `sessions.open`. The route resolves the chat through `sessions.get`, which answers live sessions only, and `connectWorkspace` reuses the project's existing blank chat when it has one. A blank chat made in an earlier run of the app is cold: the host has no live session of that id until something resumes it, the route answers 404, the client swallowed it, and the chat opened with no `space` projection. `HeroLauncher` reads that projection to decide a chat has been launched, so the chat showed the space chooser instead of the Studio composer, and the card's current mark reads the same projection.

Earlier walks passed because JJ's data left the first listed project with no reusable blank chat, so `connectWorkspace` created one, and a created session is live.

## Decision

The chat opens first, and the record follows it: opening resumes a cold chat, so `recordSpace` retries `POST /idealize/spaces/select` while the host answers 404 (20 attempts, 250 ms apart) and stops at any other refusal, which is final.

`SpaceSeed` gains `launchedSpace(sessionId)`, publishing the launch map it already kept for the ring. The card's `currentSession`, its current mark and its reuse scan read the launched space before the projection, so a chat launched in this page is in that space from the moment of the launch and never shows the chooser while the record is in flight. This is the seed's existing rule — a launch beats the projection — applied to the three other readers of the same fact.

## Alternatives considered

**Resume the chat from the route.** Recording a space would then have to build an Agent from a plain HTTP handler; resume belongs to the agent-loop, and the client already has an open verb that triggers it.

**Keep the record before the open and retry there.** Nothing would make the chat live, so every attempt would 404 until something else opened it.

**Suppress the chooser on a blank chat generally.** The chooser is the point of a blank chat; only a chat this page has just launched knows better.

## Consequences

A reload between the open and the record finds the chat with no space and lands it on Chat, a window the old order gave to the ring instead. The window is one resume long and the chat is blank.

`studio-card.client.spec.tsx` pins the new order and both retry paths; `space-seed.client.spec.tsx` pins `launchedSpace`. The walk's Studio section passes on a data state where the first project holds a blank chat.
