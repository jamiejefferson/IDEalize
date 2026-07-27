# Making the terminal feel friendly — research & 5 proposals

*Research only. No app code is changed by this document.*

The brief: investigate how to make the CLI/terminal surface in IDEalize feel
**more friendly, less daunting, and better-looking than a regular terminal** —
and spin up five concrete things we could build. This is grounded in a full read
of the current rendering + theming stack, so every idea below names the exact
seam it would hook into.

---

## TL;DR — the five

| # | Idea | What it fixes | Scope | Reuses |
|---|------|---------------|-------|--------|
| 1 | **The terminal as a designed surface** — soft inset frame, top-lit ambient glow, optional paper grain behind the grid | The live grid is a flat black void; nothing about it says "designed app" | S–M | Theme accent, gradient system |
| 2 | **A warm front door** — welcome mat empty-state + a friendly prompt/hint band | A blank terminal with a blinking cursor is the single most intimidating moment | M | Critters, tour voice, composer chips |
| 3 | **Readable output** — typographic breathing room + tasteful soft-syntax for paths, URLs, diffs, errors in block cards | Finished output is an undifferentiated monospace wall | M | `BlockRenderer`, theme palette |
| 4 | **A living command lifecycle** — graduation motion, a calm "running" shimmer rail, a small success flourish | Commands snap between states abruptly; success is unrewarded | S–M | Spring motion language, chime, `Idealizing` shimmer |
| 5 | **Moods** — a gallery of genuinely beautiful, friendly named themes + an auto ambient backdrop | Only 3 fairly techy themes ship; the palette sets the whole tone | S | Theme model, appearance USP |

Together they attack the four things that make a terminal feel cold: the *void*
(1), the *blank-page fear* (2), the *unreadable wall* (3), the *lifeless
transitions* (4), and the *default palette* (5).

---

## Where we are today

### The design language is already strong

IDEalize has a confident, warm visual vocabulary — it just stops at the edge of
the terminal grid. The recurring elements:

- **Continuous rounded rectangles** (7–18pt radii), faint `theme.border`
  hairlines, `theme.surface` / `surfaceHover` fills, soft drop shadows.
- **Derived semantic surfaces** — `chrome`, `surface`, `elevated`, `border`,
  `secondaryForeground`, `accent` are all *blended from the theme's bg↔fg*
  (`Theme.swift:47–60`), so anything built on them re-themes for free.
- **A single global "action colour"** (default a red/pink accent, = the cursor
  colour), solid or multi-stop gradient, driving buttons, focus rings, unread
  dots (`PanelAppearance.swift`, `AppearancePanel.swift`).
- **Gentle, restrained motion** — springs (`response ~0.34`), short
  `easeOut(0.12–0.28)`, one slow attention pulse. The one exuberant moment is
  the `Idealizing` typographic shimmer (`IdealizingAnimation.swift`).
- **A friendly personality** — six animated critter mascots (fox, cat, bunny,
  dog, duck, hedgehog) run while Claude works (`Branding.swift:19–54`); a
  jargon-free first-run tour written "for someone who has never used a terminal"
  (`ShowcaseTour.swift`); a gentle completion chime (`DoneSound.swift`).

### What's already delightful — do **not** rebuild

The `Idealizing` shimmer, the critter mascots, the first-run spotlight tour, the
completion chime, the pulsing "waiting" badge, the context meter, the per-panel
appearance inspector, and the Figma-style gradient editor all exist and are
polished. The ideas below deliberately avoid these.

### The gap: the terminal grid itself is undesigned

This is the key finding. There are **two independent renderers** sharing one
`Theme`:

1. The **live SwiftTerm grid** — raw monospace text on a flat
   `nativeBackgroundColor`. IDEalize subclasses `LocalProcessTerminalView` only
   to tap the byte stream (`IDEalizeTerminalView.swift`); it overrides **no**
   drawing. Styling is limited to bg/fg/cursor/selection/font/palette in
   `TerminalSession.applyTheme` (`:686–692`) plus two sliders (Blur, Margins) in
   the appearance panel (`AppearancePanel.swift:133–138`).
2. The **block cards** — IDEalize's own Warp-style re-render of finished output
   (`BlockRenderer.swift` → `BlockCardView.swift`), which *is* richly styled
   (rounded card, status rail, prompt glyph, hover actions).

