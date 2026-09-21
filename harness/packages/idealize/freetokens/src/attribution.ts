/**
 * Project attribution for the spend meter: `ctx.idealizeAttribution` maps a
 * requesting session to an `x-idealize-project` header. The label is the
 * session cwd's git toplevel basename (the same project rule the vault
 * uses), the cwd basename outside a repo. The llm-pi-ai fork calls
 * `headersFor` per request through its annotateRequest seam; the forked
 * FreeLLMAPI server writes the header into `requests.client_label`, which
 * /api/analytics/by-label rolls up.
 */

import { execFile, execFileSync } from 'node:child_process'
import { basename } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'

declare module '@deepseek-ai/cordis' {
  interface Context {
    idealizeAttribution: IdealizeAttribution
  }
}

/** The request header carrying the project label the engine attributes spend to. */
export const PROJECT_HEADER = 'x-idealize-project'

/** Resolve one cwd's project label; never throws. */
function projectFor(cwd: string): string {
  try {
    const toplevel = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf8',
      timeout: 3_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (toplevel !== '') return basename(toplevel)
  } catch {
    // not a repo, or git unavailable — the directory name still names the work
  }
  return basename(cwd)
}

/**
 * {@link projectFor} without blocking the event loop: the same command, the
 * same timeout, the same fallback. Never rejects.
 */
function projectForAsync(cwd: string): Promise<string> {
  return new Promise((resolve) => {
    try {
      execFile('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', timeout: 3_000 }, (error, stdout) => {
        const toplevel = error === null ? stdout.trim() : ''
        resolve(toplevel === '' ? basename(cwd) : basename(toplevel))
      })
    } catch {
      // a spawn that throws outright is git unavailable, as in the sync path
      resolve(basename(cwd))
    }
  })
}

/** Maps a requesting session to its project attribution header. */
export class IdealizeAttribution extends Service {
  private readonly byCwd = new Map<string, string>()
  private readonly warming = new Map<string, Promise<void>>()

  constructor(ctx: Context) {
    super(ctx, 'idealizeAttribution')
    // Resolve a session's label as it enters the store (created or resumed),
    // off the event loop, so its first request reads the cache instead of
    // blocking on git. `headersFor` still resolves synchronously on a miss.
    ctx.on('session/created', (session) => { void this.warm(session.header.cwd) })
  }

  /**
   * Resolve one cwd's label asynchronously into the cache `headersFor` reads.
   * A label already cached, or one the sync path caches meanwhile, is kept.
   * @param cwd - The session cwd to resolve; empty or undefined is ignored.
   * @returns a promise settled once the label is cached; it never rejects.
   */
  warm(cwd: string | undefined): Promise<void> {
    if (cwd === undefined || cwd === '' || this.byCwd.has(cwd)) return Promise.resolve()
    const inflight = this.warming.get(cwd)
    if (inflight !== undefined) return inflight
    const pending = projectForAsync(cwd).then((project) => {
      this.warming.delete(cwd)
      if (!this.byCwd.has(cwd)) this.byCwd.set(cwd, project.slice(0, 128))
    })
    this.warming.set(cwd, pending)
    return pending
  }

  /**
   * Attribution headers for one request; undefined when nothing is known.
   * @param sessionId - The requesting session, when the request has one.
   * @returns the `x-idealize-project` header, or undefined without a session cwd.
   */
  headersFor(sessionId: string | undefined): Record<string, string> | undefined {
    if (sessionId === undefined) return undefined
    const sessions = this.ctx.get('sessions')
    const cwd = sessions?.get(sessionId as SessionId)?.header.cwd
    if (cwd === undefined || cwd === '') return undefined
    let label = this.byCwd.get(cwd)
    if (label === undefined) {
      label = projectFor(cwd).slice(0, 128)
      this.byCwd.set(cwd, label)
    }
    return label === '' ? undefined : { [PROJECT_HEADER]: label }
  }
}
