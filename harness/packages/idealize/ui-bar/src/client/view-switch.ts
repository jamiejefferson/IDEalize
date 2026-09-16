/**
 * Reading and writing one chat's conversation view ring from outside
 * `ui-conversation`: whether the ring serves a named view here, and flipping a
 * chat onto it.
 *
 * The write resolves the per-session chat-store instance through the
 * SlotRegistry's renderer host face (`hostFace().storeOf`) — the instance the
 * rendered ring reads; `handle.create()` would mint a parallel one the ring
 * never sees. `@idealize/ui-terminal` performs the same write behind its
 * `terminalMode` service, but the Gallery and Sound Stage view packages
 * publish no service and the client bundle purity gate forbids importing
 * either package's value exports, so the welcome card restates the mechanism
 * here. If upstream exposes a public per-session store resolver, this is the
 * module to move onto it.
 * @module @idealize/ui-bar/client/view-switch
 */

/** The view ring's chat entry id: the view a chat falls back to. */
export const CHAT_VIEW = 'chat'

/** Chat-store writes used from here (restated from ui-conversation's action set). */
interface ChatViewActions {
  setView(view: string): void
  setInspect(target: { callId: string } | null): void
}

/** The chat-store field the Inspect button writes (restated from ui-conversation's state). */
interface ChatViewState {
  inspect: { callId: string } | null
}

/**
 * A per-session chat-store instance as the render boundary publishes it
 * (upstream's `StoreInstanceLike`): a bare snapshot source plus the
 * draft-stripped actions.
 */
interface ChatStoreInstance {
  actions: ChatViewActions
  getSnapshot(): unknown
  subscribe(fn: () => void): () => void
}

/** The renderer host face's store resolver (the framework's per-session instance cache). */
interface ErasedStoreHost {
  storeOf(
    entry: { options: { id?: string }; store?: unknown },
    scopeKey?: string,
  ): ChatStoreInstance | undefined
}

/** Type-erased slot registry face used where the typed overloads cannot see a foreign store. */
export interface ErasedSlots {
  entries(key: string): readonly { options: { id?: string }; store?: unknown }[]
  subscribe(key: string, fn: () => void): () => void
  /** Register with a foreign entry's store handle, which the typed overloads cannot name. */
  register(options: { name: string; store?: unknown } & Record<string, unknown>, component: unknown): () => void
  /** SlotRegistry's renderer host face (TS-private; no public seam resolves a per-session store instance). */
  hostFace(): ErasedStoreHost
}

/**
 * Whether the conversation ring serves a view with this id here — the honest
 * test of whether a mode is launchable, since a view package that is absent
 * from the composition registers no entry.
 * @param slots - the erased slot registry.
 * @param view - the ring entry id.
 * @returns true when the ring carries that entry.
 */
export function ringHasView(slots: ErasedSlots, view: string): boolean {
  return slots.entries('conversation.view').some(entry => entry.options.id === view)
}

/**
 * Subscribe to the ring's entry set.
 * @param slots - the erased slot registry.
 * @param fn - called whenever an entry joins or leaves.
 * @returns the disposer.
 */
export function subscribeRing(slots: ErasedSlots, fn: () => void): () => void {
  return slots.subscribe('conversation.view', fn)
}

/**
 * Resolve one chat's chat-store instance — the one the rendered ring reads.
 * @param slots - the erased slot registry.
 * @param sessionId - the chat whose store instance is wanted.
 * @returns the instance, or undefined until the chat ring entry is registered.
 */
function chatStoreOf(slots: ErasedSlots, sessionId: string): ChatStoreInstance | undefined {
  const entry = slots.entries('conversation.view').find(candidate => candidate.options.id === CHAT_VIEW)
  if (entry?.store === undefined) return undefined
  return slots.hostFace().storeOf(entry, sessionId)
}

/**
 * Switch one chat's conversation ring onto a named view by writing the chat
 * store's `view` through the framework's per-session instance cache.
 * @param slots - the erased slot registry.
 * @param sessionId - the chat whose ring flips.
 * @param view - the ring entry id to make active.
 * @returns whether the switch was written (false until the chat entry exists).
 */
export function openChatView(slots: ErasedSlots, sessionId: string, view: string): boolean {
  const instance = chatStoreOf(slots, sessionId)
  if (instance === undefined) return false
  instance.actions.setView(view)
  return true
}

