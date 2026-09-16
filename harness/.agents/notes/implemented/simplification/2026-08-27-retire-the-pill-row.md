# Agent Note: The composer pill row retires; the brain switcher is the only brain control

Status: implemented

The last slice of the spaces-and-brains reshape, after [the tab row goes](../feature/2026-08-27-the-tab-row-goes.md). It removes the row that [Welcome card and composer amends](../feature/2026-08-21-welcome-card-and-composer-amends.md) designed, whose welcome-card half [the two-step chooser](../feature/2026-08-26-welcome-card-space-then-brain.md) had already replaced, and leaves [the composer's brain switcher](../feature/2026-08-26-in-session-brain-switch.md) as the one brain control on a started chat. The row, the controller and the routes are `@idealize/activity-pills`'s; the space and brain record is `@idealize/spaces`'s ([vocabulary](../architecture/2026-08-26-idealize-spaces-vocabulary.md)).

## Problem

A started chat carried two controls for the same decision. The composer's model seat held the brain switcher: the brains that work in this chat's space, the current one marked, a restart labelled before the click. Directly above it, on `conversation.input.dock`, the activity pill row still rendered the five activity brains as toggle buttons, unfiltered by space, with no restart label until a dialog after the click, and with a wording of its own ("Activity agent", "Switch activity agent?"). A Gallery chat showed Coding, Design, Writing, Admin and Free above a composer whose switcher listed the Gallery agent. The two rows could disagree about the current brain and did agree about nothing else.

The row also kept a shape the reshape had made false. It was designed for a chat that could change its preset by pressing a pill; once the space owns the tools and a started chat's preset is host-locked, a pill press changed the model only, which is exactly what the switcher does with the space, the cost and the record attached.

The documentation gates were red across `packages/idealize` at the same time, and had been since before the reshape: fifteen packages had no README at all, ten more lacked `## Model Experience`, 180 exports lacked complete JSDoc, twelve config fields had no prose, the doc-graph generator knew none of the nine IDEalize services, the `Session.append` paste in `docs/subsystems/session.md` predated the fork's `NonSurfaceIntent`, and `verify-cordis-config` could not resolve eighteen `@idealize/*` bundle rows to source.

## Decision

**Delete `ActivityPills` and `ActivityPillRow`, their stylesheet, their glyphs and the `conversation.input.dock` registration.** The composer dock carries nothing from `@idealize/activity-pills`. The `idealize-activity` locale namespace keeps only the switcher's keys; the row's labels, reasons and confirm title leave `en` and `zh` together. The client slot catalog loses its `conversation.input.dock` row for the package and keeps `BrainSwitcher` on `conversation.input.model`.

**Keep `ActivityPillsController` and the `activityPills` service, narrowed to `{ face }`.** `@idealize/ui-bar`'s welcome card selects an activity brain through `face().select`, and the brain switcher routes an activity brain through the same controller, so the free-tokens route and the roster default have one owner. The service's `Row` and `t` members are gone with the row. `PillSessionSummary`, `ActivityPillsState` and the `pills` wire field keep their names: `GET /idealize/activity/models` answers `pills`, the desktop shell and the Brains pane read it, and renaming a wire field for a word is not this slice's job.

**Keep the host half whole.** The seeding of the five presets, `GET /idealize/activity/models`, `POST /idealize/activity/surface`, `GET`/`POST /idealize/activity/agent(s)`, `assessPills`, `terminalRestarts` and the `idealize-activity-pills` settings section (`models` and the `spaces` map S1 added) are unchanged. The space roster and the terminal-restart assessment run on them.

**The sweep.** Every `packages/idealize/*` README ends with `## Model Experience` and `## Known Limitations and Deferred Work`; twenty-one browser-only or provider-backed packages use the audited short form and join `SENTENCE_MODEL_EXPERIENCE` in `scripts/verify-package-readme-model-experience.ts`. `scripts/gen-doc-graphs.ts` classifies the nine IDEalize services, so `docs/capability-seams.md` and `docs/event-producer-consumer.md` regenerate with them. `tsconfig.base.json` maps every `@idealize/*` package the bundle mounts to its `src`, so the tsx source launch resolves them without built `lib/`. The root `AGENTS.md` ceiling rises from 1950 to 2100 words for the fork's service-hatch section. The `Session.append` paste in `docs/subsystems/session.md` and its Chinese counterpart carry `[opts?: NonSurfaceIntent]`.

## Alternatives considered

- **Delete the `activityPills` service and have the welcome card construct its own controller.** Two controllers would each write the agent-preset roster default and each hold a `busy` flag; a launch and a switch in the same second could interleave their writes. The service exists so there is one writer. Rejected.
- **Rename the controller, the state type and the wire field to `brain`.** The wire field reaches the desktop shell's vendored copy of the package; renaming it is a shell release, not a client edit. The type names follow the wire. Rejected for this slice; recorded in the package README's limitations.
- **Keep the row on Chat and Terminal chats only.** It would still duplicate the switcher's question with a second vocabulary and no restart label before the click. Rejected.
- **Translate the English-only READMEs and Agent Notes to satisfy `verify-translation-pairing`.** `CLAUDE.md` reserves `dsh-translate-docs` for JJ's explicit invocation. The 44 English-only files, `docs/module-graph.md`, `docs/config-catalog.md`, `docs/capability-seams.md` and `docs/event-producer-consumer.md` remain that reserved debt; the three regenerated catalogs joined it in this slice because their English sides now carry the IDEalize rows their reviewed Chinese counterparts lack.
- **Silence `verify-doc-budgets` by trimming upstream `AGENTS.md`.** The overrun is the fork's own section; cutting upstream standing orders to make room for it would widen the fork's footprint in that file. The ceiling rises instead, per the relocate-condense-raise rule.

## Consequences

A started chat has one brain control, and it is the one that knows the chat's space. Nothing a user could do is lost: every pill action (recompose a blank chat, change a started chat's model, route Free) is a brain-switcher action with the same controller behind it.

`pnpm run doc-sync` is green except `verify-translation-pairing`, whose every remaining line is the reserved translation debt above. `pnpm run hygiene` still stops at `rescope-vendor:check` (26 pre-rescope name residues in upstream `docs/` and `packages/extensions/`), which is upstream's and predates the fork's first combine.

Proof: `packages/idealize/activity-pills/proof/pills-retired-proof.mts` boots the real `idealize` profile against the scripted mock model, starts a Chat chat at 1280×840 in both themes, enumerates the `conversation.input.dock` occupants and every `[data-activity-pills]` node and requires zero, and requires the brain switcher on the composer naming the chat's brain. The same run writes `.idealize/proof/mode-provider-boundary-report.txt`, the `verify-mode-provider-boundary` report line naming the mode packages it still polices, so the gate's scope is on record as non-empty after the sweep.
