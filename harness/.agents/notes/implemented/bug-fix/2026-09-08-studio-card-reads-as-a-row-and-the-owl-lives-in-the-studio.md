# Agent Note: JJ's 8 Sep review — the Studio card reads as a row, and the owl lives in the empty Studio

Status: implemented

JJ, 8 Sep 2026: "Side nav UI is a little confusing as the studio looks like it's selected. It should have the same look as other chats but with a subtle rule between it and the projects." And: "Studio chat is asking for a project but it runs across all projects, so not needed. I'd like the owl to live here, rather than the placeholder copy."

## Problem

`StudioCard` in `@idealize/ui-bar` kept V0's lead-agent card: a filled 48px card with a border, a permanent 3px brand accent bar, a brand-coloured glyph and a 600-weight title. Every ordinary chat row in the sidebar (`Rows.module.css`) is transparent, 32 or 44px, radius 8, and takes `interactive-bg-hover` only while selected or hovered, so the one filled, accented card at the top read as the selected item whatever chat was open. The empty Studio view opened on a header subtitle ("Every project's coordination at a glance: tasks, attention, timeline.") and a paragraph telling the person how agents write to it, and a Studio chat left without a project rendered the launcher's project chooser in place of its composer, although the Studio runs across every project.

## Decision

**The card is a row.** The button takes the named session row's measurements: 44px, radius 8, `padding: 0 8px`, the glyph in a 16px lane at `label-secondary` (primary on hover and while current), a 13px/500 title over an 11px `label-secondary` subtitle, transparent until hover, and the rows' `interactive-bg-hover` fill under `data-current`. The accent bar is gone; the attention badge shrinks to 16px and the presence dot to 6px. **The rule belongs to the card.** A wrapper (`data-studio-card-wrap`) carries `padding-bottom: 8px` and a 1px `--dsw-alias-border-l2` bottom border, so the hairline sits between the Studio and the projects without touching ui-workspace's pinned strip.

**The empty Studio shows the owl.** `StudioOwl` in `@idealize/ui-studio` renders the shared `OwlMark` (`@deepseek-ai/dsh-client-ui-primitives`, the boot splash's 42 frames) at 120px, centred, with one line under it: "Nothing here yet. Message everyone below, or @name to ask one agent." `OwlMark` plays the run cycle once on appear and again on hover, and holds its resting frame under `prefers-reduced-motion`. The header subtitle key is deleted in both dictionaries; the header is the title alone. **A Studio chat never asks for a project.** `HeroLauncher` returns null for a `studio`-space session whose `projectOpen` is false, with the reason in a comment; the card already opens only a Studio chat a listed project holds, so the branch covers the chat being shown anyway.

## Alternatives considered

**Play the splash frames from `@idealize/skin`.** The frames already live in `ui-primitives` as `OwlMark` (the hero's owl, FORK.md), which also carries the reduced-motion rule; a second copy of 42 base64 frames in a client bundle would be a clone the duplication gate flags.

**Loop the owl while the Studio is empty.** A run cycle that never stops in an otherwise still pane pulls the eye from the composer; V0's welcome behaviour, one run then rest, is what `OwlMark` already does.

**Draw the rule in the pinned strip.** The strip is upstream (`WorkspaceBrowser.module.css`) and would widen the fork's footprint; the card's own wrapper draws the same line.

## Consequences

`@idealize/ui-studio` gains `@deepseek-ai/dsh-client-ui-primitives` as a dependency. Tests: `ui-bar/tests/studio-card.client.spec.tsx` (wrapper, no accent, four children), `ui-bar/tests/hero-launcher.client.spec.tsx` (the Studio chat's null), `ui-studio/tests/studio-view.client.spec.tsx` (owl, line, title-only header, reduced motion). The desktop landing walk should read the Studio card's computed background as transparent while another chat is current and as the hover fill while the Studio chat is current, one 1px border under `[data-studio-card-wrap]`, no `[data-hero-undecided]` in a Studio chat, and an `img` inside `[data-studio-owl]` on an empty Studio.
