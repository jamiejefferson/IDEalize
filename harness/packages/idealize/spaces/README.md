# @idealize/spaces

The space vocabulary and the durable record of which space a chat is in.

A space is what a chat **is**. Six are declared, in chooser order, the last one unlaunchable:

| Space | Ring entry | Composition | Agent preset | Capability |
|---|---|---|---|---|
| `chat` | `chat` | `standard` | whichever brain the user picks | none |
| `terminal` | `terminal` | `standard` | whichever brain the user picks | none (needs the desktop shell) |
| `gallery` | `gallery` | media | `gallery` | `images` |
| `soundstage` | `soundstage` | media | `soundstage` | `sound` |
| `motion` | `motion` | media | `video` | `motion` |
| `studio` | `studio` | `standard` | none (`launchable: false`) | none |

Display names and ids differ for the media spaces: `gallery` shows as “Images”, `soundstage` as “Sounds” and `motion` as “Video” (the `launcher.*` locale keys); ids, preset names and session logs keep the original words. Each generating space names the media agent `@idealize/gen-tools` seeds for it (`video` for Motion since 7 Sep 2026), and `composition: 'media'` is what makes a brain confined to these spaces compose the generation toolset only (`@idealize/activity-pills` applies the rule; `@idealize/gen-tools` states it). The table is **declared, not derived from the `conversation.view` ring**. The chooser offers every space as an ordinary tile with its brain count; every reason and recovery lives on the brain step, never on a dimmed tile. Every id equals the ring entry id that renders it, so the ring is seeded from a space with no translation table — Motion included since 4 Sep 2026, when `@idealize/ui-gallery` gained the Video grid. The ring keeps rendering; this package owns the fact. `studio` is a project's one group chat (`@idealize/ui-studio` renders it; `@idealize/ui-bar`'s pinned Studio card opens it, minting the chat the first time): it is declared so the record, the ring seed and the sidebar lane know it, and marked `launchable: false` so the chooser, the roster and a brain's space list never offer it — a launch tile would mint a second Studio for the project. `LAUNCHABLE_SPACES` / `LAUNCHABLE_SPACE_IDS` are the subset every chooser reads.

## The durable record

The ring's `view` field lives in the browser's `localStorage`, so it is per-machine, wiped with site data, and invisible to the host and the sidebar. The space is therefore a session event.

- `idealize/space` `{space}` — the chat's space. Latest wins.
- `idealize/brain` `{brain, instructions?}` — the agent preset the chat runs and the standing instructions sent with every message it handles. The instructions reach the model, which is why they are logged.

Both are appended with the envelope's `ignorable` marker and both join `KNOWN_SESSION_EVENT_TYPES` through `pnpm run gen-persistence-catalog` in the same change that first appends them. A build without this vocabulary reads the log and resolves the chat's space through the ladder below rather than refusing it.

Projections: `space` (always present — see the ladder) and `brain` (absent until one is recorded).

`POST /idealize/spaces/select` `{sessionId, space, brain?, instructions?}` records both. Loopback-only and gated on `x-idealize-auth: 1`. An event whose value already matches the log is skipped, so re-entering a space does not grow the log.

## The brain's instructions reach the model

`installBrainPrompt` is the reader that makes the logged instructions model-visible. It listens on `system-prompt/assemble` unscoped, so it sees every agent's assembly, and it **replaces** the `deployment:persona` section rather than adding one of its own.

Replacement, because the preset still mounted for the chat contributes the OLD brain's persona. Two personas in one prompt is both brains at once, not "the brain owns the instructions".

Which of the two logged facts wins is the whole rule, and `brainPersona(session)` is all of it:

| Logged brain vs. resolved agent preset | What is contributed | Why |
|---|---|---|
| no brain recorded | nothing | the composition speaks, as it always did |
| they agree | nothing | the welcome card's launch and a blank-chat switch both recompose the preset, so its own persona row is already this brain's voice |
| they differ, instructions non-empty | that text, in the persona slot | a started chat cannot be recomposed, so the log is the only statement of the brain's voice |
| they differ, instructions `''` or absent | an empty persona slot | a brain with no voice silences the old one; the section renders to nothing rather than to an empty heading |

The resolved preset comes from `resolveSessionPreset` — `agent-preset/selected`, else the creation header — so **both facts are in the log** and the prompt is reconstructable from it alone. A preset whose persona is declared `complete` keeps the whole prompt, because the registry restores a complete section after this waterfall.

