# @idealize/activity-pills

The five Chat and Terminal brains (Coding, Design, Writing, Admin, Free) and the composer's brain switcher; the pill row that once chose an activity at chat start is gone (the new-chat card chooses a space, then a brain — `@idealize/spaces`), and the name `activity-pills` is the package's history, not its surface. Each activity brain is an agent preset: a named composition (tools + persona) with a model the host maps to it. The host half seeds the five presets and serves their model, availability and edit routes; the client half owns the composer's More settings panel (`conversation.input.access`), where the **brain switcher** lists the brains that work in THIS chat's space, the current one marked; the shipped model dropdown stays on the row and reads the chat's model. `/model` remains for a manual pick. The `idealize-activity-pills` row in `@idealize/bundle-idealize` mounts both halves.

The welcome card (`@idealize/ui-bar`'s `HeroLauncher`) is the other surface that selects an activity brain; it does so through this package's `activityPills` service, so the free-tokens route and the roster default have one owner.

## What selecting an activity brain does

| Chat state | Effect |
|---|---|
| Blank chat (no turn yet) | Recomposes the chat on that preset (`agentPresets.select`), then selects the brain's model (`session.selectModel`; the preset carries none, so without the write the first turn would run on the deployment default), and sets it as the roster default for new chats. |
| Started chat | Changes the chat's model only (`session.selectModel`); the preset stays. Also sets the default for new chats. |
| Any | Free additionally switches the model policy to auto (`POST /idealize/models/mode`). |

`ActivityPillsController` (`src/client/pills-store.ts`) applies this table. The brain switcher routes an activity brain through it and writes every other brain (a media agent, a user-authored one) for the current chat alone, so a Gallery agent never becomes what new chats open on.

## The composer's overflow control (`conversation.input.access`)

The tool row's three-dot button opens a panel holding the two settings that belong to the chat rather than to the work in front of the user: the project's access mode and this chat's brain. The composer owns the access chip and hands it in as `control` on the seat; this package only decides where it goes. Both sat on the row as chips at opposite ends until 9 Sep 2026, which left a media space's row reading as one undifferentiated line of controls beside the space's own settings.

The trigger carries `data-composer-overflow-trigger` and the panel `data-composer-overflow-panel`. The panel closes on a pointer landing on the page, and stays open for a pointer inside a menu one of its own controls opened (those portal to the body, outside the panel's subtree). A removed session shuts it and refuses the trigger.

## The brain switcher (the panel's Brain row)

**The space owns the tools; the brain owns the model and the standing instructions.** A started conversation's history was produced under its preset's tools, so the host fixes that preset for the life of the chat (`agent-preset-locked`). Switching brains mid-chat therefore never recomposes: it writes the session's model and records the brain in the log.

| Chat state | Effect of choosing a brain |
|---|---|
| Blank chat | Recomposed on that brain, exactly as the welcome card's brain step does. |
| Started chat | `session.selectModel` to the brain's model, then `POST /idealize/spaces/select` records `idealize/brain` with the brain's standing instructions. The tools stay as they were. |
| Terminal space | A brain whose launch command or provider differs also restarts the shell, through `terminalMode.restart` (`@idealize/ui-terminal`). |

The menu reads three routes: `GET /idealize/spaces` for the brains of this chat's space and the default mark, `GET /idealize/activity/agents` for each brain's resolved model and instructions, and `GET /idealize/terminal/launches` for the commands a fresh shell types. The chat's space and current brain come from the `space` and `brain` session projections (`@idealize/spaces`). The trigger carries `data-brain-switcher`, `data-space` and `data-brain-current`; each menu row carries `data-brain`.

**The trigger names a brain of the space, or nothing.** `resolveCurrentBrain` takes the recorded brain when the space offers it, then the chat's preset when the space offers that, and otherwise the space's own default — the brain a launch into that space lands on. Both fallbacks earn their place during a launch, which changes the chat's space, its preset and its recorded brain over separate frames: for a beat the log names the brain the chat is leaving while the summary names the preset it was created on, and neither is what the chat runs. The rendered label is that brain's display name, never its preset id, and the control renders nothing while no brain of the space is current. Reads are not coalesced either: each `load()` carries a token and only the newest writes the snapshot, so a superseded answer cannot stand.

**What a switch costs is stated in the row, before the click.** In the Terminal space a brain that would replace the running shell reads "restarts the shell"; a brain with no standing instructions reads "No instructions"; every other row names the provider it runs on. Choosing a restarting brain asks first: a title, the line "The terminal restarts. You may lose some context.", and Cancel / Continue. Cancel writes nothing at all. The composer's `conversation.input.dock` seat carries nothing from this package; the switcher is the only brain control on a started chat.

## Seeding

Host half. On boot, when the roster holds none of the five ids, each preset is written to `$DSH_HOME/.agent-presets/<id>/` as a copy of the shipped `standard` composition with the persona replaced, plus `preset.yml` metadata. An existing id is never overwritten, so a deleted brain stays deleted.

## The space owns the tools

A brain whose every space generates (Images, Sounds, Video) composes the generation toolset only — `mediaCompositionFor` from `@idealize/gen-tools`: a persona row, `@idealize/gen-tools/tools`, and `@deepseek-ai/dsh-tool-jobs`, with no shell, filesystem, web or delegation rows. A brain that works in Chat or Terminal derives from the shipped `standard` preset. The rule is applied at three points:

| When | What happens |
|---|---|
| Create (`POST /idealize/activity/agent` without `id`) | The brain's spaces are the submitted `spaces`, else `presetSpaces`' default for its id (so a brain named "Video", whose id is Motion's `agentPreset`, lands in Video). All generating → `mediaCompositionFor`; otherwise the `standard` copy. Empty instructions take the default persona for the spaces: the media one, built from the name and the spaces' duties, or the one-line standard persona. |
| Save (with `id`) | The brain's spaces are the submitted `spaces`, else its stored list, else the default. Moved into generating spaces with a composition that is not generation-only → rewritten with `mediaCompositionFor`, instructions kept. Moved out of them with a generation-only composition → derived from `standard` again, instructions kept. Otherwise the composition stays and only the persona row changes. |
| Startup, after seeding, before the repair | `retiredRolePresetsToRemove`: a preset on `RETIRED_ROLE_PRESETS` (`lead-agent`) with no stored space list is deleted through `agentPresets.remove` and one `info` line names it (`removed the retired role preset "<id>"`). JJ, 7 Sep 2026: "remove the lead agent row". A retired preset the person placed in a space has a stored list and stays as their own brain. |
| Startup, after seeding | `repairGeneratingBrains` over every editable preset: one whose spaces all generate but whose composition is not generation-only (`isGenerationOnlyComposition`) is rewritten with `mediaCompositionFor`, keeping its persona, and one `info` line names it (`repaired preset "<id>": it works in <spaces> only, so its composition now carries the generation toolset alone`). A repaired preset is generation-only, so the next start writes nothing. This is what fixed a Video brain created before Motion had an agent (JJ, 7 Sep 2026), without a hand edit. |

## Routes (loopback; mutations need `x-idealize-auth: 1`)

- `GET /idealize/activity/models` → `{ models, pills, surface }`. `models[id]` is the `{provider, model}` an activity brain selects on a started chat (null when nothing resolves). `pills[id]` is `{ model, state, reason? }` with `state` one of `ready | confirm | unavailable`; the field keeps the name the payload has always carried. `surface` is the last shell report.
- `POST /idealize/activity/surface` `{ kind: 'chat' | 'terminal', provider? }` → the shell reports where the user is working. Default `chat` until reported.
- `GET /idealize/activity/agents` → `{ agents }`: every preset under the user root with `name`, `activity` (one of the five), `modelPinned` (the free-tokens route resolves its model, so a surface states the model rather than offering a picker), `spaces` (which spaces the brain works in, from `presetSpaces` over the `spaces` setting, so a preset the user never placed reads as its computed default), `model` (the selection it resolves to, null when nothing does), `access` (the model's availability, as the states table below decides it), `providerName` (the route's display name, present when the sign-in surface offers the route), `overridden` (a `models` entry names it) and `instructions` (the composition's persona text). The Brains pane groups these by `spaces`. Alongside, `terminal`: one row per terminal-only route with the `cli` that serves it (`terminalCliByProvider`) and `installed`, whether the user's login zsh resolves that name (`command -v`, probed at most once a minute; null where the probe cannot run), so the pane can say which brains run as a CLI in the terminal and whether the CLI is present.
- `POST /idealize/activity/agent` `{ id?, name, model, instructions, spaces? }` → edits the named preset, or creates one when `id` is absent (id = the hyphenated name), composing from `source` or from the generation toolset by the brain's spaces (the table above). `name` lands in `preset.yml`, `instructions` replace the persona row, and `model` (`{provider, model}` or null for the default) lands in the `models` setting. `spaces` lands in the `spaces` setting: an array of declared space ids (`[]` = an agent role, in no space), refused with 400 for anything else, and **absent leaves the stored placement untouched**, so saving a name or a model never moves a brain between spaces. Shipped presets are refused.

## Availability states

Decided by `assessPills` (`src/availability.ts`, pure, unit-tested) from three facts.

| Fact | Source |
|---|---|
| Route reachable from the chat | A provider listed in the OAuth store (`idealizeOAuth`), or an API key resolvable through `credentials` (the profile's `apiKeyEnv`, else `config.apiKeyEnvByProvider`). The deployment default's route gets no shortcut: with no stored key its first turn fails with a credential error. |
| Surface | The shell's last `POST /idealize/activity/surface`. |
| Terminal available | `desktopActions.openTerminal` is composed (desktop app only). |

| State | Reason | When |
|---|---|---|
| `unavailable` | `no-model` | No model resolves (no free-tokens route, no default model). |
| `unavailable` | `no-sign-in` | Route is a subscription the sign-in surface offers (`idealizeOAuth.status()`), not signed in, and not terminal-only. A sign-in clears it; a key cannot. |
| `unavailable` | `no-access` | Route unreachable, not a subscription, and no terminal to send the user to. |
| `unavailable` | `terminal-only` | Route is in `terminalOnlyProviders`, unreachable from the chat, and a terminal exists (Claude on subscription runs as Claude Code there). |
| `confirm` | `terminal-restart` | The shell would be replaced (`terminalRestarts`): the provider differs, or the launch command does. The host read sees only the provider half, because it answers for the roster as a whole and knows no chat's current brain; the brain switcher applies both halves. |
| `ready` | | Everything else. |

The space roster (`@idealize/spaces`) folds these states into each space's `models` answer; the brain switcher renders the restart half as the row's "restarts the shell" line.

## Configuration (`idealize-activity-pills` row)

| Field | Default | Meaning |
|---|---|---|
| `root` | `$DSH_HOME/.agent-presets` | Where the presets are seeded. |
| `source` | `standard` | Shipped preset each composition derives from. |
| `models` | `{}` | Per-preset `{provider, model}` override. Without one: Free → first model on the `freetokens` route; others → the deployment default model. The row is also the `idealize-activity-pills` settings section, so the Brains pane's edits persist in the settings document over the composition value. |
| `spaces` | `{}` | Which spaces each brain works in, keyed by preset id. Sibling of `models` in the same settings section, so a write to either leaves the other intact (`settings.update` merges). A preset with no entry takes the default `presetSpaces` computes (`@idealize/spaces`): a media agent its own space, an agent role none, Free Chat alone (its free-tokens route is a chat route no CLI plays in the terminal, so no stored list puts it back there), everything else Chat and Terminal. |
| `terminalOnlyProviders` | `['anthropic']` | Routes served only by a terminal agent on subscription. |
| `terminalCliByProvider` | `{ anthropic: 'claude' }` | The command-line agent serving each terminal-only route, reported with its install state on the agents route. |
| `apiKeyEnvByProvider` | deepseek-official, anthropic, openai | Key variable per route when the settings profile names none. |

## The `activityPills` service

The client provides `ctx.activityPills` (`{ face }`): `face()` returns the wired controller face (`hooks.activityPills` roster snapshot, `load`, `select`) over the one `ActivityPillsController` instance the brain switcher also uses. `@idealize/ui-bar`'s welcome card is its consumer.

## Dependencies on the desktop shell (open; not buildable from this repo)

The web half is complete and assumes `chat` until told otherwise. The desktop repo (`~/dev/idealize-desktop`) must:

1. **Report the surface.** When the terminal pane takes focus, `POST /idealize/activity/surface {kind:'terminal', provider:'<agent provider>'}` (Claude Code → `anthropic`); when the chat takes focus, `{kind:'chat'}`. Header `x-idealize-auth: 1`. Without this, the `confirm` state never arises in the shell's own terminal pane.
2. **Act on a confirmed switch, in the shell's OWN terminal pane.** For the EMBEDDED terminal (`@idealize/ui-terminal`'s view) nothing is outstanding: the brain switcher's Continue calls `terminalMode.restart`, which closes the PTY and reopens it on the new brain's launch command. Restarting the agent in the shell's separate pane remains the shell's action.
3. **Expose `desktopActions.openTerminal`** (already composed in the app per `ui-bar`'s capabilities route) so `terminal-only` resolves instead of `no-access`.

Repack the fork tarballs into `vendor/idealize/*.tgz` and `corepack yarn install` in the desktop repo after these land, or the shell never sees the package.

## Model Experience

### The seeded activity personas

#### What the model sees

Each seeded preset is the `standard` composition with its `system-prompt` persona row replaced by the activity's persona text from `src/activities.ts`, so a chat on an activity brain carries that persona in its system prompt in place of the standard one. The text is owned here and edited by the user through `POST /idealize/activity/agent`; the current value is whatever the preset directory holds, so it is not quoted verbatim.

#### Token effect

Fixed per request for the life of a chat on that preset: the persona replaces the standard persona rather than adding to it, so the delta is the length difference between the two texts.

#### KV Cache effect

Prefix-stable while the preset is unchanged; editing a brain's instructions rewrites the system prompt of every later request on that preset and invalidates reuse from that point. A started chat never recomposes, so a brain switch mid-chat changes the model and the logged `idealize/brain` instructions (`@idealize/spaces` owns that entry) rather than this persona.

## Known Limitations and Deferred Work

- **The desktop shell's own terminal pane never reports its surface.** Items 1 to 3 above are unbuilt in the desktop repo, so `POST /idealize/activity/surface` stays at its `chat` default there and the `confirm` and `terminal-only` states arise only for the embedded terminal.
- **The host's availability read applies the provider half of the restart rule only.** It answers per brain for the roster as a whole and knows no chat's running launch command; a chat-specific answer lives in the brain switcher's client-side `terminalRestarts` call.
- **The wire and type names keep `pill`.** `GET /idealize/activity/models` answers `pills`, and `PillAvailability`, `PillReason` and `assessPills` name the same states; renaming them is a wire change for the desktop shell and the Brains pane together.
