/**
 * @idealize/ui-studio — Host loader entry for the browser-only Studio pane.
 *
 * Every record this pane shows travels over `@idealize/studio`'s existing
 * `/idealize/studio/*` routes, and that package alone owns the timeline, the
 * state fold, presence, and the loopback route fence. This half therefore
 * contributes no host behaviour and serves no routes of its own.
 * @module @idealize/ui-studio
 */

/** Stable Cordis plugin name. */
export const name = 'idealize-ui-studio'

/** Contributes no host-side behaviour; the whole view is the browser half. */
export function apply(): void {}
