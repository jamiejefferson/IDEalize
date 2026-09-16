# Agent Note: A3 third commit — the Studio pane's rendered proof

Status: implemented

`packages/idealize/ui-studio/proof/studio-proof.mts`, on the ui-schedule proof template: the assembled `idealize` profile booted from source, the pane driven headlessly at 1280x840 in both themes, 38 expectations green.

## Problem

The pane's unit specs prove the component and the store over fixtures; nothing proved the assembled application transcript — the rail seat, the client bundle actually mounting, the pane reading a record `@idealize/studio` wrote to disk, the failure surface — which testing policy requires for a product-user-visible change.

## Decision

**Seed first, browser absent.** A first boot writes the record through studio's own routes (assignments, updates, a request, a synthesis, then a later assignment that stales it, and one addressed message through `deliver` carrying its source thread), then stops. The app the browser drives reads that record off disk, so the proof covers load, not just live append.

**Assert the fold's semantics, not just presence.** The synthesis must be stale-marked, exactly the requesting task lists under Needs attention, presence reads unreachable (no seeded owner is a live session), the delivered message offers Open chat, and after the whole run the timeline file is byte-identical — the pane is a reader.

**The failure keeps the stale view.** Both routes 503'd: the cause is stated, Retry offered, and the seeded tasks stay on screen — the store's stale-data-beats-none behavior proven on the shipped surface, then recovery through Retry once the routes answer.

## What the proof caught

- **Stale client bundles are silent.** The first run's rail had no Studio button: the browser executes each plugin's built `lib/client.js`, and ui-bar's predated the wiring. `pnpm --filter @idealize/ui-bar bundle` before a proof run; the proof's rail enumeration is the guard.
- **A symlinked spelling splits a timeline.** Seeding under `/tmp/...` while the workspace canonicalises to `/private/tmp/...` produced two project keys for one folder: studio's routes `path.resolve` but do not `realpath`. The proof seeds the canonical path; the gap is recorded in `@idealize/studio`'s Known Limitations for a `realpath` fix when a real consumer hits it.

## Alternatives considered

**Extending the desktop landing-walk driver instead.** Deferred, not rejected: the walk runs on the packaged binary at landing time and will gain a Studio step then; the in-repo rendered proof is the per-commit evidence that runs keylessly on this repo alone, the ui-schedule precedent.

**Clicking Open chat in the proof.** Rejected for now: the seeded source thread is not a real session, so the click would exercise nothing truthful; the button's presence is the pane's claim, and real navigation lands with FR-P0-23's position work.

## Consequences

- Proof outputs land in `.idealize/proof/` as `studio-rail-{open,error}-{light,dark}.png` + `studio-rail-audit-{light,dark}.json`.
- A3's remaining scope after this: `project-note.md` retirement (blocked on JJ — "pinned shared context" is undefined and the role-guide rewrite is reserved for JJ's eye) and FR-P0-23 navigation (needs a conversation scroll-to-event seam).