So all the polish lives in the *chrome around* the terminal. The terminal — the
thing a new user stares at — is still "just a terminal": a wall of monospace on
a black rectangle. That's where the friendliness budget should go.

### The cleanest hooks (verified)

| Hook | File / line | Good for |
|------|-------------|----------|
| Container layer around the live grid | `TerminalViewRep.makeNSView` (`:61–95`) | Inset frame, glow, gradient/grain, inner shadow, rounded corners |
| Non-interactive overlay over the grid | `LeafPaneView.shellLayout` overlay (`:245–251`, the existing 5%-logo watermark) | Vignette, welcome mat, ambient art — the proven "decorate without touching SwiftTerm" pattern |
| Terminal title/prompt strip | `paneHeader` (`PaneView.swift:83–109`) | Breadcrumb, plain-language hint band |
| Historical-output text attributes | `BlockRenderer.flush()` (`:81–87`) | Line spacing, kerning, soft-syntax colour/weight |
| Block card chrome + status | `BlockCard` (`BlockCardView.swift:34–178`) | Graduation motion, success flourish, running shimmer |
| Palette + derived surfaces | `Theme.swift:20–98` | New moods; retuning the whole app at once |
| Empty state | `EmptyState` (`WorkspaceView.swift`) + watermark overlay | Warm front door |

---

## Principles for this work

1. **Never touch what SwiftTerm draws.** Every idea layers *around* or *behind*
   the grid, or restyles IDEalize's *own* re-render (block cards). The PTY byte
   stream stays untouched — TUIs (Claude, vim, top) must render pixel-exact.
2. **Derive from the theme, don't hardcode.** Anything new should read from
   `theme.accent` / `surface` / `border` so it re-themes for free and respects
   the per-panel appearance USP. (There's an existing consistency debt here:
   `BlocksSidebar.swift` hardcodes greys/system colours instead of theme
   surfaces — worth folding into idea 3.)
3. **Calm over flashy.** Match the existing motion budget (short springs, one
   slow pulse). Warmth, not a toy. Everything opt-outable via the appearance
   panel — power users can flatten it back to a plain terminal.
4. **Friendliness is mostly the empty state and the first 10 seconds.** The
   biggest "less daunting" wins are cheap: what you see before you've typed
   anything, and how the first command feels.

---

## The five ideas

### 1. The terminal as a designed surface

**Problem.** The live grid sits on a flat fill with only optional flat margins.
It reads as a void dropped into an otherwise designed app — the seam is jarring.

