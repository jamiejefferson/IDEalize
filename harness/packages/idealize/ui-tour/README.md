# @idealize/ui-tour

The first-run showcase tour and the keyboard shortcuts sheet, both halves. The host registers the `idealize-tour` settings section (one field, `hasSeenTour`); the browser renders one occupant on the frame's `shell.overlay` seat (order 90) that plays the tour once and opens the ⌘/ shortcuts sheet, and provides two services other plugins wire into. Mounted by the `idealize` profile as the `idealize-ui-tour` row.

## Services

- `ctx.keybinds` (`KeybindRegistry`, `src/client/keybinds.ts`): register a shortcut with `{id, group, label, chords, run?, order?}`. A binding with `run` is dispatched by this plugin's document-level keydown listener; a binding without one is listed in the sheet only, which is how the composer's own keys are catalogued. A second registration with the same id replaces the first.
- `ctx.tour`: `anchor(target, element)` points a tour target at a live element (bypassing that target's default selectors while the anchor stands), `start()` runs the showcase over the targets on screen, `openKeybinds()` opens the sheet, and `holdFirstRun()` suspends the automatic first-run start while at least one hold stands, which is how `@idealize/onboarding` runs its wizard ahead of the showcase; a hold taken while the 1.4 s start delay is already running cancels it, so the showcase never starts beneath the wizard whatever order the two plugins apply in (`src/client/first-run-trigger.ts`).

## The tour

`TOUR_STEPS` (`src/client/tour-script.ts`) names eight steps: welcome (no target), sidebar, studio, composer, files, brains, askbar and rail (revised 14 Sep 2026, when a walk of the packaged first run found the old files and models steps never showing: their selectors named the frame's empty `[data-shell-dock]` row, while V1's panes live on the tool rail in the `shell.rail` seat). The composer step introduces spaces and brains, the studio step the shared group chat, the brains step the pane where models, keys and keys files are managed, and the askbar step the collapse-to-bar transform and ⌃⌥A. A step whose target does not resolve at start is dropped, so no callout points at nothing. The first-run trigger fires 1400 ms after the settings scope reads `hasSeenTour` as unset and no hold stands; finishing or reaching the last step writes `hasSeenTour: true`. A failed write replays the tour next launch.

## Default shortcuts

New chat ⌥⌘N, focus composer ⌘I, toggle sidebar ⇧⌘R, settings ⌘, and the sheet ⌘/, plus the listed-only Askbar row (⌃⌥A, which the desktop shell runs as a global shortcut so it works with no IDEalize window focused) and the composer's listed-only rows (Enter, ⌘Enter, ⇧Enter, history arrows, undo). Browser-reserved chords (⌘N, ⌘T, ⌘W, ⇧⌘N) never reach the page, which is why New chat takes ⌥⌘N.

## Model Experience

None, as the tour overlay and the keybind registry render and dispatch in the browser and register nothing that reaches a model request.

#### KV Cache effect

Independent of every model request.

## Known Limitations and Deferred Work

- **Default target selectors are string literals.** A target no plugin anchors resolves through `DEFAULT_SELECTORS`, which name other packages' DOM hooks; a renamed hook silently drops that step from the tour rather than failing loud.
- **One keydown listener serves the whole document.** A shortcut registered with `run` fires wherever focus is, and only the composer's own keys are excluded by being listed without a handler; there is no per-surface scoping.
