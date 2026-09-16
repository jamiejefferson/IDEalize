# Agent Note: Wave C6c — the Terminal group chooses its CLI

Status: implemented

JJ, 31 Aug, after checking C6 in the app: "there should be a choice of cli in the terminal section of Brains". Host: `@idealize/ui-terminal`; pane: `@idealize/ui-bar`.

## Problem

Which CLI a fresh Terminal shell launches was composition config only: `launchCommand` (default `claude --dangerously-skip-permissions`) and `launchByActivity` in the `idealize-ui-terminal` row. The Brains pane's Terminal group showed the same chat-model picker as every other group, which does not decide anything a terminal chat does, and no surface in the app could change the launch.

## Decision

**The launch config becomes a settings section** (`installSettingsSection`, namespace `idealize-ui-terminal`), so choices persist in the settings document over the composition values, and **a new config field `clis` names the probeable catalogue** (Claude Code, Codex CLI, Gemini CLI, Kimi CLI, Pi, Herdr, OpenCode, Aider, Plain shell `''` by default — JJ's installed set plus the common agent CLIs; a fixed list can only offer what it names, so additions go here or in the `clis` config). `GET /idealize/terminal/launches` serves the catalogue with each command's executable probed through the login zsh (`cliInstalled` from `@idealize/activity-pills`; a plain shell is always installed; cached a minute), and `POST /idealize/terminal/launch` `{activity?, command}` writes one brain's override or the default. Commands are bounded to one 200-character line; running shells keep their command until restarted, which is the existing brain-switcher confirm.

**The Brains Terminal group carries the choice.** Each brain row in that group renders a CLI select instead of the chat-model picker (value: the command the shell would type now — the brain's override or the default; a hand-set command outside the catalogue shows as its own option rather than being misread). JJ, 31 Aug: "the cli picker ought to check which clis are available and show them in the list" — so the picker offers only the CLIs the login shell finds, and a stored choice of a missing one stays visible with the "not found on this Mac" suffix. A Default CLI row closes the group. The pickers render only where the route serves a catalogue, which is the desktop app; a plain browser keeps the model picker.

**Choosing writes an explicit override.** There is no per-brain "follow the default" option, because a settings merge cannot unset one key of the map; a brain touched once keeps its own choice. Logged in the pane README.

## Alternatives considered

- **Reuse the chat-model picker's slot for a combined model + CLI control.** A terminal brain's chat model decides nothing in the shell; two controls in one select would mislead.
- **Probe with the app's own PATH.** Same reason as C6a: launchd's PATH misses Homebrew; the terminal resolves commands in a login shell, so the probe does the same.
- **A delete route for per-brain overrides.** Deferred until someone needs "follow the default" back; the Default CLI row covers the common case.

## Consequences

`routes.client.spec.ts` pins the catalogue with real probe verdicts, the per-brain and default writes through an in-memory settings section, the merge keeping sibling overrides, and the refused shapes (multi-line, over-long, empty activity, unauthenticated). `brains-panel.client.spec.tsx` pins the Terminal group's pickers, the missing-CLI filtering with its marked survivor, the custom-command option and both writes. The packaged walk is in `idealize-desktop/.idealize/proof/c6a-2026-08-30` (rerun with the CLI-choice checks).
