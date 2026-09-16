# Agent Note: a generating brain composes the generation toolset, and five smaller rulings from JJ's second 7 Sep review

Status: implemented

JJ, 7 Sep 2026, on the first landing-9 build: "sound generation not working"; "video gen incorrectly trying to use higgsfield - should be fal"; "drop down not needed in brains - just choose model in edit"; "remove 'free' from the terminal brains - as there's no free one"; "skip the brain selection if there's only one brain"; "kimi isn't logging in via the connection screen".

## Problem

**A Video brain added from the Brains pane carried the standard tool set.** `POST /idealize/activity/agent` derived every new brain from the shipped `standard` preset whatever spaces it was placed in, so JJ's `video` preset composed bash, the filesystem, skills, subagents and the web, and no `@idealize/gen-tools/tools` row. In a Video chat the model had no generate_video tool, found a Higgsfield skill under `~/.agents/skills`, and tried its CLI. The space table already declared `composition: 'media'` for the three generating spaces; nothing read it on create, and Motion had no seeded agent of its own.

**fal.ai's music endpoint wants a field the seam never sends.** `minimax/music-3` requires `lyrics` beside `prompt` (its OpenAPI: `required: ["prompt","lyrics"]`). The queue adapter sent the prompt alone and every Sound Stage generation on that model ended in `fal.ai refused the audio generation (422): lyrics: Field required`.

**Kimi Code signs in with a device code, and the sign-in surface only knew browser URLs.** pi-ai's Kimi Code flow raises one `device_code` event (a verification URL carrying the code, plus the code) and never an `auth_url`. `IdealizeOAuth` recorded `auth_url` alone, so the page waited fifteen seconds and reported "login surfaced no authorize URL".

**Three pane and card behaviours JJ ruled against.** Every Brains row carried an inline model picker although the Edit sheet asks the same question. Free, a chat route on the free-tokens engine that no CLI plays, was listed under Terminal because `presetSpaces` gave every non-role preset `['chat', 'terminal']`. The welcome card asked "which brain" of a space that has one.

## Decision

**The space's composition follows the brain's spaces.** `@idealize/gen-tools` exports `mediaCompositionFor(spaces, name, instructions)`: for spaces that all generate, the generation-only composition (persona, `@idealize/gen-tools/tools`, `dsh-tool-jobs`) with the person's instructions as persona or, when empty, a default persona assembled from the brain's name and the duty sentence of each space's media agent ("You create video from the user's prompts with the generate_video tool; …"). `isGenerationOnlyComposition(text)` names the other half. `@idealize/activity-pills` uses both: on create, a brain placed in generating spaces alone gets the media composition; on save, a media-bound brain whose composition carries other tools is rewritten, and a generating brain moved to Chat or Terminal derives from `standard` again, instructions kept either way. A startup repair pass rewrites any user-root preset whose spaces all generate and whose composition is not generation-only, logging each one, so JJ's existing `video` preset is fixed on the next start without a hand edit. `MEDIA_AGENTS` gains a third row, `video`, and Motion's table row names it as `agentPreset`, so a fresh install seeds a Video brain like Gallery and Sound Stage.

**A required field fal names is filled once, from a table of what its absence means.** `REQUIRED_FIELD_DEFAULTS` in the queue adapter holds `lyrics: '[instrumental]'`. When the enqueue answers 422 and every `Field required` entry names a field absent from the body and present in that table, the adapter enqueues once more with those fields; any other 422, and a second one, refuse as before. generate_audio gains a `lyrics` parameter so a model asked for a song can send real lyrics, which pass through to the body unchanged.

**The sign-in surface records a device code as the page to open.** `noteAuthEvent` settles `authUrl` from `auth_url` or from `device_code`'s verification URL, keeps the user code on the attempt, `status()` reports it while pending, and the page shows "If the page asks for a code, enter …" and polls for the device flow's fifteen-minute expiry rather than five minutes.

**Brains rows state the model as text; the Edit sheet chooses it.** The chat-model select and the media picker leave the row (`data-brain-model` carries the text); the Terminal row keeps its CLI select because that decides which CLI the shell types, not a model. The sheet's `data-brains-model` and `data-brains-chat-model` selects are unchanged and carry the alphabetical order.

**Free is Chat-only.** `CHAT_ONLY_PRESETS = ['free']` in the space table; `presetSpaces` returns `['chat']` for it before any stored list, so a stored list cannot put it back in Terminal. Chat lists five brains, Terminal four.

**A tile with one reachable brain starts it.** In the welcome card a tile click launches when the space has exactly one brain, models serve the space, and that brain's row would start the chat (Terminal, or access not `unavailable`); the card carries `data-launcher-autostart` during the round trip and falls back to step 2 when the host refuses. A single brain that waits on a key or a sign-in still gets step 2, which is where the reason and the way out are stated.

## Alternatives considered

**Send `lyrics` on every audio request.** Endpoints that do not take it might refuse an unknown field, and the seam would be guessing at every music model's vocabulary. Filling only what a 422 names, from a table, sends nothing an endpoint did not ask for.

**Read each fal endpoint's OpenAPI input schema into the catalogue.** The right long-term shape: the catalogue would know required fields before the first call. It changes the cache format and adds a fetch per model; deferred until a second required field appears.

**Fix the Video brain by hand on JJ's disk.** Every other install that added a brain in a generating space carries the same composition; the repair pass fixes them all and the create and save paths stop producing them.

**Sort the Terminal CLI select as well.** It renders the catalogue's order (Claude Code, Codex CLI, Plain shell); sorting would put Plain shell mid-list. Left for JJ to rule on.

## Consequences

An install holding `gallery` and `soundstage` but no Video brain does not gain the `video` preset: seeding still skips when any media agent is present (the deletion rule), and the tile offers to add one. A brain in a generating space now has no shell or filesystem tool; a person who wants a chat that also generates keeps it in Chat, where the standard composition applies and no generation tool exists — generation is a space, per JJ's rule that the space owns the tools.

The packaged walk driver reads the sort claim off the Edit sheet, enters a single-brain space from its tile, and expects four Terminal brains; the fal retry cannot be walked keyless and rests on the scripted 422 in `queue-adapter.spec.ts`, which matches JJ's error text and fal's schema.

Tests: `services/tests/queue-adapter.spec.ts`, `gen-tools/tests/presets.spec.ts` and `gen-tools.spec.ts`, `spaces/tests/space-table.spec.ts` and `roster.spec.ts`, `gen-fixture/tests/agent-composition.host.spec.ts`, `ui-bar/tests/brains-panel.client.spec.tsx` and `hero-launcher.client.spec.tsx`, `provider-pack/tests/auth-events.spec.ts`.
