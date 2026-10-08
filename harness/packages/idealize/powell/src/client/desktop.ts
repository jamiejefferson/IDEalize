/**
 * The desktop shell's Powell bridge (dsh-plugin-desktop's preload), read
 * defensively: in a plain browser tab the owl still works, it just cannot
 * move its window or let clicks through.
 * @module @idealize/powell/client/desktop
 */

/** The owl's width in its window (the desktop shell sizes its frame with the same number). */
export const OWL_WIDTH = 92

/**
 * Where the owl sits in its window: `owlX` from the left edge, and `flip`
 * when the owl is at the top of the window with the bubble below it (near
 * the top of the screen).
 */
export interface PowellLayout {
  owlX: number
  flip: boolean
}

/** Bottom centre of the 380 px window, before the shell says otherwise. */
export const CENTRED_LAYOUT: PowellLayout = { owlX: (380 - OWL_WIDTH) / 2, flip: false }

/** The bridge the preload exposes as `window.idealizePowell`. */
export interface PowellDesktopBridge {
  /** The pointer is over something of Powell's (true) or empty window (false). */
  hit(over: boolean): void
  dragStart(): void
  dragEnd(): void
  /** Take or give back the keyboard. */
  focus(focus: boolean): void
  /** Show the full app. */
  openMain(): void
  /** Hide Powell until the shortcut or the tray brings it back. */
  hide(): void
  /** Global-key commands. */
  onCommand(listener: (command: 'listen' | 'type') => void): () => void
  /** Layout changes from the shell. */
  onLayout(listener: (layout: PowellLayout) => void): () => void
  /** The page painted the latest layout. */
  layoutApplied(): void
}

/** The bridge, or a stand-in that does nothing. */
export function desktop(): PowellDesktopBridge {
  const bridge = (globalThis as { idealizePowell?: Partial<PowellDesktopBridge> }).idealizePowell
  // A shell from before a method existed still lends the methods it has.
  if (bridge !== undefined) return { ...standIn(), ...bridge }
  return standIn()
}

function standIn(): PowellDesktopBridge {
  return {
    hit: () => undefined,
    dragStart: () => undefined,
    dragEnd: () => undefined,
    focus: () => undefined,
    openMain: () => { void post('/idealize/powell/open-app') },
    hide: () => undefined,
    onCommand: () => () => undefined,
    onLayout: () => () => undefined,
    layoutApplied: () => undefined,
  }
}

/**
 * POST to one of Powell's routes.
 * @param path - the route.
 * @param body - JSON body, when any.
 * @returns whether the host accepted it.
 */
export async function post(path: string, body?: unknown): Promise<boolean> {
  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'x-idealize-auth': '1', 'content-type': 'application/json' },
      ...body === undefined ? {} : { body: JSON.stringify(body) },
    })
    return response.ok
  } catch {
    return false
  }
}
