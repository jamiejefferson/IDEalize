# Agent Note: The launch names its brain, and New chat mints a chat

Status: implemented

The two defects the 27 August landing walk met after [the tab row went](../feature/2026-08-27-the-tab-row-goes.md) — its Consequences names both — reading the walk's own evidence in `idealize-desktop/.idealize/proof/landing-2026-08-27/findings.md` (defects 3 and 4). The switcher is `@idealize/activity-pills`' ([in-session brain switch](../feature/2026-08-26-in-session-brain-switch.md)), the view seed is `@idealize/ui-bar`'s, and the reuse rule is the host's.

## Problem

**The composer named a brain by its id, and sometimes the wrong brain.** The switcher's trigger read `current?.name ?? state.currentId`, so any moment the chat's current brain was not among the brains its space offers, the raw agent-preset id rendered where a display name belongs. Two moments produced exactly that. A chat launched into Gallery read `coding` — the preset the blank chat was created on — until a reload; and a blank chat carrying an earlier launch's `space: gallery`, relaunched into Chat on Coding, read `gallery` and stayed there, because the controller's `load()` refused a second read while one was in flight. A launch changes the chat's space, its preset and its recorded brain over three separate frames, each firing another read, so the coalescing dropped every read after the first and left the answer that described the chat the user had just left.

**New chat handed back the chat you had just launched.** The host's New chat reuses a workspace's blank session rather than minting one (`connectWorkspace`, `packages/client/runtime/src/client/workspaces/service.ts`), and `blank` means "no turn has run". A chat launched into a space has recorded its space and its brain and has run no turn, so it was still the workspace's blank chat; New chat reopened it, and with the welcome card retired on its recorded brain there was no chooser to answer. For JJ this read as New chat doing nothing.

## Decision

**The current brain is resolved against the space, and the label is always a name.** `resolveCurrentBrain` (`src/client/brain-switcher.ts`) takes the recorded brain when the space offers it, then the chat's preset when the space offers that, and otherwise the space's own default — the brain a launch into that space puts the chat on. The trigger renders `current.name` and the component returns null while no brain of the space is current, so an id can never reach the screen. That null is the beat before the first read lands, where the seat was already empty.

**Reads are not coalesced; the newest wins.** `load()` takes a monotonic token and only the newest read writes the snapshot. Every call fetches, which is the price of never leaving a superseded answer standing.

**A launch beats the space seed.** `seedViewFromSpace` became `createSpaceSeed`, which publishes `noteLaunch(sessionId, space)` beside `start()`. The welcome card calls it before it POSTs the record, so the launched space answers for that chat from then on and the seed cannot take a relaunched chat back to the space its projection still names. `noteLaunch` also clears the chat's seeded mark, so a launch whose own ring write found no entry is placed by the next ring change instead of being stranded.

**A recorded brain makes a blank session unreusable.** `connectWorkspace`'s reuse scan skips a blank session whose `brain` projection names one; `SessionsPortSummary` carries `projectionValues` for it. The `blank` computation is untouched, so the hero, the welcome card and the sidebar keep reading it as they did — only the reuse decision changes. The `space` projection cannot serve as the marker: every chat derives one through the ladder, so it is present on a chat that has never been launched.

## Alternatives considered

- **Make the launched chat non-blank at the host.** `blank` also drives the hero, the welcome card's whole existence and the sidebar's row filtering, so flipping it would have retired the composer's welcome card on the chat that needs it. The reuse scan is the one place that decides reuse.
- **A reuse-veto seam on `IWorkspaces`.** Cleaner in the abstract, and it would have kept the fork's vocabulary out of upstream. It also widens a public service interface, its test doubles and the generated client api-catalog for one predicate; the projection read is two lines and needs no new public operation.
- **Let the seed keep reading the projection and simply run later.** Any ordering that waits on the projection frame races the card's own ring write; the launch is the fact, and telling the seed is stating it rather than timing around it.
- **Keep the id as the label's last resort.** It is what shipped, and it is what the walk photographed. An id is a log value; showing one tells the user nothing and looks like a bug because it is one.

## Consequences

`@idealize/ui-bar` exports `createSpaceSeed` and `SpaceSeed` in place of `seedViewFromSpace`. `@deepseek-ai/dsh-client-runtime` gains a type-only dependency on `@idealize/spaces/client` for the projection merge, the third package to take it after `@deepseek-ai/dsh-client-ui-workspace`; the [fork table](../../../../FORK.md) carries the row.

The switcher renders nothing for a chat whose space offers no brains at all — Motion, and any space whose roster entry is empty. That was already true through the `brains.length === 0` guard this replaces.

Proof: `.idealize/proof/launch-follow-ups-*.png`, harness [`packages/idealize/spaces/proof/launch-follow-ups-proof.mts`](../../../../packages/idealize/spaces/proof/launch-follow-ups-proof.mts). It boots the whole `idealize` profile at 1280×840 in a scratch home with a scripted mock model, and in both themes: launches a fresh chat into Gallery and requires the switcher to read the roster's own display name for the Gallery brain immediately and again after a reload, never the preset id; presses the shipped New chat control on that launched-but-unsent chat and requires a different session id with the five-tile space step on screen; then records `space: gallery` with no brain on that fresh chat through `POST /idealize/spaces/select`, checks the chooser still asks, launches it into Chat on Coding and requires the switcher to read Coding. 52 expectations, two consecutive passes.
