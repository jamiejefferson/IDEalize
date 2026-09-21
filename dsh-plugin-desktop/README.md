# IDEalize V1 desktop package

`dsh-plugin-desktop` runs the IDEalize harness in Electron while remaining part of the ordinary Cordis composition. The installed application is named **IDEalize V1**. The package provides the `dsh-plugin-desktop` executable and the `dsh-desktop` alias; the registered npm package name is the reliable `npx` entry.

## Architecture

The Electron executable is minimal bootstrap code. It acquires the single-instance lock, resolves the selected profile, provides the native runtime capability, and boots the Host Cordis root in the Electron main process. The `desktop-shell` Host plugin owns the `BrowserWindow`, navigation policy, settings namespace, and close-versus-quit lifecycle through Cordis effects. The native runtime owns the physical tray, while `desktop-shell`, `desktop-profiles`, `desktop-terminal`, and `desktop-updates` contribute effect-scoped commands through its ordered item registry.

Both presentation modes reuse the existing loopback Web carrier. The profile mounts the ordinary `dsh-base` and `dsh-web-app` bundles, the Host binds its HTTP and WebSocket surface to `127.0.0.1` on an ephemeral port, and Electron loads that same-origin page in a sandboxed renderer. There is no Electron-owned plugin roster, preload bridge, or raw Electron API in the renderer.

The desktop package has normal Host and Web Client faces. Its Client face validates the Host-supplied mode and platform markers in both modes. Compatibility then returns without registering services, slots, styles, or presentation; advanced mode installs the desktop layout service and root presentation described below. Third-party Web clients continue to use the ordinary DSH module graph in both modes.

The tray profile selector lists existing profiles and the lazily available `desktop` and `web` defaults. A selectable profile directly composes `dsh-base` before `dsh-web-app`; headless, malformed, or already desktop-embedded profiles remain visible but disabled. `desktop` is the only launcher-managed profile: its installation-owned prefix is repaired while third-party bundle order is preserved. Every other selected profile keeps its manifest, user patch, and dependencies unchanged. The launcher inserts its own desktop layer after `dsh-web-app` for the active generation and never persists that layer in the selected bundle list.

Profile selection is desktop-owned state under Electron user data, not another field inside a selected profile. A switch is recorded as pending and takes effect through an orderly restart. The new profile becomes last-known-good only after the Cordis tree and native window mount successfully; the tray is created after the Web surface loads, and that state commit completes synchronously before tray commands can run. A failed pending generation is rolled back and relaunched once. Official profiles use the same DSH home for sessions, settings, and storage by default, so switching does not copy or migrate records. A custom profile patch may deliberately redirect one of those persistence roots.

Before Loader entries mount, the launcher registers the generation-scoped `ctx.desktopProfiles` service. Its immutable `current` value contains the active profile's `name` and absolute `dir`; `list()` performs read-only discovery, while `select(name)` serializes persistence-before-restart switching without changing the live generation in place. The service is a Desktop Host capability, not a renderer bridge or an active-profile API supplied by the harness itself.

Bare Cordis plugin imports resolve from the persistent profile. A narrow Node resolve hook applies only to imports issued by `@deepseek-ai/cordis-plugin-loader`, so profile-local third-party packages and the healed launcher fallback use the same resolution path even when packaged Electron does not expose Node's internal ESM loader.

Before profile preparation and Cordis boot, a packaged macOS or Linux launch runs the configured account shell in interactive login mode and recovers its exported `PATH`. This repairs the minimal `PATH` commonly supplied by Finder, LaunchServices, and other graphical launchers. It also fills only missing locale, toolchain, package-manager, and virtual-environment exports from a fixed allowlist; `PATH` alone always uses the shell value. Recovery supports absolute `zsh`, `bash`, and `fish` paths. Bash follows its standard login behavior, so `.bashrc` contributes only when a login profile sources it. Windows and unpackaged or development launches skip recovery. An unavailable or unsupported shell, timeout, capture failure, or missing `PATH` silently retains the inherited process environment.

The capture starts from `@deepseek-ai/dsh-subprocess`'s `scrubbedParentEnv()`, and captured names pass the same `SENSITIVE_ENV_PATTERN` and `DSH_ENV_PREFIX` checks before the fixed allowlist is applied. Credentials, `DSH_*` values, proxy and SSH-agent settings, and process startup hooks learned only from shell rc files are therefore not imported into Electron. This recovery does not erase values already present in Electron's explicit launch environment. Ordinary harness subprocesses apply the official scrub again; an explicit child environment may still deliberately add a value.

