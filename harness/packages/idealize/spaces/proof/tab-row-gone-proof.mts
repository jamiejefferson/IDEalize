/**
 * Proof run (not a vitest spec): boot the REAL assembled IDEalize app — the
 * whole `idealize` profile, so the welcome card, the conversation view ring,
 * the composer and its per-space docks are the shipped ones — and drive it
 * headlessly at the packaged window's 1280×840 in both themes.
 *
 * What it proves, per theme:
 *
 * 1. **No tab row anywhere.** For a chat in each space the session header is
 *    read off the DOM: every `[role="tablist"]` and `[role="tab"]` inside it
 *    is enumerated and the count must be zero. The header itself is on screen
 *    for the started Chat chat, so the zero means "rendered without tabs", not
 *    "nothing rendered".
 * 2. **Each space's own composer chrome is present.** Gallery: the aspect and
 *    count controls (`[data-gallery-aspect]`, `[data-gallery-count]`) on a live
 *    composer. Sound Stage: the length control
 *    (`[data-gen-settings-space="soundstage"] [data-gen-setting="duration"]`).
 *    Chat: the plain composer with neither dock.
 * 3. **The space is durable, not remembered.** A Gallery chat is reloaded after
 *    `localStorage.clear()` — the store the ring's view used to be remembered
 *    in is gone — and the chat must come back on the Gallery view with its
 *    dock, and the welcome chooser must not ask again inside it (its brain is
 *    on record). The one thing put back after the clear is the current-chat pointer
 *    (`dsh.sessions.current`), so the reload has a chat to open at all; every
 *    remaining key is listed in the stamp so the reader can see the view memory
 *    is not among them.
 * 4. **Terminal, as far as headless can honestly show it.** A plain browser
 *    serves no embedded terminal (there is no shell in a browser tab; the
 *    packaged-window route in `.agents/skills/packaged-window-proofing` is
 *    where the shell is evidence), so the welcome card refuses Terminal here
 *    as `desktop-only`. The run records `space: 'terminal'` on a started chat
 *    through the same `POST /idealize/spaces/select` the card uses, reloads,
 *    and asserts what the seed's own rule says must happen: the sidebar row
 *    carries the Terminal glyph, the ring — serving no terminal view — lands
 *    the chat on Chat with its composer, and still renders no tab row.
 *
 * The model behind the real turns is `@deepseek-ai/dsh-llm-mock-server` — a
 * scripted OpenAI-compatible server, so the run needs no provider key and the
 * transcript is reproducible; nothing about the loop or the projection is
 * stubbed.
 *
 * Isolation: the run refuses to start unless `DSH_HOME` and `HOME` both point
 * inside the temporary directory it made. The user's real harness home is
 * never opened.
 *
 * The app serves the built `lib/client.js`: rebuild before running.
 *
 * Usage: OUT=.idealize/proof pnpm exec tsx packages/idealize/spaces/proof/tab-row-gone-proof.mts
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
const root = await mkdtemp(join(tmpdir(), 'idealize-tab-row-gone-'))
const home = join(root, 'home')
const dshHome = join(root, 'dsh-home')
const projectDir = join(root, 'project')
for (const dir of [home, dshHome, projectDir]) await mkdir(dir, { recursive: true })
await writeFile(join(projectDir, 'NOTES.md'), '# Notes\n\nThe tab-row proof reads this file.\n')

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

/**
 * Send one prompt through the shipped composer and wait for the turn to
 * settle, so the chat stops being blank and its session header renders. The
 * fork's Enter policy types a newline, so submit is the Cmd/Ctrl+Enter
 * accelerator the composer documents.
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
 * What the running app renders, read off the DOM: the tab row (or its
 * absence) in the session header, the view a blank chat landed on, each
 * space's composer dock, and the sidebar's space glyphs.
 */