Assembled proof: [`tests/brain-instructions.snapshot.ts`](tests/brain-instructions.snapshot.ts) runs two turns on one chat with a real `POST /idealize/spaces/select` between them, pins the second turn's assembled prompt ([`system-prompt.expected.md`](tests/brain-instructions-snapshots/switch/system-prompt.expected.md)), then resumes the same persisted log in a fresh process and rebuilds the same prompt.

## The roster both welcome steps read

`GET /idealize/spaces` serves one entry per launchable space (never Studio), in chooser order: `{ id, brainCount, brains, models: 'some' | 'none', reason?, recovery?, keyMissing? }`. Loopback-only, no auth header, because it reads.

**The field split is the product invariant: the space chooser offers, the brain screen explains.** A tile reads `id` and `brainCount` and nothing else, so no tile is ever dimmed, disabled or dropped — Motion with no brains and no backend is an ordinary tile reading "No brains yet". `brains`, `models`, `reason` and `recovery` exist for the second step alone: the brains it lists, and the refusal stated once with the way forward. One fetch serves both screens, so the two cannot disagree. A surface that renders `reason` or `recovery` on a tile breaks the rule this payload exists to enforce.

`brains` is `brainCount` long, in roster order, each entry `{ id, name, model?, default? }`. `model` is the brain's own override; a brain without one follows the deployment default, which the row states rather than naming a model the user never chose. `default` marks the brain a space starts on: the agent the space declares (Gallery, Sound Stage), otherwise the roster default when it works there, otherwise the first brain listed.

`brainCount` counts the brains on the agent preset roster that `presetSpaces` places in the space. A brain is a preset from a `user`-trust root — one the app seeded or a person authored. The `system` root ships with the deployment and holds `standard`, the composition every seeded brain derives from, alongside the other read-only presets the install carries; none of them is a brain, `/idealize/activity/agents` already keeps them out of the Brains pane, and counting them would put a number on a tile that no screen can account for. `models` answers whether a model can serve the space from this surface:

| Space | Source | `models: 'none'` reasons |
|---|---|---|
| `chat` | the deployment default model, the free route's first model, or a brain's own model override | `no-model` |
| `terminal` | the same, plus the desktop shell the space runs in | `no-model`, `desktop-only` |
| `gallery`, `soundstage`, `motion` | `ctx.generation.availability()` for the space's `MEDIA_PRESETS` capability; its `keyMissing` passes through so the brain step offers a key action only when a key is what is missing | `no-backend`, `no-compatible-model` |

The generation service is optional here: `ctx.get` probes for it, and its absence reads as `no-backend`, the same answer as a composed service with no backend registered. The media reasons and recoveries come from the generation seam unchanged, so the brain step states what the Brains pane already states.

The terminal's brain step is why a declared roster does not hide rows. A plain browser used to have no Terminal segment at all, because `@idealize/ui-terminal` registered no ring entry outside the desktop app. The tile now shows with its brain count, and the brain step reads `desktop-only` and says where the terminal runs.

Captured payloads from a real composition, with a fixture generation backend mounted and with none: [`proof/roster-with-backend.json`](proof/roster-with-backend.json) and [`proof/roster-no-backend.json`](proof/roster-no-backend.json), produced by [`proof/space-roster-proof.mts`](proof/space-roster-proof.mts).

