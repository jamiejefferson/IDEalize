/**
 * Proof run (not a vitest spec): boot the REAL assembled IDEalize app — the
 * whole `idealize` profile, so the frame, its columns and the composer are the
 * shipped ones — then drive it headlessly at the packaged window's 1280×840 in
 * both themes.
 *
 * What it proves, in order:
 *
 * 1. **A chat with no task list shows no column and loses no width.** The
 *    aside track is measured before the turn: it must be zero, and the centre
 *    column must be exactly as wide as it is with the column absent. This is
 *    the claim that lets the seat ship mounted in every chat.
 * 2. **A real `todo_write` fills it.** The scripted model calls the shipped
 *    tool through the real tool registry, so the list the column renders came
 *    out of the session log's `todo/write` and the `todos` projection, not a
 *    fixture handed to a component.
 * 3. **Each row carries its own status** — one completed, one in progress, the
 *    rest pending — read off the DOM, and the header counts the finished ones.
 * 4. **The column sits between the conversation and the tool rail**, measured:
 *    its left edge is right of the centre column's and its right edge is left
 *    of the rail's. "Left of the rail" is JJ's requirement, so it is measured
 *    rather than assumed from a CSS grid column number.
 * 5. **Folding it keeps the header and releases the rows**, and the centre
 *    column widens by what the fold released — the column is a real grid track,
 *    not an overlay.
 *
 * The model behind the turn is `@deepseek-ai/dsh-llm-mock-server` — a scripted
 * OpenAI-compatible server, so the run needs no provider key and the transcript
 * is reproducible; nothing about the loop, the tool execution or the projection
 * is stubbed.
 *
 * Isolation: the run refuses to start unless `DSH_HOME` and `HOME` both point
 * inside the temporary directory it made.
 *
 * Usage: OUT=.idealize/proof pnpm exec tsx packages/idealize/ui-tasks/proof/tasks-proof.mts
 */
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '../../../../apps/web/node_modules/playwright/index.mjs'
import type { Browser, Page } from '../../../../apps/web/node_modules/playwright/index.mjs'
import { startMockLlmServer } from '../../../test-support/llm-mock-server/src/index.ts'
import { assertSettled, openApp } from '../../../../.idealize/proof-settle.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..', '..')
const out = process.env.OUT ?? '.idealize/proof'
await mkdir(out, { recursive: true })

// ── Isolation, verified before anything is written ─────────────────────────
const root = await mkdtemp(join(tmpdir(), 'idealize-tasks-proof-'))
const home = join(root, 'home')
const dshHome = join(root, 'dsh-home')
const projectDir = join(root, 'project')
for (const dir of [home, dshHome, projectDir]) await mkdir(dir, { recursive: true })
await writeFile(join(projectDir, 'NOTES.md'), '# Notes\n\nThe task column proof reads this file.\n')

