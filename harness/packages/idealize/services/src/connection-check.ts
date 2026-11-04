/**
 * The connection check: a quick, free read against the service itself, so a
 * person learns whether a key works when they connect it rather than when a
 * chat fails later. Each probe reads an address that needs the key and spends
 * nothing; a service with no such address reads as untested.
 * @module @idealize/services/connection-check
 */

/** What the check found. */
export type CheckState = 'working' | 'refused' | 'no-credit' | 'no-keys' | 'failed' | 'untested'

/** One service's probe. */
interface Probe {
  url: string
  headers: (key: string) => Record<string, string>
  /** The service answers 403 to a good key that lacks a permission, so 403 proves nothing. */
  forbiddenIsInconclusive?: true
  /** Reads a credit figure out of the answer, for a service that states one. */
  outOfCredit?: (body: unknown) => boolean
}

const bearer = (key: string): Record<string, string> => ({ authorization: `Bearer ${key}` })

const PROBES: Readonly<Record<string, Probe>> = {
  // /models answers without a key here, so only /key proves one.
  openrouter: {
    url: 'https://openrouter.ai/api/v1/key',
    headers: bearer,
    outOfCredit: (body) => {
      const remaining = (body as { data?: { limit_remaining?: unknown } } | null)?.data?.limit_remaining
      return typeof remaining === 'number' && remaining <= 0
    },
  },
  anthropic: {
    url: 'https://api.anthropic.com/v1/models',
    headers: key => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01' }),
  },
  openai: { url: 'https://api.openai.com/v1/models', headers: bearer },
  deepseek: {
    url: 'https://api.deepseek.com/user/balance',
    headers: bearer,
    outOfCredit: body => (body as { is_available?: unknown } | null)?.is_available === false,
  },
  fal: {
    // The usage address rate-limits within a few reads, which read as a fault.
    url: 'https://rest.alpha.fal.ai/users/current',
    headers: key => ({ authorization: `Key ${key}` }),
    forbiddenIsInconclusive: true,
  },
}

/** How long the person waits at most: past this the service is reported unreachable. */
const CHECK_TIMEOUT_MS = 8_000

/**
 * Whether this service has a free probe.
 * @param id - the service id.
 * @returns true when {@link checkKey} can prove a key for it.
 */
export function canProbe(id: string): boolean {
  return Object.hasOwn(PROBES, id)
}

/**
 * Check one key against its service.
 * @param id - the service id.
 * @param key - the key.
 * @param fetchImpl - the transport, for tests.
 * @returns what the service said; never throws.
 */
export async function checkKey(id: string, key: string, fetchImpl: typeof fetch = fetch): Promise<CheckState> {
  const probe = Object.hasOwn(PROBES, id) ? PROBES[id] : undefined
  if (probe === undefined) return 'untested'
  try {
    const response = await fetchImpl(probe.url, { headers: probe.headers(key), signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) })
    if (response.status === 401) return 'refused'
    if (response.status === 403) return probe.forbiddenIsInconclusive === true ? 'untested' : 'refused'
    if (response.status === 402) return 'no-credit'
    // Asked to slow down: the check learned nothing about the key, and must not read as a fault.
    if (response.status === 429) return 'untested'
    if (!response.ok) return 'failed'
    const body: unknown = probe.outOfCredit === undefined ? undefined : await response.json().catch(() => undefined)
    return probe.outOfCredit?.(body) === true ? 'no-credit' : 'working'
  } catch {
    return 'failed'
  }
}
