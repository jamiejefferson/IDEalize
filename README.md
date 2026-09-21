<h1 align="center">IDEalize V1</h1>

<p align="center">
  <strong>The agent-directing desktop app for designers, for macOS and Windows.</strong><br>
  Open a project folder, pick a space and a brain, and direct the work from one window.
</p>

<p align="center"><sub>A fork of <a href="https://github.com/anywhere-labs/deepseek-harness-desktop">DeepSeek Harness Desktop</a> over the <a href="https://github.com/jamiejefferson/IDEalize/tree/main/harness">IDEalize harness</a>. Not affiliated with DeepSeek.</sub></p>

<p align="center">
  <a href="https://idealize.projject.ai"><img src="https://img.shields.io/github/v/release/jamiejefferson/IDEalize?style=flat&amp;label=release&amp;color=FF5436" alt="Latest release"></a>
  <a href="https://idealize.projject.ai"><img src="https://img.shields.io/github/downloads/jamiejefferson/IDEalize/total?style=flat&amp;label=downloads&amp;color=FF5436" alt="Total downloads"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-2EA44F?style=flat" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/macOS-4493F8?style=flat-square" alt="Supported platform: macOS">
  <img src="https://img.shields.io/badge/Windows_x64-4493F8?style=flat-square" alt="Supported platform: Windows x64">
</p>

IDEalize V1 packages the IDEalize harness (its plugin Host, web client and every `@idealize/*` plugin) into a native desktop application for macOS and Windows x64: the window, tray, Askbar, terminal, updates and work profiles come from this repository; the harness runs unchanged from vendored tarballs under `vendor/idealize/`.

<a id="run"></a>

## Download and install

