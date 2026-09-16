# Agent Note: The IDEalize launch sequence

Status: implemented

## Problem

The app went from the boot splash straight to a fully painted frame: every column popped in at once the moment React mounted. IDEalize's V1 design calls for an opening beat — a centred logo carrying the splash's dismissal, then the sidebar sliding in from the left, then the centre column and tool rail from the right — once per launch, in about a second. Two constraints shaped the design: a new first-run onboarding overlay (an opaque full-screen `shell.overlay` occupant built in parallel) must never fight the sequence, and the client bundle purity gate forbids value imports from `@deepseek-ai/*`, so the brand mark cannot come from ui-primitives.

## Decision

New package `packages/idealize/ui-launch` (`@idealize/ui-launch`), browser-only, in three parts sharing one park/play state machine (`src/client/launch-machine.ts`):

- **Logo layer.** A `shell.overlay` occupant (`idealize-launch`, order 10 — below the tour's 90 and onboarding's 95, so those paint above it) renders the centred brand card on an opaque full-frame layer from the frame's first commit, so it is already in place when the boot splash fades. The card PNG is copied from ui-primitives' `BrandMark` into `src/client/launch-mark.ts`, the same copy-don't-import move ui-primitives itself made from the skin package.
- **Panel beats.** One global stylesheet injected by the client plugin at apply (the appearance package's sheet precedent) keyframes the existing `data-idealize-surface` hooks — `sessions` (sidebar column) slides from the left at 300ms, `chat` (conversation root) from the right at 470ms, both `backwards`-filled so nothing flashes settled between the logo fade and each beat. The rail carries its own gated keyframe in `@idealize/ui-bar`'s module stylesheet (fork-owned) on the chat beat's delay. All beats are gated on `data-idealize-launch="playing"` on the body, which the machine sets when the sequence starts and removes when it ends — animations run exactly once, never on re-renders or remounts.
- **Park/play machine.** The sequence stays parked — logo layer visible, beats unarmed — while any other `shell.overlay` occupant is *actively rendering*, and plays exactly once when the last one clears (after a 250ms dwell so the logo reads as a beat, not a flash; a foreign arrival during the dwell cancels it). Under `prefers-reduced-motion: reduce` the machine starts settled: no layer, no beats.

The coordination signal is the overlay container's DOM children (`div[data-slot="shell.overlay"]`, watched by MutationObserver), not the slot registry: the tour occupant stays registered from boot and renders null while idle, so `ctx.slots.entries('shell.overlay')` says nothing about visibility. Every element child other than this package's own layer root (`data-idealize-launch-layer`) or a crash face (`data-slot-error`) counts as an active occupant. This decouples ui-launch from the onboarding package entirely — it never references it.

## Alternatives considered

**Subscribe to `ctx.slots` for occupant presence.** Rejected: registration is not visibility. A list slot keeps every occupant registered for the app's lifetime; the tour's entry exists at boot whether or not the tour is on screen, so a registry count parks the launch forever.

**Coordinate through the tour's first-run hold or a settings flag.** Rejected: it couples ui-launch to whichever first-run flow exists (setup today, onboarding next) and says nothing about the tour or the shortcuts sheet opening later. DOM presence of *any* sibling occupant is the invariant the design actually needs.

**Animate the whole centre column instead of the conversation root.** Deferred: the centre column div has no surface hook (only the conversation root carries `data-idealize-surface="chat"`), and adding one is a ui-layout mount seam — an upstream touch the piece was told to avoid unless the hooks proved insufficient. They proved sufficient; the banner and dock strips simply stay settled during the beat.

## Consequences

- Returning users see the ~1.1s sequence on every launch; first-run users see it once, as the onboarding finale, when the onboarding overlay unmounts.
- A crashed sibling occupant's empty crash face does not park the launch.
- The beat timings live in three places that must stay in step: `LAUNCH_SEQUENCE_MS`/`LAUNCH_DWELL_MS` in launch-machine.ts, the delays in launch-sheet.ts, and the rail keyframe in ui-bar's IdealizeBar.module.css. Each carries a comment naming the others.
- The client slot catalog (`cordis-client-runner`) still lists the tour as the only shipped `shell.overlay` occupant until the combine regenerates it.
- HMR of any overlay plugin replays nothing: the machine settles to `done` after one play and the body attribute is gone.
