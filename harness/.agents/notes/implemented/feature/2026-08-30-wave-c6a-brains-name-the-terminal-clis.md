# Agent Note: Wave C6a — the Brains pane names which brains run as a CLI in the terminal

Status: implemented

The first half of the providers slice of JJ's 28 Aug review (plan: `.idealize/plans/feedback-wave-c-plan.md`): "Not clear which models are CLIs in terminal." The second half of the item resolved on 30–31 Aug: JJ chose the split "Claude Code in the terminal on subscription, chat on the API", which the existing pi-ai anthropic catalogue route already serves once a key is stored — so no Claude Code chat provider is built, and the pane wires the key path instead. Host: `@idealize/activity-pills`; pane: `@idealize/ui-bar`.

## Problem

Claude on subscription runs as Claude Code in the desktop terminal (`terminalOnlyProviders: ['anthropic']`, `@idealize/ui-terminal`'s default launch `claude --dangerously-skip-permissions`), and the chat cannot reach that route. The pane said none of this. A brain on Anthropic read "No key for anthropic" with an Add key button, its model picker grouped Anthropic like any keyed route, and Token Use listed Anthropic as "Key missing" while Subscriptions never mentioned it. Nothing on the pane said that the route is a command-line agent in the terminal, or whether that agent is installed.

## Decision

**The agents route reports the terminal CLIs.** `GET /idealize/activity/agents` gains `terminal`: one row per terminal-only route with the `cli` that serves it (new config `terminalCliByProvider`, default `{ anthropic: 'claude' }`) and `installed`, the verdict of `command -v <cli>` in an interactive login zsh (`cliInstalled`), because the packaged app's own PATH is launchd's and misses Homebrew. Null where the probe cannot run (Windows, a shell that exits abnormally, a name that is not one path component). Probed at most once a minute.

**The pane says it in three places.** A brain whose route a CLI serves carries the note "Runs as the claude CLI in the terminal, on its subscription. Chat needs an API key." with an Add key button into the provider editor (`data-brain-access="terminal-only"`, also when the host read said `no-access` for a route the CLI list names). Its model pickers label the group "Anthropic · claude CLI in the terminal" until a key is stored, after which the chat reaches the route directly and the mark would mislead, so it drops. Subscriptions lists the route as "Anthropic — Runs as the claude CLI in the terminal, on its subscription" with an Installed / Not found on this Mac / Could not check badge and an "Add key for chat" (or Manage) action into the provider editor, and Token Use stops listing a keyless route the CLI serves, so one name no longer reads as a missing key in one section and a subscription in another. A stored key returns the route to Token Use as connected.

## Alternatives considered

- **Probe with the app's PATH.** False "not found" for every Homebrew install; the terminal itself resolves the command in a login shell, so the probe does the same.
- **Read the CLI name off `@idealize/ui-terminal`'s launch command.** The terminal plugin ships only in the desktop app and its command carries flags; a provider-keyed name in the plugin that already owns `terminalOnlyProviders` is the smaller seam.
- **Keep Anthropic under Token Use as well.** Correct for a user who adds a key, misleading for the one who has not; the CLI row and the brain rows both open the provider editor for the key.
- **A Claude Code chat provider (`claude -p` behind the LLM seam).** Rejected with JJ, 31 Aug: the terminal keeps the subscription and chat uses the API, which keeps the app inside Anthropic's terms and off a second permission model.

## Consequences

`brains-panel.client.spec.tsx` pins the row note with its Add key path, the picker group label and its drop once connected, the Subscriptions row with its chat-key action and the single listing of the name; `roster-lifecycle.host.spec.ts` reads the `terminal` row off the real route and drives `cliInstalled` with a present name, an absent one and the refused shapes. The `packaged-window-proofing` walk for C6a is in `idealize-desktop/.idealize/proof/c6a-2026-08-30`.
