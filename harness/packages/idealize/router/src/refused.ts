/**
 * Models that refused a routed turn. A route's catalogue can list a model the
 * user's account cannot run (a ChatGPT sign-in lists Codex models its plan
 * does not serve), and only the provider's answer says so. A model that failed
 * a turn the router gave it is left out of the candidates for a week, so the
 * router learns the account's real list one refusal at a time. A rate limit
 * says only that the model is busy (a free OpenRouter model shares one pool
 * with everyone), so that keeps it out for an hour, and so do a timeout and a
 * server error. A dropped connection says nothing about the model: the route's
 * address did not answer (a gateway the office network blocks, 11 Nov 2026), so
 * the whole route sits out for ten minutes and no model on it is blamed. Kept
 * in the harness data folder so a restart does not repeat the lesson.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const REFUSED_FILE = 'router-refused.json'
const REFUSED_FOR_MS = 7 * 24 * 60 * 60 * 1000
const RATE_LIMITED_FOR_MS = 60 * 60 * 1000
const UNREACHABLE_FOR_MS = 10 * 60 * 1000

/** Why a model is left out: the account cannot run it, it was only busy, or its route did not answer at all. */
export type RefusalCause = 'refused' | 'rate-limited' | 'unreachable'

/** How long each cause keeps a model out, as the log says it. */
export const REFUSAL_SPAN: Readonly<Record<RefusalCause, string>> = {
  'refused': 'the router leaves that model alone for a week',
  'rate-limited': 'the router leaves that model alone for an hour',
  'unreachable': 'the router leaves that whole route alone for ten minutes',
}

/**
 * What a failure says about the model that gave it.
 * @param code - the failure's code.
 * @returns the cause to record.
 */
export function refusalCause(code: string): RefusalCause {
  if (code === 'TRANSPORT') return 'unreachable'
  return code === 'RATE_LIMIT' || code === 'TIMEOUT' || code === 'SERVER' ? 'rate-limited' : 'refused'
}

/** Route key (`provider/model`) to the time the refusal lapses, in epoch milliseconds. */
export type Refusals = Record<string, number>

export const routeKey = (model: { provider: string; model: string }): string => `${model.provider}/${model.model}`

/** The key that keeps every model on a route out. No model id is `*`. */
const wholeRoute = (provider: string): string => `${provider}/*`

/**
 * Whether a model sits out now, on its own account or with its whole route.
 * @param refusals - the refusals in force.
 * @param model - the model asked about.
 * @param now - the current time.
 * @returns true while either refusal holds.
 */
export function sitsOut(refusals: Refusals, model: { provider: string; model: string }, now = Date.now()): boolean {
  return (refusals[routeKey(model)] ?? 0) > now || (refusals[wholeRoute(model.provider)] ?? 0) > now
}

/**
 * The refusals still in force.
 * @param home - the harness data folder.
 * @param now - the current time.
 * @returns the live refusals; an absent or unreadable file reads as none.
 */
export async function readRefusals(home: string, now = Date.now()): Promise<Refusals> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(home, REFUSED_FILE), 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return {}
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && entry[1] > now))
  } catch {
    return {}
  }
}

/**
 * Record one refusal.
 * @param home - the harness data folder.
 * @param refusals - the refusals in force, changed in place.
 * @param model - the model that failed the turn.
 * @param cause - a refusal holds for a week, a rate limit for an hour, and an unreachable route for ten minutes.
 * @param now - the current time.
 */
export async function noteRefusal(
  home: string, refusals: Refusals, model: { provider: string; model: string }, cause: RefusalCause = 'refused', now = Date.now(),
): Promise<void> {
  if (cause === 'unreachable') refusals[wholeRoute(model.provider)] = now + UNREACHABLE_FOR_MS
  else refusals[routeKey(model)] = now + (cause === 'rate-limited' ? RATE_LIMITED_FOR_MS : REFUSED_FOR_MS)
  await writeFile(join(home, REFUSED_FILE), JSON.stringify(refusals, null, 2), 'utf8').catch(() => undefined)
}

/** Which key gateway the gateway refusals were learned against. */
export const GATEWAY_SEEN_FILE = 'router-gateway-seen.json'

/**
 * Forget what a key gateway's models refused once the gateway itself changes. A refusal
 * learned against one address or key says nothing about the next, and it would otherwise
 * keep the new gateway's models out for a week (JJ, 11 Nov 2026: six sat out after the
 * gateway moved address).
 * @param home - the harness data folder.
 * @param refusals - the refusals in force, changed in place.
 * @param identity - the connected gateway's address and key ending.
 * @returns whether any refusal was dropped.
 */
export async function forgetGatewayRefusals(home: string, refusals: Refusals, identity: string): Promise<boolean> {
  let seen: unknown
  try {
    seen = (JSON.parse(await readFile(join(home, GATEWAY_SEEN_FILE), 'utf8')) as { identity?: unknown }).identity
  } catch {
    seen = undefined
  }
  if (seen === identity) return false
  const stale = Object.keys(refusals).filter(key => key.startsWith('gateway-'))
  // A lapsed time reads as no refusal, and `readRefusals` drops it from the next read.
  for (const key of stale) refusals[key] = 0
  const kept = Object.fromEntries(Object.entries(refusals).filter(entry => entry[1] > 0))
  if (stale.length > 0) await writeFile(join(home, REFUSED_FILE), JSON.stringify(kept, null, 2), 'utf8').catch(() => undefined)
  await writeFile(join(home, GATEWAY_SEEN_FILE), JSON.stringify({ identity }), 'utf8').catch(() => undefined)
  return stale.length > 0
}
