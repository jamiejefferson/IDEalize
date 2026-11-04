/**
 * The embedded FreeLLMAPI sidecar: spawn the forked server on a private
 * loopback port with its own data directory, provision it hands-free over
 * loopback (first-run setup skips the setup code locally), and hand back the
 * unified /v1 key. The manager owns the child's lifetime: crash → respawn
 * with backoff, dispose → SIGTERM, app gone → the child exits by itself when
 * the pipe to it closes.
 *
 * Whatever already holds the port is identified before anything is sent to
 * it: the same engine on the same data is adopted, an older one on this data
 * is replaced, and any other program is left alone and never logged in to.
 * On Windows none of this runs; the child starts as it always has, because
 * none of it has been proved there.
 */

import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { basename, dirname, join } from 'node:path'

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

/**
 * Loaded into the engine before its own code. The engine is a fork kept
 * outside this repository, and this covers the build already on people's
 * machines too.
 *
 * - The pipe from the app closes however the app ends, a crash included, so
 *   the engine goes with it. SIGTERM takes the same path as a clean quit.
 * - A web page can reach a loopback port by pointing its own domain at
 *   127.0.0.1; the Host header is what gives that away.
 */
const ENGINE_GUARD = `
import http from 'node:http'
const appGone = () => {
  process.kill(process.pid, 'SIGTERM')
  setTimeout(() => process.exit(0), 3000).unref()
}
for (const event of ['end', 'close', 'error']) process.stdin.on(event, appGone)
process.stdin.resume()
const loopback = /^(127\\.0\\.0\\.1|localhost|\\[::1\\])(:\\d+)?$/i
const emit = http.Server.prototype.emit
http.Server.prototype.emit = function (event, req, out, ...rest) {
  if ((event === 'request' || event === 'upgrade') && !loopback.test(req.headers.host ?? '')) {
    if (event === 'request') { out.statusCode = 403; out.end('loopback only') } else out.destroy()
    return true
  }
  return emit.call(this, event, req, out, ...rest)
}
`

/** File, inside the data directory, naming the engine this data directory last started. */
const ENGINE_RECORD = 'engine.json'

const HEALTH_TIMEOUT_MS = 30_000
const RESPAWN_DELAY_MS = 5_000
const MAX_FAST_FAILURES = 5
/** How long an old engine gets to let go of the port after SIGTERM, then after SIGKILL. */
const STOP_WAIT_MS = 5_000
/** How often an adopted engine is checked; it has no exit event to listen to. */
const ADOPTED_WATCH_MS = 10_000

const LSOF = process.platform === 'darwin' ? '/usr/sbin/lsof' : 'lsof'

/** Run a system tool. @returns its output, or undefined when it failed or is absent. */
function tool(command: string, args: readonly string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(command, [...args], { timeout: 3_000 }, (error, stdout) => {
      resolve(error === null ? stdout : undefined)
    })
  })
}

