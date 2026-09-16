/**
 * View-state persistence across the mode-change restart.
 *
 * A shell-mode change relaunches the whole Electron application, and the
 * renderer's own persisted selection (localStorage `dsh.sessions.current`)
 * cannot carry across because the loopback origin's port changes between
 * launches. The Electron main process therefore keeps the last viewed
 * session in a small user-data file: the renderer records it through the
 * {@link DESKTOP_VIEW_STATE_PATH} route, and the next generation reads it
 * back to re-open the same session.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { DesktopViewState } from './view-state-contract.ts'

export { DESKTOP_VIEW_STATE_PATH } from './view-state-contract.ts'
export type { DesktopViewState } from './view-state-contract.ts'

/** Location of the persisted view state below the Electron user-data directory. */
export function desktopViewStatePath(userDataPath: string): string {
  return join(userDataPath, 'view-state', 'view-state.json')
}

const MAX_SESSION_ID_LENGTH = 256
const MAX_BODY_BYTES = 4 * 1024

/**
 * Validate one untrusted view-state value.
 * @param value - parsed JSON from the file or the renderer request.
 * @returns the validated state, or undefined when the value is not usable.
 */
export function parseDesktopViewState(value: unknown): DesktopViewState | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const sessionId = (value as Record<string, unknown>).sessionId
  if (typeof sessionId !== 'string' || sessionId.length === 0 || sessionId.length > MAX_SESSION_ID_LENGTH) {
    return undefined
  }
  return { sessionId }
}

/**
 * Read the persisted view state.
 * @param path - file written by {@link writeDesktopViewState}.
 * @returns the state, or undefined when none is stored or the file is unreadable.
 */
export function readDesktopViewState(path: string): DesktopViewState | undefined {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    // Unreadable (usually absent) file: the generation starts without a
    // restore target, exactly like a first launch.
    return undefined
  }
  try {
    return parseDesktopViewState(JSON.parse(text))
  } catch {
    // Corrupted JSON reads as no stored state; the next selection rewrites it.
    return undefined
  }
}

/** Persist the view state so the next generation can re-open the same session. */
export function writeDesktopViewState(path: string, state: DesktopViewState): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

/** Main-process store the view-state route reads and writes. */
export interface DesktopViewStateStore {
  /** Read the persisted state, or undefined without one. */
  read(): DesktopViewState | undefined
  /** Persist the state for the next generation. */
  write(state: DesktopViewState): void
}

function finish(res: ServerResponse, statusCode: number): void {
  res.statusCode = statusCode
  res.end()
}

function sendJson(res: ServerResponse, body: unknown): void {
  res.statusCode = 200
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(body))
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    size += bytes.byteLength
    if (size > MAX_BODY_BYTES) return undefined
    chunks.push(bytes)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    // Malformed JSON surfaces as an undefined parse result, refused as 400.
    return undefined
  }
}

/**
 * Serve the renderer view state on the loopback Host.
 *
 * GET returns the stored state (or `{}`); a same-origin GET carries no Origin
 * header, so it relies on the loopback binding the desktop Web server already
 * guarantees. POST validates the same-origin marker like the renderer boot
 * route, then persists the body.
 * @param req - loopback request.
 * @param res - response written by this handler.
 * @param expectedOrigin - renderer origin allowed to record state.
 * @param store - main-process persistence.
 */
export async function handleDesktopViewStateRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  store: DesktopViewStateStore,
): Promise<void> {
  if (req.method === 'GET') {
    sendJson(res, store.read() ?? {})
    return
  }
  if (req.method !== 'POST') return finish(res, 405)
  if (req.headers.origin !== expectedOrigin) return finish(res, 403)
  if (req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    return finish(res, 415)
  }
  const state = parseDesktopViewState(await readBody(req))
  if (state === undefined) return finish(res, 400)
  store.write(state)
  finish(res, 204)
}
