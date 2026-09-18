# Agent Note: Appearance fixes and terminal theming

Status: implemented

English | [中文](2026-08-24-appearance-fixes-and-terminal-theming.zh.md)

## Problem

JJ's 24 Aug review found four faults in the appearance panel and one missing V0 capability. The action colour changed only `--dsw-alias-button-primary-*` and the soft fills, while the affordances the user actually sees read other tokens: the send circle reads `--dsw-alias-button-info-fill/-hover` and the composer accents, selected view tab and links read `--dsw-alias-state-business-primary` — so picking a colour appeared to do nothing. The line-spacing rule emitted `calc(1.45em + Npx)` against chat's real 16px/28px body, so most of the slider *tightened* text, flattened headings onto the same leading, and never reached bubble text (`MessageText` inherits its line-height). The font pickers were native `<select>` elements, whose popup macOS refuses to style, so families could not preview themselves. Send on Return appeared in three places (composer toggle, Appearance row, and an unreachable Settings row). And V1 had no counterpart to V0's Appearance ▸ Terminal: the xterm grid always sat on the page's alias tokens.

## Decision

**Action colour lands on the visible tokens.** `actionTokens` gains the ground hex and now also emits the `button-info` pair (mirroring the primary fill/hover, gradient included) and `--dsw-alias-state-business-primary` as the solid colour deepened along its hue to 3:1 on the ground — the same readability rule `--dsw-alias-brand-primary` follows in the preset resolver.

**Line spacing adds onto each surface's real leading.** A `SURFACE_BASE_LEADING` table (chat 1.75 from the assistant flow's 16/28; the other surfaces 1.45, the browser-normal their rows sit on) replaces the flat 1.45em; headings leave the selector and keep their design leading; a `data-message-text` hook on ui-primitives' `MessageText` (FORK-logged) lets a second rule cover bubble text from its own 16/24 base.

**Font pickers become the panel's own listbox.** Trigger and options render in the family they name; the unknown-value and loading rows survive; Escape, blur or a pick closes.

**Send on Return keeps one home.** The composer-strip `ReturnToggle` stays; the Appearance row and its store/face/scope plumbing go, and ui-conversation's `settings.general.item` ReturnToSendRow registration is deleted with its component (the injected face moved to `ReturnToggle` as `ReturnToggleInjected`; slot catalog regenerated).

**Terminal theming ports V0 wholesale.** `appearance-settings.ts` gains a `terminal` section (theme id, custom bg, font, size 9–28, line spacing 1–3, margin 0–80; defaults DM Mono/14/1/36/Linen per V0 `AppearanceDefaults`). `terminal-themes.ts` carries the six V0 schemes verbatim (bg/fg/cursor/selection/16 ANSI), followed by the Classic pair and the selection floor of the [appearance contrast floors note](../bug-fix/2026-09-18-appearance-contrast-floors.md); a custom background re-derives the selection with V0 `withBackground`'s 0.14 ink blend. The panel's new Terminal tab lists themes as V0's rows, monospaced families first (the Host's font scan now reads the `post` table's `isFixedPitch` and the fonts route serves `{ families, monospaced }`); Reset keeps the theme choice, matching V0's "choices are never reset" rule. The resolved `TerminalPaint` crosses to `@idealize/ui-terminal` through `ctx.appearance.terminalPaint()` plus a store subscription — a service seam, because the client bundle purity gate forbids cross-plugin value imports. `applyTerminalPaint` restyles every cached and future grid, refits and pushes the new cols/rows to the PTY, paints the margin in the terminal ground, and fixes the cursor as V0's bar in the theme's cursor colour. The grid stays independent of the app theme.

## Alternatives considered

**Sharing the theme tables by value import from ui-terminal.** Rejected: `@idealize/*` specifiers happen to pass the purity gate's `@deepseek-ai/` filter, but the inlining would duplicate the tables into both bundles and couple plugin runtimes outside the sanctioned service channel; the resolved-paint service keeps the dependency one-way (ui-terminal → appearance, types only).

**`calc(1lh + Npx)` for line spacing.** Rejected: `lh` inside `line-height` reads the parent's value, so nested markdown (`li > p`) would compound the addition per nesting level.

**A cursor-style setting.** Rejected: V0 fixes the bar cursor in the theme's cursor colour; the plan carries that forward as a non-setting.

## Consequences

An action colour set before this change now also recolours the send button, composer accents and links on next load — a visible but intended shift. `--dsw-alias-state-business-primary` also colours ANSI blue in tool output and trajectory accents; they follow the action colour by design (one accent). The Terminal tab edits the embedded terminal only; browsers without the desktop shell see the tab but no grid to paint until one exists. DM Mono renders only where the face is installed or bundled; the paint's stack falls back through `ui-monospace`/Menlo. The stored `terminal` section is new; older settings documents fill it from schema defaults.