/** Owns the embedded engine child process: spawn, health wait, respawn on exit, and account provisioning. */
export class SidecarManager {
  private child: ChildProcess | undefined
  private disposed = false
  private fastFailures = 0
  private adoptedWatch: ReturnType<typeof setInterval> | undefined

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
    mkdirSync(this.options.dataDir, { recursive: true, mode: 0o700 })
    if (await this.adoptOrClearPort()) return
    this.spawnChild(entry)
    const deadline = Date.now() + HEALTH_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (this.disposed) throw new Error('freetokens sidecar: disposed during startup')
      if (await this.answers()) {
        // An answer proves only that something is on the port.
        const pid = this.child?.pid
        const holders = process.platform === 'win32' ? undefined : await this.portHolders()
        if (holders === undefined || pid === undefined || holders.includes(pid)) return
      }
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    throw new Error(`freetokens sidecar: no answer on ${this.baseURL} after ${HEALTH_TIMEOUT_MS / 1000}s`)
  }

  /** Whether anything answers on the port; /api/auth/status is unauthenticated. */
  private async answers(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseURL}/api/auth/status`, { signal: AbortSignal.timeout(2_000) })
      return res.status < 500
    } catch {
      return false
    }
  }

  /**
   * Decide what to do about whatever holds the port. Before this, any answer
   * on the port passed the health check: after an update, chats kept going
   * through the old engine; next to another install, the app tried to log in
   * to that install's engine with this one's password.
   * @returns true when a running engine was adopted and nothing should be spawned.
   * @throws when the port belongs to something that is not this data's engine.
   */
  private async adoptOrClearPort(): Promise<boolean> {
    if (process.platform === 'win32') return false
    const holders = await this.portHolders()
    const pid = holders?.[0]
    if (pid === undefined) return false
    const record = this.readRecord()
    if (record?.pid === pid) {
      if (record.fingerprint === this.engineFingerprint() && await this.answers()) {
        this.options.log(`freetokens sidecar: adopted the running engine (pid ${String(pid)}), same version on this data`)
        this.watchAdopted()
        return true
      }
      this.options.log(`freetokens sidecar: replacing the engine left running by another version (pid ${String(pid)})`)
      await this.stopProcess(pid)
      return false
    }
    if (await this.isOrphanOfThisData(pid)) {
      this.options.log(`freetokens sidecar: replacing an engine left behind by a crash (pid ${String(pid)})`)
      await this.stopProcess(pid)
      return false
    }
    throw new Error(`freetokens sidecar: port ${String(this.options.port)} is held by another program (pid ${String(pid)}), which was left alone`)
  }

  /** The processes listening on the engine's port; undefined when that cannot be told. */
  private async portHolders(): Promise<number[] | undefined> {
    // lsof exits 1 for "none", which looks the same here as failing to run, so
    // its absence is checked first. A packaged app's PATH does not reach /usr/sbin.
    if (LSOF.startsWith('/') && !existsSync(LSOF)) return undefined
    const output = await tool(LSOF, ['-nP', `-iTCP:${String(this.options.port)}`, '-sTCP:LISTEN', '-t'])
    return (output ?? '').split('\n').map(Number).filter(pid => pid > 0)
  }

  /**
   * Whether a process with no record is an engine from before records existed,
   * orphaned on this data: its parent is gone, it runs the engine's file, and
   * it holds this data directory open. Anything short of all three is someone
   * else's, such as a second install's engine, whose parent is still alive.
   */
  private async isOrphanOfThisData(pid: number): Promise<boolean> {
    const info = await tool('/bin/ps', ['-o', 'ppid=,command=', '-p', String(pid)])
    const match = info?.trim().match(/^(\d+)\s+(.*)$/su)
    if (match?.[1] !== '1' || !(match[2] ?? '').includes(basename(this.options.entry))) return false
    const files = await tool(LSOF, ['-nP', '-p', String(pid), '-Fn'])
    const dataDir = realpathSync(this.options.dataDir)
    return (files ?? '').split('\n').some(line => line === `n${dataDir}` || line.startsWith(`n${dataDir}/`))
  }

  /** SIGTERM, then SIGKILL, waiting for the port to come free after each. */
  private async stopProcess(pid: number): Promise<void> {
    for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
      try {
        process.kill(pid, signal)
      } catch {
        // Already gone.
      }
      const deadline = Date.now() + STOP_WAIT_MS
      while (Date.now() < deadline) {
        if ((await this.portHolders())?.includes(pid) !== true) return
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }
    throw new Error(`freetokens sidecar: the old engine (pid ${String(pid)}) would not stop`)
  }

  /** An adopted engine has no exit event, so its going away is noticed by asking. */
  private watchAdopted(): void {
    this.adoptedWatch = setInterval(() => {
      void this.answers().then((up) => {
        if (up || this.disposed || this.adoptedWatch === undefined) return
        clearInterval(this.adoptedWatch)
        this.adoptedWatch = undefined
        this.options.log('freetokens sidecar: the adopted engine stopped; starting a new one')
        this.spawnChild(this.options.entry)
      })
    }, ADOPTED_WATCH_MS)
    this.adoptedWatch.unref()
  }

  /** What identifies this version of the engine: the hash of the file it runs. */
  private engineFingerprint(): string {
    return createHash('sha256').update(readFileSync(this.options.entry)).digest('hex')
  }

  private readRecord(): { pid?: unknown; fingerprint?: unknown } | undefined {
    try {
      return JSON.parse(readFileSync(join(this.options.dataDir, ENGINE_RECORD), 'utf8')) as { pid?: unknown; fingerprint?: unknown }
    } catch {
      return undefined
    }
  }

  private spawnChild(entry: string): void {
    const guarded = process.platform !== 'win32'
    const child = spawn(process.execPath, guarded ? ['--import', `data:text/javascript,${encodeURIComponent(ENGINE_GUARD)}`, entry] : [entry], {
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
      stdio: guarded ? ['pipe', 'ignore', 'ignore'] : 'ignore',
    })
    child.stdin?.on('error', () => {})
    if (guarded && child.pid !== undefined) {
      writeFileSync(
        join(this.options.dataDir, ENGINE_RECORD),
        JSON.stringify({ pid: child.pid, fingerprint: this.engineFingerprint() }),
        { encoding: 'utf8', mode: 0o600 },
      )
    }
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
    // An adopted engine is not ours to stop: it follows its own app's pipe.
    if (this.adoptedWatch !== undefined) clearInterval(this.adoptedWatch)
    this.adoptedWatch = undefined
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
