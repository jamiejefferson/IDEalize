/**
 * The engine's lifetime and identity, against real processes on a real port.
 * The port is never 3213: that is the port of whatever engine this machine is
 * running for real.
 */
import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SidecarManager } from '../src/sidecar.ts'

const FAKE_ENGINE = `
import { createServer } from 'node:http'
import { openSync } from 'node:fs'
import { join } from 'node:path'
// Holds its data open the way the real engine holds its database.
openSync(join(process.env.FREEAPI_DATA_DIR, 'fake.db'), 'a')
createServer((req, res) => {
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify({ pid: process.pid, marker: 'MARKER', host: req.headers.host }))
}).listen(Number(process.env.PORT), process.env.HOST)
`

const scratch: string[] = []
const pids = new Set<number>()
const managers: SidecarManager[] = []

afterEach(() => {
  for (const manager of managers.splice(0)) manager.stop()
  for (const pid of pids) {
    try { process.kill(pid, 'SIGKILL') } catch { /* already gone */ }
  }
  pids.clear()
  for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true })
})

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const { port } = server.address() as { port: number }
  await new Promise((resolve) => { server.close(resolve) })
  return port
}

interface Scene { root: string; dataDir: string; entry: string; port: number }

async function scene(marker = 'one'): Promise<Scene> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'freetokens-engine-')))
  scratch.push(root)
  const dataDir = join(root, 'data')
  mkdirSync(dataDir)
  const entry = join(root, 'server.mjs')
  writeFileSync(entry, FAKE_ENGINE.replace('MARKER', marker))
  return { root, dataDir, entry, port: await freePort() }
}

function managerFor(s: Scene, log: string[] = []): SidecarManager {
  const manager = new SidecarManager({ entry: s.entry, cwd: s.dataDir, port: s.port, dataDir: s.dataDir, log: line => log.push(line) })
  managers.push(manager)
  return manager
}

const url = (s: Scene): string => `http://127.0.0.1:${String(s.port)}/api/auth/status`
const engine = async (s: Scene): Promise<{ pid: number; marker: string }> => {
  const body = await (await fetch(url(s))).json() as { pid: number; marker: string }
  pids.add(body.pid)
  return body
}

/** fetch will not let a caller set Host, so this goes through node:http. */
async function askWithHost(port: number, host: string): Promise<number> {
  const { request } = await import('node:http')
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: '/api/auth/status', headers: { host } }, (res) => {
      res.resume()
      resolve(res.statusCode ?? 0)
    })
    req.on('error', reject)
    req.end()
  })
}

const alive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true } catch { return false }
}

async function until(check: () => boolean | Promise<boolean>, ms = 10_000): Promise<void> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('condition not met in time')
}

/** Start a process that listens like an engine and outlives the process that started it. */
async function orphanEngine(s: Scene): Promise<number> {
  const env = { ...process.env, PORT: String(s.port), HOST: '127.0.0.1', FREEAPI_DATA_DIR: s.dataDir }
  const starter = spawn(process.execPath, ['-e', `
    const { spawn } = require('node:child_process')
    const child = spawn(process.execPath, [${JSON.stringify(s.entry)}], { detached: true, stdio: 'ignore' })
    child.unref()
    process.exit(0)
  `], { env, stdio: 'ignore' })
  await new Promise(resolve => starter.once('exit', resolve))
  await until(async () => (await fetch(url(s)).then(() => true, () => false)))
  const { pid } = await engine(s)
  await until(() => execFileSync('/bin/ps', ['-o', 'ppid=', '-p', String(pid)]).toString().trim() === '1')
  return pid
}

