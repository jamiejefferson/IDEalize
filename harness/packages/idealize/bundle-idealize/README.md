# @idealize/bundle-idealize

The IDEalize product as a profile bundle. The package's substance is `cordis.patch.yml`, declared by the `dsh.bundle.patch` manifest field and applied by the profile composer after `dsh-base` and `dsh-web-app` when `dsh --profile idealize` runs. The module itself carries no runtime API, and its invariant companion registers an explained empty installer: the bundle owns no event stream or mutable data of its own.

## What the patch composes

Each `insert` row mounts one `@idealize/*` plugin under its `idealize-*` id: the skin, the provider pack, the artefact engine, the documentation policy, the vault, cron and its Schedule pane, the command surface, spaces, the host bridge, feedback, notifications, free tokens, the hatch, model management, the tool rail, the tour, the launch sequence, the terminal, Sound Stage and Gallery, the activity brains, the appearance panel, the generation seam and the Paper MCP client (`idealize-mcp-paper`: `@deepseek-ai/dsh-mcp-client` over streamable HTTP to Paper's loopback server at `http://127.0.0.1:29979/mcp`, `failOnStartupError: false` so a closed Paper never blocks a session, reconnecting every 2 to 60 seconds while it is closed). Every mounted package documents its own contract in its README; this bundle only decides that the row exists and in what order.

Three rows patch upstream plugins' `config` instead of inserting: `llm-pi-ai` gains the pre-seeded `openai-codex` route (ChatGPT subscription through Codex OAuth, deferring to the stored OAuth credential because it names no `apiKeyEnv`), `system-prompt` gains the IDEalize persona quoted below, and the remaining config rows are read from the comments beside them in the patch file. The settings document overrides every composition default here.

## Model Experience

### The IDEalize persona

#### What the model sees

The `system-prompt` row's `persona` template, rendered by `dsh-system-prompt` with `{{model}}` and `{{cwd}}` substituted, at the position that plugin gives the persona in every request's system prompt.

##### Persona template

```markdown
You are an IDEalize agent powered by the {{model}} model. Your working
directory is {{cwd}}. Explain engineering plainly and without jargon;
your user directs the work and learns from how you narrate it.
```

#### Token effect

A fixed few dozen tokens on every request of every session composed from this profile.

#### KV Cache effect

Prefix-stable while the model and working directory are unchanged; a model switch or a session in another folder renders a different sentence and starts a new prefix, which is `dsh-system-prompt`'s existing behaviour for its persona.

### Paper's tools

#### What the model sees

While Paper is running, every session's tool list carries Paper's MCP tools under `mcp__paper__*` names with the definitions Paper publishes; while Paper is closed the list carries none, and `dsh-mcp-client`'s README owns the tool and result wording.

#### Token effect

Paper's published definitions on every request while it is running; nothing while it is closed.

#### KV Cache effect

Prefix-stable while Paper's tool list is unchanged; Paper starting, stopping or changing its tools changes the prefix of every later request.

## Known Limitations and Deferred Work

- **Composition order is the only contract the bundle enforces.** A mounted package that needs another's service uses `ctx.inject` or a `ctx.get` probe; nothing here fails loud when a row is removed, so the profile Loader tests are the check that every row still resolves.
- **Paper's loopback server carries no credential.** The client connects to whatever answers on port 29979 of this machine; Paper owns that port and its access policy.
- **The `openai-codex` route is composed even where nobody has signed in.** It appears in the model directory only when `@idealize/provider-pack`'s OAuth store is composed and holds a credential; without one the row is inert rather than removed.
