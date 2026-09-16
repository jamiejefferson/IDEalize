# Agent Note: Wave C2 — why generation never ran, and what the brain surfaces now say

Status: implemented

The second slice of JJ's 28 Aug review (plan: `.idealize/plans/feedback-wave-c-plan.md`). JJ's four generation items ("image gen isn't working", Sound Stage's missing default, Motion's misleading copy, "models don't seem to be filtered") and the first slice's follow-up land here. Every change is in `packages/idealize/*`; no upstream file is touched.

## Problem

JJ's session logs (`session.jsonl.zstd` under the app's data directory) show that no `generate_image` call ever ran. Every Gallery, Sound Stage, Design and Admin chat failed at its first turn with `MISSING_CREDENTIAL` for `deepseek-official/deepseek-v4-flash`: the deployment default route, with no `DEEPSEEK_API_KEY` stored (the credentials file holds the OpenRouter and free-tokens keys only). Four faults let the app offer those chats anyway:

- `@idealize/activity-pills`' `reachable()` returned true for the default model's own provider without checking a credential, so `/idealize/activity/models` reported Design and Admin `ready`, and nothing assessed the non-activity brains (Gallery, Sound Stage) at all. The launcher listed every brain as startable.
- A non-activity brain's stored model was never applied on launch: the launcher and the brain switcher selected the preset only, so the chat ran on the deployment default whatever the Brains pane showed.
- The Brains pane's inline picker offered the chat catalogue to every brain, while the edit sheet already narrowed a brain confined to one generating space to that space's candidates. JJ had filed a text model against the Gallery brain through the inline picker.
- Motion's refusal read "No connected provider offers a compatible video model. Add an OpenRouter API key to check again", with an Add OpenRouter key action, while the key was stored. OpenRouter's catalogue lists no text-to-video model; the copy and the action were wrong, the gap is real.

Sound Stage had four compatible audio models and none stored. `generate_audio` already falls to the first compatible candidate with a rerouting notice, so the only fault was a UI that said "Choose a model" as if a generate call would fail without one.

## Decision

**Reachability has no default-route shortcut.** `reachable(provider, llm)` answers from the OAuth store or a resolvable credential only. A deployment default with no stored key now reads `no-access`, which is what its first turn would have said.

**Every editable brain carries `access` on `GET /idealize/activity/agents`**, assessed by the same `assessPills` the activity route uses. The launcher reads it through a new `LauncherSpaces.access` read; a brain marked `unavailable` renders its reason in place of its model ("No key for deepseek-official yet. Add one to start here.", `data-brain-access`) and its row opens the key editor instead of launching. The Brains pane marks the same rows with an Add key chip. The reason for marking rather than hiding: the brain exists and the fix is one key away; hiding it would repeat the "why is my brain gone" question the roster's field split was designed to avoid.

**A non-activity brain's roster model is applied on launch and on a blank-chat switch.** `selectBrain` in `@idealize/ui-bar` and `recompose` in the activity-pills client both follow `agentPresets.select` with `sessions.selectModel` when the brain has a model, because the preset carries none.

**A brain confined to one generating space picks from that space's candidates**, saving through `/idealize/brains/media`. Its chat model, the one that drives its generation tool, is its own override, asked as a second field in the edit sheet; the inline generation picker leaves it alone (the original clearing rule was reversed on 7 Sep 2026, see [the bug-fix note](../bug-fix/2026-09-07-brains-sorted-one-coordinator-and-a-way-off-an-unsigned-route.md)). The space's own row (Images, Sounds, Video) renders only while no brain carries its picker, so a group never shows the same picker twice. The picker's empty option reads "Default · <first candidate>", naming the model `gen-tools` falls to, so Sound Stage works on first use and says which model it will use.

**The generation verdict says whether a key is what is missing.** `GenerationAvailability`'s `no-compatible-model` carries `keyMissing`: true when every registered backend describes itself as `no-credential`, false when connected backends offer nothing for the artefact. The recovery sentence follows it ("Store the provider's API key…" or "No connected provider offers video generation yet."), the roster passes `keyMissing` through, and both the launcher and the Brains pane offer Add OpenRouter key only when it is true. The localised sentences drop their "Add an OpenRouter API key to check again" tail; Video's reads "No connected provider offers a video model. Video generation waits until one does." Motion ships with no provider, and the surface now says exactly that.

## Alternatives considered

- **Keep the default-route shortcut and store a DeepSeek key for JJ.** The key is JJ's to add; the shortcut was a false report whoever the user is. Rejected.
- **Assess access on the spaces roster instead of the agents route.** The roster is `@idealize/spaces`' host read and cannot see activity-pills' credential facts without a new seam; the agents route already resolves each brain's model. The launcher joins the two reads by preset id.
- **Hide unavailable brains from the launcher.** Rejected for the reason above: the roster's contract is that the brain step explains.
- **Keep both pickers (brain row and space row) in a generating group.** Two controls bound to one stored value read as two decisions. The space row stays for the empty group, where it is the only way to set the space's model.
- **Store a default sound model at seed time.** The tool's first-candidate fallback already gives the same result without writing a choice the user never made; the placeholder states it.

## Consequences

`hero-launcher.client.spec.tsx` pins the blocked row and the no-key-action refusal; `brains-panel.client.spec.tsx` pins the confined picker, the "Default · Tone A" placeholder, the access mark and the `keyMissing` gate; `generation.spec.ts` pins both `keyMissing` verdicts; `roster.spec.ts` the passthrough; and `roster-lifecycle.host.spec.ts` now composes `@deepseek-ai/dsh-credentials-local` (the activity routes register only with a credential store) and asserts `access` on a real composition. `packages/idealize/spaces/proof/roster-with-backend.json` is regenerated for the new sentence.

Applying a brain's model on launch goes through `sessions.selectModel`, which ApiProxy also saves as the deployment default (`saveDefaultModelSelection`). The activity controller and the brain switcher's started-chat path already did this, so a Gallery launch now moves the default the same way a Design pick does; for JJ that means the first Gallery launch flips the default from the keyless DeepSeek route to the signed-in ChatGPT model, and the default-route brains read `ready` from then on. The packaged proof resets the default before its walk for that reason.

A brain the user cannot start now says why before the chat opens. What it does not do is add the key: that stays the provider editor's job, one click away from the row. JJ's stored `gallery` text-model override remains until the Gallery brain's picker is next touched, which clears it.
