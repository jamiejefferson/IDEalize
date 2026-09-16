# Agent Note: the welcome card offers four ways to start

Status: implemented

The way-to-start ROW this note designed is superseded by [the two-step chooser](2026-08-26-welcome-card-space-then-brain.md): the roster is declared rather than derived from the view ring, and the launch is two questions rather than one pill press. Everything else here remains current — the `data-blank-view` rule, the retired hero chrome, the composer seat the column-owning view suppresses itself, the restated view switch in `view-switch.ts`, and the reason a media launch never goes through the pill verb.

## Problem

The welcome card's way-to-start row offered Chat and Terminal. `@idealize/ui-gallery` and `@idealize/ui-soundstage` had landed as conversation view-ring entries with no way in from the card, and `@idealize/gen-tools` seeds a `gallery` and a `soundstage` media agent that nothing selected. MOD-01/MOD-02 of the multi-activity plan ask for one row with four entries, each starting a chat whose prompts still go through the ordinary composer (AC-05/AC-06).

Two facts shaped the work. The pill `select` verb also writes the roster default, so reusing it for a media agent would make Gallery the agent every future chat opens on. And `ui-conversation` retired the composer seat for **every** blank chat sitting on a non-chat view — right for the terminal, which carries its own input, fatal for two modes whose only way to submit is that composer.

## Decision

**The row is built from the conversation view ring.** `HeroLauncher` takes a `media` face listing which of `gallery`/`soundstage` the ring serves and subscribing to that set; a segment renders only when its view exists, so a composition without a media package shows no dead choice and a mode whose view leaves the ring falls back to Chat. Terminal keeps its own capability probe (the desktop shell is a different question from registration). Each media id names the ring entry AND the seeded preset, so one value cannot drift between the view and the agent.

**A media launch selects the media agent directly, not through the pills.** `@idealize/ui-bar` calls `api.agentPresets.select` for the launched chat and publishes it with `sessions.noteAgentPreset` — the blank-session half of the pill controller's work, without its `settings.update({ default })`. The clicked activity pill is the launch button; in a media mode the media agent replaces it, because a media agent composes only the generation toolset. The card then LANDS (chooser retires, composer revealed) rather than staying undecided as the terminal launch does.

**The view switch is restated in `ui-bar`.** `view-switch.ts` resolves the chat entry's per-session store through `hostFace().storeOf` and writes `view` — the same write `terminalMode.open` performs. The media view packages publish no service and the client bundle purity gate forbids importing their value exports, so the mechanism is restated rather than shared. If upstream exposes a public per-session store resolver, both copies move onto it.

**Upstream publishes which view took the column; the column-owning view suppresses the composer itself.** `ConversationSession` now writes the active view's id into `data-blank-view` (was an empty marker). `ConversationRoot.module.css` retires the hero CHROME — the glow and the shell, which gained a `data-hero-shell` hook because the rule cannot reach a hashed class in another sheet — and leaves the composer seat mounted. `@idealize/ui-terminal` hides the seat from its own stylesheet on `[data-blank-view='terminal']`. Naming plugin ids in upstream CSS is what fork discipline forbids, so upstream states the fact and the plugin decides.

## Alternatives considered

**Reusing `pills.select` for the media preset.** Rejected: it writes the roster default and is guarded by a single `busy` flag, so it would both hijack every future chat's agent and drop one of two chained calls.

**Deferring the ring switch until the chat starts, leaving upstream untouched.** Rejected: picking Gallery would land the user in a plain chat, which is not "start in the Gallery". The upstream rule was written for one view and had to learn there are three.

**Keeping the composer for every blank non-chat view.** Rejected: it would put a composer under the embedded terminal, a visible change to a shipped surface nobody asked to change.

**A `keepsComposer` registration option on `conversation.view`.** Rejected for this slice: slot register options are a fixed set in `dsh-client-ui-slots`, so the seam would widen the framework for one CSS decision.

## Consequences

The row grows to four segments at 1280 and wraps inside the card at narrower widths (`flex-wrap` on the toggle). The activity pills are unchanged. In a media mode the pill row shows no pressed pill after landing, because the chat's agent is the media one — honest, and the header's agent label says which. `ui-bar` now injects `connection` for the preset write.

The proof this note shipped drove a booted app at 1280×840 in both themes: the four-segment row; a Gallery launch landing on the Gallery ring tab with the Gallery agent and a live composer; the same for Sound Stage; a Terminal launch still retiring the composer; and the row at 900px. It retired with the row it photographed; the launch-and-landing half of it lives on in `packages/idealize/ui-bar/proof/welcome-spaces-proof.mts`.
