# Agent Note: the tray shows the IDEalize monogram, and the plugin market starts with its partner sources

Status: implemented

JJ, 8 Sep 2026, on the landing-14 build: "Desktop menu bar shows the DeepSeek logo when I'm in IDEalize" and "Add the DeepSeek plugin sources by default; also translate the copy if possible."

## Problem

`build/tray-icon.svg` was the DeepSeek whale in `#4D6BFE`, so the macOS menu bar, the Windows notification area and the Linux tray all named the wrong product while the Dock and the window carried the IDEalize mark. In the plugin market, the `dsh-community-market` settings namespace started with `sources: []`, so a first visit showed no catalogue until the person found the Sources tab, pressed Add on a partner card and then Select. Both partner cards carried one hard-coded Chinese sentence as their description, rendered raw in the current-source row and on the Add card regardless of the app language.

## Decision

**The tray source is the IDEalize "IDE" monogram.** `build/tray-icon.svg` holds the same four paths as the harness's `FishLogo` component, centred on the 50-pixel canvas in one fill of the app's accent blue `#0757B4`, with the letter gaps widened by 0.9 units each so the I, D and E stay separate in the 16-pixel raster (at the original spacing the gaps fell under half a pixel and the letters fused). `scripts/generate-tray-icons.mjs` asserts the new fill and derives the same six bitmaps: the black-plus-alpha macOS template at 16 and 32 pixels, which the system recolours, and the fixed accent-blue Windows and Linux images at 16, 20, 24 and 32. The 32-pixel template renders crisply; the 16-pixel one reads as three letters with the E's arms at partial coverage. Runtime selection (`src/tray-icons.ts`) and file names are unchanged.

**A never-used registry is seeded on its first read.** `SettingsCatalogSourceStore.load` finds `sources` empty with no `builtInSourcesSeeded` flag, writes one record per `BUILT_IN_PROVIDERS` entry in catalogue order with the `defaultSelected` provider (DSH 1024Store) enabled and dshfind saved unselected, and persists `builtInSourcesSeeded: true` alongside them. Every `save` sets the same flag, so a registry the person empties stays empty and a registry that already held sources is never rewritten. The seed goes through the same store as Add, so `mutateSources`' duplicate rejection still applies to a seeded provider. The provider table moved to `src/catalog/built-in-providers.ts` so the store can import it without the catalogue service.

**Partner descriptions are locale keys.** Each built-in provider carries `descriptionKey: 'partnerSourceDescription'` (`MarketSourceDescriptionKey` in `api-types.ts`, a literal union so the host never imports client code); `MarketSourceView` carries it for built-in sources and `description` only for a user-added manifest. The client resolves `t(descriptionKey)` on the current-source row and the Add card. en: "A partner catalogue, on by default. A listing there is not a review or a recommendation." zh: 合作提供方目录，默认启用。目录收录不代表插件经过审核或推荐。

## Verification

`dsh-plugin-desktop/tests/package.spec.ts` asserts the single `#0757B4` fill and every generated bitmap; the generator ran and the 16- and 32-pixel templates were inspected at 16x. `dsh-community-market/tests/source-store.spec.ts` covers the seed, the second read, the flagged-empty registry, the untouched populated registry and the save-sets-flag path; `host-routes.spec.ts` reads a new registry through the state route, refuses a duplicate Add of a seeded provider and shows the registry empty after both removals; `market-settings-tab.spec.tsx` renders the translated description on the row and the card; `market-settings-persistence.spec.ts` proves the file-backed schema accepts the flag.

## Alternatives considered

**Thickening the monogram with a stroke for the 16-pixel raster.** A stroke closes the letter gaps faster than it darkens the E's arms; widening the gaps keeps the letterforms and the single fill the generator asserts.

**Seeding in the routes' read path instead of the store.** The catalogue service and the mutator both read through the store, so a route-level seed would leave a first mutation on an unseeded registry racing the state read.

**Reseeding whenever `sources` is empty.** Removing both partner sources would bring them back on the next read; the flag records that the offer was made.
