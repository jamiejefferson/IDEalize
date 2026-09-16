# IDEalize V1

The agent-directing desktop app for designers, built on a fork of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). This repository is the harness: the plugin host, the web client, and every IDEalize plugin under `packages/idealize/*`. The Mac app that wraps it lives in [IDEalize](https://github.com/jamiejefferson/IDEalize), which is where releases are published.

<a id="run"></a>

## Install the app

Run this once in Terminal on a Mac, and again any time to update:

```sh
curl -fsSL https://raw.githubusercontent.com/jamiejefferson/IDEalize/main/install.sh | bash
```

Or download the DMG from the [latest release](https://github.com/jamiejefferson/IDEalize/releases/latest), drag `IDEalize V1.app` into Applications, and run `xattr -dr com.apple.quarantine "/Applications/IDEalize V1.app"` once so macOS opens the self-signed build. The site is [idealize.projject.ai](https://idealize.projject.ai).

<a id="run-from-source"></a>

## Run the harness from source

The IDEalize harness (`dsh`) uses an architecture where **everything is a plugin**, powered by [Cordis](https://github.com/cordiverse/cordis). To run the IDEalize composition from a checkout:

```sh
git clone https://github.com/jamiejefferson/IDEalize.git
cd IDEalize/harness
pnpm install
pnpm run build
pnpm dsh --profile idealize web
```

The command starts the Web UI at `http://127.0.0.1:3080`. See the [Web UI guide](docs/user/guide/index.md).

## The fork

[FORK.md](FORK.md) records the fork point (upstream `v0.1.0-rc.7`, 18 Aug 2026) and every upstream file this fork touches. IDEalize code goes in `packages/idealize/*`; upstream packages stay as close to their source as the seams allow. Upstream's own documentation under `docs/` describes the harness and still applies.

## Community and support

Feedback, bug reports and questions about IDEalize, harness ones included, go through [GitHub Issues](https://github.com/jamiejefferson/IDEalize/issues).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

For agents, follow [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE), for the fork and for DeepSeek Harness beneath it.

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
