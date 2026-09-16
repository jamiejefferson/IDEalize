# Agent Note: the composer's "+" opens one menu for files, skills, connectors, plugins and commands

Status: implemented

JJ, 15 Sep 2026: "one thing that bugs me about the interface is the plus icon and the paperclip. could we look to integrated them in the same way as claude does?" The screenshot showed Claude's menu: `Add files or photos ⌘U`, then `Skills ›`, `Connectors ›`, `Plugins ›`.

## Problem

The composer carried two unrelated controls: a "+" at the left that only toggled the slash menu's command source, and a paperclip at the right that opened the file picker. Neither said what it did, and nothing on the composer offered the skill catalogue, the app's connections, or the plugin market, although each exists elsewhere in the app.

## Decision

The "+" opens one `Menu` (the primitives component, side `top`) whose rows are, in order: `Add files or photos` with a `⌘U` hint (the picker the paperclip owned; Ctrl+U on other platforms), a separator, every entry plugins registered, a separator, and `Commands`, which does what the old "+" did. The paperclip button is removed; its hidden file input and its intake stay.

Entries come from a registry, `ctx.composerMenu` (`createComposerMenu()` in `ui-conversation/src/client/composer-menu.ts`), provided by ui-conversation's `apply` and read by the bar through a `composerMenu` hook in the injected hooks compartment. An entry has an `order`, a label and icon, an optional `rows(session)` read afresh every time the menu opens (a `Loading…` row while a promise settles, `Nothing here yet` for an empty or failed read) and `onSelect(session, rowId)`. The session hands the entry `insertText`, which appends to the draft after a separating space, so a contributor never touches the input machine. Contributors probe the registry with `ctx.get` and type it structurally, so neither ui-skill nor ui-bar gains a dependency on ui-conversation:

- ui-bar: `Skills & Commands` (order 10). The first cut put a `Skills` entry in ui-skill over the whole catalogue; JJ, testing it: "i was expecting to see a skills chooser in the modal that uses the skills folder as its source" and "maybe they can be blended in the modal too Skills & Commands". The entry now lives in ui-bar, reads the folder's skills from `GET /idealize/bar/skills` (the host registry filtered to the `@idealize/skills` provider) and the session's host commands from `commands.list`, and lists them under two headings. A skill pick inserts `/name ` (the host's pre-step boundary injects the skill body, exactly as the `/` source does); a bare command runs at once through the command channel, as the `/` menu does; a command that takes input is inserted for the person to finish. The entry declares `commands: true`, so ui-conversation drops its own Commands row. The primitives `Menu` submenu accepts headings and separators for this. ui-skill is untouched again. JJ, on the next build: "the dividers are invisible and there's no obvious way to browse the full suite - it would be good if there were a type-in search at the top of this view too". So: a hairline now precedes every heading after the first; a third group, All skills, lists the rest of the session's catalogue (`skill.list`, folder skills excluded, sorted); and the entry declares `search: true`, which the primitives `Menu` renders as a search field at the top of the submenu (rows filtered by label and `keywords`, which carry the descriptions; headings and separators left without a row drop out; Enter picks the first match; the card holds open while the field has focus; rows scroll under the field). The All skills group was a misreading: JJ's "browse the full suite" meant every package in the nominated folder, of which only four were read at the time (see the skills-folder note). Once all packages were read JJ said "i only want this to use the skills folder attributed. anything in agent/skills is only accessed by the / command as those are model specific", so the submenu lists the skills folder and the commands, and the typed `/` menu keeps the whole catalogue.
- ui-bar: `Connectors` (order 20) opens Settings, where the Telegram pairing lives, and `Plugins` (order 30) clicks the community market launcher when mounted, else the hatch pane. The first cut gave each a submenu with a service-hatch row; JJ, testing: "remove this service hatch reference - this will confuse people" and, of the Plugins submenu, "this sub menu is not needed". The rows went with it: Paper had nothing to configure, and a one-row submenu is a pick.

The primitives run in the app from the web frontend's own bundle (`apps/web`, vendored as `dsh-web-frontend`), not from the primitives tarball: the plugins' bundles resolve `@deepseek-ai/dsh-client-ui-primitives` through the module table to the frontend's copy. A change to a primitive therefore lands only when the frontend is rebuilt and repacked; landing 48 shipped the submenu search without it, and JJ saw blank rows where the old submenu rendered the headings.

Claude's `Record a skill` row is omitted: no such feature exists here. The menu scopes nothing: a picked skill's body joins the chat like a typed reference. JJ's wider ask, a skills folder visible in Files and in setup, is the companion note `2026-09-15-skills-folder.md`.

## Alternatives considered

A second menu beside the file button, one per contributor, would have kept ui-conversation untouched and given the composer a row of buttons where JJ asked for one "+". Listing the whole skill catalogue in the submenu was built and removed the same day: JJ wants only the skills folder there, with `~/.agents/skills` reachable through the typed `/` menu because those are model specific.

## Consequences

One "+" menu carries files, the contributed entries and the commands; a plugin contributes a row through `ctx.composerMenu` without touching the composer. The submenu search and headings live in the shared Menu primitive, so any contributor can use them; a change there reaches the app only through a rebuilt web frontend, which the landing route now includes.

## Evidence

`tests/composer-menu.client.spec.ts` (ordering, duplicate id, disposal), `tests/input-bar.client.spec.tsx` `the "+" menu and control seats` (row order, entry pick, submenu rows loading then picked with the draft insert, heading rows and the commands flag, empty and failed reads, files row and ⌘U/Ctrl+U opening the picker, the locked launcher), the primitives `atoms.client.spec.tsx` submenu headings case, ui-bar `aliases.client.spec.ts` (`GET /idealize/bar/skills` with and without a registry) and ui-bar `apply.client.spec.ts` (all three entries, every row's target, disposal order).
