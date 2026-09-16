# Agent Note: JJ's 1 September list — what had already landed, and the four faults underneath it

Status: implemented

JJ kept a list in `feedback.md` from walking the app on 1 September 2026 and asked for it on the 11th, after nine landings had gone past it. Most of it was already built. Walking the packaged binary against a copy of his data separated the twenty-odd items into three piles: shipped, wrong for a reason nobody had found, and one that cannot be built where it was asked for.

## Problem

Four items were live faults, and each was invisible in a different way.

**Image generation looked broken and was not.** A prompt in the Images space produced "Nothing was generated this turn." The same prompt on DeepSeek made three pictures in forty seconds. The Gallery brain was running `gpt-5.6-sol` on the `openai-codex` route, and the turn ended `{ kind: 'error', failure: { message: 'Failed to extract accountId from token', code: 'PI_AI_ERROR' } }` — a ChatGPT token the route could not read an account id out of. The grids fold `turn/end` into a phase and a reason but never kept the message, so a turn nobody answered rendered with the copy written for a turn the model chose not to generate on. The account was at fault; the sentence blamed the generator.

**OpenRouter could not register as a media service.** `createImagesBackend` sets `credentialConfigured` false at construction and its `refresh()` re-fetched the catalogue without reading the credential. The only thing that could move the flag was a `setCredentialConfigured` with no caller in the repository. The queue adapter reads its key inside `refresh()`; the images adapter, the one OpenRouter uses, never did. So `/idealize/brains/media-keys` reported `connected: false` for OpenRouter however many keys were stored, and its image and audio models never entered the candidate lists.

**The composer named the wrong model in a media space.** The seat reads the session's chat model, which in Images, Video and the Sound Stage only drives the generation tool. The model that makes the artefact is the space's, and it could be reached only from the Brains pane — two panes away from the prompt.

**The drawer's drag handle moved the wrong pane.** It sat left of the rail, which with a document open is the *document's* right edge. Dragging the border between the document and the rail resized the Files pane.

Three smaller ones: the rule between projects was a 4% hairline that vanished against the sidebar ground; the terminal's painted ground stopped at the conversation scroller's stable scrollbar gutter and left a pale strip down the right; every Appearance slider wrote through to durable settings on each pointer move.

## Decision

**A refused turn says what refused it.** `GalleryTurn` carries `error` alongside `endReason`, and the Images, Video and Sound Stage views print it in the error colour where the reply would stand. No turn that ended in an error can now render as a quiet outcome.

**The credential is read where the catalogue is read.** `createImagesBackend.refresh()` resolves the key and sets `credentialConfigured`, exactly as `createQueueBackend` does; `setCredentialConfigured` goes, having never had a caller. A key pasted after start-up reaches the descriptors through the refresh the connect route already triggers.

**The generator is chosen where the prompt is typed.** The generation settings strip leads with a Generator select over that space's compatible candidates from `/idealize/brains/media`, writing through the same route the Brains pane uses and raising `idealize:brains-changed`, so the field schema follows the new model. The chat model keeps its own seat: it is what failed above, and hiding it would hide that.

**Every column handle sits on its own column's left border.** The drawer's moves past the rail; the rail's own border carries no handle, because nothing there resizes. The file viewer's outline column gains the handle it never had, between 120 and 420px, remembered beside the outline's show/hide preference.

**Appearance writes coalesce over 120ms.** The local mirror and the token projection still run per pointer move, so a drag repaints at pointer rate; the durable write goes out once the pointer rests, and adoption is held off while one is pending.

**The terminal's ground carries across the measured gutter.** A positioned `::after` rather than extra width, so it cannot raise a horizontal scrollbar, and the gutter is measured from the nearest scrolling ancestor rather than assumed.

## Alternatives considered

**Replacing the composer's model seat in a media space.** It would have answered "models don't seem to be filtered" most directly and hidden the chat model — the one that had just failed silently. The strip carries the generator instead, and both are visible.

**Hard-coding the terminal's bleed at 8px.** That is this machine's scrollbar. The measurement costs one ResizeObserver and is right on a machine whose view area does not scroll at all.

**Keeping the drawer handle left of the rail.** It was placed there deliberately on 28 August, when the rail always stood between the drawer and the conversation. The deck's move to column 5 on 10 September put a document there instead, and the argument did not survive it.

## Consequences

`@idealize/ui-gallery` now reads and writes `/idealize/brains/media`, a route it previously only benefited from, so the Images/Video/Sound Stage composer depends on the generate plugin being mounted; without it the Generator control renders nothing and the rest of the strip is unchanged.

The `images` adapter's `ImagesBackend` face loses a method. No caller existed, so nothing outside its own tests moved.

**Not built, and why.** JJ asked for the mini-mode toggle to move "to the chrome next to the other window controls". The desktop runs its compatibility shell with the platform's own frame (`compatibilityWindowOptions` sets no `titleBarStyle`), so the renderer cannot draw beside the traffic lights at all: the page begins below the title bar. Moving it needs `titleBarStyle: 'hiddenInset'` for compatibility mode and a chrome row in the renderer to replace the title bar, which changes every column's top inset. It belongs with the Askbar work below, which owns the same surface.

**The Askbar rethink is its own piece of work.** `idealize-askbar-studio-product-spec.md` is a 930-line product specification for turning mini mode into a screen-edge dock of agent chips with a project Studio behind it. Parts of it have shipped since it was written (holding a chip to speak, the Studio card above the projects), so JJ's instruction is to start with a gap analysis: read the spec against what the app now does, and slice what remains. Nothing in this landing touches mini mode.
