# Agent Note: Pane restyle to V1 app styling

Status: implemented

English | [中文](2026-08-24-pane-restyle-v1-styling.zh.md)

## Problem

JJ's 24 Aug review found the rail panes reading as foreign to the app. SchedulePanel.module.css carried a private 25-variable `--sp-*` palette with its own hand-written dark block, a hardcoded Inter stack, and ~55 raw `font-size: Npx` declarations; BrainsPanel rode the alias colours but hardcoded Inter and ~34 raw sizes; DrawerPanel, FilesPanel, FileViewer and ServiceSection set raw px type; and the Feedback pane was a standalone self-styled iframe page. Two user-facing faults followed: the Appearance panel's theme, accent and interface-font settings only half-applied (a hardcoded Inter never reads `--dsw-font-family`; a private palette never reads the theme), and the iframe page's submit swallowed the proxy's 502 — a report could look sent while Supabase had refused it.

## Decision

**One pane type scale, on the skin sheet.** `--idealize-type-*` (title 14 / section 13 / body 12.5 / small 11.5 / caption 10) joins the brand tokens in `skin-css.ts`. Family stays on `--dsw-font-family` (which the interface-font setting rewrites) and size scales through the appearance zoom on `#root`, so panes on the scale follow both settings; the six pane stylesheets state every size through it.

**Colours only through `--dsw-alias-*`.** SchedulePanel's `--sp-*` palette and dark block are gone: greys map onto the label/border/bg aliases (both themes flip automatically), and every accent surface rides the tokens the appearance action colour lands on — fills on `--dsw-alias-button-primary-fill`, borders/highlights on `--dsw-alias-state-business-primary`, soft tints on `--dsw-alias-interactive-bg-hover-accent`. Layout geometry (heights, paddings, the square-corner wires look) is unchanged. Paused fills use `bg-base`, not `bg-layer-3`: the ui-theme scrollbar guard requires the l2 thumb pair on any scrolling sheet that paints an elevated rung, and the pane's scroll surfaces sit on the base rung where that pair would be wrong.

**Schedule speaks through `t()`.** The three Schedule components read every string from the `idealize-bar` dictionaries (zh+en), like the other panes; `schedule-model`'s copy helpers (badges, repeat sentences, next-run line, model label, day names) take the bound translate, and dates format through the dictionary's `sched.dateLocale` (en-GB / zh-CN).

**Feedback is a pane, not a page.** ui-bar's FeedbackPanel replaces the `/idealize/feedback` iframe: alias tokens + the type scale, the same three screenshot paths (attach, drag-drop, paste; 1600px JPEG downscale), posting to the kept `/idealize/feedback/submit` proxy. Failures surface in the pane: an upstream 502 says the report is kept locally (the proxy writes the backup before Supabase), any other refusal shows its reason. The feedback package no longer serves a page; the hatch Composition tab stays an iframe (its page is upstream's).

## Alternatives considered

**Keeping raw px sizes, since the `#root` zoom scales px anyway.** Rejected: the interface font still broke on hardcoded Inter, and the sizes had drifted into dozens of ad-hoc values per pane; a named five-step scale is the surface a future restyle can actually hold.

**Rebinding the scrollbar thumb pair to keep `bg-layer-3` paused fills.** Rejected: the canonical rebind is the l2 pair for surfaces that ARE elevated; Schedule's scroll containers sit on `bg-base`, so the rebind would mispaint them to satisfy a guard about a 58px block.

## Consequences

Pane type now moves with the Appearance interface font and size, and a custom action colour recolours Schedule's selected day, next-task block and primary buttons on next paint — intended, one accent. The pane title rows read 14px where the wires drew 20–22px; the wireframe geometry holds, the type sits on the app scale. `GET /idealize/feedback` is gone; only the submit and announcements routes remain, so anything that linked the page 404s (nothing in-repo did). Feedback submits from the pane now show their failure text; the local-backup file behaviour is unchanged.
