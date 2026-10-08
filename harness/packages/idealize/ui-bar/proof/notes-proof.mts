/**
 * Proof run (not a vitest spec) for the rail's Notes scratchpad (JJ, 6 Oct
 * 2026): boot the REAL assembled IDEalize app on scratch data, press Notes,
 * type, and read the note back off the disk; close and reopen it to show the
 * same note returns; Preview it; start a New note and show the pointer moved.
 *
 * Isolation: the run refuses to start unless `DSH_HOME` and `HOME` both point
 * inside the temporary directory it made. The user's real harness home is
 * never opened. No documentation vault is set in the scratch home, so the
 * note lands in `~/Documents/IDEalize Notes/`.
 *
 * Usage: OUT=.idealize/proof/notes pnpm exec tsx packages/idealize/ui-bar/proof/notes-proof.mts
 *
 * Packaged app: launch the built `IDEalize V1.app` with a scratch `HOME`,
 * `--user-data-dir` and `--remote-debugging-port=9334`, then run with
 * `CDP_URL=http://127.0.0.1:9334 PROOF_HOME=<that scratch HOME>`; the run
 * drives the main window and never boots a host of its own.
 */
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
// Resolved from apps/web's devDependency: the proof borrows the web e2e browser.
import { chromium } from '../../../../apps/web/node_modules/playwright/index.mjs'
import { settle, watchLaunch } from '../../../../.idealize/proof-settle.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..', '..')
const out = process.env.OUT ?? '.idealize/proof/notes'
await mkdir(out, { recursive: true })

const cdp = process.env.CDP_URL
const root = cdp === undefined ? await mkdtemp(join(tmpdir(), 'idealize-notes-proof-')) : process.env.PROOF_HOME ?? ''
if (cdp !== undefined && !root.includes('proof')) throw new Error('refusing to run: PROOF_HOME must name a scratch proof home')
const home = cdp === undefined ? join(root, 'home') : root
const dshHome = join(root, 'dsh-home')
for (const dir of [home, dshHome]) await mkdir(dir, { recursive: true })
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
const notesFolder = join(home, 'Documents', 'IDEalize Notes')

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

