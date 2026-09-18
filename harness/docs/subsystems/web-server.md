# HTTP Server

[dsh-host-webserver](../../packages/host/webserver) is the browser HTTP carrier for the GUI host: a single `node:http` plugin providing `ctx.webServer`, a named-route registry, index.html transform callbacks, and one fallback handler that a plugin may claim. It is not part of the agent loop and not a capability seam; it knows no harness concepts, and another plugin registers every feature route, including the `/api` bridge, plugin bundles, and the HMR event stream ([layering note](../../.agents/notes/implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.md)). It serves browsers only: Electron loads the built files over `file://` and sends fetch requests through an IPC bridge instead of this server.

Source: [`packages/host/webserver/src/index.ts`](../../packages/host/webserver/src/index.ts)

## Routes

```ts type-equiv
/** Route match kind: 'exact' matches the pathname verbatim; 'prefix' p matches p and p/<anything>. */
type WebRouteKind = 'exact' | 'prefix'
```

```ts type-equiv
/** One named route registration. */
interface WebRoute {
  kind: WebRouteKind
  /** Absolute pathname, no trailing slash. */
  path: string
  /** Owns the full response lifecycle (may hold the response open, e.g. SSE). */
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}
```

Match order is fixed: exact table first, then longest matching prefix, then the registered fallback. Registration order carries no request-facing semantics — named routes are composed to be disjoint, and the fallback seat answers anything no named route claims; one owner only, a second registration throws. The shipped Web composition claims the seat with [`dsh-host-frontend-static`](../../packages/host/frontend-static/src/index.ts), the SPA dist server with locked semantics: non-GET/HEAD is 405, traversal outside the dist root is 403, any miss falls back to `index.html` with HTTP 200 (SPA routing), and unknown extensions ship as octet-stream.

## Config

```ts type-equiv
/** Gateway config: the listen address. */
interface Config {
  /** Listen host; the two supported values are loopback and all-interfaces. */
  host: '127.0.0.1' | '0.0.0.0'
  /** Listen port; zero requests an OS-assigned port. */
  port: number
}
```

`host` accepts only `127.0.0.1` (default posture) and `0.0.0.0` (deliberate network exposure); there is no TLS, auth, or origin policy, so a non-loopback bind exposes the server to that network. The dist location is an assembly fact of the frontend plugin that claims the seat.

## The service

`WebServer` (`ctx.webServer`) listens immediately on activation; a listen failure (EADDRINUSE…) rejects initialization, and the boot process reports the failed fiber. `register(route)` adds one named route and returns its disposer; a duplicate `(kind, path)` throws because route patterns are a composition-level contract and a collision is a misconfiguration. `tapIndex(transform)` adds a pure html-to-html transform applied to every index response — `/` and each SPA fallback — in registration order; [dsh-client-modules](../../packages/client/modules) uses it to inject the boot manifest. `port` reads the listening port, including the port assigned by the OS when `config.port` is 0.

A request whose handling throws (a malformed %-escape hitting `decodeURIComponent`, a client dropping mid-body) is logged as a warning and answered 400 — or the socket destroyed when headers are already out — never a process exit. Disposal pairs `close()` with `closeAllConnections()` because a handler may hold its response open (SSE) and such connections never end on their own; without the force-close, teardown would hang. The package never prints: the URL line belongs to the shell. Per-package operational detail, including the dev-mode bundle watch pipeline, stays in the [README](../../packages/host/webserver/README.md).

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxidealizebridge--idealizebridge"></a>

### `ctx.idealizeBridge` — `IdealizeBridge`

The notification feed behind `ctx.idealizeBridge`: a capped buffer plus its HTTP surface.

Source: [`packages/idealize/host-bridge/src/index.ts:42`](../../packages/idealize/host-bridge/src/index.ts)

<a id="ctxidealizecomm--idealizecomm"></a>

### `ctx.idealizeComm` — `IdealizeComm`

The `idealize` command service: agent naming, roles, the roster, and mailbox delivery behind `POST /idealize/comm`.

