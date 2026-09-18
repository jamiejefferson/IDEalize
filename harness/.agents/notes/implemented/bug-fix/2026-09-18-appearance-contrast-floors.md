# Agent Note: Appearance contrast floors for the terminal selection, a plain terminal theme, and ink on a surface's own ground

Status: implemented

## Problem

Three feedback items reported colour that could not be seen. On the Y2K terminal theme a selection did not show (37ff6651): its hand-placed `#AFCAB9` stands 1.09:1 off the `#DBACE3` ground. V0 fixed this in `Theme.swift` (`selectionColor`, `selectedTextColor`) and the V1 port of the theme table carried the raw colours without the rule; `TerminalView` also set no `selectionForeground`, so selected glyphs kept their own colours over whatever the highlight was. The terminal picker offered six designed schemes and no ordinary one (238efc4d), although the app has an OG preset. A surface that paints a background of its own checked nothing about the ink on it (cb68f5d5): `surfaceCss` wrote the ink tokens only for a chosen text colour, wrote them verbatim, and applied them inside the composer card, which keeps the theme's own fill, so the card's right-hand icons could vanish.

## Decision

**The selection rule is V0's, ported into `resolveTerminalPaint`.** `legibleSelection` (`packages/idealize/appearance/src/terminal-themes.ts`) keeps a theme's selection colour when it stands `SELECTION_CONTRAST` (1.5:1) off every ground stop and the ink or the ground reads on it at `SELECTION_TEXT_CONTRAST` (3:1). Otherwise it blends in 0.005 steps toward the theme's own ANSI black (bright white on a dark ground), then toward pure black or white, and takes the first step that passes both. `TerminalPaint.selectionForeground` is whichever of ink and ground the highlight carries better, and `xtermTheme` sets it. Y2K carries V0's wash stops as `wash`, so its selection matches V0's although the grid paints the flat midpoint; a custom background drops the wash, as in V0. The spec records every theme's ratios before and after.

| Theme | Placed | Off ground | Text on it | Painted | Off ground | Text on it |
|---|---|---|---|---|---|---|
| Linen | `#E7E0D1` | 1.21 | 10.95 | `#CFC9BC` | 1.51 | 8.73 |
| Ink | `#2E2F33` | 1.33 | 10.81 | `#37383C` | 1.52 | 9.46 |
| Y2K | `#AFCAB9` | 1.09 | 3.83 | `#4D6C6B` | 2.56 | 3.00 |
| IDEalize Dark | `#444E58` | 1.46 | 6.17 | `#47505A` | 1.51 | 5.96 |
| IDEalize Light | `#CCE4FF` | 1.30 | 11.24 | `#BFD5EE` | 1.50 | 9.75 |
| Solarized Dark | `#073642` | 1.15 | 4.11 | `#1E4851` | 1.50 | 3.16 |
| Classic Dark | `#3A3D44` | 1.55 | 8.95 | unchanged | 1.55 | 8.95 |
| Classic Light | `#ADD6FF` | 1.52 | 10.41 | unchanged | 1.52 | 10.41 |

**Classic Dark and Classic Light are the plain terminal.** They take the OG preset's grounds and inks (`#1B1D21` / `#E8E9EB`, `#FFFFFF` / `#1F2328`) under the standard terminal palette, with each slot except the ground's own end at 3:1 on the ground; the stock bright black (`#666666`, 2.97:1 on the dark ground) and the stock light-ground yellows, greens and cyans did not reach it. The picker lists theme names untranslated, so the names themselves are the plain-language labels, and the Terminal tab's hint says what the pair is.

**Ink on a surface's own ground is held to floors.** `surfaceGrounds` lists the opaque colours a surface's background paints (a solid fill, or every gradient stop, composited over the theme ground at the background's opacity). `surfaceInk` reads each ink token against all of them: `--dsw-alias-label-primary` at 4.5:1, secondary, tertiary and caption at 3:1, each floor capped at the ratio the theme's own token holds on the theme's ground (IDEalize Light's 45% tertiary sits at 2.81:1 on white). The source is the surface's text colour at V0's opacities, or the theme's token when none is set. A token under its floor restarts at the lightness it shows at over the ground it reads worst on, in the ink's own hue and saturation (the composite's hue is part ground, and the opaque ink's lightness would flatten a 45% token into the primary), and is deepened by `deepenAgainstAll` (`colour.ts`), which walks lightness both ways and takes the nearest step that clears every ground, because `isDark` picks the wrong direction on a mid-tone ground (white reaches 3.95:1 on `#808080`, black 5.32:1). A surface with no text colour writes only the tokens that had to move. When the chat surface writes any ink, a `[data-composer-card]` rule repeats the floors against the card's `--dsw-specific-input-major` fill. The background card's readout is driven by the same `surfaceInk` result: the ratio, whether anything was deepened, and the case where no shade of the hue reads across the whole background.

## Alternatives considered

**Replacing the six hand-placed selection colours in the table.** Rejected: the rule also has to cover a custom terminal background, and V0 keeps the placed colour as the start of the walk, so the theme's own colour survives wherever it already works.

**A strict 3:1 on the faint ink tokens.** Rejected: the light theme's own tertiary is 2.81:1 on its own ground, so a strict floor rewrote that token on every light surface with a background, including one set to the theme's own ground. The cap states the narrower promise: a surface's background never makes ink fainter than the theme has it.

**Deriving a whole token layer (cards, bubbles, borders) from a surface's ground.** Rejected for this change: it recolours the composer card and the bubbles on every customised surface, which nobody asked for. The user bubble keeps the theme's `--dsw-specific-bubble` fill, so a surface ink deepened toward white for a dark ground in the light scheme can still sit on a light bubble; the composer card was the reported case and has its own rule.

**`deepenAlongHue` per gradient stop.** Rejected: it returns one colour per ground, and a gradient needs one colour that clears all of them.

## Consequences

Every terminal theme's selection now shows, and five of the six V0 themes paint a slightly deeper highlight than their table entry. A stored surface background repaints its ink on next load only where a token fell under its floor. A text colour chosen with a background is no longer written verbatim when it cannot be read; the readout says so. `TerminalPaint` gains a required `selectionForeground`. No upstream file changed.

## Verification

`terminal-themes.client.spec.ts` audits all eight themes against both selection floors and pins the table above. `surface-css.client.spec.ts` covers a light, a dark and a mid-tone ground, a gradient, a see-through fill, the unreachable case and the composer card; `colour.client.spec.ts` covers `deepenAgainstAll`; `panel.client.spec.tsx` covers the readout's three states and the two new picker rows; `paint.client.spec.tsx` (ui-terminal) pins `selectionForeground` in the xterm theme. The appearance sources and `TerminalView.tsx` stay at 100% coverage. `.idealize/proof-appearance-contrast.mts` renders both without a server or stored settings: real xterm grids with a line selected under the raw table and under the resolved paint, and a chat surface with a composer card before and after the floors (`.idealize/proof/appearance-contrast-terminal-selection.png`, `appearance-contrast-surface-ink.png`).
