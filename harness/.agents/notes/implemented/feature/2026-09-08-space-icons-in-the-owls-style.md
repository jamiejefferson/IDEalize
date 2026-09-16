# Agent Note: JJ's 8 Sep review, item 9 — space icons drawn in the owl's style

Status: implemented

JJ, 8 Sep 2026, item 9 of the review: space icons drawn in the style of the IDEalize owl mascot (filled, cream and warm-neutral with red and amber accents) replace the current line glyphs. Offered three ways to proceed, JJ chose "I draft five SVGs for review": the drafts are wired into the app so the next build shows them in place, and JJ reviews them there.

## Problem

Every surface that showed a space drew its own line glyph. `@idealize/ui-bar` kept five `BarIconSpace*` functions and a `BarIconStudio` in `BarIcons.tsx` (16px grid, 1.5px `currentColor` strokes) for the launcher tiles, the brain step's chip and the pinned Studio card; `@deepseek-ai/dsh-client-ui-workspace` kept a second set of six in `rows/SpaceGlyph.tsx` for the sidebar lane, restated there because that upstream package references `@idealize/spaces` type-only. The two sets were drawn separately, so a redesign meant redrawing twelve paths in two packages, and a stroke glyph on `currentColor` cannot carry the mascot's filled palette at all.

## Decision

**One home per icon.** Six SVG files live at `packages/idealize/spaces/assets/icons/<space>.svg`, named by space id (`chat`, `terminal`, `gallery`, `soundstage`, `motion`, `studio`), each a 24×24 viewBox in the owl's palette: cream `#F3EDE2` fills, `#9A8B78` outlines, red `#E4552B` and amber `#E9A23B` accents, `#2B2420` for the dark marks. `@idealize/spaces`' host half serves them at `GET /idealize/spaces/icons/<space>.svg` through the web server's prefix route effect, `image/svg+xml` with a content length. The pathname is resolved to a space by table lookup (`iconSpace`), so any other path under the prefix answers 404 and no request text reaches the filesystem; the route is loopback-only like the other spaces routes. The response is `cache-control: no-cache` with an ETag and a 304 on match, because JJ reviews these drafts build by build and an immutable cache entry in the desktop shell would keep showing the previous build's icon. `package.json` `files` carries `assets/icons/*.svg` and `lib/types/space-icons.js`, so the packed tarball ships them.

**One helper on the client face.** `spaceIconSrc(id)` and `SPACE_ICON_PATH` are exported from `@idealize/spaces/client`, the first values on a face that was types-only; the module is stateless and imports nothing from the space table, so a client bundle inlines it the way `@idealize/ui-bar` already inlines the artefacts reveal signal. `ui-bar`'s new `SpaceIcon` component renders `<img src={spaceIconSrc(space)} alt="" draggable={false}>` at the caller's size (19 on a tile, 15 in the chip, 16 on the Studio card); the six drawn functions are deleted. `ui-workspace`'s `SpaceGlyph` renders the same `<img>` at 16 from the literal route, with the comment stating why the upstream package restates it: a value import of fork code into its bundle is the thing the type-only reference exists to avoid. The `.spaceLane` and `.glyph` colour rules that served the stroke glyphs are removed; the `data-space` attribute, the `role="img"` and the `aria-label` on the lane are unchanged.

## Alternatives considered

**Keep drawing the icons inline as React components in each package.** Filled, multi-colour paths would still be duplicated across `ui-bar` and `ui-workspace`, and every review round would edit two packages; a served file changes once.

**Inline the SVGs as data URIs in a client module.** Six small files would inline cleanly, but the client face would then carry the artwork itself, and `ui-workspace` would still need its own copy or a value import; a route keeps the artwork on the host half beside the table that names the spaces.

**Cache the icons as immutable, like the askbar owl.** The owl is a build constant that will not change; these are drafts under review, and a year-long cache would defeat the review.

## Consequences

`@idealize/spaces` gains `src/space-icons.ts`, the prefix route in `src/index.ts`, `tests/space-icons.host.spec.ts` (every id served byte for byte, 304 on ETag, 404 for an unknown id and for traversal, 405 and the loopback fence, both faces name one route) and the README section "The space icons". `@idealize/ui-bar` gains `src/client/SpaceIcon.tsx`; `BarIcons.tsx` loses six functions; `studio-card.client.spec.tsx` asserts the served `img`. `ui-workspace`'s `rows.client.spec.tsx` asserts the `img` `src`, `alt` and `draggable` per space and five distinct sources. FORK.md gains a row for the `SpaceGlyph.tsx` and `Rows.module.css` touch. The desktop landing walk reads `[data-space]` on tiles, on the brain step and on sidebar rows, and none of those attributes moved; it never selected an `svg`. The icons are drafts: a further review round replaces files under `assets/icons/` and nothing else.

## Second round, same day: Tabler outlines as a currentColor mask

JJ rejected the filled owl-style drafts on 8 Sep 2026 ("i don't love the space icons") and asked for larger, thinner SVGs from [Tabler Icons](https://github.com/tabler/tabler-icons), pointing at the picker set to size 36 and stroke 1.25. The six files under `assets/icons/` are now Tabler 3.46.0 outlines (`message-circle`, `terminal-2`, `photo`, `music`, `movie`, `messages` for Studio, the project's group chat), reduced to their paths on the 24 grid with `stroke="currentColor" stroke-width="1.25"` and no fill; `assets/icons/LICENSE` carries Tabler's MIT notice and `files` ships it. The route, the helper and the tests' 404/304/loopback coverage are unchanged; the host spec additionally asserts each served file is a `currentColor` outline at 1.25 with no fixed fill.

A monochrome outline has to follow the text beside it (a tile turns brand blue on hover, the chip is brand blue, the dark preset inverts the rows), and an `<img>` cannot take `currentColor`. `SpaceIcon` and `SpaceGlyph` therefore render a square `<span>` with `background-color: currentColor` masked by the served file (`mask: var(--space-icon) center / contain no-repeat`, the URL set as a CSS custom property inline), which the ETag route still feeds. Sizes rose from 19/15/16/16 to 24 on a tile and 18 in the chip, on the Studio card and in the sidebar lane; the lane and the card's glyph cell widened from 16 to 18. The specs read the icon back through `[data-space-icon]` and `style.getPropertyValue('--space-icon')`.
