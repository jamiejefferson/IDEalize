# Agent Note: six failing gates, four of them stale invariants and one a pill painted with a surface token

Status: implemented

Found 9 Sep 2026 while landing 19: `pnpm vitest run packages/idealize packages/client packages/core/session` reported seven failures. Six fail identically at landing 18 (`6bc1f9fca6`), so no landing since 15 had run this suite; the seventh, `ui-tasks` "takes the aside seat and gives it back on disposal", is a 5 s timeout that passes when the file runs alone.

## Problem

Four separate causes, none of them in the code the landings shipped:

**`ui-studio` registration, three tests.** The spec evaluates the real `lib/client.js` and resolves its externals through an injected require backed by a fixed module map. The artifact requires `@deepseek-ai/dsh-client-ui-primitives`, a declared peer dependency it picked up when the Studio card and owl landed, and the map did not carry it, so every load threw `unexpected require`.

**`bundle-idealize` manifest ids.** The invariant read `idealize-${row.name.slice('@idealize/'.length)}` for every inserted row. Landing 14 inserted `idealize-mcp-paper` on `@deepseek-ai/dsh-mcp-client`, an upstream package, so the slice chopped the wrong prefix and produced `idealize-ai/dsh-mcp-client`. The rule as written cannot hold for a row mounting an upstream plugin, because one such package can carry several rows and only the row names which instance it is.

**`ui-workspace` space-lane width.** The sidebar's space lane went to 18px when the space icons became 18px Tabler outlines (`1893543b95`). The spec and the rule's own comment still said 16px.

**`ui-theme` elevated-surface rebinds.** `StudioView.module.css` scrolls and names `--dsw-alias-bg-layer-2` and `--dsw-alias-bg-layer-3`, so the sheet-level check read it as scrolling on an elevated surface with no rebind. Its one scroll container, `.body`, sits on the root's `--dsw-alias-bg-base`; the two elevated tokens paint `.chip` and `.eventProject`, both inline pills. The rebind contract is binary — hide the bar, or state the l2 pair — so the sheet could not declare the base elevation it actually scrolls on.

## Decision

The three drifted expectations follow the behaviour that changed under them: the module map gains the primitives package, the space lane asserts 18px with the comment naming the glyph it holds, and the manifest invariant states what is true of every row (unique, `idealize-` prefixed) and derives the id from the package name only for a first-party row, naming why an upstream row differs.

The elevated-surface failure is fixed in the sheet, not the check. `--dsw-alias-bg-*` names a surface, which is the distinction the check rests on; a pill takes the interactive fill instead, the family the check already treats as out of scope for ChatView's floating button and CodeBlock's banner. `.chip` and `.eventProject` move to `--dsw-alias-interactive-bg-hover`.

## Alternatives considered

**Exempt `StudioView.module.css` by name.** It would leave a pill painted with a surface token, which is the thing the check exists to notice, and the next sheet to do it would need its own row.

**Let a sheet declare the base elevation.** The rebind contract admits `transparent` or the l2 pair and nothing else, on the reasoning that a shape check accepts a crossed or blended pair. Widening it to admit l1 would weaken a stricter rule to describe one sheet.

**Loosen the check to element geometry.** The spec rejects this on its own terms: a floating button carries a radius, a shadow and a fixed size, so shape cannot separate a pill from a surface.

## Consequences

The Studio's neutral chips and the timeline's project tag render as a translucent neutral fill rather than a solid palette rung. In both palettes the two resolve within a few percent of each other on the Studio's base surface, and the warn chip beside them was already on a state tint.

The suite runs clean: 396 files, 4919 passed, 1 skipped.
