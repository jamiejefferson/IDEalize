/**
 * The launch gate: who may call the app's own routes.
 *
 * The server listens on loopback, and its browser fence (Host, Origin,
 * Sec-Fetch-Site and a custom header) keeps web pages out. It never told one
 * local caller from another, so any process on the Mac, an agent's shell
 * included, could drive every route with `curl` (security audit, 9 Oct 2026).
 *
 * When the embedding shell places a launch token on `globalThis` under
 * {@link LAUNCH_TOKEN_KEY} before boot, every `/api` and `/idealize` request
 * must prove it holds that token or a session key derived from it:
 * - the app's own windows carry the token as the {@link LAUNCH_COOKIE} cookie,
 *   which the shell sets in its browser session and no other program holds;
 * - a chat's shell carries its session id and that session's key
 *   ({@link sessionKey}) and may reach only the routes in
 *   {@link SESSION_ROUTES}.
 * With no token placed (tests, a bare web run), the gate stays open and only
 * the loopback Host check applies.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'

/** Where the embedding shell places the launch token before boot. */
export const LAUNCH_TOKEN_KEY = Symbol.for('idealize.launch-token')

/** The cookie the app's windows carry the launch token in. */
export const LAUNCH_COOKIE = 'idealize_launch'

/** Header carrying a chat shell's session id. */
export const SESSION_HEADER = 'x-idealize-session'

/** Header carrying a chat shell's session key (or the launch token itself). */
export const KEY_HEADER = 'x-idealize-key'

/** The routes a chat's shell may call with its session key. */
export const SESSION_ROUTES: readonly string[] = ['/idealize/comm']

/** Who made a request, as the gate proved it. */
export type LaunchCaller =
  | { kind: 'app' }
  | { kind: 'session'; sessionId: string }
  | { kind: 'open' }

const CALLER = Symbol.for('idealize.launch-caller')

/**
 * The launch token the shell placed, when it placed one.
 * @returns the token, or undefined when the gate is open.
 */
export function launchToken(): string | undefined {
  const value = (globalThis as Record<symbol, unknown>)[LAUNCH_TOKEN_KEY]
  return typeof value === 'string' && value.length >= 32 ? value : undefined
}

/**
 * The key one chat's shell carries: derived from the launch token, so the host
 * checks it without storing anything, and useless after the app restarts.
 * @param token - the launch token.
 * @param sessionId - the chat's session id.
 * @returns the hex key.
 */
export function sessionKey(token: string, sessionId: string): string {
  return createHmac('sha256', token).update(`session:${sessionId}`).digest('hex')
}

/**
 * The key for one chat's shell under the current launch token.
 * @param sessionId - the chat's session id.
 * @returns the key, or undefined when the gate is open.
 */
export function currentSessionKey(sessionId: string): string | undefined {
  const token = launchToken()
  return token === undefined ? undefined : sessionKey(token, sessionId)
}

function same(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name]
  return typeof value === 'string' ? value : undefined
}

function cookie(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers.cookie
  if (raw === undefined) return undefined
  for (const part of raw.split(';')) {
    const at = part.indexOf('=')
    if (at === -1) continue
    if (part.slice(0, at).trim() === name) return part.slice(at + 1).trim()
  }
  return undefined
}

/**
 * Whether a Host header names this machine's loopback.
 * @param host - the request's Host header.
 * @returns true for 127.0.0.1, localhost and [::1], any port.
 */
export function loopbackHost(host: string | undefined): boolean {
  if (host === undefined) return false
  const name = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0]
  return name === '127.0.0.1' || name === 'localhost' || name === '[::1]'
}

/**
 * Whether the gate guards a path.
 * @param path - the request pathname.
 * @returns true for the RPC bridge and the app's own routes.
 */
export function gatedPath(path: string): boolean {
  return path === '/api' || path.startsWith('/api/') || path === '/idealize' || path.startsWith('/idealize/')
}

/**
 * Prove who sent a request.
 * @param req - the incoming request.
 * @returns the caller, or undefined when the request proves nothing.
 */
export function identify(req: IncomingMessage): LaunchCaller | undefined {
  const token = launchToken()
  if (token === undefined) return { kind: 'open' }
  const fromCookie = cookie(req, LAUNCH_COOKIE)
  if (fromCookie !== undefined && same(fromCookie, token)) return { kind: 'app' }
  const key = header(req, KEY_HEADER)
  if (key === undefined) return undefined
  if (same(key, token)) return { kind: 'app' }
  const sessionId = header(req, SESSION_HEADER)
  if (sessionId === undefined || sessionId === '') return undefined
  return same(key, sessionKey(token, sessionId)) ? { kind: 'session', sessionId } : undefined
}

/**
 * Decide one request: whether it may proceed, recording the caller on it.
 * @param req - the incoming request.
 * @param path - its pathname.
 * @returns undefined to proceed, or the status to refuse with.
 */
export function admit(req: IncomingMessage, path: string): 403 | 401 | undefined {
  if (launchToken() !== undefined && !loopbackHost(header(req, 'host'))) return 403
  if (!gatedPath(path)) return undefined
  const caller = identify(req)
  if (caller === undefined) return 401
  if (caller.kind === 'session' && !SESSION_ROUTES.includes(path)) return 401
  ;(req as unknown as Record<symbol, unknown>)[CALLER] = caller
  return undefined
}

/**
 * Who the gate proved a request came from.
 * @param req - a request the gate admitted.
 * @returns the caller; `open` when the gate is open or never saw the request.
 */
export function requestCaller(req: IncomingMessage): LaunchCaller {
  const caller = (req as unknown as Record<symbol, unknown>)[CALLER] as LaunchCaller | undefined
  return caller ?? { kind: 'open' }
}
