# @idealize/skin

The IDEalize brand skin, host only: the boot splash and the brand token sheet injected into the served index, plus the pre-acknowledgement that stops upstream's internal-testing notice from appearing. Mounted by the `idealize` profile as the `idealize-skin` row.

## What it injects

`injectSkin` (`src/skin-css.ts`) transforms the served `index.html` through `webServer.tapIndex`, inserting after the opening `body` tag a `<style id="idealize-skin">` sheet and the splash markup (`src/splash.ts`). The sheet carries the IDEalize preset's two palettes: IDEalize Light (`#FFFFFF` ground, `#1B1F24` ink, `#0969DA` action, `crisp` dividers) and V0's IDEalize Dark (`#2A2F35` ground, `#D5DDE3` ink, `#85C1B4` sage). Every token is `@idealize/appearance`'s `deriveTokens` over those seeds, so the sheet is the same list the appearance panel lays for the IDEalize preset (`PRESET_TOKEN_KEYS`: the grounds and surfaces, the ink steps, the borders, the brand and button fills including the send button's `button-info` pair, the business highlight, and the error, warning and success text colours deepened along their hue until they read on each ground), plus the code font token (DM Mono) and the `--idealize-type-*` pane type scale. It sits after the head-linked token sheets in document order, so equal-specificity redefinitions win.

The splash is inline markup with no requests: the owl frames as data URIs, the "IDEalize" wordmark and "What shall we make?" over the brand ground, shown from the first byte of HTML until the client mounts or a 10-second hard timeout. The frames are exported for other host packages as `SPLASH_FRAMES`, and the run cycle's first frame as `OWL_FRAME_STILL` (`@idealize/askbar` serves it as the Studio tile's owl).

`suppressUpstreamWelcomeNotice` (`src/welcome-ack.ts`) writes `welcomeNoticeVersion` into the `ui-onboarding` settings section once, only when no value is stored, so a user who acknowledges a later notice is never overwritten.

## Model Experience

None, as the package injects a stylesheet and splash markup into the served page and writes one settings acknowledgement; nothing reaches a model request.

#### KV Cache effect

Independent of every model request.

## Known Limitations and Deferred Work

- **The suppressed notice version is restated by hand.** `NOTICE_VERSION` mirrors `packages/client/ui-settings-models/src/onboarding-copy.ts`; when upstream bumps its notice the dialog reappears once until this constant follows.
- **The sheet is fixed at serve time.** It is rendered once per process from the IDEalize seeds; per-user colour edits are `@idealize/appearance`'s override layer over it, never an edit of this sheet, so a page without the appearance client paints the brand and nothing else.
