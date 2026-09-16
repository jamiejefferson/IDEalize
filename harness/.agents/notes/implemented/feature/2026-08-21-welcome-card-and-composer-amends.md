# Agent Note: Welcome card and composer amends

Status: implemented

English | [中文](2026-08-21-welcome-card-and-composer-amends.zh.md)

The pill row this note designed is superseded twice: [the two-step chooser](2026-08-26-welcome-card-space-then-brain.md) replaces its welcome-card seat, and [the pill row retires](../simplification/2026-08-27-retire-the-pill-row.md) removes its composer seat, leaving [the brain switcher](2026-08-26-in-session-brain-switch.md) on the model seat this note first shadowed. The Return-to-send toggle and the hero amends here remain current.

## Problem

JJ's 2026-08-21 review of the welcome screen (Paper 1LT-0) and the composer (Paper 27K-0) listed seven defects. The five activity pills rendered twice on a blank chat: once as the hero card's own chips and once as the activity-pills row above the composer. The hero carried a "Standard mode" preset chooser beside the project chip, which the pills make redundant. The project chooser sat outside the card while the design puts it inside as the first of three rows. Selecting a pill did not start the chat. The selected pill's outline was too quiet. The in-session composer still offered a "Select model" dropdown although the pills decide the model. The composer had no plan-mode control except ui-plan's text chip, which only appears once plan mode is already on. With no project open, the welcome screen showed a disabled composer and nothing to do.

## Decision

**One pill component, one selection, two seats.** `@idealize/activity-pills` keeps owning the row. Its composer-dock registrant renders nothing while the session summary is `blank`; the welcome card renders the same `ActivityPillRow` through the `activityPills` service. A pill click on the welcome card calls the same `select` (recompose the blank chat, set the roster default) and then reveals the composer with focus, or opens the desktop terminal when Terminal is the chosen mode. `selectedClickable` lets the already-selected pill launch too.

**The hero's accessory seat carries the shell's pieces.** `HeroLauncherOwnerProps` now hands the occupant the rendered project row (chip + picker + preset chip), the recent-project cards, `projectOpen`, and two actions (`onNewProject` raises the folder flow through a second, menu-less picker instance with `addOnly`; `onFindProject` opens the picker menu). ui-conversation ships `HeroLauncherDefault`, which renders the row over the recents, so the upstream composition keeps its hero. `@idealize/ui-bar` shadows that seat at priority -1 with the welcome card and shadows `conversation.hero.agentPreset` with nothing.

**Shadowing retires the model dropdown and the plan chip.** `@idealize/activity-pills` registers an empty occupant on `conversation.input.model` (the `/model` command remains). `@idealize/ui-bar` registers `PlanToggle` on `conversation.input.plan` at priority -1: a 28px icon in the dock's treatment, pressed while the `plan` projection's effective target is on, running `/plan` or `/plan off` through the command channel so the host plugin stays the owner of the state.

**Selected pill = solid accent fill** (`#4176e6`, white label and glyph) in both themes.

## Alternatives considered

**Removing the `conversation.hero.agentPreset` render from ConversationRoot.** Rejected: the upstream web-app composition (and its browser snapshots) keep the chip; a priority -1 shadow from the fork removes it only where the pills exist.

**Editing ui-plan's chip into an icon toggle.** Rejected: the seat is single and shadowable; the fork keeps upstream files untouched where a seam exists.

**Hiding the dock row from ConversationRoot during the hero.** Rejected: the row knows its own session's `blank` flag; no owner change needed.

## Consequences

Without the desktop shell the Terminal segment is hidden and every pill click launches a chat. A composer block that only a model pick clears has no in-card affordance; `/model` is the escape hatch until the pills' availability states cover it. The ui-bar host half no longer registers the `idealize-activity` settings namespace; the roster default is the durable choice.