Download the installer for your platform from [idealize.projject.ai](https://idealize.projject.ai). The [FAQ](docs/faq.md#which-operating-systems-are-supported) lists the supported platforms.

### macOS

Run this once in Terminal, and again any time to update:

```sh
curl -fsSL https://raw.githubusercontent.com/jamiejefferson/IDEalize/main/install.sh | bash
```

Or open the DMG and drag `IDEalize V1.app` into Applications. The build is self-signed and has no Apple notarisation, so run this once and macOS will open it:

```sh
xattr -dr com.apple.quarantine "/Applications/IDEalize V1.app"
```

### Windows

Run `IDEalize-V1-Setup.exe`. The installer is unsigned, so SmartScreen shows "Windows protected your PC": choose **More info**, then **Run anyway**. The default installs for your user account and needs no administrator password. The installer also adds **Idealize this** to the right-click menu of every folder, which opens that folder as a project; Windows 11 lists it under **Show more options**.

### Updates

On both platforms the app checks for a newer release itself and offers the download.

### Keys

Add API keys in the Brains pane (Anthropic, OpenRouter, fal.ai and the rest), or open a `.idealizekeys` file an organisation issued you: double-click it and the keys it carries are connected at once ([how it works](dsh-plugin-desktop/README.md#keys-file)).

## Documentation

Ordinary users can start with the [user guide](docs/user-guide.md); the developer documentation is only needed when extending or maintaining the application.

### User documentation

| Goal | Entry point |
| --- | --- |
| Install and use the application | [User guide](docs/user-guide.md) |
| Check platforms, prerequisites, and product boundaries | [FAQ](docs/faq.md) |
| Understand why the project exists | [Why IDEalize V1](docs/why-desktop.md) |
| See the full documentation and README map | [Documentation index](docs/README.md) |

### Developer and maintainer documentation

| Goal | Entry point |
| --- | --- |
| Read the plugin ecosystem manifesto | [Plugin ecosystem manifesto](docs/plugin-ecosystem.md) |
| Build ordinary or Desktop plugins | [Plugin development](docs/plugin-development.md) |
| Join the unified plugin-contract discussion | [DSH Community Fabric Draft](dsh-community-fabric/README.md) |
| See the research behind the unified plugin framework | [Framework and real-plugin research](dsh-community-fabric/docs/research/mature-plugin-frameworks.md) |
| Read the plugin market product and safety design | [DSH Community Market](dsh-community-market/README.md) |
| See what Desktop plugins can use | [Desktop plugin API](dsh-plugin-desktop/docs/plugin-services.md) |
| Understand how the desktop works | [Architecture](docs/architecture.md) |
| Read package-level build and release details | [`dsh-plugin-desktop/README.md`](dsh-plugin-desktop/README.md) |

## Features

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>Desktop</h3>
      <p>Brings the IDEalize harness and its web client to a native desktop application. The app starts and manages the local harness service, integrates the system tray and desktop window, and requires no Node.js installation or command-line setup.</p>
    </td>
    <td width="50%" valign="top">
      <h3>Mobile Remote Control <img src="https://img.shields.io/badge/COMING_SOON-F59E0B?style=flat-square" alt="Coming Soon"></h3>
      <p>Connect to Desktop from iOS and Android to start tasks, monitor Agent progress, and send follow-ups from your phone.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3><a href="dsh-community-market/README.md">Plugin Marketplace</a> <img src="https://img.shields.io/badge/BUILT_IN-2EA44F?style=flat-square" alt="Built in"></h3>
      <p>DSH Community Market is complete and built in, with plugin discovery, details, installation, and management. The market openly connects to a wide range of plugin data sources: anyone can provide, integrate, and use a source that follows the public schemas, while existing APIs can join as cooperating sources through a reviewed adapter.</p>
    </td>
    <td width="50%" valign="top">
      <h3>Co-build the Plugin Ecosystem</h3>
      <p>The DSH plugin ecosystem is built by the community. Official, desktop, and third-party plugins follow the same conventions, so they can be installed together and work together without interfering with each other. Join us — read the <a href="docs/plugin-ecosystem.md">DSH plugin ecosystem manifesto</a>.</p>
    </td>
  </tr>
</table>

## Plugin Ecosystem

Plugins are extensions that add capabilities to IDEalize: models, tools, interfaces, and workflows can all be plugins, combined like building blocks.

IDEalize V1 is not a fixed, hardcoded shell. The IDEalize harness runs unchanged from its vendored tarballs; the desktop shell itself (the window, tray, terminal, updates, and work profiles) is a DSH plugin, composed into the same runtime through the standard plugin mechanism. From the core agent to the desktop shell, the whole product follows the same "everything is a plugin" rule: plugins from the DSH ecosystem work directly, and desktop capabilities are combined, replaced, and evolve the same way.

We want the plugin ecosystem to work like a phone app store: every plugin is built against the same set of rules, so plugins can be installed together and work together without interfering with each other.

### For developers

Unlike many other projects, this project itself is a DSH [plugin](docs/plugin-development.md): the desktop shell composes through the same official path as third-party plugins. Desktop plugin capabilities are now available. We provide Desktop services so plugin developers can integrate their plugins with desktop capabilities: for example, viewing and switching work profiles, or installing, updating, and removing plugins in the active profile. See the [Desktop plugin API](dsh-plugin-desktop/docs/plugin-services.md) for complete usage details. See [Why IDEalize V1](docs/why-desktop.md) and [Plugin development](docs/plugin-development.md) for the reasoning and the third-party boundary.

## Relationship to the upstream projects

IDEalize V1 is a fork of [DeepSeek Harness Desktop](https://github.com/anywhere-labs/deepseek-harness-desktop), built on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) and the Cordis plugin model.

The [IDEalize harness](https://github.com/jamiejefferson/IDEalize/tree/main/harness) provides the core agent capabilities, plugin system, and web UI. This repository primarily provides:

- Desktop application packaging
- Starting, stopping, and recovering the local service
- Desktop window and system tray integration
- macOS and Windows installer builds and releases
- An interface designed for desktop use

To run the harness from the command line or contribute to its core functionality, start with the IDEalize harness repository.

## Special Thanks

Special thanks to the [original DeepSeek Harness repository](https://github.com/deepseek-ai/deepseek-harness) and the DeepSeek AI team. IDEalize V1 builds on a pinned upstream checkout, and its core agents, models, tools, sessions, web UI, and plugin ecosystem come from that project.

We also thank [Cordis](https://github.com/cordiverse/cordis) for the plugin foundation that makes this composition possible. IDEalize V1 would not exist without these open-source projects.

We are also grateful to the [Koishi.js](https://koishi.chat/) project and community for their long-standing work on plugin practices, tooling, and shared knowledge, and to everyone who contributes discussions, testing, feedback, and plugins.

Also, and you.

<a id="run-from-source"></a>

## Development

Desktop source lives in `dsh-plugin-desktop/`. The outer repository uses Yarn, while the pinned `deepseek-harness/` submodule keeps its own pnpm workspace. From the repository root:

```sh
git submodule update --init --recursive
corepack yarn install --immutable
corepack yarn dev
```

Use `corepack yarn check` for the headless gate. The [architecture](docs/architecture.md) and package [`README`](dsh-plugin-desktop/README.md) describe the full build, test, and release boundaries.

### Landing a build

The app consumes the harness through the tarballs in `vendor/idealize/` (one per `@idealize/*` package plus the upstream packages the fork touches), pinned by the `resolutions` map in the root `package.json`. To land a harness change: in that package run `npx tsc -b tsconfig.json`, `pnpm run bundle` and `pnpm pack --pack-destination ../../../../idealize-desktop/vendor/idealize` (the emit comes first, because the bundle reads `lib/types`); check the tarball's `package/lib/*.js` carries the new code; then here run `corepack yarn install && corepack yarn build && corepack yarn package:dir`, which writes `dsh-plugin-desktop/dist/mac-arm64/IDEalize V1.app`. Quit the running app, replace `/Applications/IDEalize V1.app` with that bundle (`rm -rf` then `ditto`), and open it with `open`; the first launch of a replaced bundle can take half a minute before its window shows, later launches a few seconds. The project board in the harness (`.idealize/project-board.md`) records every landing.

### What the shell adds

- **The Askbar** — a slim always-on-top column at a screen edge, one chip per agent, that the main window collapses to and expands from: the sidebar's collapse button, the tray, or Ctrl+Alt+A (⌃⌥A on a Mac) from anywhere (a global shortcut, so no IDEalize window needs focus). Rolling over a chip opens a panel to read the agent's latest exchanges and ask it something.
- **"Idealize this"**: right-click a folder in Finder or Windows Explorer to open it as a project. On macOS the app installs a Quick Action into `~/Library/Services` on each launch. On Windows the installer registers the menu entry and the uninstaller removes it.
- **Keys files** — double-click a `.idealizekeys` file and the keys it carries are connected at once (see [Keys](#keys)). See [CONTRIBUTING.md](CONTRIBUTING.md) for how to contribute.

## Community

Bug reports, feedback and questions about IDEalize V1, harness ones included, go through [GitHub Issues](https://github.com/jamiejefferson/IDEalize/issues); the harness is a fork of DeepSeek Harness.

## License

[MIT](LICENSE), for this fork and for DeepSeek Harness Desktop beneath it.

> DeepSeek is a trademark of DeepSeek AI. IDEalize V1 is an independent project, not affiliated with or endorsed by DeepSeek or Anywhere Labs.
