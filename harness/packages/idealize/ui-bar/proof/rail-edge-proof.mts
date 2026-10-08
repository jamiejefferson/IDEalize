/**
 * Proof run (not a vitest spec): boot the REAL assembled IDEalize app and read
 * the tool rail's screen position in every pane state. User feedback, 8 Oct
 * 2026: "Have the toolbar stuck to the right of the screen at all times, so
 * that when different levels of sidebars are open it's always in the same
 * place." The rail's left edge is measured with nothing open, the Files
 * drawer, the Notes document, both, and the sidebar closed, and each state is
 * photographed. Every reading must equal the window width minus the rail.
 *
 * Isolation as trajectory-rail-proof.mts: HOME and DSH_HOME inside a scratch
 * root, a scripted model, no provider key.
 *
 * Usage: OUT=.idealize/proof pnpm exec tsx packages/idealize/ui-bar/proof/rail-edge-proof.mts
 */
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
// Resolved from apps/web's devDependency: the proof borrows the web e2e browser.
import { chromium } from '../../../../apps/web/node_modules/playwright/index.mjs'
import type { Page } from '../../../../apps/web/node_modules/playwright/index.mjs'
import { startMockLlmServer } from '../../../test-support/llm-mock-server/src/index.ts'
import { assertSettled, settle, watchLaunch } from '../../../../.idealize/proof-settle.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..', '..')
const out = process.env.OUT ?? '.idealize/proof'
await mkdir(out, { recursive: true })

// ── Isolation, verified before anything is written ─────────────────────────
const root = await mkdtemp(join(tmpdir(), 'idealize-rail-edge-proof-'))
const home = join(root, 'home')
const dshHome = join(root, 'dsh-home')
const projectDir = join(root, 'project')
for (const dir of [home, dshHome, projectDir]) await mkdir(dir, { recursive: true })
// A file the scripted tool call reads, so the transcript carries a tool record
// with real arguments and a real result.
await writeFile(join(projectDir, 'NOTES.md'), '# Notes\n\nA file for the Files pane to list.\n')

const env = {
  ...process.env,
  HOME: home,
  DSH_HOME: dshHome,
  XDG_CONFIG_HOME: join(home, '.config'),
  XDG_DATA_HOME: join(home, '.local', 'share'),
  // The showcase would scrim the surfaces this run photographs.
  IDEALIZE_SKIP_TOUR: '1',
}
if (!env.DSH_HOME.startsWith(root) || !env.HOME.startsWith(root)) {
  throw new Error('refusing to run: DSH_HOME and HOME must both be inside the scratch root')
}
console.log(`isolated: HOME=${env.HOME}`)
console.log(`isolated: DSH_HOME=${env.DSH_HOME}`)

/** A port the OS has just confirmed is free. */
async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      server.close(() => { resolve(port) })
    })
  })
}

// ── The scripted model ─────────────────────────────────────────────────────
// Each turn takes two requests: a tool call, then the reply that closes the
// turn. The script alternates for as many turns as the run drives, and
// `repeatLast` keeps a retry or a title request answered rather than exhausting
// the script into a 500 the ledger would render as an error.
const TURNS = [
  'Read NOTES.md and tell me what it says.',
  'Read it again and quote the heading.',
  'Read it once more and count the lines.',
  'Read it and tell me the last word.',
  'Read it and tell me the first word.',
  'Read it and describe the format.',
  'Read it and list any links.',
  'Read it one final time and summarise.',
]
const TOOL_NAME = 'read'
const TOOL_ARGS = JSON.stringify({ file_path: join(projectDir, 'NOTES.md') })
const mock = await startMockLlmServer({
  host: '127.0.0.1',
  port: 0,
  apiKey: 'mock-key',
  sequence: TURNS.flatMap(() => ['tool_call_success', 'success'] as const),
  repeatLast: true,
  toolName: TOOL_NAME,
  toolArguments: TOOL_ARGS,
})
console.log(`mock model: ${mock.baseURL} (seed ${String(mock.randomSeed)})`)

const hostEnv = {
  ...env,
  DEEPSEEK_API_KEY: 'mock-key',
  DEEPSEEK_BASE_URL: `${mock.baseURL}/v1`,
}

