# Agent Note: The sidebar lane is the only place a chat's space shows

Status: implemented

Part of the spaces-and-brains reshape; the `space` projection the lane reads is `@idealize/spaces`'s ([vocabulary](../architecture/2026-08-26-idealize-spaces-vocabulary.md)).

## Problem

The reshape gives every chat a space, and JJ rejected the space chip in the chat header. That leaves the sidebar as the single surface where a user can tell a Gallery chat from a Sound Stage chat from an ordinary one, so the left list has to carry the signal on every row, including the chats made before spaces existed.

Session rows are fixed upstream components with no per-row slot (`packages/client/ui-workspace/src/client/rows/Rows.tsx`), the same wall the token-meter capsule and the named-card rows already hit. `SessionNode` carried no space, and `@idealize/spaces` publishes the fact host-side as a projection.

## Decision

**`SessionNode.space` is fed from `projectionValues`, exactly as `agentName` and `contextPressure` are.** The host's whole projection map already rides every `session.list` row (`listProjectionsFor`, `packages/host/apiproxy/src/api-proxy.ts:826-836`), so S1's `space` unit reaches the sidebar with no new wire.

**The field is required, not optional.** The lane is a fixed 16px cell that always draws a glyph, so a row never changes height or shifts sideways when a chat's space resolves. Making the type required is what forces that: a fixture cannot omit a space, and `sessionNode` falls back to `chat` when the projection has not arrived. Every existing test fixture names its space as a result.

**The lane leads the row, ahead of the conditional status slot.** The status slot is dropped from an idle flat row, so a lane placed after it would sit at two different x positions down one list. Leading, it holds one x position whatever else the row carries — which is also what makes the lane readable as a column rather than as decoration. The consequence is that the title is no longer the row's leading element, so `.flatSessionRowWithoutStatus .title { margin-left: 0 }` retires with its class.

**The glyphs are drawn in `rows/SpaceGlyph.tsx`, not imported from `@idealize/spaces`.** The client bundle's purity gate tests only `@deepseek-ai/` specifiers (`packages/client/tsdown.client.ts:220-229`), so a cross-`@idealize` value import would not fail the build — it would silently inline a second copy of the space table. Only the `SpaceId` union crosses, type-only, which is the pattern the token-meter and `@idealize/comm` FORK.md rows already established. `FALLBACK_SPACE` restates `'chat'` for the same reason rather than importing S1's `DEFAULT_SPACE`.

Five silhouettes chosen to stay apart at 16px on the IDEalize bar's own grid (16×16, 1.5px strokes, round caps): speech bubble, `>_` prompt, framed picture, level meter, play head with speed rules.

## Alternatives considered

- **Put the lane after the status slot**, where the row's other 16px cell already is. It matches the existing rhythm and costs no layout thinking — and it puts the glyph at two x positions in the flat list, which is the one thing a per-row identity column must not do.
- **Make `space` optional and render nothing when it is absent.** Smaller diff, no fixture churn. It also means a row with no glyph for as long as the projection takes to arrive, then a 16px sideways jump on every row in the list.
- **Import the glyph table from `@idealize/spaces`.** One home for the pictures. The client bundle would ship two copies of the module instead of refusing, which is worse than an error because nothing reports it.
- **Extend the lane to the content-search rows too.** Those are a different node type fed from `SessionSearchResultItem`, which carries no projections; giving them a space needs a host change that belongs with whoever needs it.

## Consequences

A user can see at a glance which of their chats are Gallery, Sound Stage or Motion work, from the only surface that shows it. Titles lose 20px to the lane at the sidebar's default width.

A pre-reshape chat reads as Chat by two agreeing paths: S1's ladder answers Chat for a live session whose log names no space, and a cold pre-spaces row for which the host publishes no `space` value at all falls through the lane's own fallback to the same answer. Both were observed in the rendered proof (`.idealize/proof/space-lane.log`), which seeds its pre-reshape chats against a composition with the `idealize-spaces` row disabled rather than faking them.
