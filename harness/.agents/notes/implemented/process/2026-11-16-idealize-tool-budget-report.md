# Agent Note: A report counts the tools each IDEalize space and brain hands the model

Status: implemented

## Problem

Nobody had counted the tools an IDEalize chat's request carries. Reports from other teams put the point where agents degrade at about 30 directly exposed tools, and the bundle mounts two MCP clients (Paper and Hatch) on the host plane, so every brain receives their tools on top of its own. [`docs/tool-catalog.md`](../../../../docs/tool-catalog.md) lists the harness tools one package at a time and omits every tool an `@idealize` package registers, so it cannot answer what one composed chat receives.

## Decision

[`packages/idealize/bundle-idealize/scripts/tool-budget.mts`](../../../../packages/idealize/bundle-idealize/scripts/tool-budget.mts) boots the whole `idealize` profile in one process through the CLI's own `runProfile`, with `HOME` and `DSH_HOME` in a temporary folder, inherited keys dropped and `fetch` limited to loopback. It reads the brains of each launchable space from `GET /idealize/spaces`, starts one chat per pair through `session.create` and `POST /idealize/spaces/select`, and reads the tools from `ctx.systemPrompt.assemble({ scope: agent })`. It prints the tool count and the summed length of `JSON.stringify({ name, description, parameters })` per chat, then the same for the presets no space offers.

The report disables the `idealize-mcp-paper` and `idealize-mcp-hatch` rows through an overlay patch. Their tool lists belong to apps installed on the machine, and the Hatch row would start the launcher inside the installed Hatch app.

The script lives in the bundle because the bundle is the composition it measures. It follows the package `proof/` scripts: run by hand through `tsx`, outside the package's `src`, with no spec.

## Alternatives considered

**Counting tool registrations in source.** A count of `ctx.tools.register` call sites misses conditional registration (`@idealize/comm` registers its five tools only for an agent without a shell), per-agent restrictions and prompt-assembly listeners.

**Extending `gen-tool-catalog`.** The catalogue boots each tool package alone with a hand-written recipe. It has no preset, space or brain, so it cannot say which tools one chat receives.

**Reading `ctx.tools.schemas(standingKey)` per preset without starting a chat.** It skips the registrations and restrictions a chat's own scope adds and the assembly waterfall, which is where a presentation mode collapses the list.

**Leaving the MCP rows on.** The count would change with the apps installed and running on the machine, and the run would register an agent with the person's own Hatch.

## Consequences

The run needs `pnpm run build` first, because the profile refuses to start without each client package's built bundle. The figures exclude Paper's and Hatch's tools, so a shipped chat carries more than the printed count; the script header and the bundle README say so. The schema characters leave out the wrapper each provider adapter adds around a tool. The script is not type-checked or covered by a gate, as the `proof/` scripts are not, so a renamed route or service breaks it at the next run.
