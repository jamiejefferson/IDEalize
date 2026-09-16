# Agent Note: surface colours belong to one scheme

Status: implemented

Owner: `packages/idealize/appearance`, 15 Sep 2026.

## Problem

A surface's text colour and background were absolute hex values applied in both colour schemes. JJ chose a near-white chat ground and black ink over the light theme, then switched to Dark: the chat column stayed light while the composer card, the tasks column and the rail took the dark theme, so black text sat on dark cards and "many of the ui elements are not changing correctly and are therefore invisible". The Theme tab told him those panels "have colours of their own" and to reset them in their own tabs, and offered no Reset of its own because nothing at the theme level was customised, so "obviously its not resetting properly".

## Decision

`SurfaceAppearance.scheme` records the scheme on screen when a colour field is edited (`setSurface` stamps it; a surface whose colours are all cleared forgets it). `surfaceScheme` reads the recorded scheme, or infers it for a record written before the field existed: a solid or gradient ground decides by luminance, else a dark ink means light. `surfaceCss` paints the ink and background only when the surface's scheme is the one being painted; typography paints in both. The Theme tab's Reset also clears every surface's colours (`clearSurfaceColours`, typography kept), the tab counts a coloured surface as customised so that Reset is offered, and the copy says which panels hold colours for the mode on screen and which wait for the other; a surface tab whose colours belong to the other mode says so, and that editing moves them.

## Alternatives considered

- **A colour set per scheme on every surface.** Doubles the schema and the panel for a case JJ has not asked for; a colour edit in the other mode simply moves the colours there.
- **Deepening the stored colours to read against the other scheme.** A light ground under the dark theme is still a light panel in a dark app; legibility was not the whole complaint.
- **Making the Theme Reset wipe typography too.** Fonts and sizes are not theme, and JJ's document carries a chat size and a document face he chose separately.

## Consequences

A surface's colours show only in the scheme they were chosen in; switching scheme shows the theme's own colours for that surface until the person colours it there, and a colour edit in the other scheme moves the colours to it. Records written before the field existed are read by inference (ground luminance, else ink), so no migration runs. The Theme tab's Reset clears every surface's colours and keeps typography, so one action returns the whole app to the theme.

## Evidence

`tests/surface-css.client.spec.ts` (scheme inference over legacy records, colours painting only in their scheme, clearing keeps type), `tests/apply.client.spec.ts` (a colour edit stamps the scheme; JJ's live values vanish under Dark; the Theme reset clears colours and keeps type) and `tests/panel.client.spec.tsx` (the hints and the Reset title). Packaged walk against a copy of JJ's data below.
