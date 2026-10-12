/**
 * The launch token: the one secret that lets a caller drive the app's routes.
 *
 * The harness serves its UI and API on loopback, and until 1.0.15 any program
 * on the Mac (an agent's shell included) could call every route. The host's
 * launch gate now refuses a request that does not prove it holds this token.
 * The token lives only in this process: it is placed on `globalThis` for the
 * in-process harness and set as an HTTP-only, same-site cookie in the browser
 * session every app window shares. It is never written to disk or put in an
 * environment, so shells and agents never see it, and it changes every launch.
 */

import { randomBytes } from 'node:crypto'
import type { Session } from 'electron'

/** Must match the harness's `LAUNCH_TOKEN_KEY` (`@deepseek-ai/dsh-host-webserver`). */
const LAUNCH_TOKEN_KEY = Symbol.for('idealize.launch-token')

/** Must match the harness's `LAUNCH_COOKIE`. */
const LAUNCH_COOKIE = 'idealize_launch'

/** Loopback hosts the harness may be reached on; a cookie is host-scoped, not port-scoped. */
const LOOPBACK_URLS = ['http://127.0.0.1/', 'http://localhost/'] as const

/**
 * Mint this launch's token, hand it to the harness and to the app's windows.
 * Must run before the harness boots and before any window loads.
 * @param browserSession - the session every app window loads in.
 * @param mint - token source; tests pass a fixed one.
 * @returns the token.
 */
export async function installLaunchGate(
  browserSession: Pick<Session, 'cookies'>,
  mint: () => string = () => randomBytes(32).toString('hex'),
): Promise<string> {
  const token = mint()
  ;(globalThis as Record<symbol, unknown>)[LAUNCH_TOKEN_KEY] = token
  // No expiry: a session cookie, held in memory and gone when the app quits.
  for (const url of LOOPBACK_URLS) {
    await browserSession.cookies.set({ url, name: LAUNCH_COOKIE, value: token, httpOnly: true, sameSite: 'strict' })
  }
  return token
}
