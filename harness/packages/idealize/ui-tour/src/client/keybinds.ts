/**
 * The keybinds catalogue: one registry both the ⌘/ sheet and the global
 * keydown dispatcher read. A binding with a `run` is dispatched by this
 * plugin; a binding without one is listed only (the composer handles its
 * own keys and is catalogued here so the sheet shows every active shortcut).
 */

/** Modifier names in the order the sheet prints them (V0: ⌃ ⌥ ⇧ ⌘). */
export type Modifier = 'ctrl' | 'alt' | 'shift' | 'meta'

/** One shortcut. `key` is the KeyboardEvent.key value, lower-cased for letters. */
export interface KeyChord {
  key: string
  modifiers: readonly Modifier[]
}

/** One catalogue row. */
export interface Keybind {
  /** Stable id; a second registration with the same id replaces the first. */
  id: string
  /** Sheet group (a locale key resolved by the sheet, or literal text). */
  group: string
  /** Sheet label (a locale key resolved by the sheet, or literal text). */
  label: string
  /** Chords the row lists; the first is what the dispatcher matches (each chord matches). */
  chords: readonly KeyChord[]
  /** Dispatch handler; absent rows are listed but handled elsewhere. */
  run?: () => void
  /** Sort key inside the group (ascending, default 0). */
  order?: number
}

/** The minimal keydown event face the matcher reads (a DOM KeyboardEvent satisfies it). */
export interface KeyEventLike {
  key: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
}

const GLYPH: Record<Modifier, string> = { ctrl: '⌃', alt: '⌥', shift: '⇧', meta: '⌘' }
const ORDER: readonly Modifier[] = ['ctrl', 'alt', 'shift', 'meta']
const KEY_GLYPH: Record<string, string> = {
  enter: '↩',
  escape: 'esc',
  backspace: '⌫',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  ' ': 'space',
}

/**
 * Build a chord from a compact spec such as `meta+shift+r` or `meta+/`.
 * @param spec - `+`-joined modifier names ending in the key.
 * @returns the parsed chord.
 */
export function chord(spec: string): KeyChord {
  const parts = spec.split('+')
  const key = parts.pop() as string
  const modifiers = ORDER.filter(modifier => parts.includes(modifier))
  return { key: key.length === 1 ? key.toLowerCase() : key, modifiers }
}

/**
 * Render a chord the way macOS menus print it: modifier glyphs then the key.
 * @param value - the chord.
 * @returns for example `⇧⌘R`.
 */
export function formatChord(value: KeyChord): string {
  const mods = ORDER.filter(modifier => value.modifiers.includes(modifier)).map(modifier => GLYPH[modifier]).join('')
  const lower = value.key.toLowerCase()
  const key = KEY_GLYPH[lower] ?? (value.key.length === 1 ? value.key.toUpperCase() : value.key)
  return mods + key
}

/**
 * Render a binding's chords joined as V0 does (`⌘= · ⌘−`).
 * @param chords - the binding's chords.
 * @returns the joined display string.
 */
export function formatChords(chords: readonly KeyChord[]): string {
  return chords.map(formatChord).join(' · ')
}

/**
 * Does a keydown event match a chord? Every listed modifier must be down and
 * every unlisted one up; keys compare case-insensitively.
 * @param event - the keydown event (or a test double).
 * @param value - the chord.
 * @returns true on an exact match.
 */
export function matchesChord(event: KeyEventLike, value: KeyChord): boolean {
  if (event.key.toLowerCase() !== value.key.toLowerCase()) return false
  const down: Record<Modifier, boolean> = {
    ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey, meta: event.metaKey,
  }
  return ORDER.every(modifier => down[modifier] === value.modifiers.includes(modifier))
}

/** Registration face other plugins wire their shortcuts through (`ctx.keybinds`). */
export interface IKeybinds {
  /**
   * Add or replace one catalogue row.
   * @param binding - the row.
   * @returns disposer removing this row (a later replacement survives it).
   */
  register(binding: Keybind): () => void
  /** @returns the rows grouped in registration order of their groups, sorted by `order` inside. */
  list(): { group: string; items: Keybind[] }[]
  /**
   * Dispatch one keydown: the first dispatchable row whose chord matches runs.
   * @param event - the keydown event.
   * @returns true when a row ran (the caller prevents the default).
   */
  dispatch(event: KeyEventLike): boolean
  /**
   * Observe catalogue changes.
   * @param listener - invoked after every register/dispose.
   * @returns disposer.
   */
  subscribe(listener: () => void): () => void
}

/** The catalogue implementation. */
export class KeybindRegistry implements IKeybinds {
  private readonly rows = new Map<string, Keybind>()
  private readonly listeners = new Set<() => void>()

  register(binding: Keybind): () => void {
    this.rows.set(binding.id, binding)
    this.emit()
    return () => {
      if (this.rows.get(binding.id) === binding) {
        this.rows.delete(binding.id)
        this.emit()
      }
    }
  }

  list(): { group: string; items: Keybind[] }[] {
    const groups = new Map<string, Keybind[]>()
    for (const row of this.rows.values()) {
      const items = groups.get(row.group) ?? []
      items.push(row)
      groups.set(row.group, items)
    }
    return [...groups.entries()].map(([group, items]) => ({
      group,
      items: items.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    }))
  }

  dispatch(event: KeyEventLike): boolean {
    for (const row of this.rows.values()) {
      if (row.run === undefined) continue
      if (row.chords.some(value => matchesChord(event, value))) {
        row.run()
        return true
      }
    }
    return false
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }
}

/**
 * Should a global shortcut fire from this event target? A chord carrying ⌘ or
 * ⌃ is an app shortcut everywhere (⌘Z is the composer's own and is not in the
 * registry). Every other chord belongs to whatever text field has focus —
 * ⇧↑ extends a selection inside a textarea — so it reaches the registry only
 * while nothing editable is focused.
 * @param event - the keydown event.
 * @param editing - whether the event's target is a text field or contenteditable.
 * @returns true when the dispatcher may consume it.
 */
export function isAppChord(event: KeyEventLike, editing = false): boolean {
  return event.metaKey || event.ctrlKey || !editing
}
