# Agent Note: Launcher chat landing, terminal auto-launch, pill accent

Status: implemented

## Problem

JJ's round-3 review of the welcome launcher listed three faults. A chat pill left the user on the Chat/Terminal chooser instead of landing in the chat. A terminal launched from a pill opened a bare shell, where V0 typed the configured agent CLI at the first prompt (`TerminalSession.start()`). The selected pill kept a fixed `#4176e6` while the appearance panel's action colour recoloured every other primary control.

## Decision

**The launch is the session's, and it retires the chooser.** `HeroLauncher` records the launched SESSION id, never a loose boolean: `launched` is derived per render (`launchedFor === session.id`), so a new blank chat or a project switch shows the chooser again by construction, and no owner re-render can reset a launched card. Once launched, the toggle and pill rows unmount and the card is the project chip over the revealed, focused composer — the user is in the chat. The earlier `projectOpen` reset effect is gone; it could fire on any transient recompute of the chip title.

**The host types the launch command; the client only names the activity.** `/idealize/terminal/open` takes `activity` (the chat's preset id, injected from the session summary by the view-ring entry). A fresh shell — empty replay, not already scheduled — gets `scheduleLaunch`: first output event is the prompt signal, a 300ms settle lets multi-chunk prompts finish, a 2s fallback covers a silent shell (both V0 analogues, fixed timing), and the write leads with Ctrl-U. The command resolves host-side from a validated `Config`: `launchByActivity[activity]` over `launchCommand` (schema default `claude --dangerously-skip-permissions`; empty disables). A reattach never reaches the scheduler, so an agent already running cannot have a second launch typed into it; `open` replies with `launch` so callers and tests can see what was scheduled.

**The selected pill rides the action aliases.** Fill `--dsw-alias-button-primary-fill` (hover pair), label and glyph `--dsw-alias-label-primary-foreground` — the same pairing `Button.module.css` uses for primary fills, so the appearance panel's action colour (solid or gradient, `surface-css.ts` `actionTokens`) recolours the pill with the theme's readable foreground. The border is transparent because a gradient image cannot paint one; the dark-theme selected rules are deleted since the aliases flip with the theme.

## Alternatives considered

**Typing the launch from the browser after the replay settles.** Rejected: the host owns the PTY and already distinguishes fresh from reattached; a client-side write races reconnects and duplicates on multi-tab.

**Deriving the launch command from the activity's resolved model.** Rejected for now: mapping provider→CLI would re-implement `resolveActivityModels` inside ui-terminal; the per-activity config override covers the same need at the composition layer.

## Consequences

A ring-tab flip to Terminal on a fresh chat also auto-launches (the open is equally fresh), which matches V0's launch-on-new-terminal default; blanking `launchCommand` in config turns the behaviour off deployment-wide. The welcome card no longer offers the pills after a chat launch while the chat is still blank; the pills return with the first turn (composer dock row) or the next blank chat.
