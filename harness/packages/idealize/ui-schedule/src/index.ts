/**
 * @idealize/ui-schedule — Host loader entry for the browser-only Schedule view.
 *
 * Every task this view shows, creates, edits, reschedules and deletes travels
 * over `@idealize/cron`'s existing `/idealize/cron/*` routes, and that package
 * alone owns the task document, its ids, and the loopback route fence. This
 * half therefore contributes no host behaviour and serves no routes of its own.
 * @module @idealize/ui-schedule
 */

/** Stable Cordis plugin name. */
export const name = 'idealize-ui-schedule'

/** Contributes no host-side behaviour; the whole view is the browser half. */
export function apply(): void {}