```ts cordis-catalog
/**
 * Give a session its agent name if it has none: the project's pool is
 * recorded on first use and the draw is logged to the session so the model
 * and the sidebar both learn it.
 * @param session - the session to name.
 * @returns the name, new or existing.
 */
ensureName(session: Session): Promise<string>

/**
 * Record a role for a session whose preset carries one and give it the
 * role's task title. No-op for presets outside the mapping.
 * @param session - the session to take the role.
 * @param presetId - the session's preset id, matched against the role mapping.
 * @returns the adopted role, or `undefined` when the preset carries none.
 */
async adoptRole(session: Session, presetId: string | undefined): Promise<CommRole | undefined>

/**
 * Every addressable chat. The Studio chat (the `studio` space) is the
 * person's own seat and never lists: it is neither named nor a delivery
 * target.
 * @returns the roster, live chats first.
 */
async roster(): Promise<RosterEntry[]>

/**
 * Answer one wire request. Never throws for a caller mistake; those come back as `ok: false`.
 * @param request - the command envelope from the wire.
 * @returns the command's response payload.
 */
async handle(request: CommRequest): Promise<CommResponse>

/**
 * Wake the project's coordinator for a qualifying Studio event: a mailbox
 * note always, plus one model invocation when the coordinator is live,
 * idle, and had an empty mailbox — so a burst invokes it once and the rest
 * waits in the inbox. The event's own author is never woken.
 * @param event - the committed Studio event.
 */
async wakeCoordinator(event: StudioEvent): Promise<void>

/**
 * The safety net under the prompt's posting rule: when a turn that called a
 * generation tool ends and the agent posted nothing to the Studio during it,
 * one `idealize`-authored `message` on the project's timeline says who
 * generated what, with the artefact ids, and links the agent's chat through
 * `source.thread`. Nothing is recorded for a turn with no generation call,
 * a generation that stored no artefact (its failure is in the agent's own
 * chat), a chat outside a project, the Studio chat, or a turn in which the
 * agent posted itself (any `message` it authored, a `rung` line included).
 * The system author keeps the coordinator asleep: the line reports an act
 * and asks nobody to do anything. An artefact stored after the turn ended
 * (a `run_in_background` generation) takes the {@link noteBackgroundArtefact} path.
 * @param session - the session whose turn ended; its log is read up to that turn's end.
 * @param turn - the ended turn's number.
 * @returns the recorded line, or undefined when nothing was recorded.
 */
async reportFinishedTurn(session: Session, turn: number): Promise<string | undefined>

/**
 * The safety net's second path: a generation tool run with
 * `run_in_background` stores its artefacts after the turn that started it
 * has ended, where {@link reportFinishedTurn} never sees them. An
 * `artefact/created` event whose record names a generation tool as its
 * source, and whose own turn (`sourceTask.turnSeq`) has already ended,
 * joins the session's pending batch; the batch's window
 * (`backgroundPostDelayMs`) restarts on every arrival, and when it closes
 * one `idealize`-authored `message` reports the batch. An artefact whose
 * own turn is still running (every foreground generation), a chat outside a
 * project, and the Studio chat are ignored.
 * Disposing the plugin, or the session ({@link forgetSession}), drops a
 * pending batch unposted.
 * @param session - the session whose log gained the event; its log decides whether a turn is open.
 * @param event - the `artefact/created` event as appended.
 */
noteBackgroundArtefact(session: Session, event: SessionEvent<'artefact/created'>): void

/**
 * Drop a session's pending background batch: the session is gone, so its
 * line would name a chat the Studio row cannot open.
 * @param session - the disposed session.
 */
forgetSession(session: Session): void
```

Types: [Session](session.md) · [SessionEvent](session.md)

Source: [`packages/idealize/comm/src/service.ts:229`](../../packages/idealize/comm/src/service.ts)

<a id="ctxidealizestudio--idealizestudio"></a>

### `ctx.idealizeStudio` — `IdealizeStudio`

The Studio service: record, read and fold one project's coordination timeline.