const env = {
  ...process.env,
  HOME: home,
  DSH_HOME: dshHome,
  XDG_CONFIG_HOME: join(home, '.config'),
  XDG_DATA_HOME: join(home, '.local', 'share'),
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
// The list the agent writes: one finished, one being worked on, three not
// started, so all three row treatments are on screen at once.
const TASKS = [
  { content: 'Read the project notes', status: 'completed' },
  { content: 'Fix the timesheet parser', status: 'in_progress' },
  { content: 'Create the missing apply script', status: 'pending' },
  { content: 'Test every fix', status: 'pending' },
  { content: 'Tag the cron jobs with owners', status: 'pending' },
]

// The script is consumed once per turn and the server has no rewind, so each
// theme gets a freshly started model on the SAME port: the host is booted once
// with that address, and a second theme must still meet a tool call rather
// than the reply the first theme's turn left the cursor on.
const mockPort = await freePort()

/** Start the scripted model on its fixed port. */
async function startMock() {
  const started = await startMockLlmServer({
    host: '127.0.0.1',
    port: mockPort,
    apiKey: 'mock-key',
    sequence: ['tool_call_success', 'success'],
    repeatLast: true,
    toolName: 'todo_write',
    toolArguments: JSON.stringify({ todos: TASKS }),
  })
  console.log(`mock model: ${started.baseURL} (seed ${String(started.randomSeed)})`)
  return started
}

let mock = await startMock()

const hostEnv = {
  ...env,
  DEEPSEEK_API_KEY: 'mock-key',
  DEEPSEEK_BASE_URL: `${mock.baseURL}/v1`,
}

/** Boot `dsh --profile idealize` and wait for its RPC channel to answer. */
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
      // is not the signal: wait until the `/api` RPC channel answers, which is
      // what `workspace.create` needs.
      const probe = await fetch(`http://127.0.0.1:${String(port)}/api/workspace.list`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: 'workspace.list', payload: {} }),
      })
      if (probe.ok) return child
    } catch {
      // Not listening yet; the loop is the wait.
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

console.log(`workspace.create: ${await rpc('workspace.create', { path: projectDir })}`)
const projectName = projectDir.split('/').pop() ?? projectDir

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

/** Open the project and launch a Chat brain through the welcome card. */
async function launchChat(page: Page): Promise<void> {
  if (await page.locator('[data-launcher-step]').count() === 0) {
    await page.getByText(projectName, { exact: true }).first().click({ timeout: 30_000 })
    await page.locator('[data-launcher-step]').waitFor({ timeout: 30_000 })
  }
  const brain = page.locator('[data-brain]')
  if (await brain.count() === 0) {
    // A click that lands while the card is still sliding in is swallowed.
    for (let attempt = 0; attempt < 5; attempt++) {
      await page.locator('[data-launcher-step="space"] [data-space="chat"]').click()
      const advanced = await page.locator('[data-launcher-step="brain"]').waitFor({ timeout: 5_000 })
        .then(() => true, () => false)
      if (advanced) break
      if (attempt === 4) {
        await page.screenshot({ path: join(out, 'debug-tasks-launch.png') })
        throw new Error('the Chat tile never advanced to the brain step')
      }
    }
  }
  await page.locator('[data-brain]').first().click()
  await page.waitForTimeout(2_000)
}

/** Send one prompt through the shipped composer and wait for the turn to settle. */
async function turn(page: Page, text: string): Promise<void> {
  const composer = page.locator('[data-composer-seat] textarea, textarea').first()
  await composer.waitFor({ timeout: 30_000 })
  await composer.click()
  await composer.fill(text)
  // The fork's Enter policy types a newline; submit is the Cmd/Ctrl+Enter
  // accelerator the composer documents.
  await page.keyboard.press('Meta+Enter')
  await page.waitForFunction(
    () => document.querySelectorAll('[data-running], [data-turn-running]').length === 0,
    undefined,
    { timeout: 90_000 },
  ).catch(() => undefined)
  await page.waitForTimeout(2_500)
}

/**
 * What the running app renders, read off the DOM: the column, its rows and
 * their statuses, and the geometry that decides whether it is really a column
 * between the conversation and the rail.
 */
async function observe(page: Page): Promise<Record<string, unknown>> {
  // No inner function may be bound to a const here: tsx compiles this module
  // through esbuild's keepNames, which wraps such a binding in a `__name`
  // helper that does not exist inside the page.
  return page.evaluate(() => {
    const column = document.querySelector('[data-idealize-tasks]')
    const columnBox = column?.getBoundingClientRect() ?? null
    // The frame's own tracks: the slot wrappers lay out as `display: contents`
    // and measure zero, so the aside track is read off the frame's child div.
    const asideTrack = [...document.querySelectorAll('div')]
      .find(node => node.className.includes('asideCol')) ?? null
    const railTrack = [...document.querySelectorAll('div')]
      .find(node => node.className.includes('railCol')) ?? null
    const centreTrack = [...document.querySelectorAll('div')]
      .find(node => node.className.includes('centerCol')) ?? null
    const rows = [...document.querySelectorAll('[data-task-status]')]
    return {
      present: column !== null,
      asideWidth: asideTrack === null ? null : Math.round(asideTrack.getBoundingClientRect().width),
      columnWidth: columnBox === null ? null : Math.round(columnBox.width),
      centreWidth: centreTrack === null ? null : Math.round(centreTrack.getBoundingClientRect().width),
      centreRight: centreTrack === null ? null : Math.round(centreTrack.getBoundingClientRect().right),
      railLeft: railTrack === null ? null : Math.round(railTrack.getBoundingClientRect().left),
      columnLeft: columnBox === null ? null : Math.round(columnBox.left),
      columnRight: columnBox === null ? null : Math.round(columnBox.right),
      statuses: rows.map(row => row.getAttribute('data-task-status')),
      contents: rows.map(row => (row.textContent ?? '').trim()),
      header: (column?.querySelector('button')?.textContent ?? '').trim(),
      overflows: column === null ? null : column.scrollWidth > column.clientWidth + 1,
    }
  })
}

/** Capture one frame with the settle guard in front of it. */
async function shoot(page: Page, file: string): Promise<Record<string, unknown>> {
  await assertSettled(page, file)
  await page.screenshot({ path: join(out, `${file}.png`) })
  const observed = await observe(page)
  console.log(`  ${file}: ${JSON.stringify(observed)}`)
  return observed
}

for (const theme of ['light', 'dark'] as const) {
  console.log(`\n── ${theme} ────────────────────────────────────────────────`)
  const context = await browser.newContext({
    viewport: { width: 1280, height: 840 },
    deviceScaleFactor: 2,
    locale: 'en-GB',
    colorScheme: theme,
  })
  const page = await context.newPage()
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(String(error)))

  await openApp(page, base, { ready: page.getByRole('button', { name: 'Brains', exact: true }) })
  await launchChat(page)

  // 1. Before the turn: no list, so no column and no width taken.
  const before = await shoot(page, `tasks-empty-${theme}`)
  expect(before.present === false, 'a chat with no task list renders no column')
  expect(before.asideWidth === 0, `the aside track is zero wide without a list (got ${String(before.asideWidth)})`)
  const centreWithout = before.centreWidth as number

  // 2. The real tool call fills it.
  await turn(page, 'Plan the work and write the task list.')
  const filled = await shoot(page, `tasks-column-${theme}`)
  expect(filled.present === true, 'the column renders once todo_write has run')
  expect((filled.statuses as string[]).length === TASKS.length,
    `every task the model wrote has a row (got ${String((filled.statuses as string[]).length)} of ${String(TASKS.length)})`)

  // 3. Each row carries its own status, and the header counts the finished.
  expect(JSON.stringify(filled.statuses) === JSON.stringify(TASKS.map(task => task.status)),
    `each row carries the status the model gave it (got ${JSON.stringify(filled.statuses)})`)
  expect((filled.header as string).includes('1/5'), `the header counts the finished tasks (got ${JSON.stringify(filled.header)})`)
  expect(filled.overflows === false, 'no task text overflows the column')

  // 4. It is a column between the conversation and the rail, measured. The
  // conversation gave up exactly the column's width, which is what makes this
  // a grid track rather than a panel floating over the chat.
  expect((filled.columnLeft as number) >= (filled.centreRight as number) - 1,
    `the column starts right of the conversation (column left ${String(filled.columnLeft)}, conversation right ${String(filled.centreRight)})`)
  expect(centreWithout - (filled.centreWidth as number) === (filled.columnWidth as number),
    `the conversation gave up exactly the column's width (${String(centreWithout)} → ${String(filled.centreWidth)}, column ${String(filled.columnWidth)})`)
  expect((filled.columnRight as number) <= (filled.railLeft as number) + 1,
    `the column ends left of the tool rail (column right ${String(filled.columnRight)}, rail left ${String(filled.railLeft)})`)

  // 5. Folding releases the rows and gives the width back to the conversation.
  await page.locator('[data-idealize-tasks] button').first().click()
  await page.waitForTimeout(600)
  const folded = await shoot(page, `tasks-folded-${theme}`)
  expect((folded.statuses as string[]).length === 0, 'folding releases every row')
  expect((folded.header as string).includes('1/5'), 'the folded header still counts the finished tasks')
  expect((folded.columnWidth as number) === (filled.columnWidth as number),
    'the fold keeps the column at one width, so the conversation does not jump')

  if (pageErrors.length > 0) {
    console.error(`  page errors: ${JSON.stringify(pageErrors)}`)
    failures.push(`page errors in ${theme}`)
  }
  await context.close()
  // Rewind the script for the next theme by replacing the server behind the
  // address the host already holds.
  await mock.close()
  mock = await startMock()
}

await teardown()
await rm(root, { recursive: true, force: true })

if (failures.length > 0) {
  console.error(`\n${String(failures.length)} expectation(s) failed:`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log(`\nwrote task column proofs to ${out}`)
