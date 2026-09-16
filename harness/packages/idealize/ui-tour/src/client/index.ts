/**
 * IDEalize first-run tour + keyboard shortcuts, browser half. One occupant on
 * the frame's shell.overlay seat renders V0's showcase tour (once, seeded in
 * the `idealize-tour` settings section) and the ⌘/ shortcuts sheet. Two
 * services let other plugins wire in without touching this package:
 * `ctx.keybinds` (register a shortcut; it is dispatched and listed) and
 * `ctx.tour` (anchor a tour target to a real element, start a run, open the
 * sheet). Targets no plugin has anchored resolve through default selectors.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: the ui-layout SlotMap merge (shell.overlay) and ctx.layout.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: ctx.settingsScope and ctx.settingsOpen.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: ctx.locale.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { chord, isAppChord, KeybindRegistry, type IKeybinds, type Keybind } from './keybinds.ts'
import { armFirstRunTrigger } from './first-run-trigger.ts'
import { DEFAULT_SELECTORS, runnableSteps, type TourTarget } from './tour-script.ts'
import { TourView } from './tour-store.ts'
import { Overlay, type OverlayInjected } from './Overlay.tsx'
import { en, zh, type TourKey } from './locales.ts'

export { Overlay } from './Overlay.tsx'
export { KeybindRegistry, chord, formatChord, formatChords, matchesChord } from './keybinds.ts'
export type { IKeybinds, Keybind, KeyChord } from './keybinds.ts'
export { TOUR_STEPS, runnableSteps } from './tour-script.ts'
export type { TourStep, TourTarget } from './tour-script.ts'
export type { TourKey } from './locales.ts'

/** The tour face (`ctx.tour`). */
export interface ITour {
  /**
   * Point a tour target at a live element; the default selector for that
   * target is bypassed while the anchor stands.
   * @param target - which step's target.
   * @param element - the element to spotlight.
   * @returns disposer clearing the anchor.
   */
  anchor(target: TourTarget, element: Element): () => void
  /** Start (or restart) the showcase over the targets on screen now. */
  start(): void
  /** Open the ⌘/ shortcuts sheet. */
  openKeybinds(): void
  /**
   * Suspend the automatic first-run start while at least one hold stands
   * (first-run setup runs its steps ahead of the showcase). Releasing the
   * last hold re-evaluates the trigger, so the tour still starts exactly
   * once — or not at all when the seed is already set.
   * @returns idempotent disposer releasing this hold.
   */
  holdFirstRun(): () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The keybinds catalogue + dispatcher. */
    keybinds: IKeybinds
    /** The showcase tour face. */
    tour: ITour
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The tour's and sheet's copy. */
    'idealize-tour': TourKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'idealize-tour'

/** The host half's section (restated; `src/index.ts` owns the schema). */
interface TourSettingsLike {
  hasSeenTour?: boolean
}

/** V0 showed the tour 1.4s after launch so the frame's controls exist to point at. */
const FIRST_RUN_DELAY_MS = 1400

/** Required services. */
export const inject = ['slots', 'locale', 'settingsScope', 'settingsOpen', 'layout', 'workspaces']

/**
 * Client plugin body: services, the overlay occupant, the default shortcut
 * catalogue, the global dispatcher, and the first-run trigger.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'idealize-tour: dictionaries')

  const view = new TourView()
  const registry = new KeybindRegistry()
  const groups = createSnapshotStore(registry.list())
  registry.subscribe(() => { groups.set(registry.list()) })

  const anchors = new Map<TourTarget, Element>()
  const resolve = (target: TourTarget): Element | null => {
    const anchored = anchors.get(target)
    if (anchored !== undefined && anchored.isConnected) return anchored
    for (const selector of DEFAULT_SELECTORS[target]) {
      const found = document.querySelector(selector)
      if (found !== null) return found
    }
    return null
  }

  // First-run holds: while any stands, the automatic trigger stays quiet.
  const holds = createSnapshotStore(0)

  const tour: ITour = {
    anchor: (target, element) => {
      anchors.set(target, element)
      return () => { if (anchors.get(target) === element) anchors.delete(target) }
    },
    start: () => { view.start(runnableSteps(target => resolve(target) !== null)) },
    openKeybinds: () => { view.openSheet() },
    holdFirstRun: () => {
      let released = false
      holds.set(holds.getSnapshot() + 1)
      return () => {
        if (released) return
        released = true
        holds.set(holds.getSnapshot() - 1)
      }
    },
  }

  ctx.effect(() => {
    const disposers = [ctx.reflect.provide('keybinds', registry), ctx.reflect.provide('tour', tour)]
    return () => { for (const dispose of disposers) void dispose() }
  }, 'idealize-tour: services')

  // ── One-time seed ──────────────────────────────────────────────────────
  const scope = ctx.settingsScope.bind<TourSettingsLike>({ namespace: 'idealize-tour' })
  const markSeen = (): void => {
    if (scope.getSnapshot().value?.hasSeenTour === true) return
    scope.set('hasSeenTour', true).catch(() => {
      // The seed is a convenience: a failed write replays the tour next launch.
    })
  }
  ctx.effect(() => armFirstRunTrigger({ scope, holds, start: () => { tour.start() }, delayMs: FIRST_RUN_DELAY_MS }), 'idealize-tour: first-run trigger')

  // ── The default catalogue ──────────────────────────────────────────────
  // ctx.get, not the Context property: this package compiles host and client
  // halves in one project, and the host store's merge shadows the client typing.
  const workspaces = ctx.get('workspaces') as unknown as IWorkspaces
  // Every listed selector in turn: the first names the composer by its column
  // class, the second by the textarea's own marker, so a restyled shell still
  // takes the focus key.
  const focusComposer = (): void => {
    for (const selector of DEFAULT_SELECTORS.composer) {
      const input = document.querySelector<HTMLTextAreaElement>(selector)
      if (input !== null) {
        input.focus()
        return
      }
    }
  }
  // Browser-reserved chords (⌘N, ⌘T, ⌘W, ⇧⌘N) never reach the page; New chat
  // takes ⌥⌘N so the same key works in Chrome and the desktop shell.
  const defaults: Keybind[] = [
    { id: 'idealize.newChat', group: 'group.chats', label: 'bind.newChat', chords: [chord('alt+meta+n')], run: () => { workspaces.startSession() } },
    { id: 'idealize.send', group: 'group.composer', label: 'bind.send', chords: [chord('Enter')], order: 0 },
    { id: 'idealize.sendWhenNewline', group: 'group.composer', label: 'bind.sendWhenNewline', chords: [chord('meta+Enter')], order: 1 },
    { id: 'idealize.newline', group: 'group.composer', label: 'bind.newline', chords: [chord('shift+Enter')], order: 2 },
    { id: 'idealize.history', group: 'group.composer', label: 'bind.history', chords: [chord('ArrowUp'), chord('ArrowDown')], order: 3 },
    { id: 'idealize.undo', group: 'group.composer', label: 'bind.undo', chords: [chord('meta+z'), chord('shift+meta+z')], order: 4 },
    { id: 'idealize.focusInput', group: 'group.composer', label: 'bind.focusInput', chords: [chord('meta+i')], order: 5, run: focusComposer },
    { id: 'idealize.sidebar', group: 'group.panels', label: 'bind.sidebar', chords: [chord('shift+meta+r')], run: () => { ctx.layout.toggleSidebar() } },
    // Listed only: the desktop shell registers ⌃⌥A as a global shortcut
    // (dsh-plugin-desktop main.ts), so it works with no IDEalize window focused.
    { id: 'idealize.askbar', group: 'group.panels', label: 'bind.askbar', chords: [chord('ctrl+alt+a')], order: 1 },
    { id: 'idealize.settings', group: 'group.app', label: 'bind.settings', chords: [chord('meta+,')], order: 0, run: () => { ctx.settingsOpen.open() } },
    { id: 'idealize.keys', group: 'group.app', label: 'bind.keys', chords: [chord('meta+/')], order: 1, run: () => { view.toggleSheet() } },
  ]
  ctx.effect(() => {
    const disposers = defaults.map(binding => registry.register(binding))
    return () => { for (const dispose of disposers) dispose() }
  }, 'idealize-tour: default keybinds')

  // ── The dispatcher ─────────────────────────────────────────────────────
  /**
   * Is the event aimed at something the person is typing into? A plain chord
   * there belongs to the field, not to the app.
   * @param target - the event's target.
   * @returns true for an input, a textarea or a contenteditable element.
   */
  const editing = (target: EventTarget | null): boolean => {
    const node = target as HTMLElement | null
    return node?.tagName === 'INPUT' || node?.tagName === 'TEXTAREA' || node?.isContentEditable === true
  }
  ctx.effect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!isAppChord(event, editing(event.target)) || event.defaultPrevented) return
      if (registry.dispatch(event)) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => { document.removeEventListener('keydown', onKeyDown, true) }
  }, 'idealize-tour: keydown dispatcher')

  const injected = (): OverlayInjected => ({
    hooks: { view: view.store, keybinds: groups },
    resolve,
    next: () => {
      const { steps, index } = view.getSnapshot()
      if (steps !== null && index >= steps.length - 1) markSeen()
      view.next()
    },
    back: () => { view.back() },
    finish: () => {
      view.finish()
      markSeen()
    },
    closeSheet: () => { view.closeSheet() },
  })

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'idealize-tour',
    order: 90,
    locale: NS,
    inject: injected,
  }, Overlay))
}
