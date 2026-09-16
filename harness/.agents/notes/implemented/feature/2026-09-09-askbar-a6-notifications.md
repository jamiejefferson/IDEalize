# Agent Note: the Studio's alerts, and the three records that never stand in for one another

Status: implemented

JJ, 9 Sep 2026, after landing 20: "do a6". A6 is the last slice of `.idealize/plans/askbar-plan.md` — notifications and pilot polish — and its deliverables are the spec's three independent records (FR-P0-19), the MVP policy table, a notification that opens the exact Studio event, and the pilot-entry journey as the release proof.

## Problem

The Studio recorded everything an agent did and told nobody. A request addressed to the person sat on the timeline until the person happened to look, and the two facts a person needs kept apart — "I have not read this" and "this still needs an answer" — did not exist anywhere: the Studio card counted attention only, so a glance at the pane could not distinguish new work from old unanswered work, and nothing recorded whether an alert had ever gone out.

## Decision

**`@idealize/notify` owns two of the three records; the fold keeps the third.** Read position (per project, forward only) and notification delivery (`sent` → `opened`/`dismissed`, one record per Studio event) live in one JSON file under `<DSH_HOME>/idealize/notify/attention.json`, rewritten whole through one chain and renamed into place. Request resolution stays where it already was, in `@idealize/studio`'s fold, and nothing in this package writes it. That split is the requirement: dismissing an alert leaves unanswered work unanswered, and reading the Studio resolves nothing.

**The policy decides the one column nobody owned.** The spec's MVP table has three columns, and two were already implemented: the Askbar column is the chip's own fold over task attention, and the Studio column is the timeline record itself. `notificationPolicyFor` therefore answers the operating-system column and names the row that decided it (`needs-input`, `blocked-user`, `failed`, …), which the ledger records so a raised alert says which rule raised it. A failure alerts only when the person asked for the task, which needed one new fact in the fold: `StudioTask.requester`, the assignment's author.

**The browser raises the alert, because it is the half that hears the click.** The host records `sent` and pushes an `attention` event onto the bridge feed naming its Studio event; the window raises a Web Notification, which in the packaged app is a native macOS notification that reports a click. Clicking focuses the window, asks this window for that event through `@idealize/askbar`'s `requestStudio`, and records `opened`; letting it go records `dismissed`. The Askbar window runs the same bundle and skips alerts, so one event alerts once.

**An answered request says so where the alert lands.** A request-shaped timeline row carries its recorded resolution — Waiting for you while the fold holds it against a task, Answered once it does not — so an alert opened after the answer shows the answer and offers nothing to answer again (the spec's "notification opens after resolution" edge case).

## Alternatives considered

**Recording the in-product alert too.** The spec counts an in-product alert as a delivery. The Askbar badge is derived from task attention and clears when the attention resolves; recording it would be a second copy of state that can only drift from the first. The ledger records what left the app.

**Native notifications through `desktopActions.notify`.** Already composed, and one line to call. It carries no click channel, so an alert raised that way cannot open its event; it stays as the fallback when the browser refuses permission, and that alert has no way back.

**Read position per event.** One number per project is coarse: an event read out of order leaves everything after it unread. Per-event marks would need a set per project and a rule for what "read" means on a row nobody scrolled to; the number is honest about what the view can actually claim.

## Consequences

`@idealize/notify` gained a host face and now sits in both compiler aggregates (`tsconfig.host.json` / `tsconfig.client.json`, the same split `@idealize/askbar` uses), because its host half needed the Studio's event types and a host test.

An alert raised while no window is attached is recorded and never seen: the bridge buffer forgets it after 200 events or a restart, and nothing replays it. The unread mark on the Studio card is what survives that.

The alert's words are written where the record is made, like the bridge's own titles, so they are English in every locale.

Two repository gates were found red on this branch, from earlier landings, and are fixed here rather than left: `@idealize/transcribe`'s six service types had no catalog classification (landing 20), and `@idealize/ui-bar` named the provider `openrouter` as a price's source (AC-03). The price tag is now `market` in `@idealize/models`, which names the kind of source rather than the provider, so the mode/provider boundary holds without the pane losing what it can say.