/** Boot `dsh --profile idealize` and wait for an IDEalize route to answer. */
async function boot(port: number): Promise<ChildProcess> {
  const child = spawn(
    'node',
    ['--import', 'tsx/esm', 'apps/cli/src/bin.ts', '--profile', 'idealize', '--host', '127.0.0.1', '--port', String(port)],
    { cwd: repoRoot, env: hostEnv, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  child.stdout?.on('data', (chunk: Buffer) => { process.stdout.write(`  host| ${chunk.toString()}`) })
  child.stderr?.on('data', (chunk: Buffer) => { process.stderr.write(`  host! ${chunk.toString()}`) })
  const deadline = Date.now() + 180_000
  for (;;) {
    if (Date.now() > deadline) throw new Error('the host never started listening')
    try {
      // The static frontend answers any GET with the SPA shell, so "listening"
      // is not the signal: wait until an IDEalize ROUTE answers, which is the
      // moment its registration landed.
      const response = await fetch(`http://127.0.0.1:${String(port)}/idealize/spaces`)
      if (response.ok) {
        const body = await response.json() as { spaces?: unknown[] }
        if (Array.isArray(body.spaces)) return child
      }
    } catch {
      // Not listening, or the SPA shell is still the only answer; the loop is the wait.
    }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
}

/** Stop a booted host and wait for it to exit. */
async function stop(child: ChildProcess): Promise<void> {
  child.kill('SIGTERM')
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve() }, 10_000)
    child.once('exit', () => { clearTimeout(timer); resolve() })
  })
}

const port = await freePort()
const host = await boot(port)
const base = `http://127.0.0.1:${String(port)}`
console.log(`app: ${base}`)

/** One JSON-RPC call over the app's own HTTP surface; the raw reply is the log. */
async function rpc(method: string, payload: unknown): Promise<string> {
  const response = await fetch(new URL(`/api/${method}`, base), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method, payload }),
  })
  return `${String(response.status)} ${await response.text()}`
}
console.log(`workspace.create: ${await rpc('workspace.create', { path: projectDir })}`)

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1280, height: 840 }, deviceScaleFactor: 2, locale: 'en-GB' })
const page: Page = await context.newPage()
const errors: string[] = []
page.on('pageerror', (error) => { errors.push(String(error)) })
await watchLaunch(page)
await page.goto(base)
await settle(page, { ready: page.getByRole('button', { name: 'Brains', exact: true }) })
for (let attempt = 0; attempt < 8; attempt++) {
  if (await page.locator('[class*="scrim"]').count() === 0) break
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
}

const rail = page.locator('[class*="railCol"]')
const readings: Array<{ state: string; railLeft: number; railRight: number; drawer: number; deck: number }> = []
async function measure(state: string): Promise<void> {
  await page.waitForTimeout(900) // the tracks ease on the slow sider curve
  const box = await rail.boundingBox()
  const width = async (sel: string) => (await page.locator(sel).boundingBox())?.width ?? 0
  readings.push({
    state,
    railLeft: Math.round(box?.x ?? -1),
    railRight: Math.round((box?.x ?? 0) + (box?.width ?? 0)),
    drawer: Math.round(await width('[class*="drawerCol"]')),
    deck: Math.round(await width('[class*="deckCol"]')),
  })
  await page.screenshot({ path: join(out, `rail-edge-${state}.png`) })
}
const click = async (name: string) => { await page.getByRole('button', { name, exact: true }).first().click() }

await measure('1-nothing-open')
await click('Files'); await measure('2-files-drawer')
await click('Notes'); await measure('3-files-and-notes')
await click('Files'); await measure('4-notes-only')
await click('Notes'); await click('Brains'); await measure('5-brains-drawer')
await click('Brains')
const collapse = page.getByRole('button', { name: /collapse sidebar|close sidebar|hide sidebar/i }).first()
if (await collapse.count() > 0) { await collapse.click(); await click('Files'); await measure('6-sidebar-closed-files') }

console.log(JSON.stringify(readings, null, 2))
const lefts = new Set(readings.map(r => r.railLeft))
const pass = lefts.size === 1 && readings.every(r => r.railRight === 1280)
console.log(pass ? `PASS: rail left edge ${String([...lefts][0])} in all ${String(readings.length)} states, right edge on the window edge` : `FAIL: rail lefts ${JSON.stringify([...lefts])}`)
if (errors.length > 0) console.log(`page errors: ${errors.join(' | ')}`)
await browser.close()
await stop(host)
await mock.close()
process.exit(pass ? 0 : 1)
