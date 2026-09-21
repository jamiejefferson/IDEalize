/**
 * One connection to the host bridge feed per window, shared by every plugin
 * that follows it.
 *
 * The rail, the notifier, the bar and the Schedule pane each opened their own
 * `EventSource` on `/idealize/events/stream`, and three of them read
 * `/idealize/events/recent` first. The host speaks HTTP/1.1 and a browser
 * allows six connections per origin, so three feed streams plus three open
 * Terminal chats filled the pool and every later request queued behind them,
 * a keystroke's POST included.
 *
 * Plugin bundles may not value-import each other's runtime state, so each
 * bundle inlines this module and the copies meet on one `globalThis` slot
 * (the same reason `studio-request` raises a document event).
 * @module @idealize/askbar/src/client/bridge-feed
 */

/** One frame of the feed, as far as this module reads it; followers narrow it further. */
export interface BridgeFeedFrame {
  /** The host's order of events, counting from one. */
  seq: number
  /** The event kind. */
  kind?: string
  [field: string]: unknown
}

/** What a follower holds while attached. */
export interface BridgeFeedAttachment {
  /** The feed's retained tail as it stood when this follower attached, oldest first. */
  tail: readonly BridgeFeedFrame[]
  /** Stop following. The connection closes with its last follower. */
  close(): void
}

interface Follower {
  after: number
  onEvent: (event: BridgeFeedFrame) => void
}

interface SharedFeed {
  followers: Set<Follower>
  known: BridgeFeedFrame[]
  lastSeq: number
  source: EventSource | undefined
  /** Settles true once the tail is read (and the stream opened where there is one), false when the bridge is absent. */
  ready: Promise<boolean>
}

const SLOT = Symbol.for('idealize.bridge-feed')
const RECENT_PATH = '/idealize/events/recent?since=0'
const STREAM_PATH = '/idealize/events/stream'
/** The host retains this many events; the window keeps no more. */
const KNOWN_CAP = 200

function slot(): { feed?: SharedFeed } {
  const holder = globalThis as unknown as Record<symbol, { feed?: SharedFeed } | undefined>
  holder[SLOT] ??= {}
  return holder[SLOT]
}

function open(): SharedFeed {
  const feed: SharedFeed = { followers: new Set(), known: [], lastSeq: 0, source: undefined, ready: Promise.resolve(false) }
  feed.ready = (async (): Promise<boolean> => {
    try {
      const response = await fetch(RECENT_PATH)
      if (response.ok) {
        const tail: unknown = await response.json()
        if (Array.isArray(tail)) {
          for (const event of tail as BridgeFeedFrame[]) {
            if (typeof (event as BridgeFeedFrame | null)?.seq !== 'number') continue
            feed.known.push(event)
            feed.lastSeq = Math.max(feed.lastSeq, event.seq)
          }
        }
      }
    } catch {
      // The bridge is absent in this composition: there is nothing to follow.
      return false
    }
    // Closed by its last follower while the tail was being read.
    if (slot().feed !== feed) return true
    // EventSource is absent in test DOMs; the tail alone is still an honest answer.
    if (typeof EventSource === 'undefined') return true
    feed.source = new EventSource(`${STREAM_PATH}?since=${String(feed.lastSeq)}`)
    feed.source.onmessage = (message) => {
      let event: BridgeFeedFrame
      try {
        event = JSON.parse(message.data as string) as BridgeFeedFrame
      } catch {
        return // a comment or malformed frame; the feed only carries JSON lines
      }
      // A reconnect asks again from the seq this stream opened at, so the host
      // replays what already arrived; an event is delivered once.
      // A frame with no seq cannot be placed, so it is passed on as it came.
      const placed = typeof event.seq === 'number'
      if (placed && event.seq <= feed.lastSeq) return
      if (placed) {
        feed.lastSeq = event.seq
        feed.known.push(event)
        if (feed.known.length > KNOWN_CAP) feed.known.splice(0, feed.known.length - KNOWN_CAP)
      }
      for (const follower of [...feed.followers]) {
        if (placed && event.seq <= follower.after) continue
        try {
          follower.onEvent(event)
        } catch {
          // One follower's failure is not the others'.
        }
      }
    }
    return true
  })()
  return feed
}

/**
 * Follow the host bridge feed. Events recorded before the call arrive as
 * `tail`; `onEvent` runs for each event after it.
 * @param onEvent - what to run on each new event.
 * @returns the attachment, or undefined when the bridge is absent.
 */
export async function followBridgeFeed(onEvent: (event: BridgeFeedFrame) => void): Promise<BridgeFeedAttachment | undefined> {
  const holder = slot()
  const feed = holder.feed ??= open()
  const follower: Follower = { after: Number.POSITIVE_INFINITY, onEvent }
  feed.followers.add(follower)
  const close = (): void => {
    feed.followers.delete(follower)
    if (feed.followers.size > 0 || holder.feed !== feed) return
    feed.source?.close()
    delete holder.feed
  }
  if (!await feed.ready) {
    close()
    return undefined
  }
  follower.after = feed.lastSeq
  return { tail: [...feed.known], close }
}

/**
 * Close the window's connection and forget its followers: a window tearing
 * down, or a test isolating itself from the last one.
 */
export function closeBridgeFeed(): void {
  const holder = slot()
  holder.feed?.source?.close()
  holder.feed?.followers.clear()
  delete holder.feed
}
