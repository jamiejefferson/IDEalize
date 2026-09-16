# Agent Note: The fork's docs are English-only

Status: implemented

## Problem

Upstream deepseek-harness keeps every in-scope document as an English/Chinese pair, enforced by the `verify-translation-pairing` gate in `doc-sync`. The fork inherited the gate but authors only English: by 1 Sep 2026 it stood at 81 violations (76 missing `.zh.md` counterparts, 5 out-of-sync pairs), every one a fork-authored Agent Note, IDEalize package README, or regenerated catalog. Keeping it green would mean translating every fork document into Chinese forever, for a product with no Chinese-reading audience.

## Decision

JJ (1 Sep 2026): fork docs are English-only. The translation-pairing row is removed from `scripts/run-gates.ts` (logged in FORK.md), and the root `AGENTS.md` documentation paragraph now states the policy: write no `.zh.md` counterparts, leave the inherited Chinese corpus untouched, never run `dsh-translate-docs`.

The inherited Chinese files and their `.i18n.yaml` records stay in place: deleting ~950 upstream files would dominate every future upstream sync diff for no gain, and the website's bilingual projection keeps rendering what exists. They are frozen, not maintained — an English-side edit no longer obliges a Chinese update.

## Alternatives considered

- **Translate the 81 and keep the gate**: rejected by JJ — recurring translation cost with no reader.
- **Manifest exclusions for `packages/idealize/**` and `.agents/notes/**`**: keeps the gate hollow and taxes every new fork doc location with a manifest edit; the policy is corpus-wide, so the gate goes, not its scope.
- **Delete the Chinese corpus**: maximises upstream-sync friction and breaks the website's existing zh pages; retirement needs neither.

## Consequences

- `doc-sync` runs 27 gates; translation pairing is no longer one of them. CI inherits the same list.
- `verify-translation-prompt`, `gen-translation-brief`, the `dsh-translate-docs` skill and the pre-commit staged-records check remain in the tree, inert, so an upstream sync does not conflict on them.
- Inherited pairs drift silently when their English side changes; that is the accepted cost of the policy, and a future upstream sync may refresh them wholesale.