Two rendered proofs drive the assembled app: [`proof/tab-row-gone-proof.mts`](proof/tab-row-gone-proof.mts) (no tab row, each space's composer chrome, the space durable across a `localStorage` clear) and [`proof/launch-follow-ups-proof.mts`](proof/launch-follow-ups-proof.mts) (the composer names the launched brain at once and after a reload, New chat mints a chat rather than reopening a launched-but-unsent one, and a blank chat carrying an older space names its new brain when relaunched).

## The space icons

Six SVG files, one per space id, live at [`assets/icons/`](assets/icons/) (`chat.svg`, `terminal.svg`, `gallery.svg`, `soundstage.svg`, `motion.svg`, `studio.svg`), each a 24×24 viewBox from [Tabler Icons](https://tabler.io/icons) outlines (`message-circle`, `terminal-2`, `photo`, `music`, `movie`, `messages`; MIT, notice in [`assets/icons/LICENSE`](assets/icons/LICENSE)) at stroke 1.25 in `currentColor`, the size and weight JJ chose on 8 Sep 2026 after rejecting the filled owl-style drafts (review item 9, second round). `GET /idealize/spaces/icons/<space>.svg` serves each as `image/svg+xml` with a content length; the path resolves to a space by table lookup (`iconSpace`), so any other path under the prefix answers 404 and no request text reaches the filesystem. Loopback-only, no auth header, because it reads. The response is `cache-control: no-cache` with an ETag and a 304 on match, so a rebuilt draft shows at once and a repeat load costs no body. `spaceIconSrc(id)` on both faces names the URL; every surface that shows a space (`@idealize/ui-bar`'s launcher tiles, brain chip and Studio card, `@deepseek-ai/dsh-client-ui-workspace`'s sidebar lane) applies the file as a CSS mask over `currentColor` (`mask: url(…) center / contain no-repeat` on a `background-color: currentColor` square), sized by the caller: 24px on a launcher tile, 18px in the brain chip, on the Studio card and in the sidebar lane. A mask, because an `<img>` cannot take the tile's hover colour or the chip's brand blue. The files and the notice ship in the packed tarball through `files`.

## Chats made before spaces existed

Derived, never backfilled — nothing is written into an existing log. `deriveSpace` runs three branches, newest evidence first:

1. an `idealize/space` event → that space;
2. else the agent preset `gallery` → Gallery, `soundstage` → Sound Stage, `video` → Motion;
3. else Chat.

Terminal is deliberately underivable. The pre-spaces terminal launch wrote nothing durable, only the browser store, so a legacy terminal chat reads as Chat. Guessing from `localStorage` would be per-machine and would make the sidebar disagree with itself across devices.

`resolveSessionSpace(session)` runs the ladder over a whole session, so the creation header's preset counts too. The `space` projection folds the log alone: it recognises a media chat by its logged `agent-preset/selected`, which is the only way the product's media launch reaches a media preset.

## Which spaces a brain works in

`presetSpaces(presetId, rolePresets, stored?)` answers it. The user's own answers live in the `spaces` map of the `idealize-activity-pills` settings section, beside the `models` map that holds every model choice — a sibling key, because `settings.update` merges. A `CHAT_ONLY_PRESETS` id (`free`) works in Chat whatever is stored: the free-tokens route is a chat route and no command-line agent plays it in the terminal, so listing Free there offered a brain the terminal could not start (JJ, 7 Sep 2026). Without a stored list the default computes: a media agent preset works in its own space, an agent-role preset works in none, and every other brain works in Chat and Terminal. A stored list is read back through the launchable spaces only, and the agents route refuses `studio` in a brain's list.

Decision record: [.agents/notes/implemented/architecture/2026-08-26-idealize-spaces-vocabulary.md](../../../.agents/notes/implemented/architecture/2026-08-26-idealize-spaces-vocabulary.md).

## Model Experience

### The logged brain's instructions in the persona slot

#### What the model sees

When a chat's latest `idealize/brain` event names a brain other than the agent preset the composition resolved (`brainPersona`, the table above), the `deployment:persona` section of every assembled system prompt carries that event's `instructions` text in place of the mounted preset's persona row; instructions of `''` or absent render the section empty. The text is whatever the user typed in the Brains pane's instructions field, so nothing stable is quoted here; the pinned prompt lives in [`tests/brain-instructions-snapshots/switch/system-prompt.expected.md`](tests/brain-instructions-snapshots/switch/system-prompt.expected.md).

#### Token effect

Replacing: the old persona's tokens leave and the new instructions' tokens take their place, on every request after the switch. A chat whose logged brain agrees with its preset, or has none logged, pays nothing here.

#### KV Cache effect

Replacing: a brain switch on a started chat rewrites the system-prompt prefix from the persona section onward, so the first request after the switch cannot reuse the earlier prefix. Requests between switches are prefix-stable.

## Known Limitations and Deferred Work

- **The brain owns the model and the instructions, not the tools.** A started chat keeps the toolset its preset composed (`agent-preset-locked`), so a brain whose composition differs in tools behaves as its space's toolset with the brain's voice; only a blank chat is recomposed on the brain.
- **Motion's grid is `@idealize/ui-gallery`'s, not its own package.** The `motion` ring entry is registered by the Gallery plugin over the same per-chat generation source, filtered to video. A composition that mounts the spaces table without `@idealize/ui-gallery` therefore declares a Motion tile whose ring entry never appears, and a Motion chat there lands on the Chat view.
- **Terminal is underivable for legacy chats.** A terminal chat launched before `idealize/space` existed reads as Chat everywhere the ladder runs; only a new record moves it.
