/**
 * `@idealize/ui-tasks` — the task column's Host face.
 *
 * It contributes no host behaviour. The column renders the `todos` projection
 * `@deepseek-ai/dsh-tool-todo` already computes from the session log, so this
 * face exists only to give the plugin a Host entry point beside its Client one.
 * @module @idealize/ui-tasks
 */

import type { Context } from '@deepseek-ai/cordis'

/** Cordis plugin name. */
export const name = 'idealize-ui-tasks'

/**
 * Mount the task column's host face.
 * @param _ctx - Host context; unused, this face registers nothing.
 */
export function apply(_ctx: Context): void {
  // Deliberately empty: see the module note.
}
