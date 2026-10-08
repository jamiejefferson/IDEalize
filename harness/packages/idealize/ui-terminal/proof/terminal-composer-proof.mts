/**
 * Proof run (not a vitest spec): boot the REAL assembled IDEalize app and
 * check the rule that retires the composer under the terminal once a Terminal
 * chat holds turns of its own (JJ, 8 Oct 2026: an agent note woke the chat's
 * own agent behind the terminal, and the composer and its stats came back).
 *
 * A plain browser serves no embedded terminal, so the run starts a Chat chat,
 * marks its root `data-phase="active"` (the non-blank state the woken chat
 * reached), then sets the session header's `data-view` to `terminal`, which is what
 * ui-conversation writes when the Terminal view is active. It reads the
 * composer seat's computed display with the view on `terminal` and back on
 * `chat`, so the shipped stylesheet decides both answers.
 *
 * Isolation: the run refuses to start unless `DSH_HOME` and `HOME` both point
 * inside the temporary directory it made.
 *
 * The app serves the built `lib/client.js`: rebuild before running.
 *
 * Usage: OUT=.idealize/proof pnpm exec tsx packages/idealize/ui-terminal/proof/terminal-composer-proof.mts
 */
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
// Resolved from apps/web's devDependency: the proof borrows the web e2e browser.
import { chromium } from '../../../../apps/web/node_modules/playwright/index.mjs'
import type { Browser, Page } from '../../../../apps/web/node_modules/playwright/index.mjs'
import { startMockLlmServer } from '../../../test-support/llm-mock-server/src/index.ts'
import { assertSettled, openApp, settle } from '../../../../.idealize/proof-settle.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..', '..')
const out = process.env.OUT ?? '.idealize/proof'
await mkdir(out, { recursive: true })

// ── Isolation, verified before anything is written ─────────────────────────
const root = await mkdtemp(join(tmpdir(), 'idealize-terminal-composer-'))
const home = join(root, 'home')
const dshHome = join(root, 'dsh-home')
const projectDir = join(root, 'project')
for (const dir of [home, dshHome, projectDir]) await mkdir(dir, { recursive: true })
await writeFile(join(projectDir, 'NOTES.md'), '# Notes\n\nThe terminal-composer proof reads this file.\n')

const env = {
  ...process.env,
  HOME: home,
  DSH_HOME: dshHome,
  XDG_CONFIG_HOME: join(home, '.config'),
  XDG_DATA_HOME: join(home, '.local', 'share'),
  // The tour would cover the surfaces this run photographs.
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
// One turn per chat is enough: a tool call, then the reply that closes it.
// `repeatLast` keeps a retry or a title request answered rather than exhausting
// the script into a 500.
const mock = await startMockLlmServer({
  host: '127.0.0.1',
  port: 0,
  apiKey: 'mock-key',
  sequence: ['tool_call_success', 'success'],
  repeatLast: true,
  toolName: 'read',
  toolArguments: JSON.stringify({ file_path: join(projectDir, 'NOTES.md') }),
})
console.log(`mock model: ${mock.baseURL} (seed ${String(mock.randomSeed)})`)

const hostEnv = {
  ...env,
  DEEPSEEK_API_KEY: 'mock-key',
  DEEPSEEK_BASE_URL: `${mock.baseURL}/v1`,
}

/** Boot `dsh --profile idealize` and wait for the spaces roster and the RPC channel to answer. */
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
      // is not the signal: wait until the spaces ROUTE answers with its roster,
      // and until the `/api` RPC channel answers, which lands about a second
      // later and is what `workspace.create` needs.
      const response = await fetch(`http://127.0.0.1:${String(port)}/idealize/spaces`)
      if (response.ok && Array.isArray((await response.json() as { spaces?: unknown }).spaces)) {
        const probe = await fetch(`http://127.0.0.1:${String(port)}/api/workspace.list`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: 'workspace.list', payload: {} }),
        })
        if (probe.ok) return child
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
  const reply = `${String(response.status)} ${await response.text()}`
  if (!response.ok) throw new Error(`${method} failed: ${reply}`)
  return reply
}

// The project the run works inside, registered before the first render: the
// welcome card only asks its questions inside a project.
console.log(`workspace.create: ${await rpc('workspace.create', { path: projectDir })}`)
const projectName = projectDir.split('/').pop() ?? projectDir
console.log(`project: ${projectDir}`)
console.log(`roster: ${await (await fetch(`${base}/idealize/spaces`)).text()}`)

const browser: Browser = await chromium.launch()

