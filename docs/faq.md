# IDEalize V1 FAQ

This page answers common questions about installation, supported platforms, the bundled runtime, and plugins in the current stable release. The [latest GitHub release](https://github.com/jamiejefferson/IDEalize/releases/latest) and [user guide](user-guide.md) define the shipped product scope.

## What is IDEalize V1?

IDEalize V1 is an open-source desktop client for the IDEalize harness on Windows and macOS. It packages the harness's local web UI, Host service, and plugin system into a native desktop application with a window, system tray, Askbar, terminal, updates, and profile management.

## Is this an official DeepSeek product?

No. IDEalize V1 is an independent open-source project: a fork of [DeepSeek Harness Desktop](https://github.com/anywhere-labs/deepseek-harness-desktop) over a fork of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It is not affiliated with or endorsed by DeepSeek.

## Which operating systems are supported?

Current release installers support Windows x64 and Apple Silicon macOS. There is currently no Linux installer, and Intel Macs are not supported. Cross-platform compatibility code in the source tree does not imply that an installer has been released for that platform.

## Do I need to install Node.js, pnpm, or the harness?

No. The installer includes Electron, Node.js, pnpm, and pinned harness packages. Ordinary users can install and launch directly, and Desktop does not modify the global system PATH or user shell configuration.

## Does the first launch download a runtime?

No separate Node.js or harness download is required. The installer is larger because it contains the runtime and pinned dependencies, trading download size for a more deterministic first launch and dependency set. Cloud models, update checks, and new-version downloads still require network access.

## Does IDEalize V1 modify the harness?

No. The app consumes the IDEalize harness from tarballs vendored under `vendor/idealize/` and pinned in the root `package.json`; harness changes land in the harness repository first. Compatibility mode runs the harness's default web client. Advanced mode adds Desktop-owned layout and native window presentation through plugins without editing harness source.

## Is data stored locally?

The Desktop Host, profiles, and DSH home live on the local machine. Whether content is sent to an external service depends on the model or tool providers the user configures; requests to cloud models still go to those providers.

## Can I install plugins?

Yes. IDEalize V1 uses the harness plugin system. Choose **Open IDEalize Terminal** from the tray and run `dsh plugin add`, `dsh plugin remove`, or `dsh plugin update`. These commands default to the active profile, and Desktop must be restarted after plugin changes.

## Does the Desktop profile automatically sync with an existing web profile?

No plugins are copied automatically. Each profile has its own bundle and dependency composition. After switching profiles, default plugin commands target the active profile; `--profile <name>` can always select one explicitly.

## How are updates installed?

Packaged applications check for stable releases in the background but never install silently. A newer version requires confirmation. macOS downloads and opens a DMG; Windows downloads and starts an NSIS installer. Network and download failures leave the current installation intact.

## Where can I download the app or report a problem?

Download from [idealize.projject.ai](https://idealize.projject.ai) or the [latest GitHub release](https://github.com/jamiejefferson/IDEalize/releases/latest). Check the [troubleshooting section](user-guide.md#troubleshooting) first. If the problem remains, open a [GitHub Issue](https://github.com/jamiejefferson/IDEalize/issues/new/choose) with the operating system, app version, reproduction steps, and error details.
