/**
 * The embedded FreeLLMAPI sidecar: spawn the forked server on a private
 * loopback port with its own data directory, provision it hands-free over
 * loopback (first-run setup skips the setup code locally), and hand back the
 * unified /v1 key. The manager owns the child's lifetime: crash → respawn
 * with backoff, dispose → SIGTERM.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { dirname, join } from 'node:path'

/** How the embedded engine process is started. */
export interface SidecarOptions {
  /**
   * Absolute path to the server's JS entry: a fork checkout's
   * `dist/index.js` in dev, or the single-file `server.mjs` bundle the
   * desktop app ships.
   */
  entry: string
  /** Working directory for the child; defaults to the entry's directory. */
  cwd?: string
  /** Loopback port the sidecar binds. */
  port: number
  /** Data directory (DB + key file) owned by this deployment. */
  dataDir: string
  /** Where the child's lifecycle lines go. */
  log: (message: string) => void
}

/** What `provision()` hands back once the engine account exists. */
export interface ProvisionResult {
  /** The unified /v1 API key. */
  apiKey: string
  /** Present only when this call created the account (store it). */
  adminPassword?: string
}

/**
 * The page the sidecar's own port serves. The forked server always mounts its
 * dashboard's build directory and IDEalize does not ship that dashboard: it
 * proxies the engine's API through its own routes and renders its own status
 * page, so the build directory is absent and every request to this port used
 * to end in a bare 404 that said nothing about what the port was. This says
 * it.
 */
const PORT_PAGE = `<!doctype html>
<meta charset="utf-8">
<title>IDEalize free tokens</title>
<body style="font: 14px/1.6 system-ui, sans-serif; margin: 3rem auto; max-width: 34rem">
<h1 style="font-size: 1.1rem">IDEalize free tokens</h1>
<p>This port belongs to IDEalize's free-tokens engine, which serves an
OpenAI-compatible API to the app on this machine. It has no web interface of
its own.</p>
<p>Manage keys, routing and spend inside IDEalize, under Brains.</p>
</body>
`

/** Directory, inside the data directory, the child is pointed at for its static assets. */
const PORT_PAGE_DIR = 'port-page'

const HEALTH_TIMEOUT_MS = 30_000
const RESPAWN_DELAY_MS = 5_000
const MAX_FAST_FAILURES = 5

/** Owns the embedded engine child process: spawn, health wait, respawn on exit, and account provisioning. */
export class SidecarManager {
  private child: ChildProcess | undefined
  private disposed = false
  private fastFailures = 0

  constructor(private readonly options: SidecarOptions) {}

  /** The loopback origin the engine answers on. */
  get baseURL(): string {
    return `http://127.0.0.1:${this.options.port}`
  }

  /** Spawn the server and resolve once it answers on its port. */
  async start(): Promise<void> {
    const entry = this.options.entry
    if (!existsSync(entry)) {
      throw new Error(`freetokens sidecar: no server at ${entry}`)
    }
    mkdirSync(this.options.dataDir, { recursive: true })
    this.spawnChild(entry)
    const deadline = Date.now() + HEALTH_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (this.disposed) throw new Error('freetokens sidecar: disposed during startup')
      try {
        // Any HTTP answer proves the port is up; /api/auth/status is unauthenticated.
        const res = await fetch(`${this.baseURL}/api/auth/status`, { signal: AbortSignal.timeout(2_000) })
        if (res.status < 500) return
      } catch {
        // not up yet
      }
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    throw new Error(`freetokens sidecar: no answer on ${this.baseURL} after ${HEALTH_TIMEOUT_MS / 1000}s`)
  }