After login-shell recovery, the launcher creates the layered launch-environment snapshot. It then prepends a private command directory containing only the pinned bundled `pnpm` command to the current Electron main process `PATH`. Host and third-party plugins can therefore discover that package manager from startup, including through ordinary harness subprocess providers, without requiring a system Node.js installation. This ambient path is a compatibility surface, not the formal plugin-management contract.

The `desktop-pnpm` Host row provides `ctx.desktopPnpm` for managed package operations against the immutable active profile. `run(args, signal?)` executes packaged pnpm directly in the active profile directory; it is a low-level operation and does not promise profile initialization, caller-relative source anchoring, or bundle reconciliation. `runPlugin(args, invokingDir, signal?)` instead starts the packaged `dsh plugin --profile <active>` command from the caller's absolute directory. Plugin installation, removal, update, and dependency repair must use `runPlugin()` so the upstream CLI remains authoritative for relative `file:` and `link:` specifications, the pnpm profile working directory, first-use initialization, and successful `dsh.profile.bundles` reconciliation.

Both methods return live stdout and stderr streams, a `done` promise that settles after the complete process tree exits, and `cancel()`. One operation may run per generation. The service uses the ordinary harness subprocess provider, exact packaged JavaScript entries, shell-free argv, and child-scoped DSH home, Electron-backed Node, CI, and native-module ABI values. The public runtime path still does not expose `node` or `dsh`; its private helper and the `ELECTRON_RUN_AS_NODE` and npm ABI variables exist only inside package-manager subprocess trees. The launcher does not modify the system `PATH`, shell startup files, profile configuration, or `.env` documents.

Plugin authors should use the supported contract imports, lifecycle rules, and adaptation patterns in the [Desktop plugin service architecture](docs/plugin-services.md).

## Mode setting and restart boundary

The `dsh-desktop.mode` field in the DSH home `settings.yaml` document is the single source of truth:

```yaml
dsh-desktop:
  mode: compatibility # or advanced
```

The launcher reads the same file resolved by the active `@deepseek-ai/dsh-settings-file` row before composing a generation. The Host registers the `dsh-desktop` namespace with the standard settings service. There is no parallel mode value in the profile manifest.

Users can select the other mode from the tray or edit the DSH home `settings.yaml` document by hand. The tray updates the registered `dsh-desktop` settings namespace, while a manual edit changes the same file observed by the settings provider. A committed change requests one orderly restart: the current Cordis tree disposes first, then Electron relaunches only after a successful zero-code shutdown. The application never hot-swaps root slots, native window materials, or Loader rows inside a live renderer generation.

Linux supports compatibility mode only. Its tray mode command is disabled, and an advanced value is rejected rather than silently falling back.

The legacy `mini` value written by the pre-Askbar shell still validates; every read normalises it to `compatibility` and logs one warning, so an older `settings.yaml` never blocks a launch.

## Askbar

The Askbar is a frameless, always-on-top 72 CSS-pixel column docked to a screen edge and alive for the whole application lifetime. It stays hidden until the user collapses to it, so the bar and the main window are never both on screen. Ctrl+Alt+A (a global shortcut), the tray command `Collapse to Askbar` / `Expand from Askbar`, and the harness's `desktopActions.collapseToBar()` / `expandFromBar()` run the transform: collapse shows the bar and glides the main window toward it before hiding it; expand restores the main window on its remembered frame and hides the bar. The transform never restarts the application. `dsh-desktop.askbarSide` (`left` by default, or `right`) selects the edge; the tray submenu `Askbar edge` writes the same setting and the bar re-docks live. The bar is movable: its background is a drag region (buttons and fields stay clickable), and where a drag leaves it is written to `dsh-desktop.askbarPosition` as `{ displayId, x, y }`. Every show places the window before it paints, at the stored position while that display is attached (clamped into its work area, full height) and otherwise docked by `askbarSide` on the display under the cursor; a post-show re-placement remains as the fallback for the macOS cascade. A stored position must name all three fields or the settings file fails its load. `yarn verify:askbar-transform` boots the real Electron runtime on a scratch home and proves the three visibility states.

## Compatibility mode

`dsh-desktop.mode` defaults to `compatibility`. This mode creates a normal operating-system window with its native frame and loads the official Web surface from the active DSH profile. macOS suppresses the visible page title. Windows retains the native caption icon and displays the application name, but removes the window menu bar. The operating system owns native title-bar color and appearance.

The desktop Client module validates the mode and platform markers, then performs no presentation replacement in compatibility mode. It does not provide or replace the `layout` service, register a `root` or `sidebar` occupant, or change the conversation surface. Desktop-owned boot-health reporting and local folder drop are capability effects; compatibility mode still preserves the selected profile's own layout, sidebar, and conversation composition, so the ordinary `desktop` and `web` profiles keep the official rows unchanged.

