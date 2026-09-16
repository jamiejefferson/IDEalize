# Agent Note: the logged brain's instructions reach the model request

Status: implemented

Closes deviation 5 of [the in-session brain switch](2026-08-26-in-session-brain-switch.md). Reads the `idealize/brain` record defined by [the spaces vocabulary](../architecture/2026-08-26-idealize-spaces-vocabulary.md).

## Problem

The reshape promises the user that **the space owns the tools and the brain owns the model and the instructions.** S4 delivered half of it. Switching brain on a started chat called `session.selectModel` and recorded `idealize/brain` with the new brain's standing instructions, and no system-prompt contributor read that projection. The model changed; the voice did not. S4's own note says so: "the switch changes the model today and the voice when a system-prompt contributor lands."

The gap is not laziness. A started chat cannot be recomposed — `agentPresets.select` returns `agent-preset-locked` because the transcript the model re-reads was produced under one tool set — so the preset that supplies the persona stays pinned to the brain the chat began on. Writing the new brain to the log was the right move. Nothing read it.

## What the log actually said

The switcher omits the `instructions` field when the brain carries none (`brain-switcher.ts:280`, `...brain.instructions === '' ? {} : {…}`), and the welcome card never sends it at all (`ui-bar/src/client/index.ts:491`, body `{sessionId, space, brain}`). So an absent `instructions` field meant two unrelated things:

- the brain carries no standing instructions (switcher), and
- the writer did not state them, and the mounted preset still holds them (welcome card).

A reader that treated absence as "no voice" would empty the persona of every card-started chat. A reader that treated it as "unstated" would leave the OLD brain's persona in force after a switch to a brain with no voice. Neither is acceptable, and the field alone cannot tell them apart.

## Decision

**The payload is sufficient, because the log carries a second fact that separates the two cases.** `brainPersona(session)` compares the recorded brain against `resolveSessionPreset(session)` — `agent-preset/selected`, else the creation header, both durable:

| Logged brain vs. resolved preset | Contribution |
|---|---|
| no brain recorded | nothing |
| they agree | nothing |
| they differ | the recorded `instructions`, defaulting to `''` |

They agree in exactly the cases where the brain was chosen while the chat could still be recomposed: the welcome card's launch, and a switch on a blank chat. There the mounted preset's own `@deepseek-ai/dsh-persona` row is already this brain's voice, so contributing nothing is correct and the composition is left to speak.

They differ in exactly one case — a switch on a STARTED chat — which is the case the preset lock leaves unserved. There the only writer is the switcher, which omits `instructions` only when the value is `''`, so absent means empty and the ambiguity is gone.

**The event is unchanged, and no vocabulary regeneration was needed.** `idealize/brain` already carries `instructions?`, already sits in `KNOWN_SESSION_EVENT_TYPES`, and already appends with the `ignorable` marker. This slice added no session event and changed no payload, so `gen-persistence-catalog` had nothing to regenerate and `SESSION_FORMAT_VERSION` stays at 0. That is the point of checking rather than assuming: the twice-paid regression needs a changed event to bite, and this change has none.

**The contributor replaces `deployment:persona` rather than adding a section.** The preset mounted for a started chat still contributes the old brain's persona at order 0. Appending a second section would send both brains at once, which is not what "the brain owns the instructions" means. Replacement is safe because the prompt registry registers that exact section name unconditionally in its own constructor, and a preset's persona row shadows the name rather than adding another — so the slot is always present and always singular.

**It listens on `system-prompt/assemble` unscoped, post-`next()`.** Unscoped because a host plugin has no agent scope to register a section into, and an untagged listener is admitted to every scope's dispatch (`dsh-scope`). Post-`next()` because the persona it must overwrite is the one the scope chain resolved, not one an earlier listener has yet to contribute. `installModelSelection` is the same shape.

**A brain with no instructions contributes nothing, not an empty section.** Setting the persona text to `''` is exactly that: `renderPrompt` drops sections that render empty, so the prompt loses the persona rather than gaining a blank one.