  private spawnChild(entry: string): void {
    const child = spawn(process.execPath, [entry], {
      cwd: this.options.cwd ?? dirname(entry),
      env: {
        ...process.env,
        PORT: String(this.options.port),
        HOST: '127.0.0.1',
        FREEAPI_DATA_DIR: this.options.dataDir,
        // The forked server mounts a static directory unconditionally and
        // defaults it to a dashboard build IDEalize does not ship; without
        // this the port answers every request with a bare 404.
        CLIENT_DIST: this.portPageDir(),
        // Inside the desktop app process.execPath is the Electron binary;
        // without this flag the child would open another GUI instance
        // instead of running the entry under Electron's bundled Node.
        ...process.versions.electron === undefined ? {} : { ELECTRON_RUN_AS_NODE: '1' },
      },
      stdio: 'ignore',
    })
    const startedAt = Date.now()
    child.on('exit', (code) => {
      if (this.disposed) return
      this.fastFailures = Date.now() - startedAt < 15_000 ? this.fastFailures + 1 : 0
      if (this.fastFailures >= MAX_FAST_FAILURES) {
        this.options.log(`freetokens sidecar: exited (code ${code}) ${MAX_FAST_FAILURES} times quickly; giving up`)
        return
      }
      this.options.log(`freetokens sidecar: exited (code ${code}); respawning in ${RESPAWN_DELAY_MS / 1000}s`)
      setTimeout(() => {
        if (!this.disposed) this.spawnChild(entry)
      }, RESPAWN_DELAY_MS).unref()
    })
    this.child = child
  }

  /**
   * Ensure an account and return the unified key. First run creates the
   * account (loopback skips the setup code) with a generated password the
   * caller must persist; later runs log in with the stored password.
   * @param storedPassword - the admin password persisted by an earlier run, undefined on first run.
   * @returns the unified key, plus `adminPassword` only when this call created the account.
   * @throws when setup is complete but the stored password does not log in, or the key cannot be read.
   */
  async provision(storedPassword: string | undefined): Promise<ProvisionResult> {
    const email = 'host@idealize.local'
    const status = await this.getJson('/api/auth/status') as { authenticated?: boolean; setupComplete?: boolean }
    let token: string | undefined
    let adminPassword: string | undefined

    if (storedPassword !== undefined) {
      const login = await this.postJson('/api/auth/login', { email, password: storedPassword })
      if (typeof login.token === 'string') token = login.token
    }
    if (token === undefined) {
      const generated = randomBytes(18).toString('base64url')
      const setup = await this.postJson('/api/auth/setup', { email, password: generated })
      if (typeof setup.token === 'string') {
        token = setup.token
        adminPassword = generated
      }
    }
    if (token === undefined) {
      throw new Error(
        'freetokens sidecar: setup is complete but the stored admin password does not work; '
        + `adopt manually on /idealize/freetokens (status: ${JSON.stringify(status)})`,
      )
    }

    const keyBody = await this.getJson('/api/settings/api-key', token) as { apiKey?: string }
    if (typeof keyBody.apiKey !== 'string' || keyBody.apiKey === '') {
      throw new Error('freetokens sidecar: provisioned session could not read the unified key')
    }
    return { apiKey: keyBody.apiKey, ...adminPassword === undefined ? {} : { adminPassword } }
  }

  /**
   * Ensure the directory the child serves as its static assets, holding one
   * page that says what this port is.
   * @returns the absolute directory path.
   */
  private portPageDir(): string {
    const dir = join(this.options.dataDir, PORT_PAGE_DIR)
    try {
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'index.html'), PORT_PAGE, 'utf8')
    } catch (error) {
      // An unwritable data directory is the child's problem to report on
      // startup, not this helper's: the path is still the right one to pass.
      this.options.log(`freetokens sidecar: could not write the port page (${error instanceof Error ? error.message : String(error)})`)
    }
    return dir
  }

  /** Terminate the child and stop respawning; safe to call more than once. */
  stop(): void {
    this.disposed = true
    this.child?.kill('SIGTERM')
    this.child = undefined
  }

  private async getJson(path: string, token?: string): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.baseURL}${path}`, {
      headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    })
    return await res.json() as Record<string, unknown>
  }

  private async postJson(path: string, body: unknown): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.baseURL}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    })
    return await res.json() as Record<string, unknown>
  }
}