The Cordis row registers native window values during profile activation. The launcher creates the window only after `app-boot` settles and audits the complete profile, so the first renderer manifest includes the active official, desktop, and third-party client plugins without a Loader-wide wait inside the plugin itself.

On Windows, the launcher pins the browse directory-picker backend and keeps the full in-app directory panel. The desktop build patches that panel with a small system-folder icon whose same-origin route calls Electron's `dialog.showOpenDialog`; a selected path returns to the panel's existing workspace-adoption flow, while cancellation leaves the panel open. Ordinary browser and remote launches do not receive the desktop bridge. macOS and Linux retain the upstream adaptive chooser.

On every desktop platform and in both presentation modes, one local folder can be dragged onto the left Workspace region. The isolated preload uses Electron `webUtils` only to resolve that operator-dropped `File`, after which the Client reuses the official `workspaces.create` and `startSession` flow. Ordinary files, multi-item drops, and internal Workspace or Session reordering do not trigger directory adoption; the Host remains responsible for path canonicalization, directory validation, and idempotent reuse of an existing Workspace.

Windows PowerShell keeps the upstream `pwsh-sandbox` behavior and Windows ACL confinement in both presentation modes. The launcher generation replaces only that Host provider with the `dsh-plugin-desktop/windows-pwsh-sandbox` subpath from this same package. For the exact upstream ACL-runner argv, the adapter launches the packaged Electron executable in Node mode through a private trampoline, removes the Node-mode variable before the restricted PowerShell process is created, and delegates all policy and failure handling back to the upstream runner. The desktop deploy root also pins a Yarn patch that combines `STARTF_USESHOWWINDOW` with the existing `STARTF_USESTDHANDLES` and `SW_HIDE` on both native restricted-process paths. This preserves captured stdio without suppressing console allocation and requests a hidden initial show state when Windows creates the GUI-hosted PowerShell process's first console window. It does not use the upstream-incompatible `CREATE_NO_WINDOW` or `CREATE_NEW_CONSOLE` flags. Direct `danger-full-access` PowerShell, macOS, and Linux execution are unchanged; there is no automatic unrestricted fallback when Windows confinement fails.

## Advanced mode

Advanced mode is an explicitly composed desktop presentation for macOS and Windows. After all user patches have been read, the launcher disables the official `ui-layout` Loader row, keeps the official `ui-sidebar` and `ui-conversation` rows enabled, and applies the selected mode to `desktop-shell`.

The desktop Client then provides the `layout` service for its own Cordis-fiber lifetime and registers only the `root` slot occupant. Its root declares seats for the unchanged upstream sidebar, conversation, details, and overlay contributions. The official sidebar remains the `sidebar` occupant and continues to declare the workspace browser, settings shell, and additive footer-action seats. This preserves its component behavior, collapse animation, and third-party extension points while the desktop package owns only frame geometry and native material.

The advanced theme presenter projects the active upstream theme snapshot onto the document, including color scheme, resolved token values, dark-mode marker, and theme-color metadata. It subscribes to ordinary theme changes and removes only its own projected state when the generation disposes.

For an advanced generation, the Electron adapter also reads the registered `ui-theme.preference` after Host boot and mirrors its built-in `light`, `dark`, or `system` value into Electron's native appearance before constructing the window. Committed preference changes update the native material while the window is active, and disposal restores the preceding Electron appearance. Client-only third-party theme ids do not change this Host preference.

The desktop sidebar surface scopes the upstream sidebar-fill token to transparent, so the official sidebar and session-list fade reveal the native material without changing their component styles.

On macOS the advanced window uses a transparent hidden-inset title bar, positioned traffic lights, and native `sidebar` vibrancy. Its 90 CSS-pixel collapsed column centers the official 56-pixel rail below a desktop-owned traffic-light inset. The sidebar surface itself is non-draggable; a desktop-owned transparent 32 CSS-pixel strip to the right of the traffic lights supplies its window drag target. A separate caption row reserves 20 CSS pixels above the complete conversation and details surfaces while exposing another transparent 32 CSS-pixel drag target. Buttons, links, inputs, dialogs, and contributions that explicitly declare `app-region: no-drag` remain interactive; a custom pointer target placed within the top 32 pixels must declare the same exclusion. On Windows the official sidebar keeps compatibility geometry: 56 pixels collapsed, 280 pixels by default when expanded, and the same upstream transition behavior, while its transparent surface reveals Mica. The window uses a hidden title bar with native controls, transparent overlay, Mica background material, shadow, rounded corners, and a thick resizable frame. Electron exposes the system-drawn Mica material on Windows 11 22H2 and later. A desktop-owned 32 CSS-pixel caption row spans the Windows conversation and details columns; the complete upstream slot surfaces start below that row, so official and third-party header contributions keep their ordinary relative layout without element-specific caption offsets. Linux rejects advanced mode rather than silently falling back to a presentation different from the persisted setting.

