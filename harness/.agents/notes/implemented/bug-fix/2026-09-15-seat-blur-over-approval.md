# Agent Note: the seat's frosted layer paints under the composer entries

Status: implemented

JJ, 15 Sep 2026, 15:38: "the ask bar has suddenly broken", with a screenshot of a chat waiting on a bash approval.

## Problem

The whole approval card, its amber Waiting for approval strip and its Allow button, was frosted and unreadable while the transcript line above it stayed sharp, and the approval could not be answered. It had been pending since 15:35:26 (session `70766da1`, TeamAdmin). When the chat surface paints its own ground (JJ's chat surface is solid `#FAFAFA`), the appearance sheet puts a `::before` on the composer seat with `backdrop-filter: blur(14px)` and `inset: 0` to mask the transcript under the composer (note `e79a055562`). The active seat is sticky with `z-index: 7`, so it is a stacking context; the `::before` is a positioned box at auto z-index, which paints above the seat's non-positioned in-flow content. The InputBar's root is `position: relative`, so it paints later in tree order and stayed sharp, which is why the blur looked right on every ordinary chat. The approval takeover (`ApprovalPanel`, which replaces the InputBar in the seat while an approval is pending) has no positioned root, so the frosted layer painted over it. The user-questions panels have none either.

## Decision

The seat layer takes `z-index: -1` in `seatBlurRule` (`packages/idealize/appearance/src/surface-css.ts`): inside the seat's stacking context it paints above the seat's own background and below every entry the seat holds, positioned or not, and its backdrop is still the transcript under the sticky seat. One line, asserted in `surface-css.client.spec.ts`. No upstream package changed.

## Alternatives considered

Giving `ApprovalPanel` (and the user-questions panels) a positioned root would have fixed the panels seen today and left the next composer takeover to meet the same fault; the ordering belongs to the layer that causes it. Dropping the blur under a custom ground would have brought back the transcript showing through the card, the fault the blur was added for.

## Consequences

Every composer entry paints over the frosted layer, present and future. The blur still masks the transcript under a custom chat ground, and the ordinary InputBar case is unchanged. Nothing changes without a custom ground, because the rule is only emitted then.
