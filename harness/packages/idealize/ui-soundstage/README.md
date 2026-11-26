# @idealize/ui-soundstage

An entry point with nothing behind it. Until 26 Nov 2026 this package held the `soundstage` seat in the conversation view ring and drew the chat's sounds as their own list. Image, Video and Sound are now one history in one grid, so `@idealize/ui-gallery` holds all three seats, and both halves of this plugin register nothing. The package stays in the composition until it is removed from the bundle, the fixture and the desktop's vendored set in one change.

## Routes

None.

## Configuration (`idealize-ui-soundstage` row)

None.

## Model Experience

None: the package registers no tool, prompt contribution or session event.

#### KV Cache effect

Independent: nothing this package does changes a request prefix.

## Known Limitations and Deferred Work

- **The package is an empty plugin.** Removing it touches `@idealize/bundle-idealize`, `@idealize/gen-fixture` and the desktop's vendored set, and belongs in one change of its own.