## Development

This package is managed by the Yarn workspace at the repository root. The sibling `deepseek-harness/` checkout remains an independent upstream pnpm project and is not part of the Yarn workspace. Install and verify IDEalize V1 from the repository root:

```sh
yarn install
yarn check
```

The check verifies that every required first-party peer in the production graph is declared by the desktop deploy root. Headless Loader smokes activate the launcher-owned desktop row and a profile-local third-party row, then boot the published Web profile and inspect its loopback root and client manifest. Unit and type tests cover both profile compositions, restart fencing, client environment validation, desktop layout state, and platform-native window options.

Start the desktop application explicitly when a graphical session is available:

```sh
yarn dev
```

`dev` builds before launching. It does not require a separate manual build.

The headless-safe launcher surfaces can be exercised without importing or starting Electron:

```sh
node lib/bin.js --help
node lib/bin.js --version
```

## Plugin workflow

Manage any profile with the `dsh` command:

```sh
dsh plugin --profile desktop add third-party-plugin
dsh plugin --profile desktop remove third-party-plugin
dsh plugin --profile desktop update
```

The application starts with `desktop` by default. Choose another Web-capable profile from the tray's **Profile** submenu; switching profiles restarts the application. The generated terminal defaults bare commands to the currently active profile, so the shorter forms below modify that profile directly:

```sh
dsh plugin add third-party-plugin
dsh plugin remove third-party-plugin
dsh plugin update
```

An explicit `--profile <name>` remains authoritative and is useful for preparing another profile before selecting it.

`dshmarket@1.2.3` is not preinstalled and is not a dependency of IDEalize V1. That release still resolves a profile from config/argv and starts `dsh plugin` through private child-process code; it neither reads `desktopProfiles` nor uses `desktopPnpm`, and its package exports no runner injection seam. A later compatible release must detect the Desktop services dynamically and retain its existing CLI fallback under ordinary DSH. In addition, the `1.2.3` source repository and npm tarball contain no complete MIT license text or copyright notice, so that version does not pass the bundled-redistribution gate. User-directed installation of a third-party package is separate from Desktop embedding it in the application archive or installer.

See [Plugin services for authors](docs/plugin-services.md) for required injection, optional Desktop adaptation, TypeScript examples, cancellation, and fallback guidance.

The package can then be launched from npm with:

```sh
npx dsh-plugin-desktop
```

## Launching from the command line

The package installs two equivalent commands, `dsh-desktop` and `dsh-plugin-desktop`. Both launch the packaged Electron launcher (`lib/main.js`) when invoked without arguments.

- **Global install** — `npm install -g dsh-plugin-desktop` installs the `electron` peer automatically, and `dsh-desktop` then starts the application against the default DSH home:
  ```sh
  dsh-desktop
  ```
- **Inside a profile** — after `dsh plugin --profile <name> add dsh-plugin-desktop`, the command lives in the profile's `node_modules/.bin`. pnpm does not install the `electron` peer automatically; add it when you want the command to launch:
  ```sh
  dsh plugin --profile <name> add electron
  ```
  Native build approvals (node-pty, koffi, electron, and others) follow pnpm's usual `allowBuilds` rules.
- **Electron missing** — the command prints a short installation guide instead of failing with a module error.

