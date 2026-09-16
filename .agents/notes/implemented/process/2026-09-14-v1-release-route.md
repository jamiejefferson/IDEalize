# Agent Note: the V1 release route — one self-signed DMG, GitHub Releases, a keys file for the team

Status: implemented

JJ, 14 Sep 2026: "need to make a deployment plan for v1. 1. public version - accessible via the website and github. 2. the team only version that includes eqtr api keys for claude, openrouter, and fal, so it's ready to go." Decided the same day: no Apple Developer ID (self-signed, like the V0 app), open-source both repositories under MIT, one public build for everyone plus a `.idealizekeys` file for the team, shared through a Google Drive folder limited to the example.com domain. JJ, later the same day: "please don't push the product live yet. just get everything ready."

## Problem

Nothing was releasable. The manifest said `IDEalize` / `ai.projject.idealize` while the only script anyone ran (`package:dir`) forced `IDEalize V1` / `ai.projject.idealize.v1`, so a DMG would have installed a differently named app over a different data folder from the one JJ uses. The DMG verifiers still looked for `DSH Desktop.app`. The update checker read a version service that answers 404 and the downloader fetched from the upstream project's Chinese CDN. CI watched `master` on a repository whose branch is `main`, so no gate had run since the fork; the packaging gate itself failed on a missing submodule, stale bilingual-pair records and a verifier that predated the `idealize` CLI shim. The version was upstream's `2.0.1`.

## Decision

**One identity, the one JJ already runs.** The manifest now carries `IDEalize V1` and `ai.projject.idealize.v1`, `package:dir` forces nothing, and the release DMG is `IDEalize-V1-<version>-universal.dmg`. JJ's data folder (`~/Library/Application Support/IDEalize V1`) is untouched, and the Swift V0 app at `/Applications/IDEalize.app` is left alone. Shipping as plain `IDEalize` was the plan's first assumption; it fell when an older `IDEalize` data folder with a stale harness turned up on JJ's Mac, which would have made any migration a guess. Renaming later needs a migration and its own note.

**The public build is the smoke build.** `yarn dist:mac-public` runs `scripts/package-mac.ts --public`: the same headless gates, universal DMG and verifier as `dist:mac-smoke`, into `dist/mac-public`. There is no notarisation because there is no Developer ID; `install.sh` clears the quarantine flag as V0's installer did, and the release notes carry the `xattr` line for a manual install.

**GitHub Releases is the only release infrastructure.** `release.yml` runs on a `v*` tag, checks the tag names the manifest version, builds the DMG, and publishes it under its versioned name and again as `IDEalize-V1-mac.dmg`, with `install.sh` and checksums. The update checker reads `releases/latest` (its `tag_name`, 256 KiB cap) and the downloader follows `releases/latest/download/IDEalize-V1-mac.dmg`, so the app never parses an asset list and nothing has to be set in a console after publishing.

**the team's keys travel as a file, not a build.** See [the keys-file note in the harness](../../../../../idealize/.agents/notes/implemented/feature/2026-09-14-keys-file-import.md) for the mechanism; `scripts/issue-keys-file.mjs` writes the file from environment variables so the keys never enter either repository.

**Version 1.0.0** on both manifests. The tag `v1.0.0` is JJ's to push; this note records the route, and nothing here publishes.

## Alternatives considered

**A second build with the keys baked in.** Extractable from the ASAR by anyone holding the DMG; every rotation a rebuild. Rejected in the plan.

**Keep the version service at idealize.projject.ai.** A Vercel function proxying GitHub would have kept the app's checker unchanged, but it is one more thing to run and to keep pointed at the right release. The release itself is the source of truth.

**Rename to `IDEalize` now.** See the identity decision above.

## Consequences

- `scripts/verify-mac-smoke.ts` and `verify-mac-release.ts` look for `IDEalize V1.app`; `tests/package.spec.ts` pins the identity and the `.idealizekeys` file association.
- `scripts/verify-cli-runtime.mjs`, `verify-loader-boot.mjs`, `verify-profile-boot.mjs` and the two proof scripts pass `idealizeCliPath`, which the pnpm runtime has required since the `idealize` shim was added; the gates had not run since.
- `dsh-community-market` bilingual-pair records are re-recorded for edits made on 8 Sep without them; the root `README.i18n.yaml` is re-recorded for the rebranded `README.en.md`. The Chinese `README.md` is untouched (fork docs are English-only, JJ, 1 Sep 2026).
- `ci.yml` watches `main`. The macOS job builds the smoke DMG on every push again.
- The universal DMG carries onnxruntime's Apple Silicon slice only: onnxruntime-node 1.24 publishes no macOS Intel binary, so `x64ArchFiles` names its files as per-arch and transcription is Apple Silicon only in V1; everything else runs on both.
- Windows targets stay in the manifest, unbuilt: the downloader's Windows URL names an asset no release carries yet.
- Going live is a checklist, not code: push the tag, flip both repositories public, deploy the site change, share the Drive folder.
