# Agent Note: Service hatch — the source path edits in place, the quote joins the chat

Status: implemented

## Problem

JJ (2026-09-01, screenshot of the Service tab): the source path in the hatch banner was read-only, with no way to point the hatch at another checkout from the UI — the only lever was the `serviceSource` config row, applied on restart. The movie quote also sat in the banner as static copy, where JJ wants the chat to open with it "as an animation in the chat format" (following the 2026-08-28 feedback that the top copy should read as chat).

## Decision

**The edit persists through the settings user layer, not the config file.** `@idealize/hatch` registers the `idealize-hatch` settings namespace via `installSettingsSection` (the canonical optional-settings wiring, as `@idealize/ui-terminal` uses for launch commands): the composed `serviceSource` config is the base layer, and `POST /idealize/hatch/service {path}` writes the user layer through `settings.update`. The next probe resolves the new path immediately — no restart — and the value survives restarts. The route validates the fork markers (`FORK.md` + `package.json`) before persisting, answers with the fresh service report so the client renders exactly what the host now believes, and refuses with 503 while no settings provider is mounted rather than writing nowhere.

The route logic lives in `packages/idealize/hatch/src/service.ts` behind a `ServiceRouteDeps` face, tested to 100% in `tests/service.spec.ts`; `index.ts` stays wiring (it carries no tests of its own, and the coverage gate measures loaded files, so the extraction is what makes the behaviour testable without swallowing the whole route surface).

**The client edit is the only source edit.** `ServiceSection`'s banner renders the path with an Edit button whether or not the path is valid — a wrong source is fixed right there — and a save re-adopts the hatch session at the new path, because the bound session roots in the old checkout. The `/idealize/hatch` composition page's hint now points at the Service tab instead of telling the user to set `serviceSource` by hand.

**The quote is the chat's opening row.** `QuoteRow` renders inside the transcript (and the empty state) as an assistant-side bubble: a pulsing typing indicator for 600ms, then the line slides up into place (`service-quote-arrive`). Reduced motion (`prefers-reduced-motion`) skips the theatre and lands the line at once. The unused `service.banner.retort` key stays for a future exchange.

## Alternatives considered

- **Write `serviceSource` into the home patch.** Rejected: home-patch config applies on restart, so the edit would look ignored until the app relaunches; the settings layer is the mechanism the repo already has for immediately-effective, persisted user values over composed config.
- **A runtime-only in-memory override.** Rejected: it would silently revert on restart, which reads as data loss.
- **A CSS typewriter reveal of the quote text.** Rejected: character-stepped reveals need monospace width tricks that fight the italic proportional face; the typing-indicator-then-message pattern is the chat-native animation.

## Consequences

- The effective source is `settings user layer → serviceSource config → ~/dev/idealize`. A deployment pinning `serviceSource` can still be overridden per-user from the UI; that is the point of the edit.
- `@idealize/hatch` gains a `@deepseek-ai/dsh-settings` dependency.
- The 503 while settings is unmounted is loud by design: the alternative (accepting the edit and dropping it) hides misconfiguration.