Booting a profile that is composed with the desktop shell under an ordinary `dsh` invocation (without the launcher's `desktopRuntime` service) prints a reminder telling you to start it with `dsh-desktop` or from the packaged application; the shell registers nothing in that case.

A third-party Host plugin only needs its normal `dsh.bundle` patch. A plugin with browser UI also publishes the normal `dsh.client` metadata with `platform: "web"` and an exported `./client` artifact. The upstream Web client module graph discovers it in both modes; Electron does not require a separate client build or a desktop-specific registration API. Advanced-mode contributions must target services and slots that exist in that explicit composition rather than assuming the official layout or sidebar occupant owns them.

## Keys file

A `.idealizekeys` file is how an organisation hands its API keys to a person in one action. Double-clicking one opens IDEalize (the manifest's `fileAssociations` registers the extension with Launch Services and the Windows registry) and the app posts the document to the Host's `POST /idealize/brains/services/import`, which stores every key where its service keeps it and records the chat routes' `apiKeyEnv`; a native notification then names the services connected, or the host's reason for refusing the file. On macOS the file arrives as an `open-file` event, which can fire before the Host is up, so `src/main.ts` holds the path until the import route exists; Windows and Linux put the path in the argument list, which `second-instance` scans. `src/keys-file.ts` recognises the extension, refuses a file over 64 KiB without sending it, and reads the outcome; the Host owns what a keys file may say (`@idealize/services` README). The Brains pane's add flow carries "Import a keys file…" for a file already on disk.

`scripts/issue-keys-file.mjs` writes one from the keys in the environment (`ANTHROPIC_API_KEY=… OPENROUTER_API_KEY=… FAL_KEY=… node scripts/issue-keys-file.mjs "IDEalize Acme keys.idealizekeys" Acme`), so keys never enter a repository. Whoever holds the file holds the keys: it is neither encrypted nor kept, it travels by a channel that limits who can open it, and rotating a key means reissuing the file.

## Finder Quick Action

On macOS the app writes a "Idealize this" Quick Action workflow into `~/Library/Services` on every launch (`src/finder-quick-action.ts`), rewriting it only when the shipped text has changed. Right-clicking a folder in Finder and choosing it opens the app on `idealize://project?path=…`; macOS delivers that as an `open-url` event, which `main.ts` holds until the Host and a window exist and then pushes onto the bridge feed as an open-folder request, so a cold start begun from Finder still lands on the folder.

On Windows the NSIS installer registers the same entry (`build/installer.nsh`, named by `nsis.include`): a `customInstall` macro writes an `IdealizeThis` verb labelled "Idealize this" under `Software\Classes\Directory\shell` and `Software\Classes\Directory\Background\shell`, in the hive the install mode selects (HKCU for a per-user install), and `customUnInstall` deletes both keys. The verb's command is `"<install dir>\IDEalize V1.exe" "--idealize-project=%V"`. The folder travels as a switch because the registry substitutes the raw path and cannot percent-encode it into an `idealize://` URL; `requestFromArgv` in `src/idealize-url.ts` reads the switch from `process.argv` on a cold start and from the `second-instance` argument list when the app is already running, and both feed the same open-folder request. The same macro writes `InstallLocation` into the app's uninstall entry, which electron-builder's template leaves blank (PC test drive, 18 Sep 2026). The portable ZIP has no installer and gets neither.

## Desktop operations

Packaged macOS and Windows applications read the latest GitHub release of `jamiejefferson/IDEalize` (`https://api.github.com/repos/jamiejefferson/IDEalize/releases/latest`) 60 seconds after startup and every six hours after a completed check. Each no-cache request has a 15-second deadline and shares one in-flight operation with the **Check for Updates…** tray command. The release's `tag_name` is the published version and is accepted only as canonical stable Semantic Versioning with an optional leading `v`; a draft or prerelease never reaches that endpoint. Background network, HTTP, timeout, invalid-response, equal-version, and older-version outcomes are silent. A manual check always opens a native result dialog: equal or older results report the installed version, failures ask the user to retry, and a strictly newer version uses the **Download** or **Later** prompt. Automatic update prompts are remembered per version, while the tray can retry explicitly. Development, unpackaged, and Linux launches do not download an installer.

Choosing **Download** first rechecks that the advertised version is unchanged, then requests the platform's fixed latest-download URL (`…/releases/latest/download/IDEalize-V1-mac.dmg`, `…/IDEalize-V1-Setup.exe`), which GitHub redirects to the current release's asset. The app follows the redirect through Electron networking, streams at most 1 GiB into a private versioned user-data directory, and rejects an incomplete DMG or Windows PE before exposing it. On macOS it opens the downloaded DMG and tells the user to replace the application in `Applications` and reopen it. On Windows it asks again after the NSIS installer is ready; **Restart and Install** launches that installer and requests orderly Cordis teardown before the current process exits. Download, filesystem, and installer-opening failures remain silent and leave the available-version tray action retryable.

Publishing a release is pushing a `v<version>` tag (`.github/workflows/release.yml`): the workflow builds the universal DMG with `yarn dist:mac-public`, uploads it under its versioned name and again as `IDEalize-V1-mac.dmg`, attaches `install.sh`, and creates the GitHub Release the checker reads. The version is discoverable the moment the release is published; a release created as a draft stays invisible until it is published.

On macOS and Windows, **Open IDEalize Terminal** opens a system terminal rooted at the active profile. Its welcome text identifies the application version, active profile, profile directory, and DSH home, then lists configuration and plugin-management commands. Inside this terminal, bare `dsh`, `dsh --dump-config`, and plugin subcommands without a profile selection default to that active profile; an explicit `--profile` and the upstream `web` alias keep their original meaning. IDEalize V1 generates private per-profile `dsh`, `pnpm`, and `node` shims under its user-data directory, sets `DSH_HOME`, uses the active profile as the working directory, and prepends the shim directory only to that terminal's `PATH`. A later profile switch therefore does not change commands in an already open terminal. It does not edit the global environment or shell startup files. The macOS launcher preserves the user's interactive zsh or bash setup before restoring the desktop-owned values. Windows selects PowerShell 7, Windows PowerShell, or Command Prompt in that order and opens it in a new Windows Terminal window; when `wt.exe` is unavailable, a private `cmd start` broker creates a visible console instead. Synchronous launch failures and unsuccessful broker exits are shown in a native error dialog. Linux does not compose the terminal command.

## Logs and diagnostics

IDEalize V1 writes UTF-8 logs under Electron's user-data directory: `%APPDATA%\IDEalize V1\logs` on Windows and `~/Library/Application Support/IDEalize V1/logs` on macOS. Full logs use `dsh-YYYY-MM-DD.log`; warnings and errors are also written to `dsh-YYYY-MM-DD.error.log`. Files rotate at 10 MiB, files older than seven days are removed at startup, and the directory is kept below 200 MiB. Every append blocks Electron's main thread, so `info`, `warn` and `debug` lines wait up to 100 ms and a burst lands as one append per file; an `error` line, shutdown and a startup header write everything waiting at once. The `dsh-desktop.logLevel` setting controls verbosity and defaults to `info`.

The HTTP cache is cleared at every launch: the Host takes a new loopback port each time, so responses cached for an earlier launch's origin are never requested again. On macOS and Linux the final native exit is bounded from outside the process: a detached `/bin/sh` watchdog kills the application 10 seconds after `app.exit` if Electron's Node cleanup has not finished.

On macOS and Windows, choose **Export Diagnostics…** from the tray to create a ZIP under the sibling `diagnostics` directory and reveal it in the system file manager. Export runs outside Electron's main thread, includes at most the newest 50 MiB of owned logs plus `system-info.txt`, and retains the three newest ZIP files. The confirmation dialog explains the privacy boundary before any archive is created. Recognized credentials are masked, but logs can still contain local paths, workspace IDs, session IDs, prompts, tool output, or third-party plugin messages. Review the ZIP before sharing it, especially before uploading it publicly.

## Native lifecycle

Closing the window hides it while the Host Cordis tree continues running. The tray reopens the window, selects the active profile, opens the isolated terminal, checks for a stable release, changes mode through the standard settings namespace, or requests an explicit quit. Profile and mode changes both dispose the current Cordis tree before Electron relaunches. Native quit, `SIGINT`, and `SIGTERM` also request disposal before exit; a five-second deadline or a repeated request forces the final exit. Navigation and redirects remain on the exact loopback origin; external HTTP, HTTPS, and mail links open in the operating system, while the renderer uses `contextIsolation`, the Chromium sandbox, and no Node integration.

## Packaging

`yarn package:dir` creates an unpacked directory for the current host platform. The packaged-runtime gate rejects an application archive that omits the desktop update and terminal modules, the `dsh` CLI bootstrap, the bundled pnpm entry, or the physical deployment package. Electron Builder emits the root manifest, desktop runtime, and complete dependency tree under `app.asar.unpacked`; both Host profile boot and the CLI bootstrap use this physical tree so profile-fallback symlinks never target a virtual ASAR directory. `build/app-icon.png` remains the unmodified iOS Default source and the Windows/Linux application icon. The build runs `scripts/generate-mac-app-icon.mjs` to center that artwork at 824 by 824 pixels on a transparent 1024 by 1024 canvas; macOS packaging and the live Dock both use the generated `build/app-icon-mac.png`. `build/tray-icon.svg` is the tray source: the IDEalize "IDE" monogram (the same paths as the harness's `FishLogo`) on a 50-pixel canvas, its letter gaps widened by 0.9 units each so the three letters stay separate in the 16-pixel raster, in one fill of the app's accent blue `#0757B4`. The build derives a macOS template image that the system colours automatically and fixed accent-blue Windows and Linux tray images.

### WSL Linux headless checks

WSL2 is suitable for Linux headless build, typecheck, and unit-test coverage from a Windows workstation. Use a Linux Node.js installation inside WSL, not the Windows Node.js or Corepack shims that WSL can inherit through the mounted Windows `PATH`. When using `nvm`, start each shell with `source ~/.nvm/nvm.sh` before running Corepack commands:

```bash
source ~/.nvm/nvm.sh
git submodule update --init --recursive
corepack yarn install --immutable
corepack yarn workspace dsh-plugin-desktop typecheck
corepack yarn workspace dsh-plugin-desktop test
corepack yarn build
```

Commands run from `/mnt/<drive>` are valid but slower than a checkout stored on WSL's native ext4 filesystem. WSL does not replace a real Linux desktop session for tray, window-manager, `.desktop` integration, or installed-package smoke tests.

### Local Windows x64 installer

Use a native Windows x64 machine with Git and x64 Node `22.23.2` (the same release used by CI). The packaging command accepts Node `22.19+` and Node `24.x`, whose official distributions include the required Corepack command. From PowerShell in a fresh `main` checkout, run:

```powershell
git submodule update --init --recursive
corepack.cmd yarn install --immutable
corepack.cmd yarn dist:win
```

Python and Visual Studio C++ Build Tools are not required. The Windows command uses `node-pty`'s bundled x64 Node-API binaries instead of asking Electron Builder to rebuild them from source, and the packaged-runtime gate rejects an installer staging tree that omits those binaries.

`dist:win` refuses non-Windows and non-x64 hosts, runs a Windows-safe gate containing the build, all TypeScript compiler faces, packaging and native-shell focused tests, and the runtime-closure verifier, then builds an assisted NSIS installer and verifies both generated PE files. The full cross-platform suite remains CI-owned because some POSIX execution tests are not Windows programs. The installer allows a per-user or elevated all-users installation, permits changing the installation directory, creates Start Menu and desktop shortcuts, and preserves user data when the application is uninstalled. Version `1.0.0` is written to `dsh-plugin-desktop\dist\IDEalize-1.0.0-x64-Setup.exe`; the unpacked application remains at `dsh-plugin-desktop\dist\win-unpacked\IDEalize V1.exe` for smoke testing. Both verifiers take the executable's name from the manifest's `build.productName`. A `v<version>` tag builds this same installer on the release workflow's Windows job and publishes it beside the DMG as `IDEalize-V1-Setup.exe`, the fixed name the Windows update download requests.

This local command deliberately strips Windows certificate variables and sets `signExecutable=false`. Its output is installable for testing but has no Authenticode publisher, so Windows can display an Unknown publisher or SmartScreen warning. A signed Windows release, certificate verification, installer upgrade/uninstall testing, and native UI/sandbox smoke remain separate release gates.

#### PC build pack

`yarn pack:pc` (`scripts/make-pc-build-pack.ts`) writes `dist/pc-build-pack/IDEalize-PC-build-pack-<version>-<commit>.zip`: the committed tree from `git archive HEAD` minus `.idealize/`, the three files in `pc-build-pack/` (`Build-IDEalize.cmd`, `build.ps1`, `README.txt`, written with CRLF line endings), and a `PACK.json` naming the version, commit, and expected outputs. It exists for a colleague with a Windows PC and no project knowledge: they unzip it, double-click the launcher, and send back the `OUTPUT` folder. The launcher runs exactly what the release workflow's Windows job runs (`corepack yarn install --immutable`, `dist:win`, `dist:win-portable`), refuses a non-x64 PC or a Node release outside 22.19+/24.x with install instructions, sets `COREPACK_ENABLE_DOWNLOAD_PROMPT=0` so Corepack fetches Yarn without asking, and collects the versioned installer, its `IDEalize-V1-Setup.exe` copy, the portable zip, `SHA256SUMS-windows.txt` in `sha256sum` format, and `build-log.txt`. The pack needs no git, GitHub access, Python, or Visual Studio on the PC; it does need network for the registry, the Electron binary, and electron-builder's NSIS toolchain. The generator warns about uncommitted changes and packs the commit regardless; `assertPackContents` refuses a pack missing `yarn.lock`, `vendor/freellmapi/server.mjs`, or the other entries the build reads, or one still carrying `.idealize/`.

### Windows x64 portable ZIP

Use `yarn dist:win-portable` on a native Windows x64 machine to create an unsigned portable ZIP:

```powershell
corepack.cmd yarn dist:win-portable
```

The output is `dsh-plugin-desktop\\dist\\IDEalize-<version>-x64-Portable.zip`. Extract it to any writable directory and launch `IDEalize V1.exe` without an installer, administrator access, Start Menu registration, or uninstall step. The application still keeps its profiles, logs, and caches in the normal Windows user-data directory, so this is portable distribution rather than a self-contained data sandbox. Portable archives are not handed to the NSIS updater and must be replaced manually when a new version is released. Local builds are unsigned and may trigger an Unknown publisher or SmartScreen warning; signed portable artifacts remain a release gate.

### macOS DMG smoke

`yarn dist:mac-smoke` builds one unsigned universal DMG on a native macOS host. The same package runs natively on Intel and Apple Silicon Macs. The command refuses non-macOS hosts and runs the complete product gate before packaging: repository layout and community-contract checks, the Market build and check, then the Desktop build, every TypeScript compiler face, the full unit-test suite, runtime-closure verification, CLI/Loader/profile headless smokes, and the license audit. This includes the real login-shell tests for each supported shell installed on the macOS runner. It then packages without code-signing material, mounts the DMG, and verifies the property list, executable bit, both `x86_64` and `arm64` slices, and `app.asar`. It mirrors `dist:win`'s secret discipline by stripping every Electron Builder macOS signing and notarization variable, sets `CSC_IDENTITY_AUTO_DISCOVERY=false`, disables notarization, and never publishes. The artifact has no Developer ID signature, so Gatekeeper will block it on other machines; it exists so packaging regressions fail in CI before a manual release. The signed and notarized universal release remains `yarn dist:mac` on a credentialed macOS machine and writes its artifact to `dsh-plugin-desktop/dist/mac-release/`.

## Model Experience

None. The desktop package changes application composition and native presentation; it does not add model-visible instructions, tools, events, or request fields.

#### KV Cache effect

None. The same harness Host and client feature plugins assemble model requests.

## Known Limitations and Deferred Work

- **Speech is out of the product for now (18 Sep 2026).** The profile no longer composes `@idealize/transcribe`, which drops about 265 MB of on-device speech runtime from the package; the `mac.x64ArchFiles` rule for onnxruntime stays for its return. When it returns: **transcription is Apple Silicon only.** onnxruntime-node publishes no macOS Intel binary, so the universal DMG carries its arm64 slice alone (`mac.x64ArchFiles`); on an Intel Mac the transcribe plugin cannot load its runtime while the rest of the app runs.

- Adding or removing a profile bundle requires restarting IDEalize V1; the launcher does not watch profile manifests. Selecting another profile from the tray performs that restart automatically.
- Switching compatibility/advanced mode always restarts the application by design; a live generation never hot-swaps Loader rows, slot ownership, or native materials.
- Advanced mode is unavailable on Linux. Linux continues to use the compatibility presentation.
- The macOS and Windows tray terminal exposes private `dsh`, `pnpm`, and `node` shims. Separately, the Host runtime exposes the bundled `pnpm` command on the current Electron process `PATH` for ambient compatibility and provides the managed `desktopPnpm` service; none of these commands are added to the system `PATH`, and Linux currently has no desktop terminal command.
- On Windows, the ambient `pnpm` command and lifecycle Node helper are `.cmd` shims. `desktopPnpm.run()` and `runPlugin()` avoid shell lookup for the manager process by launching exact packaged entries, while upstream `dsh plugin`, PowerShell, and Command Prompt can resolve the ambient shim through a command interpreter. A third-party plugin that calls Node `spawn('pnpm', { shell: false })`, or a lifecycle script that directly executes its `.cmd` `npm_node_execpath` with `shell: false`, remains non-portable and should use the managed service or a shell-aware launch path.
- `dshmarket@1.2.3` remains an optional user-installed third-party package, not a bundled marketplace. Preinstallation is deferred until an audited release consumes the optional Desktop services while preserving ordinary DSH fallback and includes the complete license notice required for redistribution.
- The update handoff validates the download container, not publisher identity. macOS still requires the user to replace the application from the opened DMG; Windows runs the downloaded NSIS installer but the local `dist:win` artifact is unsigned. Signed artifacts, Authenticode/publisher verification, SmartScreen reputation, and native upgrade testing remain release gates.
- The shared carrier is loopback HTTP and WebSocket, not Electron IPC. Replacing it requires transport extension points in the harness and is outside this standalone package.
- This project pins the `0.1.0-rc.7` package family, with the fork's packages as tarballs under `vendor/idealize/`, and the corresponding `deepseek-harness/` release source. Product builds resolve published package interfaces rather than linking the source checkout.
- `package:dir` is an unpacked smoke artifact. `dist:win` adds an unsigned NSIS test installer but does not establish Authenticode identity or SmartScreen reputation. Installation and upgrade behavior, native notifications and terminals, the Windows ACL sandbox, and native-material appearance remain target-platform verification boundaries.
