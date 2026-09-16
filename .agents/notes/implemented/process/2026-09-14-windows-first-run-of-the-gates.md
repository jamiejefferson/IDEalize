# Agent Note: Windows — the first run of the fork's gates, and a PC build the release publishes

Status: implemented

JJ, 14 Sep 2026: "please run a side test to confirm any issues with running idealize v1 on pc." No Windows machine and no Wine on the Mac, so the test was the real `windows-latest` runner: CI had started watching `main` that morning (the release-route note), and the first four runs gave the fork its first Windows results.

## Problem

**The Windows installer built and the gate then failed on a name.** `yarn dist:win` produced `dist\IDEalize-1.0.0-x64-Setup.exe` in 12 minutes and `verify-win-installer.ts` then stat'ed `dist\win-unpacked\DSH Desktop.exe`, which no longer exists: the executable follows the manifest's `productName`, `IDEalize V1` since the release route. `verify-win-portable.ts` looked for the same stale name inside the ZIP. The DMG verifiers had been fixed the same morning; the two Windows ones had not.

**The toolchain smoke never installed.** `upstream-command-windows` ran `yarn check:layout` straight after `corepack enable`; Yarn's node-modules linker refuses `yarn run` without an install state ("Couldn't find the node_modules state file"). Every other job in the file installs first.

**No PC build was ever published.** `release.yml` had one macOS job. The Windows updater requests `releases/latest/download/IDEalize-V1-Setup.exe`, an asset nothing produced, so a Windows person had nothing to download and an installed app would never have found an update.

**Two app ids.** `main.ts` announced `ai.deepseek.dsh.desktop` as the Windows App User Model ID while the manifest's `appId`, which Electron Builder writes into the Start Menu and desktop shortcuts, is `ai.projject.idealize.v1`. Windows groups taskbar buttons and routes toast notifications by that id; with two ids the pinned shortcut and the running window sit apart and the keys-file notification (`new Notification`) is dropped.

**Harness CI never runs on the fork.** `idealize-v1`'s `ci.yml` watches `master`; the fork's branch is `main`, so its Wine Windows gate and native Windows job have run on none of `packages/idealize/*`. The E2E workflow does run on every push and fails for want of a key. Not changed here: the workflow references a self-hosted Windows runner and a failover variable, and turning it on is a decision with a queue behind it.

## What the audit found clean

The IDEalize packages guard their platform calls explicitly: the Terminal CLI probe returns `null` on Windows and the Brains pane prints "unknown" for it; Reveal in Finder is a macOS-only route and the bar hides the button elsewhere; the free-tokens sidecar runs the Electron binary in Node mode with `runAsNode` fused on; the keys file arrives through `second-instance` argv on Windows, which `main.ts` scans; the embedded terminal spawns `COMSPEC`; `node-pty` ships `win32-x64` prebuilds and the manifest keeps them. The upstream desktop's Windows handling (PowerShell sandbox, ACL runner, volume diagnostics, Mica frame) is inherited unchanged and has its own tests, which pass here.

## Decision

Both Windows verifiers take `productName` from the manifest's `build.productName` through one `readWindowsProductManifest`, failing loud when it is missing, and the specs fix the executable at `IDEalize V1.exe` with a case for a wrong name. `upstream-command-windows` caches and installs before it runs anything. `release.yml` gains `release-windows`: the same tag check, `yarn dist:win`, the versioned installer plus a fixed `IDEalize-V1-Setup.exe`, its own `SHA256SUMS-windows.txt` (the macOS job's became `SHA256SUMS-mac.txt` so neither overwrites the other), and a SmartScreen line in the release body since the build is unsigned. `main.ts` announces the manifest's `appId`.

## Evidence

`check:win-package` on the Mac: 11 files, 161 tests pass, 1 skipped, before and after. The Windows runner proves the installer on the next push; nothing here publishes, since a release needs a `v*` tag.
