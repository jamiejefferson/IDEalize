/**
 * The showcase script: V0's steps re-pointed at the V1 frame. Each step names
 * a tour target; a step whose target is not on screen is dropped at start so
 * no callout points at nothing (V0 filtered the same way).
 */
import type { TourKey } from './locales.ts'

/** Targets the tour can point at. `welcome` has none (the opening card floats centred). */
export type TourTarget = 'sidebar' | 'studio' | 'composer' | 'files' | 'brains' | 'askbar' | 'rail'

/** One step: a target plus its copy keys. */
export interface TourStep {
  target: TourTarget | null
  title: TourKey
  body: TourKey
}

/** The full script, in order. */
export const TOUR_STEPS: readonly TourStep[] = [
  { target: null, title: 'tour.welcome.title', body: 'tour.welcome.body' },
  { target: 'sidebar', title: 'tour.sidebar.title', body: 'tour.sidebar.body' },
  { target: 'studio', title: 'tour.studio.title', body: 'tour.studio.body' },
  { target: 'composer', title: 'tour.composer.title', body: 'tour.composer.body' },
  { target: 'files', title: 'tour.files.title', body: 'tour.files.body' },
  { target: 'brains', title: 'tour.brains.title', body: 'tour.brains.body' },
  { target: 'askbar', title: 'tour.askbar.title', body: 'tour.askbar.body' },
  { target: 'rail', title: 'tour.rail.title', body: 'tour.rail.body' },
]

/**
 * Snapshot the steps whose targets resolve now. Filtering once at start keeps
 * a step's index from shifting under the user when a panel appears mid-tour.
 * @param resolves - whether a target currently resolves to an element.
 * @param steps - the script (the default export order).
 * @returns the steps to run.
 */
export function runnableSteps(
  resolves: (target: TourTarget) => boolean,
  steps: readonly TourStep[] = TOUR_STEPS,
): TourStep[] {
  return steps.filter(step => step.target === null || resolves(step.target))
}

/**
 * Default DOM selectors per target, tried in order until one matches. Other
 * plugins may register an element for a target through `ctx.tour.anchor()`;
 * these selectors are the fallback for frames that have not wired one. The
 * aria-labels are the sidebar's, the Studio card's and the tool rail's en/zh
 * copy. Every rail pane sits in the frame's `shell.rail` seat (the
 * `[data-shell-dock]` row under the chat column is empty in V1, so a selector
 * on it drops its step at every launch: a walk of the packaged first run on
 * 14 Sep 2026 found the files and models steps never showing).
 */
export const DEFAULT_SELECTORS: Record<TourTarget, readonly string[]> = {
  sidebar: ['[class*="_sidebarCol"]'],
  studio: ['[data-studio-card-wrap]', 'button[aria-label="Open the Studio"]'],
  composer: ['[class*="_centerCol"] textarea', 'textarea[data-phase]', '[data-launcher-step]'],
  files: ['[data-slot="shell.rail"] button[aria-label="Files"]', '[data-slot="shell.rail"] button[aria-label="文件"]'],
  brains: ['[data-slot="shell.rail"] button[aria-label="Brains"]', '[data-slot="shell.rail"] button[aria-label="大脑"]'],
  askbar: ['button[aria-label="Collapse to the Askbar"]', 'button[aria-label="收起到 Askbar"]'],
  rail: ['nav[aria-label="Tool rail"]', '[data-slot="shell.rail"]'],
}
