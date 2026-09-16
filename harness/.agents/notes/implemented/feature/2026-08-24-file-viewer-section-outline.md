# Agent Note: File viewer section-title outline

Status: implemented

## Problem

V0's document panel carried a section-title sidebar beside every markdown file, and V1's deck file viewer shipped without one: a long document could only be read by scrolling. Porting it needs a source for the headings and a place to put a second column inside a deck that already competes for width with the drawer and the conversation.

V0 parsed the markdown text itself (`MarkdownOutline`, ATX headings with code-fence tracking). V1's markdown goes through the client's own renderer, which emits bare `h1`–`h6` with no ids (`packages/client/ui-primitives/src/markdown/render.tsx`), so anchor-by-slug is unavailable without changing an upstream package, and a second text parser would drift from what the renderer produced.

## Decision

`FileViewer` reads its outline from the rendered DOM. A `useLayoutEffect` keyed on the loaded envelope queries `h1,h2,h3,h4,h5,h6` inside the markdown container and keeps each live element, so a click jumps to the element the reader can see. `scrollIntoView({ block: 'start' })` puts the heading at the top of the `css.body` scroller, and `scroll-margin-top: 8px` on the headings gives it breathing room. Re-clicking the same entry is idempotent, so V0's `jumpToken` bump has no counterpart here.

Fenced code costs nothing to exclude: the renderer already turns a fence into a `CodeBlock`, so a `# comment` inside a shell block is never an `h1`. The proof run over a real Agent Note lists 14 entries from a file with 23 `#` lines, the other 9 being inside fenced markdown examples.

The outline is a 176px right-hand column, narrower than V0's 200pt because the deck's floor is 360px (`DECK_MIN`, `packages/client/ui-layout/src/client/columns.ts`) and a 200px sidebar would leave a 160px document. It auto-collapses while the viewer's measured width is under 520px, watched with a `ResizeObserver` on the viewer root rather than read from the stored deck preference, because the solver squeezes the deck below its preference at narrow windows. A toolbar toggle works at any width and persists its choice at `localStorage['idealize.viewer.outline']`; crossing the threshold re-applies the automatic state.

Markdown only, per V0's `isMarkdownDocument` gate, over V0's extension set (`md`, `markdown`, `mdown`, `mkd`, `mdx`): code, image, and binary envelopes render with neither the column nor the toggle. Markdown with no headings shows the "No headings" note. Indentation is V0's 12px per level and the font ramp its `10 + (6 - level)`.

## Alternatives considered

**Re-parse the markdown text, as V0 does.** Rejected: the parser and the renderer would disagree the moment either changes, and the parser cannot produce an element to scroll to, so jumping would need heading ids the renderer does not emit.

**Add slug ids to the upstream markdown renderer.** Rejected: it is an upstream file with no missing seam (FORK.md discipline), and reading the DOM needs nothing from it.

**Keep V0's 200pt sidebar.** Rejected on the width budget above.

**Collapse on the stored deck width preference instead of measuring.** Rejected: the preference is not the rendered width — the concession-chain solver overrides it — which is the packaged-window failure mode the proofing skill names.

## Consequences

The outline can only list what the renderer produced, so a truncated envelope outlines the rendered portion and the existing truncated banner stays as the signal. It also costs a DOM read per envelope, which is fine for a read-only viewer and would need revisiting if the viewer ever became editable — V0 re-parsed on every keystroke for exactly that reason.

Bought: no drift between the outline and the document, fence handling for free, and jumping that targets live elements rather than ids nobody emits.

## Testing

`packages/idealize/ui-bar/tests/file-viewer-outline.client.spec.tsx` covers document order and the indent/size ramp, the fenced-comment exclusion, the jump target, the toggle and its persistence across a remount, auto-collapse and recovery across the 520px threshold, the whole extension set, the empty state, and the non-markdown gate.

`packages/idealize/ui-bar/proof/viewer-outline-proof.mts` drives a booted app headlessly at 1280×840 and writes `.idealize/proof/viewer-outline-*.png`: the outline beside a real markdown file, the jump recorded as the scroller's `scrollTop` before and after plus the heading's distance from the scroller top, the auto-collapsed state after the deck is dragged to 420px, and a `.ts` file with no outline column. The app must be booted on a scratch `DSH_HOME` and a scratch `HOME`, so a proof run never reads or writes the real home.
