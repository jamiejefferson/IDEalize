# @idealize/notify

Everything that interrupts the person: the announcement banner, the done chime, and the Studio's alerts. The host registers the `idealize-notify` settings section, six loopback routes and the notification policy over `@idealize/studio`'s timeline; the browser renders the newest active announcement on the frame's `shell.banner` strip, plays the task-complete chime when an agent finishes, raises the Studio's alerts and reports what the person did with them, and adds the chime row to General settings. Mounted by the `idealize` profile as the `idealize-notify` row.

## Three records, kept apart (FR-P0-19)

The product spec asks for three records that never stand in for one another, and this package owns two of them:

| Record | Owner | What moves it |
|---|---|---|
| Studio read position | here (`read` in the ledger) | showing the Studio view; it moves forward only |
| Notification delivery | here (`notifications` in the ledger) | raising an alert (`sent`), then the person opening (`opened`) or letting it go (`dismissed`) |
| Request resolution | `@idealize/studio`'s fold | the answer the request asked for |

Dismissing an alert therefore leaves unanswered work unanswered, and reading the Studio resolves nothing. The ledger is one JSON file under `<DSH_HOME>/idealize/notify/attention.json`, rewritten whole through one chain and renamed into place; a file that is not a ledger refuses loudly rather than starting empty over the top of it. A write that fails drops the in-memory copy so the next read comes off disk, and the caller logs it: an alert whose record did not land is never pushed to the window. It keeps the newest 500 alerts.

## The MVP policy table

`notificationPolicyFor` (`src/attention.ts`, pure) decides one recorded Studio event against the spec's MVP table and names the row that decided it:

| Row | Event | Operating-system alert |
|---|---|---|
| `progress` | an assignment, or a task update of `queued`/`working`/`resumed`/`progress` | off |
| `mention` | a `message` addressed to `user` | on |
| `needs-input` / `needs-action` | a `request` of that subtype | on when it names `user` |
| `blocked-other` / `blocked-user` | a task update of `blocked` | on when it names `user` |
| `done` | a task update of `done` | off |
| `failed` | a task update of `failed` | on when the person asked for the task (the fold's `requester`) |
| `other` | everything else | off |

The table's other two columns are already owned: the Askbar column is the chip's own fold (`@idealize/askbar`'s `chipStateOf` reads the same task attention) and the Studio column is the timeline record itself. `attentionNotice` writes the alert's words from the row, the event's author and its text, cut to 160 characters.

Each alerting event is recorded `sent` and pushed onto `@idealize/host-bridge` as an `attention` event naming its Studio event; the browser half raises it there. A second arrival of one event keeps the first record and stays quiet.

## Configuration

| Field | Default | Meaning |
|---|---|---|
| `appVersion` | `1.0.0-dev` | The running app's version, compared against each announcement's `minAppVersion` and `maxAppVersion`. |

## Settings (`idealize-notify`)

`chimeEnabled` (default `true`), `chimeVolume` (0 to 1, default `0.4`) and `lastSeenAnnouncementId` (default empty). The schema in `src/settings.ts` is shared by the host registration and the browser's settings scope.

## Routes (loopback only; mutations need `x-idealize-auth: 1`)

- `GET /idealize/notify/app` returns `{appVersion}` for the banner's version gate.
- `GET /idealize/notify/chime.mp3` serves the chime asset (`assets/TaskComplete.mp3`).
- `POST /idealize/notify/native` `{title, body}` raises a native notification through the desktop shell's `desktopActions.notify` when that service is composed; 409 otherwise, and the browser half falls back to Web Notifications.
- `GET /idealize/notify/attention` serves the whole ledger: `{read, notifications}`.
- `POST /idealize/notify/attention/read` `{project, seq}` moves a project's read position forward (the folder is resolved, as the Studio's own routes resolve it) and answers the stored position.
- `POST /idealize/notify/attention/state` `{event, state}` records `opened` or `dismissed`; 404 when no alert was raised for that event.

## Browser half

The banner reads `/idealize/announcements` (served by `@idealize/feedback`) and `/idealize/notify/app`, then `selectAnnouncement` (`src/announcement.ts`) surfaces the newest active row whose version range contains the app version and whose id is not `lastSeenAnnouncementId`. Dismiss writes that id. A failed fetch shows no banner and no error.

The alerts listen to the same feed: an `attention` frame raises one notification through the browser's own Notifications API, because that is the half that reports a click back (in the packaged app it is a native macOS notification either way). Clicking it focuses the window, asks this window for that exact Studio event (`@idealize/askbar`'s `requestStudio`, which `@idealize/ui-bar` answers) and records `opened`; letting it go records `dismissed`. Without permission the host route still raises it, and that alert carries no way back to the event. The Askbar window runs the same bundle and skips alerts, so one event alerts once.

The chime listens to `@idealize/host-bridge`'s event feed. Before reading live, it seeds a gate (`src/chime-gate.ts`) with the newest retained sequence from `/idealize/events/recent`, so work that finished before the page attached (app restore, tab reload) never chimes. Each fresh `agent-finished` event plays the chime at the settings volume and raises a notification. `ctx.idealizeNotify` (`notify(title, body)`, `chime()`) lets other plugins raise the same pair without importing this package's components. The chime row on `settings.general.item` (order 40) offers on/off, a volume slider and a preview.

## Model Experience

None, as the banner, the chime and the alerts read settings, the host bridge's event feed and the Studio timeline, and register nothing that reaches a model request.

#### KV Cache effect

Independent of every model request; nothing here changes request content or ordering.

## Known Limitations and Deferred Work

- **The chime depends on `@idealize/host-bridge` being composed.** Without `/idealize/events/recent` the gate never seeds and no chime plays; there is no fallback to the session event stream.
- **Announcements come from one REST route with no local cache.** A page loaded offline shows no banner even if one was shown a moment ago; the only remembered state is the dismissed id.
- **Native notifications need the desktop shell.** In a plain browser the fallback is Web Notifications, which fire only after the user grants permission from the chime row's preview.
- **An alert raised while no window is attached is recorded and never seen.** The ledger holds it `sent`, the bridge buffer forgets it after 200 events or a restart, and nothing replays it; the unread mark on the Studio card is what survives. The main window is the one that raises alerts — collapsing to the Askbar hides that window rather than closing it, so its renderer keeps raising them, but a composition with only the Askbar window raises none.
- **The alert's copy is English only.** The words are written where the record is made, like the bridge's own titles, so a Chinese locale reads English alerts.
- **Only a `task-update` of `failed` reads as a failure.** The spec's row also covers a lost runtime, which no producer records yet.
- **The ledger never forgets a read position.** Projects removed from disk keep their entry; only alerts are capped.