```ts cordis-catalog
/**
 * Record one event and announce it. A duplicate `messageId` returns the
 * recorded event, writes nothing, and announces nothing.
 * @param input - the validated submission, its project already resolved.
 * @returns the recorded (or already-recorded) event.
 */
async record(input: StudioEventInput): Promise<StudioAppendResult>

/**
 * A project's events after a cursor, oldest first.
 * @param project - the resolved project folder.
 * @param since - return events with `seq` greater than this; 0 for all.
 * @returns the retained events after the cursor.
 */
async timeline(project: string, since: number = 0): Promise<StudioEvent[]>

/**
 * The folded project state.
 * @param project - the resolved project folder.
 * @returns tasks in creation order plus per-owner work views.
 */
async state(project: string): Promise<StudioState>

/**
 * Runtime presence for every participant the folded state names as a task
 * owner. In-process, a participant is reachable exactly while a live root
 * agent runs its session; there is no heartbeat to expire, so the answer is
 * current by construction. Non-session participants (`user`) read as
 * unreachable — the surface decides how to render them.
 * @param state - the folded state whose agents are keyed.
 * @returns presence per participant key.
 */
presenceOf(state: StudioState): Record<string, StudioPresence>

/**
 * Record one addressed message and attempt its delivery into the target's
 * mailbox. One logical message: a repeated `messageId` never records a
 * second message event — a retry re-attempts a still-queued delivery and
 * returns the recorded state once it is delivered or acknowledged.
 * @param input - the validated submission; `target` names the recipient.
 * @returns the message event, whether it already existed, and its delivery state.
 */
async deliver( input: StudioEventInput & { target: string }, ): Promise<{ event: StudioEvent; duplicate: boolean; delivery: DeliveryState }>

/**
 * Every stored project's folded state, presence and recent timeline: the
 * Studio's one read across projects.
 * @returns the projects in path order.
 */
async overview(): Promise<StudioOverviewProject[]>

/**
 * Post one message from the Studio chat. A leading `@name` delivers to that
 * participant on its own project's timeline. Anything else goes to the one
 * Studio coordinator, on the Studio's own timeline.
 *
 * An untagged post used to be recorded on every project the Studio watches,
 * which put one typed line on every timeline and woke every project's
 * coordinator at once (JJ, 11 Sep 2026: "its literally posting to all the
 * agents! that's not right"). The Studio has an agent of its own now; it
 * reads the line and works through the project coordinators itself.
 * @param text - the user's message.
 * @param messageId - the logical message id (one per send; retries reuse it).
 * @returns where the post landed, the unresolved token with who is present, or why no coordinator took it.
 */
async postFromChat(text: string, messageId: string): Promise<StudioChatPost>

/**
 * Re-attempt every queued delivery addressed to one participant, across
 * every stored project — the reconnection hook. A message older than the
 * delivery expiry is recorded `delivery-expired` instead of attempted; an
 * explicit {@link deliver} retry with its messageId can still revive it.
 * @param target - the participant whose session came back.
 * @param now - the clock for the expiry decision (tests pin it).
 * @returns how many deliveries were delivered and how many expired.
 */
async retryQueued(target: string, now: number = Date.now()): Promise<{ delivered: number; expired: number }>

/**
 * The newest recorded seq, for cursors and the announce invariant.
 * Synchronous over what is loaded: 0 for a project never read or written.
 * @param project - the resolved project folder.
 * @returns the last event's seq, 0 for an empty or unloaded timeline.
 */
lastSeq(project: string): number
```

Source: [`packages/idealize/studio/src/index.ts:206`](../../packages/idealize/studio/src/index.ts)

<a id="ctxidealizeterminals--idealizeterminals"></a>

### `ctx.idealizeTerminals` — `IdealizeTerminals`

Which terminal agents are working right now, for the surfaces that show it.

```ts cordis-catalog
/**
 * Which terminal chats are working.
 * @returns the session ids of every terminal chat whose CLI is working.
 */
working(): string[]
```

