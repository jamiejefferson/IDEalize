# Agent Note: three things JJ could not read — the media strip, the Askbar, and the Brains roles card

Status: implemented

Three faults from one testing round on landing 29, all of them surfaces a person could not read.

## Problem

**The media ask bars showed a model picker and no settings.** The Images, Video and Sound Stage composers carry a settings strip on the tool row; landing 26 put a Generator select at its head so the model that makes the artefact is chosen where the prompt is. A native select sizes to its longest option, and a generator name runs to "GPT Image 2.5 Sunburst Text to Image": measured on the packaged binary, the select took 354px of a 462px row, so Aspect (827–884px) and Count (894–951px) sat past the row's right edge at 833px. The row scrolls, and nothing says so, so the strip read as a model dropdown with the settings gone. JJ: "they're showing a model choice not the relevant prompt settings. this was working before."

**The Askbar's agents matched no chat on screen.** The floating bar is a 72px column of 40px generated portraits, each captioned with its state at 7px: `{o‿o}` over `IDLE`. The set of chips is right — it mirrors the sidebar's visible rows for the current project — but nothing on a chip said which agent it was, so the bar read as unrelated to the live chats. JJ: "the agents in it bear no relation to the live ones. also they're way too small."

**The Studio Coordinator was filed under Chat.** `presetSpaces` puts a brain in no space when its preset carries an agent role, and both readers of that list named `projectAgentPreset` alone. Landing 29's new `studio-agent` preset therefore fell through to the default and listed under Chat and Terminal — confirmed on the running app, which reported `studio-agent | Studio Coordinator | spaces= ['chat','terminal']`.

## Decision

**The generator select is capped and ellipsised.** 11em with `text-overflow: ellipsis`: it states the current generator, the menu still shows each name in full, and the settings beside it stay on the row. Widening the row instead would move the problem to the next long model name.

**Both homes caption a chip with the agent's name.** The portraits are generated, so the name is the only thing tying a chip to a chat in the sidebar. The floating bar, now 108px wide (half again on the design spec's 72px, as JJ asked), adds the state in words under the name at 8px; the 36px sidebar column keeps the name alone and leaves the state to the ring and the badge. The portrait grows to 48px and its face to 13px.

**An agent role is every coordinator, not the project one.** Both `rolePresets` readers take `projectAgentPreset` and `studioAgentPreset`, so the Studio Coordinator lists beside the Project Coordinator under Agent roles (JJ: "put studio and project coordinator together in the brains section"). Each id is taken only when present: the reader probes an untyped `ctx.get` service and a composition may carry an older settings shape.

## Alternatives considered

**Move the Generator into the three-dot overflow.** It would free the whole row, and it would also undo what landing 26 was for: JJ asked for the generation model where the prompt is, not another pane away.

**Let the tool row wrap instead of scroll.** Two rows of settings change the composer's height as the model changes, which moves the send button under the pointer.

**Keep the state as the Askbar caption and put the name in the tooltip.** A tooltip is not readable at a glance, and the bar exists to be glanced at.

## Consequences

- `ASKBAR_WIDTH` in `dsh-plugin-desktop/src/askbar-window.ts` and `.bar`'s width in `@idealize/askbar`'s sheet hold the same number; both say so.
- A chip is taller (name plus state), so fewer fit before the list scrolls. The list already scrolled.
- The spaces roster and the brains roster both change with the `rolePresets` readers, so the welcome card's Chat and Terminal tiles each count one brain fewer once a Studio Coordinator preset exists.

## Evidence

`packages/idealize/askbar/tests/askbar-root.client.spec.tsx` asserts a chip carries its name and, in the floating home, its state; `askbar-css.spec.ts` pins the bar's width and `dsh-plugin-desktop/tests/askbar-window.spec.ts` the window's. `packages/idealize/ui-gallery/tests/view.client.spec.tsx` asserts the generator select carries the cap. `packages/idealize/spaces/tests/roster-lifecycle.host.spec.ts` boots a real composition with both coordinator presets named and asserts each leaves Chat and Terminal.
