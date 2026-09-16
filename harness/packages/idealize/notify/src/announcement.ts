/**
 * Announcement decoding and gating, ported from V0's `AnnouncementStore`:
 * the newest active Supabase row surfaces unless the user already dismissed
 * that exact id or the running app version falls outside its [min, max]
 * range. Pure functions; the client store owns fetching and persistence.
 */

/** One `idealize_announcements` row, decoded from the REST JSON. */
export interface Announcement {
  id: string
  title: string
  body: string
  ctaLabel?: string | undefined
  ctaUrl?: string | undefined
  minAppVersion?: string | undefined
  maxAppVersion?: string | undefined
}

/**
 * Dotted-numeric version parts; missing components read as 0 ("0.1" == "0.1.0").
 * @param value - the version string; non-digits inside a component are ignored.
 * @returns the numeric components; an empty string reads as `[0]`.
 */
export function parseVersion(value: string): number[] {
  return value.split('.').map(part => Number.parseInt(part.replace(/\D/g, ''), 10) || 0)
}

/**
 * Component-by-component version compare.
 * @param a - the left version.
 * @param b - the right version.
 * @returns negative when a < b, zero when equal, positive when a > b.
 */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a)
  const right = parseVersion(b)
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const l = left[index] ?? 0
    const r = right[index] ?? 0
    if (l !== r) return l < r ? -1 : 1
  }
  return 0
}

/**
 * Is the running app within the announcement's target range? An absent bound
 * is open; an unreadable app version fails open so dev builds always see
 * announcements (V0's rule).
 * @param appVersion - the running app's version, undefined when unknown.
 * @param min - the inclusive lower bound; absent or empty is open.
 * @param max - the inclusive upper bound; absent or empty is open.
 * @returns true when the announcement applies to this app version.
 */
export function versionInRange(appVersion: string | undefined, min?: string, max?: string): boolean {
  if (appVersion === undefined || appVersion === '') return true
  if (min !== undefined && min !== '' && compareVersions(appVersion, min) < 0) return false
  if (max !== undefined && max !== '' && compareVersions(appVersion, max) > 0) return false
  return true
}

/**
 * Decode one REST row.
 * @param row - one element of the announcements response.
 * @returns the announcement, or undefined when `id`, `title`, or `body` is missing or mistyped.
 */
export function decodeAnnouncement(row: unknown): Announcement | undefined {
  if (typeof row !== 'object' || row === null) return undefined
  const record = row as Record<string, unknown>
  const id = record.id
  const title = record.title
  const body = record.body
  if ((typeof id !== 'string' && typeof id !== 'number') || typeof title !== 'string' || typeof body !== 'string') return undefined
  const optional = (key: string): string | undefined => {
    const value = record[key]
    return typeof value === 'string' && value !== '' ? value : undefined
  }
  return {
    id: String(id),
    title,
    body,
    ctaLabel: optional('cta_label'),
    ctaUrl: optional('cta_url'),
    minAppVersion: optional('min_app_version'),
    maxAppVersion: optional('max_app_version'),
  }
}

/**
 * Pick the announcement to show from the route's response (newest first):
 * skipped when dismissed already or out of the version range.
 * @param rows - the `/idealize/announcements` JSON body.
 * @param appVersion - the running app's version, undefined when unknown.
 * @param lastSeenId - the dismissed announcement id persisted in settings.
 * @returns the announcement to show, or undefined when there is none to show.
 */
export function selectAnnouncement(rows: unknown, appVersion: string | undefined, lastSeenId: string): Announcement | undefined {
  if (!Array.isArray(rows)) return undefined
  const latest = decodeAnnouncement(rows[0])
  if (latest === undefined) return undefined
  if (latest.id === lastSeenId) return undefined
  if (!versionInRange(appVersion, latest.minAppVersion, latest.maxAppVersion)) return undefined
  return latest
}