Source: [`packages/idealize/ui-terminal/src/index.ts:149`](../../packages/idealize/ui-terminal/src/index.ts)

<a id="ctxtranscription--transcriptionruntime"></a>

### `ctx.transcription` — `TranscriptionRuntime`

The transcription service. Registered as `ctx.transcription` (one instance per context). Providers register with `register()`; consumers resolve a capture and run it.

```ts cordis-catalog
/**
 * Register a speech provider. Throws on a duplicate id, which is a
 * composition bug rather than a task failure.
 * @param provider - the provider; its `id` is the registry key.
 * @returns the disposer that unregisters it.
 */
register(provider: TranscriptionProvider): () => void

/**
 * Every registered provider's descriptor, in registration order.
 * @returns the descriptors.
 */
list(): TranscriptionDescriptor[]

/**
 * Readiness of the provider a request would resolve to.
 * @param id - a pinned provider id; absent picks the only registered one.
 * @returns that provider's readiness.
 */
async readiness(id?: string): Promise<TranscriptionReadiness>

/**
 * Bring the provider a request would resolve to up to `ready`.
 * @param id - a pinned provider id; absent picks the only registered one.
 * @returns readiness once the attempt settles.
 */
async prepare(id?: string): Promise<TranscriptionReadiness>

/**
 * Choose the provider for a request and hold the capture to its terms. The
 * defaulting a caller does not state lives here, in the open, rather than
 * inside `transcribe()`.
 * @param request - the capture and any pinned provider.
 * @returns the resolved capture.
 */
resolve(request: TranscriptionRequest): TranscriptionSpec

/**
 * Resolve a capture and run it.
 * @param request - the capture and any pinned provider.
 * @param signal - aborts the run; an aborted run rejects and produces nothing.
 * @returns the transcript.
 */
async transcribe(request: TranscriptionRequest, signal?: AbortSignal): Promise<TranscriptionResult>
```

Source: [`packages/idealize/transcribe/src/service.ts:41`](../../packages/idealize/transcribe/src/service.ts)

<a id="ctxwebserver--webserver"></a>

### `ctx.webServer` — `WebServer`

The browser HTTP carrier service. Activation listens immediately. Route registration order does not affect requests because configured named routes must be distinct, and the fallback handler answers anything not yet claimed during startup with 404 until its owner registers. A listen failure rejects initialization, and the boot process reports the failed fiber.

```ts cordis-catalog
/**
 * Register a named route. Duplicate (kind, path) throws — route patterns are
 * a composition-level contract, so a collision is a misconfiguration.
 * @param route - kind, path, and the owning handler.
 * @returns the disposer removing the route.
 */
register(route: WebRoute): () => void

/**
 * Register an exact-path HTTP upgrade route. Duplicate paths throw because
 * one socket can have only one protocol owner.
 * @param route - pathname and handler owning negotiation plus socket use.
 * @returns the disposer removing the route.
 */
registerUpgrade(route: WebUpgradeRoute): () => void

/**
 * Claim the fallback seat: the handler answering every request no named
 * route matches (the SPA dist server in the shipped Web composition). One
 * owner only — a second registration throws, because two fallbacks cannot
 * compose.
 * @param handler - owns the full response lifecycle of unmatched requests.
 * @returns the disposer releasing the seat.
 */
registerFallback(handler: WebRoute['handler']): () => void

/**
 * Register an index.html transform, applied by the fallback owner to every
 * index response ({@link applyIndexTaps}) in registration order.
 * @param transform - pure html-to-html function.
 * @returns the disposer removing the transform.
 */
tapIndex(transform: (html: string) => string): () => void

/**
 * Run an index.html body through the registered taps in registration order
 * — called by the fallback owner on every index response it renders.
 * @param html - the raw index.html body.
 * @returns the transformed body.
 */
applyIndexTaps(html: string): string
```

Source: [`packages/host/webserver/src/index.ts:59`](../../packages/host/webserver/src/index.ts)
<!-- END GENERATED cordis-surface -->
