# Agent Note: Schedule returns to the rail, Week only

Status: implemented

Part of the spaces-and-brains reshape, and the reversal of [Schedule as a primary view](2026-08-25-schedule-as-a-primary-view.md). The rail and its drawer are `@idealize/ui-bar`'s; the calendar is `@idealize/ui-schedule`'s.

## Problem

Two days earlier Schedule left the tool rail for the conversation view ring, on the theory that it is a primary view like the other activities. The reshape then settled what the ring IS: the space mechanism. Chat, Terminal, Gallery, Sound Stage and Motion are places a chat happens; Schedule is an instrument over `@idealize/cron`'s tasks, not a space. With [Trajectory already gone to the rail](2026-08-26-trajectory-as-a-rail-pane.md), Schedule stood as the only non-space in the tab row — and the two leaving is what retires the idea of the tab row as a mixed view list at all. JJ settled it on 26 Aug: "100% agree. move them both out of the tab bar. move both to the rail."

The old note's proof made the conflict concrete: its navigation audit failed the build the moment any rail button opened Schedule, so the seat change could not land without inverting that audit.

## Decision

**Revert the seat, keep the package.** `@idealize/ui-schedule` drops its `conversation.view` registration and `view-switch.ts` (and with them the `ctx.scheduleView.open` flipper, which nothing ever called) and provides `scheduleSection` on the Context instead: `Component`, plus `face()` returning the wired props — the store-bound `useSchedule` hook, `setDate`/`setMode`, the workspace list, the current chat's folder, the Create-with-chat session plumbing, and the bound translate. This is the fourth instance of the seam `modelsSettingsSection`, `agentPresetSection` and `trajectorySection` established, and the only sanctioned channel: the client bundle purity gate polices cross-plugin value imports. One calendar serves every chat, so unlike `trajectorySection`'s per-chat `face(sessionId)`, this face takes no session.

**`@idealize/ui-bar` gains a `'schedule'` drawer pane**, seated after Trajectory: a `BarPanel` member, a rail button with a calendar glyph, a `DrawerPanel` branch and `PANEL_TITLE` row, and en+zh `bar.schedule` keys. The pane takes no chat and remounts nothing on a chat switch; the plugin's store carries the navigated week and an open editor across the drawer's unmounts, which is the same unmount discipline (SCH-09) the ring imposed and the reason `createScheduleStore` survives the move intact.

**Week is the only grain.** JJ, same review: "i'm happy with just a week view in the calendar." Day and Month are deleted — the hour lane, the reschedule drag that lived on it, the all-day section, the month grid, the grain switcher — and `VIEW_KEY`/`rememberedView` with them, because a store that persists a grain nothing renders is a lie. The day-lane geometry helpers (`HOUR_PX`, `BLOCK_PX`, `blockTop`, `timeAtOffset`, `staggerColumns`, `monthTitle`) leave `schedule-model.ts` with them. What remains — the explicit load states, `ScheduleEditor`, `ScheduleCreateChat`, the cron-route client, the data-continuity test — is unchanged in behavior.

**The layout is the drawer's, not the window's.** The content caps at 424px and centres, and the week strip's day cells flex (`flex: 1`, capped at the wireframe's 48px) instead of fixing at 48px, so all seven days stay whole at the drawer's 320px minimum. The 880px canvas cap, the composer-overlay opt-in and the 140px chrome allowance were ring-seat machinery and went with it; the audit found no viewport `@media` in the calendar's CSS, so no container-query port was needed.

## Alternatives considered

- **Keep the ring entry and add the rail pane.** Two seats for one calendar, and the tab row still mixed. Rejected with the same argument as S6's.
- **Keep Day and Month behind the pane.** JJ ruled the week view sufficient; keeping the grains would also keep the grain persistence, which would record a choice the UI no longer offers.
- **Keep the reschedule drag by re-homing it on the week columns.** The week columns have no hour granularity, so a drag there could only move a task between days — a different gesture the wires never drew. The editor's RUN AT row covers rescheduling; the README's Known Limitations names the drag as the deliberate loss.
- **Archive the reversed note in the same change.** The archive gate seals only complete English/Chinese/sidecar triplets, and this note's predecessor has no Chinese counterpart (the translation pairing debt is S10's). Inventing a translation to satisfy the sealer was rejected, so the old note stays active, cross-linked here, until the triplet exists.

## Consequences

`@idealize/cron` is byte-for-byte untouched, and so is every task record: `tests/data-continuity.client.spec.tsx` still reads a cron-written document straight into the view and asserts the file unchanged. The generated client slot catalog loses its `conversation.view id 'schedule'` row; `scripts/gen-cordis-catalog.ts`'s walk exemption moves from `scheduleView` to `scheduleSection`. The rail spec that asserted Schedule's *absence* from the rail now asserts its presence, and `proof/schedule-proof.mts`'s navigation audit is inverted: it fails unless a rail button opens Schedule and no chat's ring offers it.

The reschedule drag is gone with the Day lane; nothing else a user could do left the product.
