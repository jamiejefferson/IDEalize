/**
 * Startup clearing of Chromium's HTTP cache.
 *
 * The Host serves the interface from `http://127.0.0.1:<port>` and takes a
 * new port on every launch, so every cached response belongs to an origin
 * that no later launch requests again. Entries are never reused and pile up
 * until Chromium's own size cap (1.1 GB across 10,445 entries after a month
 * on JJ's machine). Clearing at launch keeps the directory at one launch's worth.
 */

/** The part of Electron's `Session` this module uses. */
export interface HttpCacheOwner {
  /** Remove every HTTP cache entry of the session. */
  clearCache(): Promise<void>
}

/**
 * Clear the HTTP cache without delaying or failing startup.
 * @param owner - the session whose cache holds earlier launches' responses.
 * @param report - receives the failure text when Chromium rejects the request.
 * @returns settles once the cache is cleared or the failure is reported.
 */
export async function clearPreviousLaunchHttpCache(
  owner: HttpCacheOwner,
  report: (message: string) => void,
): Promise<void> {
  try {
    await owner.clearCache()
  } catch (cause) {
    report(`HTTP cache of earlier launches was not cleared: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
}
