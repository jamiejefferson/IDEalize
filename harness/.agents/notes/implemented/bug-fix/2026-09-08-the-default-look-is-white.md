# Agent Note: JJ's 8 Sep review, item 8 — the default look is a white ground with crisp dividers

Status: implemented

JJ, 8 Sep 2026, item 8 of the review of the desktop app: the app needs a "clean minimal out-of-box look". Asked which direction, JJ chose "Pure white, crisper contrast": a white ground, dark ink, slightly heavier dividers and a single accent colour.

## Problem

The default look was V0's IDEalize Light: an off-white `#F5F5F6` ground, `#24292F` ink and `#0969DA` accent, with every card lifted to white above the grey and the dividers at V0's alphas (`border-l1` 0.05 through `border-l4` 0.20 of the ink). The first paint, the appearance panel's IDEalize preset and the skin sheet all derive from that one palette through `deriveTokens` ([one token list](2026-09-08-dark-theme-tokens-and-action-colour.md)), so the look changes in one place, and the derivation carried two assumptions a white ground breaks: layer 1 lifts the ground to white, and layer 3 sits .01 below the ground so a chip reads against a white card. On a white ground both collapse onto the ground and a chip on a card vanishes.

## Decision

**The seeds.** `IDEALIZE_LIGHT` in `packages/idealize/appearance/src/presets.ts` is `{ ground: '#FFFFFF', ink: '#1B1F24', accent: '#0969DA', crisp: true }`. The ink reads at 16.56:1 on white (V0's `#24292F` read at 14.65:1) and the accent stays `#0969DA`, at 5.19:1 on white. `IDEALIZE_DARK` keeps V0's `#2A2F35` / `#D5DDE3` / `#85C1B4`. `@idealize/skin`'s `SKIN_CSS` follows through `deriveTokens(presetPalette('idealize', scheme))`, and the boot splash's wordmark and prompt take the new ink and secondary (`#1B1F24`, `#56595D`) over the white it already painted.

**`crisp` is a `Palette` switch in the preset table.** `deriveTokens` adds `CRISP_BORDER_STEP` (0.04) to each of the four `--dsw-alias-border-l*` alphas (light: 0.05 → 0.09, 0.13 → 0.17, 0.16 → 0.20, 0.20 → 0.24; `border-l2-darkmode-thin` steps with them) and blends the secondary label `CRISP_SECONDARY_BLEND` (0.26) toward the ground in place of V0's 0.30, so `label-secondary` is `#56595D` at 7.04:1. Every other token is unchanged by the switch. `resolveAppearance` carries `crisp` through the same way it carries `flat`, so a custom ground or accent over IDEalize keeps the heavier dividers. Only IDEalize light sets it.

**Layer 3 on a white ground.** `deriveTokens` keeps layer 1 at `lift(1)` and layer 3 at `surface(0.01)` on a light ground whose layer 1 lifts above it; when layer 1 equals the ground (a white ground), layer 3 takes the surface fraction `surface(0.055)`, `#F2F3F3` for IDEalize light, which is the step V0's layer 3 (`#F3F3F4`) had against a white card. The sidebar (.03, `#F8F8F8`) and the bubble (.05, `#F4F4F4`) keep their fractions: they sit 7 and 11 channel values below white, the same distance they sat below `#F5F5F6`. Linen's derivation is unchanged because `#F7F5F0` still lifts.

## Alternatives considered

**Tune the border alphas and the secondary blend for every palette.** OG, Ink and Linen were not in JJ's ask, and a global change would move the dark IDEalize side JJ asked to keep; a per-palette switch confines the change to the preset that asked for it and leaves the tunable in the preset table where the other seeds are.

**Make layer 3 `blend(layer1, ink, 0.055)` on every light ground.** It gives `#F2F3F3` for V0's ground too, within one channel value of the .01 rule, and it strips Linen's warm tint from layer 3 (`#F5F3EE` becomes a neutral grey). Conditioning on whether layer 1 lifted changes nothing for grounds that do lift.

**A darker ink such as `#0F1115`.** It reads at 18.9:1 and its secondary at 7.08:1 with the plain blend, so the crisp blend would be unnecessary; JJ asked for dark ink and heavier dividers as two separate things, and `#1B1F24` keeps the ink in the same family as OG's `#1F2328` while the dividers carry the weight.

**Keep `#F5F5F6` and only heavy the dividers.** JJ's words were "pure white".

## Consequences

The readability gate (`appearance/tests/contrast-gate.client.spec.ts`) holds for IDEalize light at: ink 16.56 / 16.56 / 15.59 on ground / layer 1 / sidebar, secondary 7.04 / 7.04 / 6.63, accent 5.19, error `#EA1313` 4.56, warning `#AB661B` 4.52, success `#1DAB52` 3.00. The seeded gradient for a surface background runs from the ground to layer 1, and on IDEalize light both are `#FFFFFF`, so the panel's gradient seed is flat until the user edits a stop; OG light already behaved this way. `apply.client.spec` and `panel.client.spec` assert the white pair. `presets.client.spec` asserts the seeds, the `crisp` step per token, the layer-3 rule on a white, a lifted and the Linen ground, and `crisp` surviving a custom accent. `skin/tests/skin-css.spec.ts` asserts the white ground, the ink and the crisp `border-l2` in the served sheet. The ratio table in [the token-list note](2026-09-08-dark-theme-tokens-and-action-colour.md) carries the new IDEalize light row.