/**
 * Watch one chat's "inspect this call" handoff. The chat view writes the call
 * into `inspect` and then asks the ring for its `'trajectory'` entry; the
 * ledger left the ring for a rail pane, so the ring half of that write is
 * inert and this field is the live one.
 *
 * The field is cleared before the callback runs: the receiving surface holds
 * the target until its ledger has revealed the record, and a field left
 * standing would replay on the chat store's next change.
 *
 * @param slots - the erased slot registry.
 * @param sessionId - the chat to watch.
 * @param onInspect - called with each requested call id.
 * @returns the disposer, or undefined until the chat ring entry is registered.
 */
export function watchInspect(
  slots: ErasedSlots,
  sessionId: string,
  onInspect: (callId: string) => void,
): (() => void) | undefined {
  const instance = chatStoreOf(slots, sessionId)
  if (instance === undefined) return undefined
  const read = (): void => {
    const target = (instance.getSnapshot() as ChatViewState).inspect
    if (target === null) return
    instance.actions.setInspect(null)
    onInspect(target.callId)
  }
  const dispose = instance.subscribe(read)
  read()
  return dispose
}

/** The session list fields the space seed reads (restated from the client runtime's `SessionListState`). */
export interface SeedSessionList {
  current?: string | undefined
  byId: Readonly<Record<string, { projectionValues?: { space?: { space: string } | undefined } | undefined } | undefined>>
}

/** The session list as an observable snapshot, the face `ISessions.list` publishes. */
export interface SeedSessions {
  list: {
    getSnapshot(): SeedSessionList
    subscribe(fn: () => void): () => void
  }
}

/** The space seed: the standing subscription, and the launch that overrides it. */
export interface SpaceSeed {
  /**
   * Begin seeding, and place whichever chat is already current.
   * @returns the disposer.
   */
  start: () => () => void
  /**
   * A launch has recorded a new space on this chat. From here the seed follows
   * the launch rather than the `space` projection, and places the chat again
   * whether or not it had been seeded.
   * @param sessionId - the launched chat.
   * @param space - the space it was launched into.
   */
  noteLaunch: (sessionId: string, space: string) => void
  /**
   * The space a launch recorded on this chat in this page, whether or not the
   * `space` projection has caught up.
   * @param sessionId - the chat to read.
   * @returns the launched space, or undefined when nothing launched this chat here.
   */
  launchedSpace: (sessionId: string) => string | undefined
}

/**
 * Seed each chat's ring view from its `space` projection the first time that
 * chat is current on this page, so a reload lands on the space the chat was
 * launched into with nothing remembered in `localStorage`. The ring's own tab
 * row is gone: the space is fixed for the life of a chat, and this write is
 * what stands in for the tab the user used to land on.
 *
 * Once per chat per page. A space whose view package is absent here (Motion
 * everywhere, and Terminal in a plain browser) lands on Chat, where that
 * chat's composer already is, and stays eligible in case that view registers
 * later. The seed waits for the projection, the chat ring entry and the chat's
 * store instance, retrying on every list or ring change until all three exist.
 *
 * A LAUNCH BEATS THE PROJECTION. The welcome card can relaunch a blank chat
 * that already carries an older space, and the record it writes reaches the
 * projection a beat after the card has flipped the ring; a seed still reading
 * the old value would take the chat back to the space the user has just left.
 * {@link SpaceSeed.noteLaunch} is what the card calls, and the launched space
 * answers for that chat from then on.
 *
 * @param slots - the erased slot registry.
 * @param sessions - the session list face.
 * @returns the seed.
 */
export function createSpaceSeed(slots: ErasedSlots, sessions: SeedSessions): SpaceSeed {
  const seeded = new Set<string>()
  const launched = new Map<string, string>()
  const attach = (): void => {
    const list = sessions.list.getSnapshot()
    const current = list.current
    if (current === undefined || seeded.has(current)) return
    const space = launched.get(current) ?? list.byId[current]?.projectionValues?.space?.space
    if (space === undefined) return
    const instance = chatStoreOf(slots, current)
    if (instance === undefined) return
    // A space the ring does not serve yet lands on Chat without counting as
    // seeded: its view package may still be registering, and the next ring
    // change gets to place the chat properly.
    const served = ringHasView(slots, space)
    if (served) seeded.add(current)
    const desired = served ? space : CHAT_VIEW
    if ((instance.getSnapshot() as { view: string | null }).view !== desired) instance.actions.setView(desired)
  }
  return {
    start: () => {
      const disposers = [sessions.list.subscribe(attach), subscribeRing(slots, attach)]
      attach()
      return () => { for (const dispose of disposers) dispose() }
    },
    noteLaunch: (sessionId, space) => {
      launched.set(sessionId, space)
      seeded.delete(sessionId)
      attach()
    },
    launchedSpace: sessionId => launched.get(sessionId),
  }
}
