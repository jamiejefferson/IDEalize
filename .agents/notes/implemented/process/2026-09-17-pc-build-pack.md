# Agent Note: the PC build pack — a zip a colleague opens on a Windows PC to build the installer

Status: implemented

JJ, 16 Sep 2026: "can you /plan a package to give to a colleague so they can do the final pc-based build. i don't want them to need any context - everything should be in the pack." The next day: "so that's v1 ready to go. please package it all up ready for my colleague to prepare and test the pc version."

## Problem

The Windows installer builds only on a native Windows host (`package-win.ts` refuses anything else) and JJ has no PC and no Wine. The `windows-latest` runner that normally builds it stopped on 15 Sep 2026 with GitHub's "recent account payments have failed or your spending limit needs to be increased" on the private repo, and JJ parked that until release. The one remaining route is a colleague's PC, and that colleague must not need GitHub access, a git clone, or any knowledge of the project.

## Decision

**A zip generated from a commit, mirroring the release workflow's Windows job.** `yarn pack:pc` runs `scripts/make-pc-build-pack.ts`: `git archive HEAD` minus `.idealize/` into `source/`, the three templates from `pc-build-pack/` at the root with CRLF endings, and a `PACK.json` recording version, commit, and expected outputs. `Build-IDEalize.cmd` runs `build.ps1` under `-ExecutionPolicy Bypass`; the script checks the PC and Node, sets the two environment variables the build needs, then runs `corepack yarn install --immutable`, `corepack yarn dist:win`, `corepack yarn dist:win-portable` in `source/` and collects the outputs, checksums, and log into `OUTPUT/`. Those three commands are what `release.yml`'s `release-windows` job runs, so the pack produces the artefact the release would publish.

**No git and no submodule on the PC.** Only the full `yarn check` needs them, because `verify-layout.mjs` shells out to git and inspects the `deepseek-harness` checkout. That gate runs on the Mac before packing. `dist:win` carries its own gate (`check:win-package`: build, typecheck, the eleven Windows-relevant specs, the runtime-closure verifier) plus the installer verifier, and that is the gate the release job relies on too.

**`.idealize/` is excluded.** It holds 195 MB of tracked proof screenshots the build never reads; without it the export is 15 MB.

**The generator warns about a dirty tree and never refuses.** The archive is always `HEAD`, so uncommitted changes cannot leak into the pack; `PACK.json` names the commit exactly, and the warning tells the person packing that their working tree differs from what they are shipping.

**`assertPackContents` is the gate.** A pack missing `yarn.lock`, `.yarnrc.yml`, `dsh-plugin-desktop/scripts/package-win.ts`, `vendor/freellmapi/server.mjs` (an `extraResources` entry read from outside the desktop package) or one still carrying `.idealize/` is refused before zipping. `tests/make-pc-build-pack.spec.ts` proves each refusal and runs the real `git archive` once to assert the vendor tarballs are present and the screenshots are not.

## Traps the build script handles

- Node 25 and 26 are rejected by `package-win.ts` and ship without Corepack; the script accepts only 22.19+ and 24.x and prints the winget command and the 22.23.2 MSI link, the release CI pins.
- Corepack prompts before its first Yarn download; `COREPACK_ENABLE_DOWNLOAD_PROMPT=0` would otherwise hang a double-clicked window.
- `npm_config_build_from_source` in the environment makes `node-pty` delete its prebuilds and call node-gyp, which needs Python and Visual Studio; the script removes it.
- Native tools write progress to stderr, which Windows PowerShell 5.1 turns into terminating errors under `$ErrorActionPreference = 'Stop'` when redirected; each step runs under `Continue` and the exit code is the verdict.
- A deep unzip path risks MAX_PATH under `node_modules` and the electron-builder staging tree; the script warns past 60 characters and the README says to unzip to `C:\idealize-build`.
- `yarn install --immutable` hashes the vendor tarballs, so the pack's `vendor/` must come from the same commit as `yarn.lock`; `git archive HEAD` guarantees that.

## Alternatives considered

**GitHub access for the colleague.** A clone gives the full `yarn check`, at the cost of a GitHub account, a collaborator invite on a private repo, and git on the PC. The full gate already runs on the Mac; rejected.

**Fixing billing or going public.** Either restores the `windows-latest` job, and once the repo is public the `v*` tag builds the installer for free with nobody's PC involved. The pack does not compete with that; it is the route while the repo is private and the hold stands, and it is also V1's first run on a real PC, which the CI runner never gave.

**Building on the Mac under Wine.** `package-win.ts` refuses non-Windows hosts on purpose (the 2026-08-15 installer note); rejected.

## Consequences

- `dsh-plugin-desktop/pc-build-pack/`: `Build-IDEalize.cmd`, `build.ps1`, `README.txt`, written for a reader with no project knowledge and JJ as the only contact.
- `dsh-plugin-desktop/scripts/make-pc-build-pack.ts`, `tests/make-pc-build-pack.spec.ts`, `pack:pc` on both manifests, a README section under "Local Windows x64 installer".
- `build.ps1` cannot run on the Mac (no `pwsh`); its first real run is the first colleague's. The README asks them to send `OUTPUT\build-log.txt` and nothing else if it stops.
- Handback: the colleague returns `OUTPUT/` (the the team Drive folder). For the trial, `IDEalize-V1-Setup.exe` goes beside the keys file. For the public release, the same three files attach to the `v<version>` Release when its Windows job did not run.