/** Release the browser, the host and the scripted model whatever the outcome. */
async function teardown(): Promise<void> {
  await browser.close().catch(() => undefined)
  await stop(host).catch(() => undefined)
  await mock.close().catch(() => undefined)
}
process.on('uncaughtException', (error) => {
  console.error(error)
  void teardown().then(() => { process.exit(1) })
})
process.on('unhandledRejection', (reason) => {
  console.error(reason)
  void teardown().then(() => { process.exit(1) })
})

const failures: string[] = []
/** Record a failed expectation without abandoning the remaining screenshots. */
function expect(ok: boolean, what: string): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${what}`)
  if (!ok) failures.push(what)
}

const READY = (page: Page) => page.getByRole('button', { name: 'Brains', exact: true })

/**
 * Bring the welcome card's space step on screen. With a chat open, the
 * sidebar's New-chat control opens a blank one, which is the card; with none
 * open yet (the first render), the project tile on the empty hero is the way in.
 */
async function newChat(page: Page): Promise<void> {
  const step = page.locator('[data-launcher-step="space"]')
  if (await step.count() > 0 && await step.first().isVisible()) return
  const newChatButton = page.getByRole('button', { name: 'New chat', exact: true })
  if (await newChatButton.count() > 0) {
    await newChatButton.first().click()
  }
  if (await step.count() === 0 && await page.getByText(projectName, { exact: true }).count() > 0) {
    await page.getByText(projectName, { exact: true }).first().click({ timeout: 30_000 })
  }
  await step.waitFor({ timeout: 30_000 })
  await page.waitForTimeout(300)
}

/** Launch a chat into one space through the welcome card's two steps. */
async function launch(page: Page, space: string): Promise<void> {
  await newChat(page)
  // The tile is retried: a click that lands while the card is still sliding
  // in is swallowed, and the step stays on screen.
  for (let attempt = 0; attempt < 5; attempt++) {
    await page.locator(`[data-launcher-step="space"] [data-space="${space}"]`).click()
    const advanced = await page.locator('[data-launcher-step="brain"]').waitFor({ timeout: 5_000 })
      .then(() => true, () => false)
    if (advanced) break
    if (attempt === 4) {
      await page.screenshot({ path: join(out, 'debug-launch.png') })
      throw new Error(`the ${space} tile never advanced to the brain step`)
    }
  }
  await page.locator('[data-brain]').first().click()
  await page.waitForTimeout(2_500)
}


/** The composer seat's computed display and the header's view, read off the DOM. */
async function seat(page: Page): Promise<{ view: string | null; display: string | null }> {
  return page.evaluate(() => {
    const header = document.querySelector('[data-idealize-surface="chat"] header')
    const element = document.querySelector('[data-composer-seat]')
    return {
      view: header?.getAttribute('data-view') ?? null,
      display: element === null ? null : getComputedStyle(element).display,
    }
  })
}

/** Point the session header at one view, as ui-conversation does when the ring switches. */
async function setView(page: Page, view: string): Promise<void> {
  await page.evaluate((id) => {
    document.querySelector('[data-idealize-surface="chat"] header')?.setAttribute('data-view', id)
  }, view)
  await page.waitForTimeout(200)
}

const context = await browser.newContext({ viewport: { width: 1280, height: 840 }, deviceScaleFactor: 2, locale: 'en-GB' })
const page = await context.newPage()
await openApp(page, base, { ready: READY(page) })
await launch(page, 'chat')
// The scripted model is not routed in this profile, so the started state is
// set on the root as ui-conversation sets it once a turn lands.
await page.evaluate(() => { document.querySelector('[data-idealize-surface="chat"]')?.setAttribute('data-phase', 'active') })

const before = await seat(page)
console.log(`chat view: ${JSON.stringify(before)}`)
expect(before.view === 'chat' && before.display !== 'none', 'a started chat on the Chat view keeps its composer')

await setView(page, 'terminal')
const terminal = await seat(page)
console.log(`terminal view: ${JSON.stringify(terminal)}`)
expect(terminal.display === 'none', 'a started chat on the Terminal view retires its composer and stats')
await page.screenshot({ path: join(out, 'terminal-composer-terminal.png') })

await setView(page, 'chat')
const back = await seat(page)
console.log(`back on chat: ${JSON.stringify(back)}`)
expect(back.display !== 'none', 'switching back to the Chat view brings the composer back')
await page.screenshot({ path: join(out, 'terminal-composer-chat.png') })

await assertSettled(page, 'terminal-composer').catch((error: unknown) => { failures.push(`settle: ${String(error)}`) })
await teardown()
if (failures.length > 0) {
  console.error(`\n${String(failures.length)} failure(s):\n${failures.map(line => `  - ${line}`).join('\n')}`)
  process.exit(1)
}
console.log('\nall checks passed')
process.exit(0)
