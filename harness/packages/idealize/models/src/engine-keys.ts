/**
 * Key headroom on the free-tokens engine, for the auto policy: how many
 * upstream provider keys the engine's own router would still use. Reading it
 * needs an admin session. The engine's sessions last for days and every login
 * stores another one, so the reader signs in once and carries that session
 * from pass to pass, signing in again only when the engine refuses it (401:
 * expired, or a restarted engine with a fresh database).
 */

/** Reads the engine's usable-key count, holding one admin session between reads. */
export interface EngineKeyReader {
  /**
   * Count the keys the engine's router would use.
   * @param origin - The engine's origin, without the `/v1` suffix.
   * @param password - The admin password this host provisioned the engine with.
   * @returns the usable-key count, or undefined when it cannot be read.
   */
  usableKeys(origin: string, password: string): Promise<number | undefined>
}

/**
 * Build a usable-key reader. It never throws: a failed sign-in, an unreachable
 * engine or an unexpected answer all read as "unknown".
 * @returns the reader, with no session held yet.
 */
export function createEngineKeyReader(): EngineKeyReader {
  // The session is only good for the engine and the password it was issued
  // under, so either changing signs in afresh.
  let held: { origin: string; password: string; token: string } | undefined

  const login = async (origin: string, password: string): Promise<string | undefined> => {
    const res = await fetch(`${origin}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'host@idealize.local', password }),
      signal: AbortSignal.timeout(10_000),
    })
    const { token } = await res.json() as { token?: string }
    if (typeof token !== 'string') return undefined
    held = { origin, password, token }
    return token
  }

  const listKeys = async (origin: string, token: string): Promise<Response> => await fetch(`${origin}/api/keys`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  })

  return {
    async usableKeys(origin, password) {
      try {
        const reused = held !== undefined && held.origin === origin && held.password === password ? held.token : undefined
        let token = reused ?? await login(origin, password)
        if (token === undefined) return undefined
        let res = await listKeys(origin, token)
        if (res.status === 401) {
          held = undefined
          // A session carried over may simply have lapsed: sign in again, once.
          // One issued this very pass was refused outright, which no retry mends.
          if (reused !== undefined) {
            token = await login(origin, password)
            if (token === undefined) return undefined
            res = await listKeys(origin, token)
            if (res.status === 401) held = undefined
          }
        }
        const keys = await res.json() as { enabled?: boolean; status?: string }[]
        if (!Array.isArray(keys)) return undefined
        // The same usability rule as the engine's own router:
        // enabled AND status IN ('healthy', 'unknown').
        return keys.filter(key => key.enabled === true && (key.status === 'healthy' || key.status === 'unknown')).length
      } catch {
        return undefined
      }
    },
  }
}