async function observe(page: Page): Promise<Record<string, unknown>> {
  // No inner function may be bound to a const here: tsx compiles this module
  // through esbuild's keepNames, which wraps such a binding in a `__name`
  // helper that does not exist inside the page.
  return page.evaluate(() => {
    const header = document.querySelector('[data-idealize-surface="chat"] header')
    const seat = document.querySelector('[data-composer-seat]')
    return {
      headerRendered: header !== null,
      headerHidden: header?.getAttribute('aria-hidden') === 'true',
      // The tab row, enumerated where it used to render and across the page.
      headerTablists: header === null ? null : header.querySelectorAll('[role="tablist"]').length,
      headerTabs: header === null ? null : header.querySelectorAll('[role="tab"]').length,
      pageTabs: document.querySelectorAll('[data-idealize-surface="chat"] [role="tab"]').length,
      blankView: document.querySelector('[data-blank-view]')?.getAttribute('data-blank-view') ?? null,
      galleryView: document.querySelector('[data-gallery-root]') !== null,
      soundstageView: document.querySelector('[data-soundstage]') !== null,
      composerVisible: seat !== null && getComputedStyle(seat).display !== 'none',
      galleryDock: document.querySelector('[data-gallery-aspect]') !== null && document.querySelector('[data-gallery-count]') !== null,
      soundstageLength: document.querySelector('[data-gen-settings-space="soundstage"] [data-gen-setting="duration"]') !== null,
      // The welcome card's chooser: absent on a chat that already launched.
      chooser: document.querySelector('[data-launcher-step]')?.getAttribute('data-launcher-step') ?? null,
      sidebarSpaces: [...document.querySelectorAll('[data-idealize-surface="sessions"] [data-space]')]
        .map(glyph => glyph.getAttribute('data-space')),
      storageKeys: Object.keys(localStorage).sort(),
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

/** The zero-tab assertions every capture shares. */
function expectNoTabRow(observed: Record<string, unknown>, where: string): void {
  expect(observed.headerTablists === 0 || observed.headerTablists === null, `no tablist in the session header ${where}`)
  expect(observed.headerTabs === 0 || observed.headerTabs === null, `no tab in the session header ${where}`)
  expect(observed.pageTabs === 0, `no tab anywhere in the chat column ${where}`)
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

/**
 * Clear every localStorage key, then restore only the current-chat pointer so
 * the reload has a chat to open, and reload through the settle guard.
 */
async function reloadForgetting(page: Page): Promise<string[]> {
  const kept = await page.evaluate(() => {
    const pointer = Object.entries(localStorage).filter(([name]) => name.includes('dsh.sessions.current'))
    localStorage.clear()
    for (const [name, value] of pointer) localStorage.setItem(name, value)
    return Object.keys(localStorage)
  })
  await page.reload({ waitUntil: 'load' })
  await settle(page, { ready: READY(page) })
  await page.waitForTimeout(1_500)
  return kept
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

  // 1. Chat: a started chat, so the session header is on screen with no tabs.
  await launch(page, 'chat')
  await turn(page, 'Read NOTES.md and tell me what it says.')
  const chat = await shoot(page, `tab-row-gone-chat-${theme}`)
  expect(chat.headerRendered === true && chat.headerHidden === false, 'the started Chat chat renders its session header')
  expectNoTabRow(chat, 'on a started Chat chat')
  expect(chat.composerVisible === true, 'the Chat composer is present')
  expect(chat.galleryDock === false && chat.soundstageLength === false, 'the Chat composer carries neither media dock')

  // 4. Terminal, as far as headless can show it: record the space on this
  // started chat through the card's own route, reload, and read the seed.
  const chatId = await currentSessionId(page)
  const recorded = await fetch(`${base}/idealize/spaces/select`, {
    method: 'POST',
    headers: { 'x-idealize-auth': '1', 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: chatId, space: 'terminal' }),
  })
  console.log(`  spaces/select terminal for ${chatId}: ${String(recorded.status)}`)
  expect(recorded.ok, 'the Terminal space is recorded on the chat through /idealize/spaces/select')
  await reloadForgetting(page)
  const terminal = await shoot(page, `tab-row-gone-terminal-${theme}`)
  expect((terminal.sidebarSpaces as string[]).includes('terminal'), `the sidebar row carries the Terminal glyph (got ${JSON.stringify(terminal.sidebarSpaces)})`)
  expect(terminal.blankView === null && terminal.galleryView === false && terminal.soundstageView === false,
    'headless serves no terminal view, so the seed lands the Terminal chat on Chat')
  expect(terminal.composerVisible === true, 'the Terminal chat keeps a composer where no shell can render')
  expectNoTabRow(terminal, 'on a Terminal-space chat in a plain browser')

  // 2. Sound Stage: its length control on the composer, no tabs.
  await launch(page, 'soundstage')
  const soundstage = await shoot(page, `tab-row-gone-soundstage-${theme}`)
  expect(soundstage.blankView === 'soundstage' && soundstage.soundstageView === true, 'the chat landed on the Sound Stage view')
  expect(soundstage.soundstageLength === true, 'the Sound Stage length control is on the composer')
  expect(soundstage.composerVisible === true, 'the Sound Stage composer is present')
  expectNoTabRow(soundstage, 'on a Sound Stage chat')
  // The host hands "New chat" the workspace's blank chat rather than minting
  // one, and a launched-but-blank chat no longer shows the chooser (its brain
  // is on record), so each media chat runs one turn before the next launch.
  await turn(page, 'A short chime.')

  // 2 + 3. Gallery: the aspect and count dock, then the reload that proves the
  // space is durable rather than remembered.
  await launch(page, 'gallery')
  const gallery = await shoot(page, `tab-row-gone-gallery-${theme}`)
  expect(gallery.blankView === 'gallery' && gallery.galleryView === true, 'the chat landed on the Gallery view')
  expect(gallery.galleryDock === true, 'the Gallery aspect and count dock is on the composer')
  expect(gallery.composerVisible === true, 'the Gallery composer is present')
  expect(gallery.chooser === null, 'the welcome chooser retired on launch')
  expectNoTabRow(gallery, 'on a Gallery chat')

  const kept = await reloadForgetting(page)
  console.log(`  localStorage after clear + pointer restore: ${JSON.stringify(kept)}`)
  const reloaded = await shoot(page, `tab-row-gone-gallery-reload-${theme}`)
  expect(kept.every(name => name.includes('dsh.sessions.current')), 'only the current-chat pointer survived the clear (no ring view memory)')
  expect((reloaded.storageKeys as string[]).includes('dsh.sessions.current') || (reloaded.storageKeys as string[]).some(name => name.includes('dsh.sessions.current')),
    'the reload restored the same chat')
  expect(reloaded.blankView === 'gallery' && reloaded.galleryView === true, 'the reload came back on the Gallery view with nothing remembered')
  expect(reloaded.galleryDock === true, 'the Gallery dock came back with it')
  expect(reloaded.chooser === null, 'the welcome chooser does not ask again inside the reloaded Gallery chat (its brain is on record)')
  expectNoTabRow(reloaded, 'on the reloaded Gallery chat')
  await turn(page, 'A small red boat.')

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
console.log(`\nwrote tab-row-gone proofs to ${out}`)
