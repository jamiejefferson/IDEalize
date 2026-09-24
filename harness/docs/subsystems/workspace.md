# Workspaces

A workspace is the persistent record of a directory the user works in: a stable id over a canonical path, a display title, and the ordered account of sessions that belong to it. The subsystem is one package ([dsh-workspace](../../packages/workspace/workspace), `ctx.workspaceRegistry`) — an optional host-side capability, not part of the agent-loop spine, and invisible to models (no tools, no prompt text, no session events). It stores its records through the [storage domain form](storage.md) and validates session membership against [`SessionHeader.cwd`](persistence.md#sessionheader--metadata-beside-the-log), so `storageDomain` and `sessionPersistence` are mandatory startup dependencies: an unavailable persistence peer leaves the plugin pending rather than being mistaken for an empty history. Design record: [domain KV storage Agent Note](../../.agents/notes/proposed/architecture/2026-07-24-domain-kv-storage-and-workspace.md); bootstrap and GUI ordering: [Workspace UI product-flow Agent Note](../../.agents/notes/implemented/feature/2026-07-25-workspace-ui-product-flow.md).

Source: [`packages/workspace/workspace/src/types.ts`](../../packages/workspace/workspace/src/types.ts)

## Identity

```ts type-equiv
/**
 * Identifies one workspace record. A generated uuid, never the path: path
 * normalization rewrites paths, and a reference anchor must stay stable.
 */
type WorkspaceId = Branded<'WorkspaceId'>
```

`WorkspaceId` is a [branded id](core.md#branded-ids). Path identity is separate: `realpathNormalize` (`fs.realpath`; trailing slashes, `..`, and symlinks resolved) is the one uniqueness canon — workspace paths are stored canonicalized, uniqueness is string equality of canonical paths (a symlink to an owned directory collides), and attach-time session cwd checks go through the same canon.

## The workspace entity

Consumers see only the `Workspace` interface; the implementation stays package-private.

```ts type-equiv
/**
 * One workspace: a stable id over an existing directory, a display title, and
 * an ordered candidate account of sessions. Membership requires both an id in
 * that account and a session header whose canonical cwd equals the workspace
 * path. Consumers only see this interface; the implementation stays private.
 */
interface Workspace {
  /** Stable record id (generated uuid). */
  readonly id: WorkspaceId

  /**
   * Canonical directory path: the `fs.realpath` of the path given at create
   * time (trailing slashes, `..`, and symlinks all resolved). Never rewritten
   * afterwards, even when the directory disappears (see {@link status}).
   */
  readonly path: string

  /** Display title. Defaults to `basename(path)` at create; duplicates are allowed. */
  readonly title: string

  /** ISO-8601 creation instant, stamped at create and never rewritten. */
  readonly createdAt: string

  /** ISO-8601 instant of the last durable mutation (create counts as one). */
  readonly updatedAt: string

  /**
   * Header-validated sessions in manually owned order: a new session is
   * prepended at attach, explicit reordering goes through
   * `insertSessionBefore`, and activity never reorders. The durable candidate
   * account is filtered synchronously: missing headers, invalid cwd values,
   * and canonical cwd mismatches are never returned. A subsequent workspace
   * mutation prunes those filtered candidates durably.
   */
  readonly sessionIds: readonly SessionId[]

  /**
   * Replace the display title durably.
   * @param title - New title; any string, duplicates across workspaces allowed.
   * @returns resolution after durability.
   */
  setTitle(title: string): Promise<void>

  /**
   * Prepend a session to this workspace's candidate account. An already
   * accounted id resolves without writing, aside from the durable
   * filtered-candidate prune every accepted mutation performs. A new id's
   * live or persisted
   * header cwd must resolve to an existing directory equal to {@link path};
   * unknown ids, missing or invalid cwd values, and mismatches reject without
   * writing.
   * @param sessionId - The session to record.
   * @returns resolution after durability.
   */
  attachSession(sessionId: SessionId): Promise<void>

  /**
   * Move an accounted session within the manual order, DOM-insertBefore-like:
   * with an anchor the session lands before it, without one it appends to the
   * end. Only the moved id changes position. A session or anchor absent from
   * the account rejects without writing; a move to the current position
   * resolves without writing, aside from the durable filtered-candidate
   * prune every accepted mutation performs; decided on the domain write
   * chain.
   * @param sessionId - The accounted session to move.
   * @param beforeSessionId - Accounted anchor to insert before; omitted appends.
   * @returns resolution after durability.
   */
  insertSessionBefore(sessionId: SessionId, beforeSessionId?: SessionId): Promise<void>

  /**
   * Remove a session from this workspace's account. Idempotent: an id not on
   * the account resolves without writing, aside from the durable
   * filtered-candidate prune every accepted mutation performs; decided on
   * the domain write chain like attach. Never touches the session's own stored log.
   * @param sessionId - The session to remove.
   * @returns resolution after durability.
   */
  detachSession(sessionId: SessionId): Promise<void>

  /**
   * Live directory check, uncached: whether {@link path} currently exists and
   * is a directory. A missing directory never mutates the record — the
   * directory may only be temporarily moved.
   * @returns `'ok'` when the directory exists, `'missing-dir'` otherwise.
   */
  status(): Promise<'ok' | 'missing-dir'>
}
```

Ownership truth is the record's ordered `sessionIds`, never derived from session cwd — but membership requires both: an id on the account and a header whose canonical cwd equals the workspace path, so one session structurally belongs to at most one workspace. Failed writes reject (`insertSessionBefore` account errors as `WorkspaceMoveInvalidError`, storage failures as plain errors); every accepted mutation stamps `updatedAt` and durably prunes candidates that no longer pass the membership check.

## The registry: `ctx.workspaceRegistry`

`WorkspaceRegistry` ([signatures](#ctxworkspaceregistry--workspaceregistry)) owns registration and resolution. `create(path, title?)` canonicalizes the path, rejects a nonexistent path (the original `ENOENT`) or a non-directory, returns the existing entity unchanged when the canonical path is already owned, and otherwise creates a record with `title ?? basename(path)` prepended to the durable registry order — a new record cannot duplicate an existing display title (`WorkspaceNameConflictError`). `get(id)` and the ordered `list()` are synchronous cache reads; `resolveByPath(path)` applies the same realpath canon without creating. `delete(id)` removes only the registration, order entry, and session account — the directory, user files, live sessions, and persisted logs are never touched, so those sessions become Ungrouped ([decision](../../.agents/notes/implemented/feature/2026-07-27-workspace-registration-deletion.md)); unknown ids return `false`. Create and delete persist a pending-mutation marker before their two writes (record + order) can diverge; startup resolves exactly the marked mutation — by deleting the marked table row, which completes an interrupted delete and rolls back an interrupted create (the registration is re-creatable, so rollback is the safe direction) — and an unmarked order/table mismatch fails loud as corruption.

Sessions get their cwd at create time from whoever creates them, not from this registry — the API gateway resolves a new session's cwd from the chosen workspace's `path` (falling back to an explicit or default cwd), creates the session so the cwd lands in its immutable [`SessionHeader`](persistence.md#sessionheader--metadata-beside-the-log), then calls `attachSession`, which re-validates that stored header cwd against the workspace path. On the first successful start, the registry bootstraps history from persisted headers alone (`id`, `cwd`, `createdAt` — never event bodies), grouping sessions with a valid canonical cwd into per-directory workspaces, newest first; the initialized marker is written last so an interrupted bootstrap resumes safely. The bootstrap is one-time: cwd-less legacy sessions stay Ungrouped, and sessions created afterwards join a workspace only through `attachSession`.

## Consumers

[dsh-host-apiproxy](../../packages/host/apiproxy) is the product consumer: it serves workspace CRUD to GUI clients over `ctx.workspaceRegistry` and performs the create-session-then-attach flow above. [dsh-agent-instructions](../../packages/context/agent-instructions) is **not** a consumer despite the name: it discovers AGENTS.md-style instruction files under an agent's own cwd and never touches `ctx.workspaceRegistry` — the shared word refers to the user's working directory, not to this registry's entities.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxdirectorypicker--directorypicker-abstract-seam"></a>

### `ctx.directoryPicker` — `DirectoryPicker` (abstract seam)

Abstract directory-picking service. Subclass, implement `capability()`, and load the subclass as a plugin — it registers as `ctx.directoryPicker` (one implementation per context; loading a second throws, cordis' standard duplicate-service behavior). The capability object must be stable for the service lifetime: consumers may capture it across calls.

```ts cordis-catalog
/**
 * The backend's interaction capability.
 * @returns the discriminated capability consumers switch on.
 */
abstract capability(): DirectoryPickerCapability
```

Source: [`packages/host/directory-picker/src/index.ts:131`](../../packages/host/directory-picker/src/index.ts)

<a id="ctxdocpolicy--docpolicy"></a>

### `ctx.docPolicy` — `DocPolicy`

The canonical documentation service. Scans are serialized on one chain; reads (`state`, `search`) are safe at any time.

```ts cordis-catalog
/**
 * The configured documentation folder, or `undefined` before setup.
 * @returns the absolute folder path, or `undefined` when unconfigured.
 */
folder(): string | undefined

/**
 * The packaged ruleset version this build applies.
 * @returns the pinned ruleset version.
 */
rulesetVersion(): RulesetVersion

/**
 * The canonical conventions text (the DOC-05 authority).
 * @returns the ruleset's conventions text.
 */
conventions(): string

/**
 * The documentation rule for a command-line agent the built-in terminal
 * launches in `cwd`. `@idealize/ui-terminal` probes for this method and
 * appends the text to the agent's prompt, because such an agent reads no
 * harness prompt and no session-start notice.
 * @param cwd - the shell's working directory.
 * @returns the guidance, naming the project's note when the folder holds one.
 */
async terminalKnowledge(cwd: string): Promise<string>

/**
 * The folder holding one project's documentation inside the configured
 * documentation folder: the folder of the note whose `repo:` names the
 * project, else `Projects/<project folder name>` when it exists.
 * @param projectPath - absolute path of the project's own folder.
 * @returns the folder and how it was found, or `undefined` with no documentation folder or no match.
 */
async projectFolder(projectPath: string): Promise<ProjectDocsFolder | undefined>

/**
 * Scaffold and scan the configured folder, rebuild the retrieval index,
 * and record the scan to the storage domain when attached (DOC-04/06/07).
 * Serialized: concurrent calls run one at a time in order. A call that
 * finds the folder's {@link fingerprintFolder} unchanged since the last
 * scan returns that scan's record and neither re-reads, re-indexes nor
 * records: sessions flush every few seconds, and the index rebuild runs
 * synchronously on the Host thread.
 * @returns the scan record, or `undefined` when no folder is configured.
 */
scan(): Promise<DocScanRecord | undefined>

/**
 * Phrase-search the indexed documentation.
 * @param query - caller text, matched as one literal phrase.
 * @param limit - maximum hits.
 * @returns best-first hits (empty when no folder is configured).
 */
async search(query: string, limit: number): Promise<DocsSearchHit[]>

/**
 * Folder + scan state for the settings surface and the state route.
 * @returns the current configuration and last scan snapshot.
 */
state(): DocsState

/**
 * Attach the durable scan-history table; a scan that ran before attachment
 * is recorded now so a late-mounting storage form loses nothing.
 * @param table - the opened `scans` table.
 */
attachScans(table: KvTable<string, DocScanRecord>): void

/** Detach the scan-history table ahead of its domain closing. */
detachScans(): void
```

Source: [`packages/idealize/doc-policy/src/index.ts:126`](../../packages/idealize/doc-policy/src/index.ts)

<a id="ctxworkspacealiases--workspacealiases"></a>

### `ctx.workspaceAliases` — `WorkspaceAliases`

The workspace-alias seam (`ctx.workspaceAliases`) plus the orientation flow behind the `/idealize/setup` routes.

Contract for consumers (the Files tabs, the Reconnect flow):

- resolve never throws for a known alias: an unset alias returns `undefined`, a set-but-broken one returns its stored path with a non-`ok` `accessState` and a plain `reason` — render the path with a Reconnect affordance rather than dropping it.
- set validates before it persists: a failing folder rejects with AliasProbeError and stores nothing, so a stored alias was valid at the moment it was written (it may still die later — resolve re-probes on every call).
- Writing `documentation` re-seeds `@idealize/doc-policy`'s folder and re-scans; writing `projectsRoot` re-seeds `@idealize/vault`'s root. A missing dependent settings section fails loud naming the plugin.

```ts cordis-catalog
/**
 * Resolve one alias to its stored path and live-probed access state.
 * @param aliasName - which alias to resolve.
 * @returns the alias with its probe verdict, or `undefined` while unset.
 */
async resolve(aliasName: WorkspaceAliasName): Promise<WorkspaceAlias | undefined>

/**
 * Point one alias at a folder: probe it, persist it, and re-seed the
 * dependent settings section (the Reconnect flow's write path).
 * @param aliasName - which alias to write.
 * @param path - absolute folder path.
 * @returns the stored alias (`accessState` is `ok` by construction).
 * @throws {AliasProbeError} when the folder fails its probe; nothing is stored.
 */
async set(aliasName: WorkspaceAliasName, path: string): Promise<WorkspaceAlias>

/**
 * One project's documentation folder: the folder chosen for it, else the
 * one `@idealize/doc-policy` resolves inside the documentation vault. A
 * chosen folder that has died is still returned, with its failing
 * `accessState`, so the caller can say which folder was lost.
 * @param projectPath - absolute path of the project's own folder.
 * @returns the folder with its probe verdict, or `undefined` when none is chosen and the vault holds none.
 */
async projectDocumentation(projectPath: string): Promise<ProjectDocumentation | undefined>

/**
 * The documentation folders chosen per project, as stored.
 * @returns project folder path to chosen documentation folder; cleared entries omitted.
 */
chosenProjectDocumentation(): Record<string, string>

/**
 * Choose one project's documentation folder, or clear the choice.
 * @param projectPath - absolute path of the project's own folder.
 * @param path - absolute folder path; the empty string clears the choice.
 * @returns the project's documentation folder after the write.
 * @throws {AliasProbeError} when the folder fails its probe; nothing is stored.
 */
async setProjectDocumentation(projectPath: string, path: string): Promise<ProjectDocumentation | undefined>

/**
 * Component seeds + live-probed aliases for the state route and, later,
 * the settings surface.
 * @returns the current setup state.
 */
async state(): Promise<SetupState>

/**
 * The orientation component (SET-02/04/06): probe both folders, create and
 * register the first project under the projects root when a name is given,
 * persist the aliases + the orientation seed, seed the documentation and
 * vault sections, and kick the documentation scan. Field failures return in
 * `failures` with nothing persisted; a missing dependent plugin throws.
 * @param request - the two folders and the optional first-project name.
 * @returns the outcome; on `ok` the created project when one was requested.
 */
async orient(request: OrientationRequest): Promise<OrientationResult>
```

Source: [`packages/idealize/setup/src/index.ts:241`](../../packages/idealize/setup/src/index.ts)

<a id="ctxworkspaceregistry--workspaceregistry"></a>

### `ctx.workspaceRegistry` — `WorkspaceRegistry`

Durable workspace registry. Startup waits for `sessionPersistence`, builds one canonical-cwd header index, and completes the one-time history bootstrap before the service becomes active. The persistence dependency is mandatory so an unavailable peer can never be mistaken for an empty history and commit the initialized marker.

```ts cordis-catalog
/**
 * Create or reuse a workspace for an existing directory. The path is
 * canonicalized through `fs.realpath`; a nonexistent path rejects with the
 * original error and a non-directory rejects. Repeated calls for the same
 * canonical path return the existing entity without changing its title.
 * A newly created workspace is prepended to the durable registry order.
 * Different canonical paths may share a display title.
 * @param path - Existing directory to own, in any path spelling.
 * @param title - Display title used only when a new record is created.
 * @returns the existing or newly durable workspace.
 */
async create(path: string, title?: string): Promise<Workspace>

/**
 * Look up a workspace by id.
 * @param id - Workspace id.
 * @returns the workspace, or `undefined` when unknown.
 */
get(id: WorkspaceId): Workspace | undefined

/**
 * Synchronous workspace projection in durable registry order. Every
 * entity's `sessionIds` getter is already filtered by the startup/live
 * canonical-cwd header index; this method performs no persistence reads.
 * @returns a fresh ordered array of workspace entities.
 */
list(): Workspace[]

/**
 * Delete one workspace registration while retaining its directory and every
 * session log. The durable order is updated before the table deletion; a
 * failed table write restores the prior order and keeps the entity
 * published. Unknown ids are an idempotent no-op for domain callers.
 * @param id - Workspace registration to remove.
 * @returns `true` when a record was deleted, `false` when it was unknown.
 */
delete(id: WorkspaceId): Promise<boolean>

/**
 * Move one workspace within the durable display order, DOM-insertBefore-like.
 * With an anchor it lands before that workspace; without one it appends.
 * @param id - Workspace to move.
 * @param beforeId - Workspace anchor; omitted appends.
 * @returns the complete committed workspace order.
 */
insertBefore(id: WorkspaceId, beforeId?: WorkspaceId): Promise<readonly WorkspaceId[]>

/**
 * Archive one session durably. The session must exist (live or in session
 * persistence); its workspace accounting — or lack of one — is irrelevant.
 * An already archived id resolves without writing.
 * @param sessionId - The session to archive.
 * @returns resolution after durability.
 */
archiveSession(sessionId: SessionId): Promise<void>

/**
 * Resolve by canonical directory path without creating or mutating a
 * workspace. A missing path rejects during `realpath`; an existing unowned
 * directory returns `undefined`.
 * @param path - Existing directory path in any spelling.
 * @returns the workspace owning the canonical path, when one exists.
 */
async resolveByPath(path: string): Promise<Workspace | undefined>
```

Types: [SessionId](core.md)

Source: [`packages/workspace/workspace/src/index.ts:92`](../../packages/workspace/workspace/src/index.ts)
<!-- END GENERATED cordis-surface -->
