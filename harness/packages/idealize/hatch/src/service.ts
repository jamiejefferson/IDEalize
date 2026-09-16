/**
 * The V0 service-hatch half of the hatch routes: resolve the IDEalize source
 * checkout, report it, and accept an edit. The edit persists into the
 * settings user layer over the composed `serviceSource` config, so a new path
 * takes effect on the next probe without a restart and survives restarts.
 */

import { existsSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * The message a caught value carries, for an error body or a report field.
 * @param error - the caught value; a thrown non-Error is stringified.
 * @returns the message to report.
 */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Write a JSON body with its status.
 * @param res - the response to complete.
 * @param status - HTTP status code.
 * @param body - value serialized as the JSON body.
 */
export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
}

/** Collect a request body as UTF-8 text.
 * @param req - the incoming request.
 * @returns the concatenated body.
 */
export async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

/** A directory counts as the service source when it carries the fork markers.
 * @param path - candidate directory.
 * @returns whether `FORK.md` and `package.json` both exist there.
 */
export function isServiceSource(path: string): boolean {
  return existsSync(join(path, 'FORK.md')) && existsSync(join(path, 'package.json'))
}

/**
 * Resolve the service source checkout: the configured path when set,
 * otherwise the conventional dev location.
 * @param configured - the effective `serviceSource` value, if any.
 * @returns the candidate path plus whether it passes the fork-marker check.
 */
export function resolveServiceSource(configured: string | undefined): { path: string; valid: boolean } {
  const path = configured ?? join(homedir(), 'dev', 'idealize')
  return { path, valid: isServiceSource(path) }
}

/** What the service route needs from the hosting plugin. */
export interface ServiceRouteDeps {
  /** The effective `serviceSource`: settings user layer over composed config. */
  currentSource: () => string | undefined
  /**
   * Persist a new source into the settings user layer, or `undefined` while
   * no settings provider is mounted (the route then refuses the edit loudly).
   */
  writeSource: () => ((path: string) => Promise<void>) | undefined
  /** The workspace already open at a path, if any. */
  resolveWorkspace: (path: string) => Promise<{ id: string } | undefined>
}

/**
 * Handle `/idealize/hatch/service`. GET reports the source checkout; POST
 * `{path}` validates the fork markers, persists the path, and answers with
 * the fresh report, so the caller renders exactly what the next GET would
 * say. POST demands the `x-idealize-auth` header (the route registers as
 * non-mutating for GET's sake).
 * @param deps - source resolution, persistence, and workspace lookup.
 * @param req - the incoming request.
 * @param res - the response to complete.
 */
export async function handleServiceRoute(
  deps: ServiceRouteDeps,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method === 'POST') {
    if (req.headers['x-idealize-auth'] !== '1') {
      res.writeHead(403, { 'content-type': 'text/plain' }).end('missing x-idealize-auth header')
      return
    }
    const body = JSON.parse(await readBody(req)) as { path?: unknown }
    const path = typeof body.path === 'string' ? body.path.trim() : ''
    if (path === '') {
      sendJson(res, 400, { error: 'path is required' })
      return
    }
    if (!isServiceSource(path)) {
      sendJson(res, 422, { error: `no service checkout at ${path} (needs FORK.md + package.json)` })
      return
    }
    const write = deps.writeSource()
    if (write === undefined) {
      sendJson(res, 503, { error: 'no settings provider is mounted; set serviceSource in the hatch config' })
      return
    }
    await write(path)
  }
  const source = resolveServiceSource(deps.currentSource())
  const workspace = source.valid ? await deps.resolveWorkspace(source.path) : undefined
  sendJson(res, 200, {
    path: source.path,
    valid: source.valid,
    configured: deps.currentSource() !== undefined,
    workspaceId: workspace?.id ?? null,
  })
}
