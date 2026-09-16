# Agent Note: Service hatch pane as a full chat

Status: implemented

English | [中文](2026-08-24-service-hatch-full-chat.zh.md)

## Problem

The Service tab of the Service hatch modal rendered a cut-down transcript (user bubbles, assistant text, tool names as bare lines) over a bare textarea, and its failure paths were silent: a failed `/idealize/hatch/service` probe disabled the composer with no message, `ensureSession` returned `null` and the send handler just cleared its busy flag, a freshly created session was never staged open so its transcript never streamed, and the assistant row matched kind `'assistant'` while the registered chat kind is `'assistant-step'`, so replies never rendered at all. JJ's decision for the pane is a full chat inside the modal, never a hand-off to a main-area session.

## Decision

**The pane renders the complete chat-node projection for the hatch session, in-pane.** `ServiceSection` (in `@idealize/ui-bar`) dispatches every `snapshot.chat` node kind: user/steering bubbles, `assistant-step` markdown with collapsible reasoning, `tool-call` cards (status dot, one-line args digest, expandable args and result, error state, nested subcalls to depth 4), command rows, compaction/retry/max-tokens markers, and turn errors through `displayFailureMessage`. The transcript follows its tail unless the reader scrolls up, and a running turn shows a Working row.

**The composer is real.** Image attachments arrive by picker, paste, or drop (PNG/JPEG/WebP/GIF, matching the apiproxy prompt route), rail through the platform `@deepseek-ai/dsh-client-ui-attachment` components, and send as base64 `PromptContentPart` images beside the text. Stop and Open-as-a-chat remain.

**Every failure path renders a message in the pane.** A probe failure renders a strip with a Try again button; `ensureSession` now rejects instead of returning `null` (a missing binding throws) and the section renders the rejection; prompt business failures render from the session's mirrored `promptError`; a fresh session is staged with the class-only `open()` so its transcript displays, mirroring what `adoptSession` already did. Amended in round 3: a `promptError` whose code is `MISSING_CREDENTIAL` or `AUTH` renders as a notice strip with a Connect-a-model button (`openModels` on the injected face opens the Brains pane) — JJ read the plain error line as "chat not working"; other failures keep the plain line.

**The section stays a slot-composed pane, sized by the settings modal.** The column is a flex stack whose transcript takes the flexible row, so the layout holds from a 320px content column (the drawer floor) upwards.

## Alternatives considered

**Mount the main area's `ConversationRoot`/`ConversationSession` slot tree inside the modal.** Rejected: the session-scoped slot machinery renders only the *current* session — `SessionProvider` follows `sessions.currentProvideInfo` — so hosting the full surface for a non-current session means new renderer plumbing, and pointing the current selection at the hatch session is exactly the main-area session JJ ruled out.

**Value-import the conversation plugin's `ChatView`/`InputBar`.** Rejected by the client bundle purity gate: cross-plugin value imports are forbidden; only platform modules (ui-primitives, ui-attachment, web-react) and the client runtime are shared. The pane therefore renders the runtime's chat-node projection itself with those shared components.

**Keep failures on `paneError` state for prompt business errors too.** Rejected: `session.prompt` business failures already mirror into `snapshot.promptError`, so the transcript renders that one source; a second local copy of the same failure would double-display.

## Consequences

The hatch chat now shows tool activity and replies with the same information order as the main surface, at pane scale, and no failure leaves the composer silently dead — the cost is a pane-local projection (about 250 lines of render code) that tracks `ChatNodeDataMap` kinds by hand; an unknown future kind falls through to nothing, matching the documented merge-extensible default. `ensureSession`'s face changed from `Promise<SessionBinding | null>` to a rejecting `Promise<SessionBinding>`, and `@idealize/ui-bar` gains the platform ui-attachment dependency. Covered by `packages/idealize/ui-bar/tests/service-section.client.spec.tsx` and the proof run `packages/idealize/ui-bar/proof/service-hatch-proof.mts` (screenshots under `.idealize/proof/service-hatch-*.png`).