## Alternatives considered

- **Fix the writers so `''` is always logged.** It would make the field self-sufficient and the reader's rule total. It also means editing `@idealize/activity-pills` and `@idealize/ui-bar`, both of which another slice held open; and it would not help the logs the shipped build has already written, which omit the field. The reader needs the comparison rule either way, so paying for the writer change buys nothing this slice needs.
- **Resolve the brain's instructions host-side in the select route.** Same benefit, no client edit: the route reads the named preset's composition and fills the field in. It costs `@idealize/spaces` a YAML persona reader, duplicating `personaOf` (which lives in `@idealize/activity-pills`, a package that already type-depends on spaces, so importing it would close a cycle). And again, existing logs still omit the field.
- **Read the `brain` projection through `sessionProjections` instead of folding the events.** The projection is the client-facing view and does not carry `instructions`, so this would mean a versioned projection change with no reader plus a projection-registry dependency inside prompt assembly, evaluated on every step. `dsh-plan-mode` is the shipped precedent for the other way round: it registers a projection for clients and folds the log directly in its own `plan:policy` section. `foldBrainRecord` sits beside `foldBrain` and `foldSpace` in `projection.ts` for the same reason.
- **Contribute the instructions as dynamic context rather than a prompt section.** A context snapshot is a user-role message that supersedes earlier snapshots; standing instructions are an identity, they belong in the persona slot the product already reserves for them.
- **Have the switcher recompose a started chat after all.** Refused by the host for a reason: tool results in the history would name tools the new composition does not have. The space/brain split exists to avoid this.

## Consequences

An in-session switch now changes the voice as well as the model. A brain with no standing instructions silences the previous one instead of inheriting it, which is a behaviour change the unit and assembled tests both pin.

`@idealize/spaces` gains real dependencies on `@deepseek-ai/dsh-system-prompt` (for `PERSONA_SECTION`, imported rather than restated so the two cannot drift) and `@deepseek-ai/dsh-agent` (type-only, for the `agent` field merged into `AssembleContext`).

A preset whose persona is declared `complete` is unaffected: the registry restores a complete section after this waterfall, so such a brain keeps the whole prompt. That is the complete-prompt contract, not a gap.

A user who types `{{…}}` into a brain's instructions can still break the render, because the persona slot has always been a strict template. This change moves the same string through the same interpolation, so it adds no exposure.

## Proof

Unit: [`tests/brain-prompt.spec.ts`](../../../../packages/idealize/spaces/tests/brain-prompt.spec.ts) pins each branch of the comparison and the assembled prompt the registry produces.

Assembled and keyless: [`tests/brain-instructions.snapshot.ts`](../../../../packages/idealize/spaces/tests/brain-instructions.snapshot.ts). One driver boots the real Loader, runs a turn on the composition's own brain, switches over a real `POST /idealize/spaces/select` (loopback fence, `x-idealize-auth`, ephemeral port), and runs a second turn on the same chat. The persisted log then carries both `request/header` events, so the switch is read off the transcript: the first prompt has the Coding voice and not the Design one, the second has the Design voice and not the Coding one, and the second is pinned verbatim as [`system-prompt.expected.md`](../../../../packages/idealize/spaces/tests/brain-instructions-snapshots/switch/system-prompt.expected.md).

A second run then resumes that same persisted log in a fresh process — `agents: []`, one resumed root, no memory of the switch anywhere but the file — and rebuilds the identical prompt. That is what "reconstructable from the log" has to mean for an input the model reads. A third scenario switches to a brain with no instructions and asserts the persona is gone rather than blank.

The scenario lives in-package rather than under `examples/`, following the fork's existing arrangement for assembled IDEalize coverage (`vitest.snapshot.config.ts` already includes `packages/idealize/*/tests/**/*.snapshot.ts`), because the composition mounts `@idealize/*` rows no upstream example declares.
