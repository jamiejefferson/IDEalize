# Agent Note: the four standing defects on the handoff's open list

Status: implemented

JJ, 4 Sep 2026, on the list of smaller open defects: "smaller ones - fix these too".

## Problem

Four faults had sat on the handoff's open list since before the reshape, each too small to schedule and none investigated to a cause.

**A notification never reached the operating system.** `@idealize/notify` posts `/idealize/notify/native`, which probes `desktopActions.notify` and answers 409 when it is absent. The desktop shell's `DesktopActions` face never carried `notify`, so on the packaged app the route always refused and the browser fell back to Web Notifications, which fire only after the user grants permission from the chime row.

**The free-tokens sidecar could be stranded for good.** The engine account lives in the sidecar's own database under its data directory; the admin password the host generated for it lives in the credential store. Those reset independently, and the engine's setup endpoint runs once per database: lose the credential while the database survives and `provision()` can neither log in nor set up, so the embedded sidecar stayed down with a message telling the user to adopt it by hand.

**A launch command could be typed into a half-drawn prompt.** `scheduleLaunch` armed its settle timer on the shell's *first* output chunk and never restarted it, so a prompt written in several pieces more than 300 ms apart received the command partway through being drawn.

**The sidecar's port answered every request with a bare 404.** The forked engine mounts a static directory unconditionally, defaulting to a dashboard build IDEalize does not ship. Nothing in the app links there, but the listener was silent about what it was, which is why the handoff recorded its purpose as unknown.

## Decision

**Notify:** `DesktopActions` gains `notify(notification)`, matching the shape `@idealize/notify`'s probe already looks for, wired in the launcher to the runtime's existing `showNotification`. The capability was already there; only the face was missing.

**Sidecar password:** the generated password is written to `host-admin.json` inside the data directory as well as to the credential store, and provisioning reads the file when the credential is gone. The two halves now travel together, and whichever survives puts the other back in step.

**Terminal launch:** the settle restarts on every output chunk, so the command goes in after 300 ms of quiet rather than 300 ms after the first byte. The 2 s timer becomes a deadline that still starts the agent on a shell that reports nothing or never falls quiet.

**Sidecar port:** the manager writes one page naming the port into `<dataDir>/port-page` and passes it as `CLIENT_DIST`.

## Consequences

Notifications now arrive natively on the desktop and keep the Web Notifications fallback in a plain browser. A data directory provisioned before this change gains its password record on the next start, from the credential the host still holds.

The terminal launch is later than it was for a chatty shell, by design: the command waits for quiet. A shell that prints continuously now always launches at the 2 s deadline, where before it launched 300 ms after its first byte; the deadline is what makes that bounded.

`host-admin.json` puts a loopback password on disk beside the database it unlocks, mode 0600. It is not a new exposure: anyone who can read that directory can already read the database. One case stays unrecoverable — both the credential and the file gone while the database survives — and the error still names the manual route.

## Alternatives considered

**Ship the engine dashboard.** Megabytes of a UI nobody opens, and a second authenticated surface to keep secure, to answer a request that only a curious probe makes.

**Reset the engine account when no password works.** It would recover the stranded case automatically, at the cost of silently destroying the deployment's usage history. The record beside the data prevents the case instead of repairing it destructively.

**Detect the shell prompt properly.** There is no protocol to detect one, which is why both V0 and this code use a timer; the debounce is the honest improvement available without inventing one.

## Evidence

- `dsh-plugin-desktop/tests/desktop-actions.spec.ts` (desktop repo): the notification reaches the launcher and is refused after disposal. 3 tests pass; `yarn typecheck` clean.
- `packages/idealize/freetokens/tests/admin-password.spec.ts`: the record round-trips, creates its directory, is owner-readable only, and reports no record for a missing, truncated or empty file.
- `packages/idealize/freetokens/tests/sidecar-port-page.spec.ts`: the child is spawned with `CLIENT_DIST` at a directory the manager wrote, holding a page that names the port and does not claim to be the dashboard.
- `packages/idealize/ui-terminal/tests/routes.client.spec.ts`: a prompt in three chunks 250 ms apart types nothing until 300 ms after the last one, and a shell printing every 100 ms launches once, at the deadline. 37 tests pass.
- `pnpm run lint`, `pnpm run typecheck` and `pnpm run doc-sync` clean.
