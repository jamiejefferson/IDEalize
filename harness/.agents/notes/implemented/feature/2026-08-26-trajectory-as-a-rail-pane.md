# Agent Note: Trajectory reads beside the conversation, not instead of it

Status: implemented

Part of the spaces-and-brains reshape. The rail and its drawer are `@idealize/ui-bar`'s; the ledger is [`@deepseek-ai/dsh-client-ui-trajectory`](../../../../packages/client/ui-trajectory/README.md)'s.

## Problem

Trajectory sat in the conversation view ring beside Chat, Gallery, Sound Stage and Schedule. Selecting it replaced the conversation, so reading what the agent did meant losing sight of what it said. The ledger's whole job is to explain a transcript, and the ring made the transcript and its explanation mutually exclusive.

The ring also mixed two kinds of thing. Chat, Gallery, Sound Stage and Schedule are places a chat happens; Trajectory is an instrument you point at one. JJ settled it on 26 Aug: "100% agree. move them both out of the tab bar. move both to the rail."

The move breaks a shipped feature on the way. A tool row in Chat carries an Inspect button that writes `{callId}` into the chat's own store and then asks the ring for its `'trajectory'` entry. ui-conversation's own comment calls an unregistered id "safe": the ring falls back to Chat. So with Trajectory off the ring, Inspect silently does nothing.

## Decision

**The ledger becomes a service, and the rail decides where it sits.** `@deepseek-ai/dsh-client-ui-trajectory` drops its `conversation.view` registration and provides `trajectorySection` on the Context: `Component`, plus `face(sessionId)` returning that chat's wired props or `undefined` while the chat has no binding. This is the third instance of the seam `modelsSettingsSection` and `agentPresetSection` established, and it is the only sanctioned channel — the client bundle purity gate polices `@deepseek-ai/` specifiers, so a cross-package value import would inline a duplicate module rather than fail.

The providing package does its own wiring. `face()` binds the selector hooks with `bindSnapshotSelector` and hands over `loadOlder`, `setActualDuration` and the bound translate, exactly as `ui-settings-models` does, so a consuming surface needs no knowledge of Trajectory's stores. A `WeakMap` keyed on the session object caches one selector hook per chat: minting a fresh hook per render would remount every `useSyncExternalStore` subscription.

**`@idealize/ui-bar` gains a `'trajectory'` drawer pane**, seated between Brains and Feedback because both are instruments rather than places. The pane remounts the ledger per chat (`key={sessionId}`) so folds, search and selection never carry across, and states "Open a chat to see its trajectory." rather than rendering an empty ledger.

**The inspect handoff is rescued from the consumer side, with no upstream seam.** `StoreInstanceLike` already publishes `getSnapshot()` and `subscribe()` (`packages/client/ui-slots/src/renderer.ts:43`), so `watchInspect()` subscribes to the chat's store through `hostFace().storeOf(entry, sessionId)` — the framework's per-session instance cache, which is what the rendered ring reads. On a non-null `inspect` it clears the field first, then reports, so one click fires once. The bar records `{sessionId, callId}` in its own view state and opens the pane; the pane passes the target on only when it belongs to the chat on screen.

`handle.create()` was the trap here: it mints a parallel store instance the ring never renders, so the watcher would see writes nobody made and miss every write the user made. `packages/idealize/ui-bar/tests/trajectory-pane.client.spec.tsx` guards it against the real `createChatStore` on a real `SlotRegistry`.

**The ledger's split adapts to the ledger, not the window.** The rail drawer runs 320–720px and the user drags it. `.details` was capped at `calc(100% - 280px)` unless `@media (max-width: 760px)` fired, and that media query read the 1280px viewport, so in a 420px pane the record inspector rendered 140px wide with its tab labels clipped to single letters. `.split` becomes a named container and the rule becomes `@container trajectory-split (max-width: 760px)`, so a narrow pane gets the covering inspector the rule always intended: 386px with all five tabs legible, measured off the rendered DOM.

The floating-composer reserve needed the same honesty. The pane publishes `--dsh-composer-height: 0px`, collapsing a 168px reserve meant for a composer that does not float over a drawer down to the ledger's own 16px.

## Alternatives considered

- **Keep the ring entry and add the rail pane.** Two seats for one ledger, with the ring seat still hiding the conversation. It also leaves the question of which one Inspect should open.
- **Register the ledger on a slot the drawer renders.** Slots carry no per-chat wiring and no way for the drawer to decide seating, and the drawer already seats Brains and Appearance by service. A second mechanism for the same job.
- **Add an upstream seam for the inspect field** — an event, or a service method on the chat view. `StoreInstanceLike` already exposes exactly what the watcher needs, and reading a published interface costs no fork surface. Checking that before designing was the brief's own instruction.
- **Have ui-bar bind the selector hooks itself.** It would put Trajectory's store knowledge in a package that should only know where the ledger sits, and every future consumer would repeat the binding.
- **Keep the viewport media query and add a pane-specific override class.** The bug is that the ledger asked the wrong question, and a class per host repeats the answer for every future host. The container query fixes the question once.
- **Cap the drawer's minimum above 760px** so the side-by-side split always fits. It takes a user control away to avoid fixing a layout rule, and 320px is the reshape's stated minimum.

## Consequences

`packages/client/ui-trajectory` is an upstream touch, logged in FORK.md: the ring registration, the props type narrowed off the slot standard kit, the container query, the invariant reason, `@deepseek-ai/dsh-client-web-react` as a peer dependency, and both READMEs. The generated client slot catalog loses its `conversation.view id 'trajectory'` row; `scripts/gen-cordis-catalog.ts` gains a `trajectorySection` walk exemption, since the service carries a React component and the README owns its API.

`TrajectoryView`'s props no longer come from the conversation slot's standard kit; they are `TrajectoryViewInjected & ConvViewOwnerProps & PropsLocale<'trajectory'>`, so any surface can seat the ledger by satisfying an explicit interface.

Proof: `.idealize/proof/trajectory-rail-*.png` (four frames per theme at 1280×840), harness [`packages/idealize/ui-bar/proof/trajectory-rail-proof.mts`](../../../../packages/idealize/ui-bar/proof/trajectory-rail-proof.mts). It boots the real `idealize` profile over a scratch home, scripts the model with `@deepseek-ai/dsh-llm-mock-server` so the agent loop, tool execution and projection stay real, and drives eight turns through the shipped composer. Every assertion reads the rendered DOM: the ring enumerates Chat, Gallery, Sound Stage and Schedule with no Trajectory; the rail carries Trajectory pressed; the ledger's 35 rows overflow a 712px scroller and scroll upward off the tail with the conversation readable beside it; the drawer settles at exactly 320 with the ledger's four controls not overflowing; and an Inspect click in the chat leaves the pane selecting `tool\0call\0mock-call-1`, matching the clicked row's `data-chat-call-id`, with a 386px inspector.

**The ledger fits at 320px because the inspector stopped standing beside the rows.** Both are readable, one at a time, which is the trade the width forces.
