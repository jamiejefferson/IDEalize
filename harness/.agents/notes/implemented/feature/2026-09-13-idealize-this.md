# Agent Note: "Idealize this" on a folder's right-click menu

Status: implemented

JJ: "right-click menu on folders should include 'Idealize this' which opens it as a project."

## Problem

Turning a folder into an IDEalize project meant opening the app, opening the Files panel or the onboarding folder step, and walking a directory picker to a folder the person was already looking at in Finder. The work starts in Finder; the app made them leave it.

Nothing existed to build on. The app answered no URL scheme, registered nothing with Launch Services, and contributed no Services entry, so no surface outside the app could ask it to do anything.

## Decision

**The app's own Files pane carries the entry.** A folder's row menu gains "Idealize this" between Copy path and New file here. That is the menu JJ was looking at when he asked, and it is the one people are in while they are already in the app.

**A Finder Quick Action sends one URL, and the app does the work.** Right-clicking a folder runs `~/Library/Services/Idealize this.workflow`, whose single Run Shell Script action opens `idealize://project?path=<percent-encoded folder>`. macOS routes that to the running app as an `open-url` event, or starts it when it is not running.

An app cannot put an entry in Finder's right-click menu from its own bundle unless it handles Cocoa service messages, which Electron does not expose. An Automator workflow in the user's Services directory is the surface that does exist, and it is what Claude Code's own "New Claude Code Session Here" uses; this workflow's Automator keys are copied from one Automator wrote rather than invented.

**The app installs the workflow itself, on every launch.** The bundle is copied into /Applications by hand, so there is no installer to place it. `installFinderQuickAction` compares the shipped text with what is on disk and writes only when they differ, so a change here reaches an existing install on its next launch and an unchanged install does no I/O beyond two reads.

**A request names a folder and nothing else.** Anything on the machine can send an `idealize://` URL, so the scheme carries no command and no argument the app would run. `parseIdealizeUrl` takes `project` requests alone and refuses a relative path, because a relative path would resolve against whatever directory the app happened to be in.

**The window does the opening, not the shell.** Registering a Workspace is a client call (`workspaces.create`, then `startSession`), and the desktop shell has no chat surface. The main process pushes an `open-folder` event onto the host bridge and `@idealize/ui-bar` acts on it, the same path `open-studio` and `new-chat` already take. `create` is idempotent on the path, so idealizing the same folder twice opens the project that is already there.

**A cold start is the exception to skipping the feed's tail.** The window deliberately attaches past the retained events so a reload never replays an old request. A Quick Action that starts the app puts its request on the feed before the window can attach, so the attach scans the tail for an `open-folder` event and takes it when it is less than 30 seconds old.

## Alternatives considered

**`CFBundleDocumentTypes` with `LSItemContentTypes: public.folder`.** It puts IDEalize in Finder's "Open With" submenu for folders with no Services install at all, and "Open With → IDEalize V1" is not the entry JJ asked for.

**A Finder Sync extension.** It gives a real contextual-menu item owned by the app, and it needs a signed app extension target, its own bundle and entitlements, for one menu entry.

**Deliver the path over `open-file` instead of a URL scheme.** `open-file` carries a path with no request attached, so a second kind of request later would have nothing to travel in.

**Hold the cold-start request in the main process behind a route the window polls on attach.** It removes the 30-second window, and adds a route, a piece of main-process state and a fetch on every boot to do what reading the feed's tail already does.

## Consequences

- Both entries end at the same `openFolder` closure in `@idealize/ui-bar`: the Files pane calls it directly, and Finder reaches it over the bridge.
- `BridgeEventKind` gains `open-folder`, and `BridgeEvent` gains `folder`.
- The bundle declares the `idealize` scheme (electron-builder `protocols`), so Launch Services routes it to whichever copy of the app was registered last.
- A reload inside 30 seconds of an "Idealize this" re-opens that project's blank chat. `connectWorkspace` reuses a blank session, so the repeat lands on the chat that is already open rather than minting another.
- Windows and Linux deliver the URL in the argument list, which `requestFromArgv` reads on cold start and on `second-instance`; neither platform gets a Finder entry, and neither has a shell surface asking for one yet.
