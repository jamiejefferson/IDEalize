# @idealize/ui-launch

The opening sequence: once per app launch, a centred IDEalize card on an opaque layer bridges the boot splash's fade, then the sidebar slides in from the left and the centre column and tool rail slide in from the right, staggered (~1.1s total).

## What the plugin does

- **Logo layer** — a `shell.overlay` occupant (`idealize-launch`, order 10, below the tour's 90 and first-run onboarding's 95 so those paint above it) renders the centred brand card from the frame's first commit, fading out over 350ms once the sequence plays.
- **Panel beats** — one injected global stylesheet keyframes the existing `data-idealize-surface` hooks: `sessions` (the sidebar column) slides from the left, `chat` (the conversation root) slides from the right. The rail animates itself through its own module stylesheet in `@idealize/ui-bar` on the chat beat's delay.
- **Park/play machine** — the sequence stays parked (logo layer visible, panel keyframes unarmed) while any *other* `shell.overlay` occupant is actively rendering, and plays exactly once when the last one clears. "Actively rendering" is read from the overlay container's DOM children, not the slot registry: occupants like the tour stay registered while idle, so entry presence says nothing about visibility. This keeps ui-launch decoupled from any specific overlay package.
- **Arming** — the beats are gated on `data-idealize-launch="playing"` on the body, set when the machine plays and removed when the sequence ends, so the keyframes cannot replay on arbitrary re-renders or remounts.
- **Reduced motion** — under `prefers-reduced-motion: reduce` the machine starts settled: no logo layer, no beats, panels render in their final state.

## The host half

Empty. The feature is browser-only; the host entry exists so the package loads through the host resolver like every other bundle row.

## Model Experience

None, as the opening sequence is a browser-only overlay and stylesheet that registers nothing model-facing.

#### KV Cache effect

Independent: the package produces no request and touches no request prefix.

## Known Limitations and Deferred Work

- The centre beat animates the conversation root (`data-idealize-surface="chat"`), not the whole centre column: the banner and dock strips above/below the columns stay settled. If a full-column beat is ever wanted, that needs a ui-layout mount-animation seam, not another stylesheet.
