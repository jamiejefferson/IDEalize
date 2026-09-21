/**
 * Models that refused a routed turn. A route's catalogue can list a model the
 * user's account cannot run (a ChatGPT sign-in lists Codex models its plan
 * does not serve), and only the provider's answer says so. A model that failed
 * a turn the router gave it is left out of the candidates for a week, so the
 * router learns the account's real list one refusal at a time. Kept in the
 * harness data folder so a restart does not repeat the lesson.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const REFUSED_FILE = 'router-refused.json'
const REFUSED_FOR_MS = 7 * 24 * 60 * 60 * 1000

/** Route key (`provider/model`) to the time the refusal lapses, in epoch milliseconds. */
export type Refusals = Record<string, number>

export const routeKey = (model: { provider: string; model: string }): string => `${model.provider}/${model.model}`

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
 * @param now - the current time.
 */
export async function noteRefusal(
  home: string, refusals: Refusals, model: { provider: string; model: string }, now = Date.now(),
): Promise<void> {
  refusals[routeKey(model)] = now + REFUSED_FOR_MS
  await writeFile(join(home, REFUSED_FILE), JSON.stringify(refusals, null, 2), 'utf8').catch(() => undefined)
}
