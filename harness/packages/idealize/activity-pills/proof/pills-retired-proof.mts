/**
 * Proof run (not a vitest spec): boot the REAL assembled IDEalize app — the
 * whole `idealize` profile, so the welcome card, the composer and its docks are
 * the shipped ones — and drive it headlessly at the packaged window's 1280×840
 * in both themes.
 *
 * What it proves, per theme, on a started Chat chat:
 *
 * 1. **No pill row above the composer.** The `conversation.input.dock` outlet
 *    is read off the DOM: every direct occupant is listed with its tag and
 *    data attributes, and none may be the retired activity pill row; every
 *    `[data-activity-pills]` and `[data-activity]` node on the page is counted
 *    and the count must be zero. The composer itself is on screen, so the zero
 *    means "a composer without the row", not "no composer".
 * 2. **The brain switcher is in its place.** `[data-brain-switcher]` renders on
 *    the composer's model seat, its `data-brain-current` is the brain the chat
 *    launched on, and its label names that brain.
 *
 * The same run writes `mode-provider-boundary-report.txt` into OUT: the report
 * line of `pnpm run verify-mode-provider-boundary`, which names the mode
 * packages the gate still polices after the documentation sweep. A gate whose
 * discovery found no mode packages would pass every rule vacuously; the line
 * is the evidence it did not.
 *
 * The model behind the real turn is `@deepseek-ai/dsh-llm-mock-server`, a
 * scripted OpenAI-compatible server, so the run needs no provider key.
 *
 * Isolation: the run refuses to start unless `DSH_HOME` and `HOME` both point
 * inside the temporary directory it made. The user's real harness home is
 * never opened.
 *
 * The app serves the built `lib/client.js`: rebuild before running.
 *
 * Usage: OUT=.idealize/proof pnpm exec tsx packages/idealize/activity-pills/proof/pills-retired-proof.mts
 */
import { spawn, spawnSync } from 'node:child_process'
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
import { assertSettled, openApp } from '../../../../.idealize/proof-settle.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..', '..')
const out = process.env.OUT ?? '.idealize/proof'
await mkdir(out, { recursive: true })

// ── The gate's own report line, captured before anything boots ─────────────
const boundary = spawnSync('pnpm', ['run', '--silent', 'verify-mode-provider-boundary'], { cwd: repoRoot, encoding: 'utf8' })
const reportLine = boundary.stdout.split('\n').find(line => line.startsWith('verify-mode-provider-boundary:')) ?? ''
if (boundary.status !== 0 || reportLine === '') {
  throw new Error(`verify-mode-provider-boundary did not report: exit ${String(boundary.status)}\n${boundary.stdout}\n${boundary.stderr}`)
}
await writeFile(join(out, 'mode-provider-boundary-report.txt'), `${reportLine}\n`)
console.log(reportLine)
const modeCount = Number(/^verify-mode-provider-boundary: (\d+) mode packages/.exec(reportLine)?.[1] ?? '0')

// ── Isolation, verified before anything is written ─────────────────────────
const root = await mkdtemp(join(tmpdir(), 'idealize-pills-retired-'))
const home = join(root, 'home')
const dshHome = join(root, 'dsh-home')
const projectDir = join(root, 'project')
for (const dir of [home, dshHome, projectDir]) await mkdir(dir, { recursive: true })
await writeFile(join(projectDir, 'NOTES.md'), '# Notes\n\nThe pills-retired proof reads this file.\n')

