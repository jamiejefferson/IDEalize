/**
 * Proof run (not a vitest spec): boot the REAL assembled IDEalize app — the
 * whole `idealize` profile, so the welcome card, the view ring, the composer
 * and its brain switcher are the shipped ones — and drive it headlessly at the
 * packaged window's 1280×840 in both themes.
 *
 * It answers the two things the 27 August landing walk met after S8 landed
 * (`.idealize/proof/landing-2026-08-27/findings.md`, defects 3 and 4), per
 * theme:
 *
 * 1. **The composer names the brain, at once and after a reload.** A fresh
 *    chat is launched into Gallery through the card's two steps, and the
 *    switcher's trigger must read the Gallery brain's DISPLAY NAME straight
 *    away — not the raw preset id the roster route serves, and not the brain
 *    the chat was created on. The page is then reloaded and the same assertion
 *    made again, because before this change the label was right only after a
 *    reload.
 * 2. **New chat mints a chat.** On that launched-but-unsent Gallery chat the
 *    host's New chat control must open a DIFFERENT session with the space
 *    chooser on screen. A chat launched into a space has recorded its space and
 *    its brain and still has no turn, so it stayed "the workspace's blank chat"
 *    and New chat handed it straight back — which reads as New chat doing
 *    nothing.
 * 3. **A relaunched blank chat names its new brain.** The chat New chat just
 *    minted has `space: gallery` recorded on it through the same
 *    `POST /idealize/spaces/select` the card writes, with no brain, so the
 *    chooser still asks. Launching it into Chat on Coding must leave the
 *    switcher reading Coding's display name, with `data-brain-current` on
 *    Coding — the walk found the raw id `gallery` there while the menu marked
 *    Coding.
 *
 * The model behind the one real turn is `@deepseek-ai/dsh-llm-mock-server` — a
 * scripted OpenAI-compatible server, so the run needs no provider key.
 *
 * Isolation: the run refuses to start unless `DSH_HOME` and `HOME` both point
 * inside the temporary directory it made. The user's real harness home is
 * never opened.
 *
 * The app serves the built `lib/client.js`: rebuild before running.
 *
 * Usage: OUT=.idealize/proof pnpm exec tsx packages/idealize/spaces/proof/launch-follow-ups-proof.mts
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
const root = await mkdtemp(join(tmpdir(), 'idealize-launch-follow-ups-'))
const home = join(root, 'home')
const dshHome = join(root, 'dsh-home')
const projectDir = join(root, 'project')
for (const dir of [home, dshHome, projectDir]) await mkdir(dir, { recursive: true })
await writeFile(join(projectDir, 'NOTES.md'), '# Notes\n\nThe launch follow-ups proof reads this file.\n')

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
const mock = await startMockLlmServer({
  host: '127.0.0.1',
  port: 0,
  apiKey: 'mock-key',
  sequence: ['success'],
  repeatLast: true,
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

/** One space's roster entry, as the shipped `GET /idealize/spaces` serves it. */
interface RosterEntry {
  id: string
  brains: { id: string; name: string; default?: boolean }[]
}
const roster = (await (await fetch(`${base}/idealize/spaces`)).json() as { spaces: RosterEntry[] }).spaces
console.log(`roster: ${JSON.stringify(roster.map(space => ({ id: space.id, brains: space.brains.map(brain => brain.id) })))}`)

/** The brain a launch into one space lands on: the space's default, else its first. */
function defaultBrainOf(space: string): { id: string; name: string } {
  const entry = roster.find(candidate => candidate.id === space)
  if (entry === undefined) throw new Error(`the roster serves no ${space} space`)
  const brain = entry.brains.find(candidate => candidate.default === true) ?? entry.brains[0]
  if (brain === undefined) throw new Error(`the roster offers no brain in ${space}`)
  return { id: brain.id, name: brain.name }
}

