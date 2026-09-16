/**
 * Client face of @idealize/spaces: the `SessionEventMap` and
 * `SessionProjectionMap` merges, the space vocabulary's types, and the roster
 * payload types the welcome card reads off `GET /idealize/spaces` — types
 * only, so browser bundles can name these values without pulling host code and
 * without value-importing a second copy of this module. The one value here is
 * the icon route helper, a stateless module a client bundle inlines.
 * @module @idealize/spaces/client
 */
export type * from './projection-types.ts'
export type * from './space-table.ts'
export type * from './roster.ts'
export { SPACE_ICON_PATH, spaceIconSrc } from './space-icons.ts'
