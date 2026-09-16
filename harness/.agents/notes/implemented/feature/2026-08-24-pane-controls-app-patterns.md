# Agent Note: Pane controls on the app's control patterns

Status: implemented

English | [中文](2026-08-24-pane-controls-app-patterns.zh.md)

## Problem

JJ's round-3 review: the panes follow the app's colours since the round-2 token restyle, but their controls do not follow the app's control styling — square corners from the Paper wires, per-pane borders (l2/l3/l4 mixed), five different focus treatments (business-blue outlines, brand borders, none), and per-pane button shapes (square filled, 6px ghost, 10px pills). Every pane hand-rolled its own button and field css.

## Decision

**One shared control sheet, composed.** `packages/idealize/ui-bar/src/client/controls.module.css` states the app's control patterns once; the seven ui-bar pane sheets `composes` from it. The patterns are read off the app's own controls, tokens and all:

- **Buttons**: capsule (`border-radius: 999px` = the height/2 rule of ui-primitives `Button.module.css`; `.md` h36 / `.sm` h28), `primary` on `--dsw-alias-button-primary-fill`/`-hover` with `--dsw-alias-label-primary-foreground` text, `outline` as 1px `--dsw-alias-border-l2`, `ghost` hovering `--dsw-alias-interactive-bg-hover`; disabled opacity 0.4.
- **Fields** (input/select/textarea): 1px `--dsw-alias-border-l2`, `border-radius: 8px`, `--dsw-alias-bg-layer-1` fill, focus turns the border `--dsw-alias-brand-primary` (ui-primitives `Input` + ui-settings-plugins `fields` pattern); placeholder `--dsw-alias-label-dimmed`.
- **Icon buttons**: circles with the ghost hover, bordered (`iconButtonOutline`) where the pane needs the outline weight.
- **Focus ring** on buttons: `box-shadow: 0 0 0 2px --dsw-alias-border-l3` (PermissionSelect's ring).
- **Surfaces**: in-pane grouped lists/cards round to 12px (Menu/appearance-card radius), calendar cells and task blocks to 8px, the Brains edit sheet takes the Modal dialog radius (24px) with `--dsw-shadow-lv2`.

**The bundler resolves `composes` now.** The tsdown css-modules plugin (`packages/client/tsdown.client.ts`) mapped each local class to its single hashed name and dropped `composes` entirely — same-sheet and cross-sheet — so a composed base's styling never reached the built app (ui-settings-plugins' `inputInvalid` shipped without its base `input` styles). The plugin now flattens same-sheet references transitively, compiles a `from './x.module.css'` target sheet for its class names, and emits an import of that sheet so its style tag injects before the composing sheet's (pane overrides win by tag order at equal specificity). Missing targets and circular references fail the build. Logged in FORK.md.

**AppearancePanel states the same values directly.** The appearance package cannot `composes` ui-bar css: the client-bundle purity gate forbids cross-plugin value imports and each bundle injects its own style tags, so a cross-package compose would duplicate the sheet per bundle. Its controls were already close; radii moved to the shared values (8px fields, capsule small buttons, 12px menu list) and focus to the brand border + l3 ring.

## Alternatives considered

**Repeating the control declarations in each pane sheet.** Rejected: five copies of the same button/field css is how the panes drifted apart in the first place; the composes route keeps one authority and needed only a real bug fix in the bundler.

**A shared React control component.** Rejected for this pass: the concurrent pane work edits the panes' tsx, and a css-only change (composes lives in the sheets) cannot conflict with it; behaviour is unchanged by construction.

## Consequences

Pane controls now render with the composer and settings controls' geometry: capsule buttons, 8px fields, one focus language in both themes. The Service hatch Send moved from a grey fill to the primary capsule, and text on primary fills reads `--dsw-alias-label-primary-foreground` (was `brand-primary-invert`). Any future client bundle can rely on `composes` — including the pre-existing `inputInvalid` in ui-settings-plugins, which is correct in built bundles from this change on.