describe.skipIf(process.platform === 'win32')('the free-tokens engine process', () => {
  it('starts, and exits when the app that started it is killed outright', async () => {
    // The replay: a crash, not a clean quit. A real parent is killed with
    // SIGKILL and the engine has nobody left to stop it.
    const s = await scene()
    const script = join(s.root, 'parent.mts')
    writeFileSync(script, `
      import { SidecarManager } from ${JSON.stringify(new URL('../src/sidecar.ts', import.meta.url).pathname)}
      const manager = new SidecarManager({ entry: ${JSON.stringify(s.entry)}, cwd: ${JSON.stringify(s.dataDir)}, port: ${String(s.port)}, dataDir: ${JSON.stringify(s.dataDir)}, log: () => {} })
      await manager.start()
      process.stdout.write('started\\n')
      setInterval(() => {}, 1000)
    `)
    const parent: ChildProcess = spawn(process.execPath, ['--import', 'tsx/esm', script], {
      cwd: new URL('..', import.meta.url).pathname,
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    await new Promise<void>((resolve) => { parent.stdout!.once('data', () => { resolve() }) })
    const { pid } = await engine(s)
    expect(alive(pid)).toBe(true)
    parent.kill('SIGKILL')
    await until(() => !alive(pid))
    await expect(fetch(url(s))).rejects.toThrow()
  }, 40_000)

  it('refuses a request whose Host is not this machine, and answers one that is', async () => {
    const s = await scene()
    await managerFor(s).start()
    await engine(s)
    expect(await askWithHost(s.port, `127.0.0.1:${String(s.port)}`)).toBe(200)
    expect(await askWithHost(s.port, `localhost:${String(s.port)}`)).toBe(200)
    // DNS rebinding: an outside domain pointed at 127.0.0.1.
    expect(await askWithHost(s.port, `evil.example.com:${String(s.port)}`)).toBe(403)
    expect(await askWithHost(s.port, '127.0.0.1.evil.example.com')).toBe(403)
  }, 40_000)

  it('adopts an engine of the same version on the same data', async () => {
    const s = await scene()
    await managerFor(s).start()
    const first = await engine(s)

    const log: string[] = []
    await managerFor(s, log).start()
    expect((await engine(s)).pid).toBe(first.pid)
    expect(log.join('\n')).toMatch(/adopted/)
  }, 40_000)

  it('replaces an engine of another version on the same data', async () => {
    const s = await scene('old-version')
    await managerFor(s).start()
    const old = await engine(s)
    expect(old.marker).toBe('old-version')

    writeFileSync(s.entry, FAKE_ENGINE.replace('MARKER', 'new-version'))
    const log: string[] = []
    await managerFor(s, log).start()
    const current = await engine(s)
    expect(current.marker).toBe('new-version')
    expect(current.pid).not.toBe(old.pid)
    await until(() => !alive(old.pid))
    expect(log.join('\n')).toMatch(/another version/)
  }, 40_000)

  it('replaces an orphan left by a build from before the record existed', async () => {
    const s = await scene('orphan')
    const orphan = await orphanEngine(s)
    expect(existsSync(join(s.dataDir, 'engine.json'))).toBe(false)

    writeFileSync(s.entry, FAKE_ENGINE.replace('MARKER', 'fresh'))
    await managerFor(s).start()
    const current = await engine(s)
    expect(current.marker).toBe('fresh')
    await until(() => !alive(orphan))
  }, 40_000)

  it('leaves another program on the port alone, and does not take its answer for the engine', async () => {
    const s = await scene()
    const other = spawn(process.execPath, [join(s.root, 'server.mjs')], {
      env: { ...process.env, PORT: String(s.port), HOST: '127.0.0.1', FREEAPI_DATA_DIR: mkdtempSync(join(s.root, 'elsewhere-')) },
      stdio: 'ignore',
    })
    pids.add(other.pid!)
    await until(async () => (await fetch(url(s)).then(() => true, () => false)))

    await expect(managerFor(s).start()).rejects.toThrow(/held by another program/)
    expect(alive(other.pid!)).toBe(true)
  }, 40_000)

  it('leaves a second install of the app alone: its engine has a living parent on other data', async () => {
    const s = await scene()
    await managerFor(s).start()
    const theirs = await engine(s)

    const blank = { ...s, dataDir: join(s.root, 'blank-data') }
    mkdirSync(blank.dataDir)
    await expect(managerFor(blank).start()).rejects.toThrow(/held by another program/)
    expect(alive(theirs.pid)).toBe(true)
  }, 40_000)

  it('writes the record readable by the owner alone, naming the running engine', async () => {
    const s = await scene()
    await managerFor(s).start()
    const { pid } = await engine(s)
    const path = join(s.dataDir, 'engine.json')
    expect(statSync(path).mode & 0o077).toBe(0)
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
      pid,
      fingerprint: createHash('sha256').update(readFileSync(s.entry)).digest('hex'),
    })
  }, 40_000)
})
