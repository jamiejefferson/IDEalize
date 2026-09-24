/**
 * The chime library's vocabulary, shared by the host (which lists and serves
 * the sounds) and the browser (which picks and plays one): the built-in
 * chime's id, one catalogue entry, the route each id plays from, and the
 * decoder the browser reads the catalogue through.
 */

/** The id of the chime the package ships (`assets/TaskComplete.mp3`). */
export const BUILT_IN_CHIME_SOUND = 'built-in'

/** The route that serves the built-in chime. */
export const BUILT_IN_CHIME_URL = '/idealize/notify/chime.mp3'

/** The route that lists the catalogue: `{sounds: ChimeSound[]}`, the built-in chime first. */
export const CHIME_SOUNDS_PATH = '/idealize/notify/sounds'

/** The route that serves one catalogue sound by `?id=`. */
export const CHIME_SOUND_PATH = '/idealize/notify/sound'

/** One sound the person can pick. */
export interface ChimeSound {
  /** Stable id: `built-in`, or `system:<name>` for one of the operating system's own alert sounds. */
  id: string
  /** The name shown in the picker. The built-in entry's label is replaced by the locale's. */
  label: string
}

/** The built-in chime's catalogue entry, in the host's own words. */
export const BUILT_IN_CHIME: ChimeSound = Object.freeze({ id: BUILT_IN_CHIME_SOUND, label: 'Built-in chime' })

/**
 * The URL that plays one sound: the shipped asset for the built-in chime,
 * the catalogue route for anything else.
 * @param id - a catalogue id.
 * @returns the URL to hand an Audio element.
 */
export function chimeSoundUrl(id: string): string {
  return id === BUILT_IN_CHIME_SOUND ? BUILT_IN_CHIME_URL : `${CHIME_SOUND_PATH}?id=${encodeURIComponent(id)}`
}

/**
 * Read the catalogue the host answered. Anything that is not a list of
 * `{id, label}` strings is dropped, and the built-in chime always leads, so
 * a picker always has one entry that plays.
 * @param body - the parsed `sounds` field, or anything else.
 * @returns the catalogue with the built-in chime first.
 */
export function decodeChimeSounds(body: unknown): ChimeSound[] {
  const rows = Array.isArray(body) ? body : []
  const system = rows.flatMap((row): ChimeSound[] => {
    const entry = row as { id?: unknown; label?: unknown } | null
    if (typeof entry?.id !== 'string' || entry.id === '' || entry.id === BUILT_IN_CHIME_SOUND || typeof entry.label !== 'string') return []
    return [{ id: entry.id, label: entry.label }]
  })
  return [BUILT_IN_CHIME, ...system]
}
