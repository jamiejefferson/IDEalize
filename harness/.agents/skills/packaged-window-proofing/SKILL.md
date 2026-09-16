---
name: packaged-window-proofing
description: Prove UI fixes on the packaged IDEalize V1 Electron window, not just headless — the three failure modes that made headless passes lie, and the isolation rules for proof runs.
---

# Packaged-window proofing

Round 2 passed ten headless checks; JJ then hit real faults on the packaged window. Three mechanisms caused every divergence — check them before claiming a visual/behavioural pass:

1. **Solver caps.** Layout maths differs at the real window's size: asserting a stored preference (drawer width) is not asserting the rendered width. Measure the rendered element at 1280×840 on the packaged app.
2. **Mode-dependent composition.** The desktop serves a different plugin graph per shell mode (mini/advanced have no rail; only compatibility has the full frame). Confirm which mode the window is in (`dsh-desktop.mode` in `<data>/harness/settings.yaml`) before judging anything missing.
3. **Error-path splits.** A rejected prompt lands on `promptError`; an accepted-then-failed turn arrives as a `turn-error` chat node. Cover both paths or the packaged app will show the one you never rendered.

4. **Overlays that mount beneath a higher occupant.** The first-run tour mounted under the wizard on two boots of five (14 Sep 2026): reading the DOM after the wizard closed showed a tour that "appeared 4 ms later", and the real start was 1.2 s after boot. Poll the DOM every 200 ms from the FIRST CDP target through the whole sequence, and time each overlay's mount against the others; a state read after the fact cannot tell an early mount from a late reveal. Race-shaped faults need at least four fresh boots, fast and slow, before a pass means anything.

## How to drive the packaged surface

- playwright-core's Electron launcher against `dsh-plugin-desktop/lib/main.js`, `--user-data-dir` on a scratch dir, window 1280×840.
- The renderer only boots with the query markers: `?dsh-desktop-mode=<persisted mode>&dsh-desktop-platform=darwin` — a bare loopback URL fails with "waiting for service: layout" by design.
- To test harness changes in the shell, vendor your built packages into a **throwaway copy** of the desktop repo, never into `~/dev/idealize-desktop` itself.

## Isolation rules (each violated once, at real cost)

- `DSH_HOME` alone is not enough — verify the booted host actually bound your scratch home before the run touches sessions/settings (one proof run edited JJ's live appearance settings; another wrote real feedback rows).
- `screencapture` from a worker shell returns black without screen-recording permission; capture the renderer headlessly instead.
- Full `pnpm run lint`/typecheck results are unreliable while any concurrent build rewrites `lib/types` — a "22 pre-existing errors" report on a loaded machine is usually this; re-run on a quiet tree before believing it.
