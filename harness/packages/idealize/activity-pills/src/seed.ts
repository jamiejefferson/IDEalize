/**
 * The five activity agents and the composition each one is seeded with.
 *
 * An activity agent is an ordinary agent preset (a directory under the
 * user preset root) whose persona carries the activity's working
 * instructions. Seeding derives each composition from the shipped `standard`
 * preset so the activity agents carry the full tool set and track upstream
 * changes to it; only the persona row's text is replaced.
 * @module @idealize/activity-pills/seed
 */

import { dump, load } from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { ACTIVITY_IDS, type ActivityDefinition } from './activities.ts'

export { ACTIVITIES, ACTIVITY_IDS, FREE_ACTIVITY_ID } from './activities.ts'
export type { ActivityDefinition } from './activities.ts'

/** One parsed composition row: a map carrying a plugin `name`. */
interface CompositionRow {
  id?: unknown
  name?: unknown
  config?: unknown
  [key: string]: unknown
}

/**
 * Derive an activity's composition text from a source composition.
 *
 * The source is parsed with the loader's own YAML dialect so `!!js`
 * expressions survive the round trip. The first `@deepseek-ai/dsh-persona`
 * row's `text` is replaced by the activity's persona; when the source carries
 * no persona row, one is prepended.
 * @param source - the source composition text (the shipped `standard` preset).
 * @param activity - the activity whose persona the result carries.
 * @returns the derived composition text.
 * @throws when the source is not a top-level list of plugin rows.
 */
export function deriveComposition(source: string, activity: ActivityDefinition): string {
  const rows = load(source, { schema: entryListSchema })
  if (!Array.isArray(rows)) throw new Error('activity-pills: the source composition must be a top-level list of plugin rows')
  const list = rows as CompositionRow[]
  const persona = list.find(row => row.name === '@deepseek-ai/dsh-persona')
  if (persona === undefined) {
    list.unshift({ id: 'persona', name: '@deepseek-ai/dsh-persona', config: { text: activity.persona } })
  } else {
    const config = typeof persona.config === 'object' && persona.config !== null
      ? persona.config as Record<string, unknown>
      : {}
    persona.config = { ...config, text: activity.persona }
  }
  return dump(list, { schema: entryListSchema, lineWidth: -1, noRefs: true })
}

/**
 * Read the persona text a composition carries (its special instructions).
 * @param source - the composition text.
 * @returns the first `@deepseek-ai/dsh-persona` row's text, or undefined when
 * the composition carries none or is not a list of plugin rows.
 */
export function personaOf(source: string): string | undefined {
  const rows = load(source, { schema: entryListSchema })
  if (!Array.isArray(rows)) return undefined
  const persona = (rows as CompositionRow[]).find(row => row.name === '@deepseek-ai/dsh-persona')
  const text = (persona?.config as { text?: unknown } | undefined)?.text
  return typeof text === 'string' ? text : undefined
}

/**
 * Whether a roster already carries any activity agent.
 * @param ids - the preset ids the roster reports.
 * @returns true when at least one activity id is present.
 */
export function hasActivityPresets(ids: Iterable<string>): boolean {
  const present = new Set(ids)
  return ACTIVITY_IDS.some(id => present.has(id))
}