/** One named brain of one space, as the roster serves it. */
function brainOf(space: string, id: string): { id: string; name: string } {
  const brain = roster.find(candidate => candidate.id === space)?.brains.find(candidate => candidate.id === id)
  if (brain === undefined) throw new Error(`the roster offers no ${id} brain in ${space}`)
  return { id: brain.id, name: brain.name }
}

const GALLERY_BRAIN = defaultBrainOf('gallery')
const CODING_BRAIN = brainOf('chat', 'coding')
console.log(`gallery brain: ${JSON.stringify(GALLERY_BRAIN)}; chat coding brain: ${JSON.stringify(CODING_BRAIN)}`)

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

/** Press the sidebar's New chat control and wait for the space chooser. */
async function pressNewChat(page: Page): Promise<void> {
  const step = page.locator('[data-launcher-step="space"]')
  const newChatButton = page.getByRole('button', { name: 'New chat', exact: true })
  if (await newChatButton.count() > 0) await newChatButton.first().click()
  if (await step.count() === 0 && await page.getByText(projectName, { exact: true }).count() > 0) {
    await page.getByText(projectName, { exact: true }).first().click({ timeout: 30_000 })
  }
  await step.waitFor({ timeout: 30_000 })
  await page.waitForTimeout(600)
}

/** Bring the welcome card's space step on screen, from a chat or from the first render. */
async function newChat(page: Page): Promise<void> {
  const step = page.locator('[data-launcher-step="space"]')
  if (await step.count() > 0 && await step.first().isVisible()) return
  await pressNewChat(page)
}

/** Launch the current blank chat into one space on one named brain. */
async function launch(page: Page, space: string, brain: string): Promise<void> {
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
  await page.locator(`[data-launcher-step="brain"] [data-brain="${brain}"]`).click()
  await page.waitForTimeout(2_500)
}

/**
 * What the running app renders, read off the DOM: the composer's brain
 * switcher (its label, the brain it marks and the space it is in), the view a
 * blank chat landed on, and whether the welcome chooser is asking.
 */
async function observe(page: Page): Promise<Record<string, unknown>> {
  // No inner function may be bound to a const here: tsx compiles this module
  // through esbuild's keepNames, which wraps such a binding in a `__name`
  // helper that does not exist inside the page.
  return page.evaluate(() => {
    const trigger = document.querySelector('[data-brain-switcher]')
    return {
      brainSwitcher: trigger !== null,
      brainLabel: trigger === null ? null : (trigger.textContent ?? '').trim(),
      brainCurrent: trigger?.getAttribute('data-brain-current') ?? null,
      brainSpace: trigger?.getAttribute('data-space') ?? null,
      blankView: document.querySelector('[data-blank-view]')?.getAttribute('data-blank-view') ?? null,
      galleryView: document.querySelector('[data-gallery-root]') !== null,
      galleryDock: document.querySelector('[data-gallery-aspect]') !== null,
      chooser: document.querySelector('[data-launcher-step]')?.getAttribute('data-launcher-step') ?? null,
      sidebarSpaces: [...document.querySelectorAll('[data-idealize-surface="sessions"] [data-space]')]
        .map(glyph => glyph.getAttribute('data-space')),
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

/** The current chat's id, read from the same persisted selection the app restores on reload. */
async function currentSessionId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const key = Object.keys(localStorage).find(name => name.includes('dsh.sessions.current'))
    if (key === undefined) throw new Error('the persisted current-session pointer is missing')
    const raw = localStorage.getItem(key) ?? ''
    const match = /"sessionId"\s*:\s*"([^"]+)"/.exec(raw)
    if (match === null) throw new Error(`the persisted selection carries no sessionId: ${raw}`)
    return match[1]!
  })
}