const env = {
  ...process.env,
  HOME: home,
  DSH_HOME: dshHome,
  XDG_CONFIG_HOME: join(home, '.config'),
  XDG_DATA_HOME: join(home, '.local', 'share'),
  // The tour would cover the composer this run photographs.
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
      // is not the signal: wait until the spaces route answers with its roster
      // and the `/api` RPC channel answers, which `workspace.create` needs.
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

// The five activity brains are seeded into the user preset root on first boot,
// asynchronously; the roster answers before that lands.
interface RosterSpace { id: string; brainCount: number; brains: { id: string; name: string }[] }
async function roster(): Promise<RosterSpace[]> {
  return (await (await fetch(`${base}/idealize/spaces`)).json() as { spaces: RosterSpace[] }).spaces
}
for (let attempt = 0; attempt < 60; attempt += 1) {
  if ((( await roster()).find(space => space.id === 'chat')?.brainCount ?? 0) > 0) break
  await new Promise(resolve => setTimeout(resolve, 1_000))
}
const chatBrains = (await roster()).find(space => space.id === 'chat')?.brains ?? []
console.log(`chat brains: ${JSON.stringify(chatBrains)}`)
if (chatBrains.length === 0) throw new Error('the roster serves no Chat brains; nothing to launch on')

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

expect(modeCount > 0, `verify-mode-provider-boundary still polices mode packages (${String(modeCount)})`)

const READY = (page: Page) => page.getByRole('button', { name: 'Brains', exact: true })

/** Bring the welcome card's space step on screen (the project tile on the empty hero is the way in). */
async function newChat(page: Page): Promise<void> {
  const step = page.locator('[data-launcher-step="space"]')
  if (await step.count() > 0 && await step.first().isVisible()) return
  const newChatButton = page.getByRole('button', { name: 'New chat', exact: true })
  if (await newChatButton.count() > 0) await newChatButton.first().click()
  if (await step.count() === 0 && await page.getByText(projectName, { exact: true }).count() > 0) {
    await page.getByText(projectName, { exact: true }).first().click({ timeout: 30_000 })
  }
  await step.waitFor({ timeout: 30_000 })
  await page.waitForTimeout(300)
}

/** Launch a Chat chat on one named brain through the welcome card's two steps. */
async function launch(page: Page, brain: string): Promise<void> {
  await newChat(page)
  // The tile is retried: a click that lands while the card is still sliding
  // in is swallowed, and the step stays on screen.
  for (let attempt = 0; attempt < 5; attempt++) {
    await page.locator('[data-launcher-step="space"] [data-space="chat"]').click()
    const advanced = await page.locator('[data-launcher-step="brain"]').waitFor({ timeout: 5_000 })
      .then(() => true, () => false)
    if (advanced) break
    if (attempt === 4) {
      await page.screenshot({ path: join(out, 'debug-pills-retired-launch.png') })
      throw new Error('the Chat tile never advanced to the brain step')
    }
  }
  await page.locator(`[data-launcher-step="brain"] [data-brain="${brain}"]`).first().click()
  await page.waitForTimeout(2_500)
}

/**
 * Send one prompt through the shipped composer and wait for the turn to
 * settle, so the chat stops being blank and the composer's docks and model
 * seat render for a started chat. The fork's Enter policy types a newline, so
 * submit is the Cmd/Ctrl+Enter accelerator the composer documents.
 */
async function turn(page: Page, text: string): Promise<void> {
  const composer = page.locator('[data-composer-seat] textarea, textarea').first()
  await composer.waitFor({ timeout: 30_000 })
  await composer.click()
  await composer.fill(text)
  await page.keyboard.press('Meta+Enter')
  await page.waitForFunction(
    () => document.querySelectorAll('[data-running], [data-turn-running]').length === 0,
    undefined,
    { timeout: 90_000 },
  ).catch(() => undefined)
  await page.waitForTimeout(2_500)
}

/**
 * What the running app renders, read off the DOM: the dock outlet's occupants,
 * every pill-row hook on the page, and the brain switcher on the model seat.
 */
async function observe(page: Page): Promise<Record<string, unknown>> {
  // No inner function may be bound to a const here: tsx compiles this module
  // through esbuild's keepNames, which wraps such a binding in a `__name`
  // helper that does not exist inside the page.
  return page.evaluate(() => {
    const dock = document.querySelector('[data-slot="conversation.input.dock"]')
    const seat = document.querySelector('[data-composer-seat]')
    const trigger = document.querySelector('[data-brain-switcher]')
    return {
      composerVisible: seat !== null && getComputedStyle(seat).display !== 'none',
      dockRendered: dock !== null,
      // Each direct occupant of the dock outlet: its tag and every data-* attribute.
      dockOccupants: dock === null ? null : [...dock.children].map(child => ({
        tag: child.tagName.toLowerCase(),
        data: [...child.attributes].filter(attr => attr.name.startsWith('data-')).map(attr => `${attr.name}=${attr.value}`),
        text: (child.textContent ?? '').trim().slice(0, 60),
      })),
      pillRows: document.querySelectorAll('[data-activity-pills]').length,
      pillButtons: document.querySelectorAll('[data-activity]').length,
      switcher: trigger === null ? null : {
        label: (trigger.textContent ?? '').trim(),
        current: trigger.getAttribute('data-brain-current'),
        space: trigger.getAttribute('data-space'),
        // The switcher sits inside the composer's model seat outlet.
        onModelSeat: trigger.closest('[data-slot="conversation.input.model"]') !== null,
      },
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

const brain = chatBrains[0]!

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

  await openApp(page, base, { ready: READY(page) })

  await launch(page, brain.id)
  await turn(page, 'Read NOTES.md and tell me what it says.')
  await page.locator('[data-brain-switcher]').waitFor({ timeout: 30_000 }).catch(() => undefined)
  const chat = await shoot(page, `pills-retired-chat-${theme}`)

  expect(chat.composerVisible === true, 'the started Chat chat renders its composer')
  expect(chat.dockRendered === true, 'the conversation.input.dock outlet is rendered (so its emptiness of pills is observed, not assumed)')
  const occupants = (chat.dockOccupants ?? []) as { tag: string; data: string[]; text: string }[]
  expect(
    occupants.every(occupant => !occupant.data.some(attr => attr.startsWith('data-activity-pills'))),
    `no dock occupant is the activity pill row (occupants: ${JSON.stringify(occupants)})`,
  )
  expect(chat.pillRows === 0, `zero [data-activity-pills] nodes on the page (got ${String(chat.pillRows)})`)
  expect(chat.pillButtons === 0, `zero [data-activity] pill buttons on the page (got ${String(chat.pillButtons)})`)
  const switcher = chat.switcher as { label: string; current: string | null; space: string | null; onModelSeat: boolean } | null
  expect(switcher !== null, 'the brain switcher renders on the started chat')
  expect(switcher?.onModelSeat === true, 'the brain switcher sits on the composer model seat')
  expect(switcher?.space === 'chat', `the switcher knows the chat's space (got ${JSON.stringify(switcher?.space)})`)
  expect(switcher?.current === brain.id, `the switcher marks the launched brain ${brain.id} (got ${JSON.stringify(switcher?.current)})`)
  expect(switcher?.label === brain.name, `the switcher names the brain "${brain.name}" (got ${JSON.stringify(switcher?.label)})`)

  if (pageErrors.length > 0) {
    console.error(`  page errors: ${JSON.stringify(pageErrors)}`)
    failures.push(`page errors in ${theme}`)
  }
  await context.close()
}

await teardown()
await rm(root, { recursive: true, force: true })

if (failures.length > 0) {
  console.error(`\n${String(failures.length)} expectation(s) failed:`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log(`\nwrote pills-retired proofs to ${out}`)