**Concept.** Treat the terminal region as a first-class surface, the way every
other panel already is. In the `TerminalViewRep` container (which is fully ours,
independent of SwiftTerm's drawing):

- A **soft inset frame**: round the container's corners to match the app's card
  radius, hairline `theme.border`, and a barely-there inner shadow so the grid
  reads as *inset into* the surface rather than floating on nothing.
- A **top-lit ambient wash**: a very low-opacity vertical gradient (lighter at
  the top, from `theme.surface` toward `background`) or a faint radial glow
  seeded from `theme.accent`, painted on the *container layer behind* the grid.
  Because SwiftTerm's own background is opaque, the wash shows only in the margin
  gap and as an overall "lit from above" feel — subtle but it kills the void.
- Optional **paper grain / noise** at ~2–4% for texture (a static tiled layer),
  and an optional **vignette** as a non-interactive `.overlay` (the proven
  watermark pattern) to focus the eye on the text.

**Feel.** The terminal stops being a black hole and becomes a calm, lit panel
that belongs to the app.

**Hooks.** `TerminalViewRep.makeNSView` (`:61–95`) for the layer treatment;
`shellLayout` overlay (`:245–251`) for the vignette. New appearance controls
slot into the existing terminal card (`AppearancePanel.swift:133`).

**Effort:** S–M. **Risk:** low — nothing touches the grid; keep opacities tiny
so text contrast (and legibility on light themes) is never harmed. Ship it
*off by default* behind a "Surface style" toggle so it's a delight, not a
surprise.

---

### 2. A warm front door

**Problem.** A brand-new terminal is a blinking cursor on a dark rectangle —
the most intimidating thing in the app. Today the empty state is a 5%-opacity
logo watermark (`PaneView.swift:246–250`): technically tasteful, emotionally
cold. New users don't know a terminal is even for typing.

**Concept.** Two small, friendly additions:

- **A welcome mat** replacing the watermark on an empty pane: a soft centred
  card with one of the critters (reuse `Branding.Critters`), a warm one-liner
  in the tour's voice ("Nothing running yet — tell me what you'd like to do"),
  and **two or three one-tap starters**: *Ask Claude…* (opens the composer /
  chat), *Open a project* (⌘O), *Run a command* (focuses the composer). Each is
  a rounded chip in the app's existing vocabulary.
- **A prompt/hint band** for the plain-shell state: a slim strip above the live
  grid (in `paneHeader` / top of `shellLayout`) showing a breadcrumb chip
  (`project ▸ branch ▸ cwd`, reusing the composer's directory-chip styling) and
  a rotating plain-language hint ("Type a command, or press ⌘L to just describe
  what you want"). It gives the blinking cursor context and an escape hatch.

**Feel.** The first thing a nervous user meets is an invitation, not a void.
This is the single highest-leverage "less daunting" change and it reuses assets
we already ship.

**Hooks.** `EmptyState` (`WorkspaceView.swift`) and the watermark overlay
(`PaneView.swift:245–251`); `paneHeader` (`:83–109`); starter chips call the
same actions the command palette already exposes.

**Effort:** M. **Risk:** low. Keep the band dismissible and auto-hiding once the
user is clearly fluent (e.g. after N commands) so it never nags.

---

### 3. Readable output

**Problem.** Finished output in a block card is an undifferentiated monospace
wall — accurate, but hard to skim, and no friendlier than any terminal.

**Concept.** Make IDEalize's *own* re-render (block cards, not the live grid)
quietly more legible:

- **Typographic breathing room** — a couple of points of line spacing and a hair
  of tracking via `.paragraphStyle` / `.kern` in `BlockRenderer.flush()`. This
  alone makes dense logs feel calmer.
- **Tasteful soft-syntax** — a light post-pass that recognises common shapes and
  nudges their colour/weight *from the theme palette*: file paths and URLs get a
  subtle accent + underline-on-hover feel, diff `+`/`-` lines get the theme's
  green/red at low saturation, `error`/`warn`/`fail` keywords get a gentle
  emphasis, and numbers/durations get monospaced-digit alignment. All derived,
  never hardcoded, and capped so it reads as "designed log," never "rainbow."
- **Consistency cleanup** — unify `BlocksSidebar.swift` (which hardcodes
  greys/system colours) onto the same `theme.surface`/`border`/`accent` the
  cards use, so the two block views finally match.

**Feel.** Output reads like a well-set document instead of a dump. Crucially
this touches only the historical re-render — live TUIs are unaffected.

**Hooks.** `BlockRenderer.flush()` attributes (`:81–87`) + a small classifier
pass; `BlockCard.outputView` (`BlockCardView.swift:112–126`);
`BlocksSidebar.swift` for the consistency pass.

**Effort:** M. **Risk:** medium — soft-syntax must be *conservative* and
opt-outable; over-colouring would feel worse than plain. Start with just line
spacing + diff/error emphasis and expand only if it lands.

---

### 4. A living command lifecycle

**Problem.** State changes are abrupt. Output "graduates" into a card via a
Ctrl-L viewport clear (`IDEalizeTerminalView.clearViewport`), which pops. A
running command shows a bare spinner; success is a static green tick with no
reward. The terminal feels like a log printer, not something alive.

**Concept.** Choreograph the command lifecycle with the app's existing motion
language:

- **Graduation** — when a command finishes and its card appears, fade + a small
  spring rise so it *settles* into the history instead of snapping in
  (`BlocksScrollView` already animates the scroll; add the card's own
  transition).
- **A calm running rail** — replace the spinner on the running block with a soft
  shimmer travelling down the status accent rail (a restrained cousin of the
  `Idealizing` shimmer), so "working" reads as alive and patient rather than
  buffering.
- **A success flourish** — on exit 0, a brief sparkle/checkmark pop on the
  status icon and a one-frame accent sweep of the rail (green), timed with the
  existing completion chime so sight and sound land together. On failure, a
  gentle shake, never harsh.

**Feel.** Running a command becomes a tiny, satisfying loop — the difference
between a terminal that *reacts* and one that just scrolls.

**Hooks.** `BlockCard` status rail + `statusIcon` (`BlockCardView.swift:146–168`);
`BlocksScrollView` transitions (`:9–29`); tie the flourish to the same signal
that triggers `DoneSound.play()`.

**Effort:** S–M. **Risk:** low — pure additive motion. Respect
`NSWorkspace.shared.accessibilityDisplayShouldReduceMotion` and make it
opt-outable.

---

### 5. Moods

**Problem.** Only three themes ship (`IDEalize Dark`, `IDEalize Light`,
`Solarized Dark`), and they're fairly techy. The palette sets the entire
emotional tone of the app — a great default mood does more for "friendly and
good-looking" than any single feature. The deep appearance USP exists, but most
users won't build a theme from scratch; they want to *pick* a beautiful one.

**Concept.** A curated **mood gallery**: 6–10 genuinely lovely, named,
friendly presets — warm-dark ("Ember"), soft-paper light ("Linen"), calm
blue-hour ("Dusk"), high-contrast-but-warm ("Cocoa"), etc. — each a full `Theme`
(bg/fg/cursor/selection + 16 ANSI) tuned for long AI-coding sessions and
accessible contrast. Presented as swatch cards in the appearance panel's
existing theme picker (which already renders mini swatches).

Pair it with an optional **auto ambient backdrop**: derive a very subtle
mesh/gradient for `theme.background` from the mood's accent (reusing the gradient
system), so even the default install looks composed rather than flat-black. This
is the low-effort, high-visibility "better looking out of the box" win.

**Feel.** The app looks beautiful the moment it opens, without anyone touching a
single setting — and the personality is warm, not "hacker terminal."

**Hooks.** `Theme.all` (`Theme.swift:98`) — add presets; the theme picker
(`AppearancePanel.swift:318–342`) already renders swatches; the ambient backdrop
reuses `makeGradientStyle` (`PanelAppearance.swift:57`).

**Effort:** S (themes) + S (ambient). **Risk:** low. This is the safest,
fastest visible improvement and a good first ship. Contrast-check every preset
(the derived `secondaryForeground` must stay readable, as the Solarized note in
`Theme.swift:56–57` already flags).

---

## Suggested sequencing

A pragmatic order by effort-to-impact:

1. **Idea 5 (Moods)** — fastest, most visible, lowest risk. A gorgeous default
   mood + a handful of presets changes the whole first impression in a day.
2. **Idea 2 (Warm front door)** — biggest "less daunting" win; reuses critters
   and tour voice.
3. **Idea 1 (Designed surface)** — kills the void; small, behind a toggle.
4. **Idea 4 (Living lifecycle)** — additive motion polish once the surface is
   settled.
5. **Idea 3 (Readable output)** — most nuanced; ship the conservative half
   (spacing + diff/error) first, expand only if it lands.

Everything is opt-outable through the appearance panel, so power users can always
return to a plain, fast terminal — the friendliness is a warm default, not a
mandate.

---

## Appendix — file map used in this research

- Palette & derived surfaces — `Sources/IDEalizeApp/Model/Theme.swift`
- Live-grid styling — `Sources/IDEalizeApp/Model/TerminalSession.swift` (`applyTheme`, `:679–704`)
- Byte-stream tap (no drawing) — `Sources/IDEalizeApp/Model/IDEalizeTerminalView.swift`
- SwiftTerm host + container/margin — `Sources/IDEalizeApp/UI/TerminalViewRep.swift`
- Pane composition + empty watermark — `Sources/IDEalizeApp/UI/PaneView.swift`
- Block cards (rich chrome) — `Sources/IDEalizeApp/UI/BlockCardView.swift`
- Block output re-render — `Sources/IDEalizeApp/Model/BlockRenderer.swift`, `Model/AnsiColor.swift`
- Compact block list (styling debt) — `Sources/IDEalizeApp/UI/BlocksSidebar.swift`
- Appearance inspector (the USP) — `Sources/IDEalizeApp/UI/AppearancePanel.swift`, `Model/PanelAppearance.swift`
- Existing delight — `UI/IdealizingAnimation.swift`, `UI/ShowcaseTour.swift`, `Model/Branding.swift`, `Model/DoneSound.swift`, `UI/AgentStatusBadge.swift`