/** Boot `dsh --profile idealize` and wait for an IDEalize route to answer. */
async function boot(port: number): Promise<ChildProcess> {
  const child = spawn(
    'node',
    ['--import', 'tsx/esm', 'apps/cli/src/bin.ts', '--profile', 'idealize', '--host', '127.0.0.1', '--port', String(port)],
    { cwd: repoRoot, env, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  child.stderr?.on('data', (chunk: Buffer) => { process.stderr.write(`  host! ${chunk.toString()}`) })
  const deadline = Date.now() + 180_000
  for (;;) {
    if (Date.now() > deadline) throw new Error('the host never started listening')
    try {
      const response = await fetch(`http://127.0.0.1:${String(port)}/idealize/spaces`)
      if (response.ok) return child
    } catch {
      // Not listening yet; the loop is the wait.
    }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
}

const port = cdp === undefined ? await freePort() : 0
const host = cdp === undefined ? await boot(port) : undefined
const base = `http://127.0.0.1:${String(port)}`

const browser = cdp === undefined ? await chromium.launch() : await chromium.connectOverCDP(cdp)
const page = cdp === undefined
  ? await (await browser.newContext({ viewport: { width: 1280, height: 840 }, deviceScaleFactor: 2, locale: 'en-GB' })).newPage()
  : browser.contexts().flatMap(context => context.pages()).find(candidate => !candidate.url().includes('askbar'))
if (page === undefined) throw new Error('no main window over CDP')
console.log(`app: ${cdp ?? base}`)
const errors: string[] = []
page.on('pageerror', (error) => { errors.push(String(error)) })
const results: string[] = []

/** Stop everything this run started. */
async function teardown(): Promise<void> {
  // Over CDP the window belongs to the launched app: disconnect and leave it.
  await browser.close()
  host?.kill('SIGTERM')
}

/** The notes folder's Markdown files, sorted. */
async function notes(): Promise<string[]> {
  return (await readdir(notesFolder)).filter(name => name.endsWith('.md')).sort()
}

try {
  if (cdp === undefined) {
    await watchLaunch(page)
    await page.goto(base, { waitUntil: 'load' })
    await settle(page, { ready: page.getByRole('button', { name: 'Notes', exact: true }) })
  } else {
    // First run on blank data: skip setup, then step the tour off the window.
    const skip = page.getByRole('button', { name: 'Skip setup' })
    if (await skip.isVisible().catch(() => false)) await skip.click()
    await page.getByRole('button', { name: 'Notes', exact: true }).waitFor({ timeout: 60_000 })
  }
  for (let attempt = 0; attempt < 8; attempt++) {
    if (await page.locator('[class*="scrim"]').count() === 0) break
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
  }
  const later = page.getByRole('button', { name: 'Configure later' })
  if (await later.isVisible()) await later.click()

  // 1. The first tap creates a note and opens it straight into the editor.
  const notesButton = page.getByRole('button', { name: 'Notes', exact: true })
  await notesButton.click()
  const editor = page.locator('[data-viewer-body] textarea')
  await editor.waitFor({ timeout: 15_000 })
  const created = await notes()
  if (created.length !== 1) throw new Error(`expected one note, found ${JSON.stringify(created)}`)
  results.push(`first tap created ${created[0]} and opened the editor; Notes pressed=${String(await notesButton.getAttribute('aria-pressed'))}`)
  await page.screenshot({ path: join(out, 'notes-1-first-tap.png') })

  // 2. Typing saves itself once the pause passes.
  await editor.click()
  await page.keyboard.press('End')
  await page.keyboard.press('Meta+ArrowDown')
  await page.keyboard.type('Ask Powell about the move-to-project wording.')
  await page.locator('[data-note-save="saved"]').waitFor({ timeout: 10_000 })
  const onDisk = await readFile(join(notesFolder, created[0] ?? ''), 'utf8')
  if (!onDisk.includes('Ask Powell about the move-to-project wording.')) throw new Error(`typing never reached disk: ${JSON.stringify(onDisk)}`)
  results.push(`typing saved without a Save press: ${JSON.stringify(onDisk)}`)
  await page.screenshot({ path: join(out, 'notes-2-typed-and-saved.png') })

  // 3. A second tap closes the deck; a third brings back the same note.
  console.log('step 3: closing')
  await notesButton.click()
  await page.waitForTimeout(600)
  const closed = await page.locator('[data-viewer-body]').count()
  console.log(`step 3: closed=${String(closed)}, reopening`)
  await notesButton.click()
  await editor.waitFor({ timeout: 15_000 })
  const reopened = await editor.inputValue()
  if (closed !== 0 || !reopened.includes('Ask Powell') || (await notes()).length !== 1) {
    throw new Error(`reopen failed: closed=${String(closed)} text=${JSON.stringify(reopened)}`)
  }
  results.push('second tap closed the deck; third tap reopened the same note with its text')

  // 4. Preview renders it; New note starts another and makes it current.
  await page.locator('[data-note-preview]').click()
  await page.locator('[data-viewer-body] h1').waitFor({ timeout: 10_000 })
  results.push(`Preview rendered the heading ${JSON.stringify(await page.locator('[data-viewer-body] h1').textContent())}`)
  await page.screenshot({ path: join(out, 'notes-3-preview.png') })
  await page.locator('[data-note-new]').click()
  await page.waitForFunction(() => document.querySelector('[data-viewer-body] textarea') !== null)
  await page.waitForTimeout(600)
  const afterNew = await notes()
  const pointer = (await readFile(join(notesFolder, '.current-note'), 'utf8')).trim()
  if (afterNew.length !== 2 || pointer === created[0]) throw new Error(`New note failed: ${JSON.stringify({ afterNew, pointer })}`)
  results.push(`New note created ${pointer}; the first note is kept: ${JSON.stringify(afterNew)}`)
  await page.screenshot({ path: join(out, 'notes-4-new-note.png') })

  for (const line of results) console.log(`PASS ${line}`)
  if (errors.length > 0) console.log(`page errors: ${JSON.stringify(errors)}`)
} finally {
  await teardown()
}
process.exit(errors.length > 0 ? 1 : 0)