/** The switcher assertions: a display name, never an id, on the brain the chat runs. */
function expectNamesBrain(
  observed: Record<string, unknown>,
  brain: { id: string; name: string },
  space: string,
  where: string,
): void {
  expect(observed.brainSwitcher === true, `the composer shows a brain switcher ${where}`)
  expect(observed.brainLabel === brain.name,
    `the switcher reads "${brain.name}" ${where} (got ${JSON.stringify(observed.brainLabel)})`)
  expect(observed.brainLabel !== brain.id,
    `the switcher shows a name, not the preset id "${brain.id}", ${where}`)
  expect(observed.brainCurrent === brain.id,
    `the switcher marks ${brain.id} as current ${where} (got ${JSON.stringify(observed.brainCurrent)})`)
  expect(observed.brainSpace === space, `the switcher is in the ${space} space ${where}`)
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

  await openApp(page, base, { ready: READY(page) })

  // 1. A fresh chat launched into Gallery names the Gallery brain at once.
  await launch(page, 'gallery', GALLERY_BRAIN.id)
  const galleryId = await currentSessionId(page)
  const landed = await shoot(page, `launch-follow-ups-gallery-${theme}`)
  expect(landed.blankView === 'gallery' && landed.galleryView === true, 'the chat landed on the Gallery view')
  expect(landed.galleryDock === true, 'the Gallery aspect dock is on the composer')
  expectNamesBrain(landed, GALLERY_BRAIN, 'gallery', 'the moment the launch lands')

  // …and still after a reload, which is all it managed before this change.
  await page.reload({ waitUntil: 'load' })
  await settle(page, { ready: READY(page) })
  await page.waitForTimeout(1_500)
  const reloaded = await shoot(page, `launch-follow-ups-gallery-reload-${theme}`)
  expect(reloaded.blankView === 'gallery', 'the reload came back on the Gallery view')
  expectNamesBrain(reloaded, GALLERY_BRAIN, 'gallery', 'after a reload')

  // 2. New chat on that launched-but-unsent chat opens a different one, asking.
  await pressNewChat(page)
  const mintedId = await currentSessionId(page)
  const minted = await shoot(page, `launch-follow-ups-new-chat-${theme}`)
  expect(mintedId !== galleryId,
    `New chat opened a different chat (${galleryId} → ${mintedId})`)
  expect(minted.chooser === 'space', 'the fresh chat asks which space')
  expect(minted.blankView === null && minted.galleryView === false,
    'the fresh chat is not the Gallery chat over again')

  // 3. The relaunch: record a space with no brain on the fresh chat, the way a
  // chat left over from an earlier launch carries one, then launch it into
  // Chat on Coding and read the switcher.
  const recorded = await fetch(`${base}/idealize/spaces/select`, {
    method: 'POST',
    headers: { 'x-idealize-auth': '1', 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: mintedId, space: 'gallery' }),
  })
  console.log(`  spaces/select gallery for ${mintedId}: ${String(recorded.status)}`)
  expect(recorded.ok, 'the Gallery space is recorded on the blank chat through /idealize/spaces/select')
  await page.reload({ waitUntil: 'load' })
  await settle(page, { ready: READY(page) })
  await page.waitForTimeout(1_500)
  const carrying = await shoot(page, `launch-follow-ups-stale-space-${theme}`)
  expect(carrying.blankView === 'gallery', 'the recorded space seeds the blank chat onto Gallery')
  expect(carrying.chooser === 'space', 'a chat with a space but no brain still asks which space')

  await launch(page, 'chat', CODING_BRAIN.id)
  const relaunched = await shoot(page, `launch-follow-ups-relaunch-${theme}`)
  expect(await currentSessionId(page) === mintedId, 'the relaunch stayed in the same chat')
  expect(relaunched.blankView === null && relaunched.galleryView === false,
    'the relaunch left the Gallery view for Chat')
  expectNamesBrain(relaunched, CODING_BRAIN, 'chat', 'after relaunching a Gallery-marked blank chat into Chat')

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
console.log(`\nwrote launch follow-ups proofs to ${out}`)
