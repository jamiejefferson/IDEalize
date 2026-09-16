/**
 * Proof run (not a vitest spec): boot the REAL assembled IDEalize app — the
 * whole `idealize` profile, so the tool rail, the drawer column, the
 * conversation view ring and the composer are the shipped ones — then drive it
 * headlessly at the packaged window's 1280×840 in both themes.
 *
 * What it proves, in order:
 *
 * 1. Tasks are created through `@idealize/cron`'s own routes BEFORE the app the
 *    browser drives ever boots. That is the pre-existing record: the same route
 *    the view writes through, landing in the same `idealize-cron.json`. The
 *    second boot then reads them back through the drawer pane (SCH-06 / AC-43).
 * 2. **The ring no longer carries Schedule, and the rail does** — the inverted
 *    audit. Every `role="tab"` is enumerated off the rendered DOM of a live
 *    chat (since S8 the ring renders no tab row at all, so the count must be
 *    zero), and every tool-rail button beside it, so "Schedule left the ring
 *    and joined the rail" is read off the page rather than inferred from a
 *    registration. The run FAILS if any tab renders or if no rail button
 *    opens Schedule.
 * 3. **The seeded tasks render under their cron-minted ids** in the Week grid,
 *    and the Month grid picks a day out of six whole weeks and lands the Day
 *    lane on it.
 * 4. **The week strip stays legible at the drawer's 320px minimum and at the
 *    content's 424px cap**, driven through the real drag handle: seven day
 *    cells, none clipped, no horizontal overflow — the honest answer to "does
 *    it fit", measured rather than assumed.
 * 5. Tapping an empty week column still opens the seeded creation flow.
 * 6. A failing task fetch states its cause and offers Retry (SCH-10), and
 *    Retry recovers once the route answers again.
 * 7. **The cron document on disk is byte-identical after the whole round
 *    trip**: reading is not a migration.
 *
 * The model behind the one real turn is `@deepseek-ai/dsh-llm-mock-server` — a
 * scripted OpenAI-compatible server, so the run needs no provider key and the
 * transcript is reproducible; nothing about the loop, the tool execution or
 * the projection is stubbed. The turn exists to un-blank the chat so the
 * session header is on screen for the audit.
 *
 * Isolation: the run refuses to start unless `DSH_HOME` and `HOME` both point
 * inside the temporary directory it made. The user's real harness home holds
 * live schedule data and is never opened.
 *
 * Usage: OUT=.idealize/proof pnpm exec tsx packages/idealize/ui-schedule/proof/schedule-proof.mts
 */
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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

// ── Isolation, verified before anything is written ─────────────────────────
const root = await mkdtemp(join(tmpdir(), 'idealize-schedule-proof-'))
const home = join(root, 'home')
const dshHome = join(root, 'dsh-home')
const projectDir = join(root, 'project')
for (const dir of [home, dshHome, projectDir]) await mkdir(dir, { recursive: true })
// A file the scripted tool call reads, so the turn carries a tool record.
await writeFile(join(projectDir, 'NOTES.md'), '# Notes\n\nThe schedule pane proof reads this file.\n')

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
// One turn is enough: a tool call, then the reply that closes it. `repeatLast`
// keeps a retry or a title request answered rather than exhausting the script
// into a 500.
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

/** Boot `dsh --profile idealize` and wait for the cron route to answer. */
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
      // is not the signal: wait until the cron ROUTE itself answers with the
      // task array, which is the moment its registration landed — AND until
      // the `/api` RPC channel answers, which lands about a second later and
      // is what `workspace.create` needs (until then the static frontend
      // answers the POST itself with 404 or 405).
      const response = await fetch(`http://127.0.0.1:${String(port)}/idealize/cron/tasks`)
      if (response.ok && Array.isArray(await response.json())) {
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

const AUTH = { 'x-idealize-auth': '1', 'content-type': 'application/json' }

/** The tasks a user had before Schedule returned to the rail. */
const EXISTING = [
  {
    name: 'Daily product brief',
    schedule: { kind: 'weekly', at: '09:00', timeZone: 'Europe/London', days: [1, 2, 3, 4, 5] },
    prompt: 'Summarise yesterday’s progress.',
    cwd: projectDir,
    enabled: true,
  },
  {
    name: 'Afternoon triage',
    schedule: { kind: 'weekly', at: '14:00', timeZone: 'Europe/London', days: [1, 2, 3, 4, 5] },
    prompt: 'Triage the inbox.',
    cwd: projectDir,
    enabled: true,
  },
  {
    name: 'Watch failed builds',
    schedule: { kind: 'every', seconds: 1800 },
    prompt: 'Check CI.',
    cwd: projectDir,
    enabled: true,
  },
]

// ── Step 1: create the records through cron's own routes, browser absent ────
const seedPort = await freePort()
const seedHost = await boot(seedPort)

const createdIds: string[] = []
for (const task of EXISTING) {
  const response = await fetch(`http://127.0.0.1:${String(seedPort)}/idealize/cron/tasks`, {
    method: 'POST', headers: AUTH, body: JSON.stringify(task),
  })
  if (!response.ok) throw new Error(`seeding "${task.name}" failed: ${String(response.status)}`)
  const saved = await response.json() as { id: string }
  createdIds.push(saved.id)
}
await stop(seedHost)
const cronPath = join(dshHome, 'idealize-cron.json')
const seededDocument = await readFile(cronPath)
const document = JSON.parse(seededDocument.toString('utf8')) as { tasks: { id: string }[] }
console.log(`seeded ${String(createdIds.length)} tasks through /idealize/cron/tasks: ${createdIds.join(', ')}`)
if (document.tasks.length !== EXISTING.length) throw new Error('the cron document does not hold the seeded tasks')

// ── Step 2: boot the app the browser will drive ─────────────────────────────
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
  // A refused registration would surface later as a missing project tile and a
  // 30s locator timeout; naming the reply here is the cheaper failure.
  if (!response.ok) throw new Error(`${method} failed: ${reply}`)
  return reply
}

// The project the run works inside, registered before the first render: the
// welcome card only asks its questions inside a project.
console.log(`workspace.create: ${await rpc('workspace.create', { path: projectDir })}`)
const projectName = projectDir.split('/').pop() ?? projectDir
console.log(`project: ${projectDir}`)

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
    // The tile is retried: a click that lands while the card is still sliding
    // in is swallowed, and the step stays on screen.
    for (let attempt = 0; attempt < 5; attempt++) {
      await page.locator('[data-launcher-step="space"] [data-space="chat"]').click()
      const advanced = await page.locator('[data-launcher-step="brain"]').waitFor({ timeout: 5_000 })
        .then(() => true, () => false)
      if (advanced) break
      if (attempt === 4) {
        await page.screenshot({ path: join(out, 'debug-launch.png') })
        throw new Error('the Chat tile never advanced to the brain step')
      }
    }
  }
  await page.locator('[data-brain]').first().click()
  await page.waitForTimeout(2_000)
}

/**
 * Send one prompt through the shipped composer and wait for the turn to
 * settle. The chat must stop being blank: a blank chat hides the session
 * header the audit reads beside the rail. The fork's Enter policy types a newline, so submit is the Cmd/Ctrl+Enter
 * accelerator the composer documents.
 */
async function turn(page: Page, text: string): Promise<void> {
  const composer = page.locator('[data-composer-seat] textarea, textarea').first()
  await composer.waitFor({ timeout: 30_000 })
  await composer.click()
  await composer.fill(text)
  await page.keyboard.press('Meta+Enter')
  // The turn is over when the composer stops reporting a run. `running` rides
  // the session snapshot, so the send button's own state is the honest read.
  await page.waitForFunction(
    () => document.querySelectorAll('[data-running], [data-turn-running]').length === 0,
    undefined,
    { timeout: 90_000 },
  ).catch(() => undefined)
  await page.waitForTimeout(2_500)
}

/**
 * What the running app renders, read off the DOM: the ring's tabs, the rail's
 * buttons, the drawer geometry, the week strip's cells, and the task ids the
 * grid carries.
 */
async function observe(page: Page): Promise<Record<string, unknown>> {
  // No inner function may be bound to a const here: tsx compiles this module
  // through esbuild's keepNames, which wraps such a binding in a `__name`
  // helper that does not exist inside the page.
  return page.evaluate(() => {
    // The frame's real columns: the slot wrappers themselves lay out as
    // `display: contents` and measure zero.
    const drawerBox = document.querySelector('[data-idealize-surface="files"]')
      ?.getBoundingClientRect() ?? null
    const pane = document.querySelector('[data-schedule-view]')
    const paneBox = pane?.getBoundingClientRect() ?? null
    // The week strip's day buttons are the pane's aria-pressed-bearing buttons.
    const stripDays = [...document.querySelectorAll('[data-schedule-view] button[aria-pressed]')]
    const strip = stripDays[0]?.parentElement ?? null
    return {
      // Every tab on the page: after S8 the ring renders none.
      ringTabs: [...document.querySelectorAll('[role="tab"]')].map(tab => (tab.textContent ?? '').trim()),
      // The rail, enumerated: Schedule must be among these instead.
      railButtons: [...document.querySelectorAll('[data-slot="shell.rail"] button')]
        .map(button => button.getAttribute('aria-label') ?? ''),
      railPressed: [...document.querySelectorAll('[data-slot="shell.rail"] button')]
        .filter(button => button.getAttribute('aria-pressed') === 'true')
        .map(button => button.getAttribute('aria-label') ?? ''),
      paneOpen: pane !== null,
      paneWidth: paneBox === null ? null : Math.round(paneBox.width),
      drawerWidth: drawerBox === null ? null : Math.round(drawerBox.width),
      taskIds: [...document.querySelectorAll('[data-schedule-task]')]
        .map(node => node.getAttribute('data-schedule-task')),
      // The week strip, measured: seven cells, each wide enough to read, none
      // clipped, and no horizontal overflow.
      stripDayCount: stripDays.length,
      stripDayWidths: stripDays.map(day => Math.round(day.getBoundingClientRect().width)),
      stripOverflows: strip === null ? null : strip.scrollWidth > strip.clientWidth + 1,
      stripDayNames: stripDays.map(day => (day.textContent ?? '').replace(/\d+/g, '').trim()),
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

/**
 * Drag the drawer to a target width through AppFrame's own handle, and report
 * the width it settled at — which is the solver's answer, not the request.
 * The handle rides the drawer's inner (left) edge and reports
 * `setDrawer(base - dx)`, so narrowing moves right.
 */
async function dragDrawerTo(page: Page, width: number): Promise<number> {
  // Measured in the page: the handle is a 10px absolutely-positioned strip and
  // Playwright's own boundingBox() reports nothing for it.
  const geometry = await page.evaluate(() => {
    const handle = document.querySelector('[data-side="drawer"]')?.getBoundingClientRect() ?? null
    const drawer = document.querySelector('[data-idealize-surface="files"]')?.getBoundingClientRect() ?? null
    return handle === null || drawer === null
      ? null
      : {
        x: handle.left + handle.width / 2,
        y: handle.top + handle.height / 2,
        drawerWidth: drawer.width,
      }
  })
  if (geometry === null) {
    console.log('drawer drag: neither the handle nor the drawer column measured')
    return -1
  }
  await page.mouse.move(geometry.x, geometry.y)
  await page.mouse.down()
  await page.mouse.move(geometry.x + (geometry.drawerWidth - width), geometry.y, { steps: 20 })
  await page.mouse.up()
  await page.waitForTimeout(700)
  return page.evaluate(() => Math.round(
    document.querySelector('[data-idealize-surface="files"]')?.getBoundingClientRect().width ?? -1))
}

/** Open the Schedule pane from the rail and wait for the calendar. */
async function openSchedule(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Schedule', exact: true }).click()
  await page.locator('[data-schedule-view]').waitFor({ timeout: 30_000 })
  await page.waitForTimeout(800)
}

/** The strip assertions both width steps share. */
function expectStripLegible(observed: Record<string, unknown>, where: string): void {
  expect(observed.stripDayCount === 7, `the week strip still carries all seven days ${where}`)
  const widths = observed.stripDayWidths as number[]
  expect(widths.every(w => w >= 36), `every week-strip day is wide enough to read ${where} (${JSON.stringify(widths)})`)
  expect(observed.stripOverflows === false, `the week strip does not overflow horizontally ${where}`)
  const names = observed.stripDayNames as string[]
  expect(names.join(',') === 'MON,TUE,WED,THU,FRI,SAT,SUN', `the week strip reads Monday-first with full day names ${where} (${names.join(',')})`)
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
  // Un-blank the chat so the session header renders for the audit.
  await turn(page, 'Read NOTES.md and tell me what it says.')

  // 2. The inverted navigation audit: no Schedule tab in the ring, a Schedule
  // button on the rail. Enumerated off the DOM in BOTH directions, so the seat
  // is evidence, not an assumption.
  const audit = await observe(page)
  console.log(`  view ring: ${JSON.stringify(audit.ringTabs)}`)
  console.log(`  tool rail: ${JSON.stringify(audit.railButtons)}`)
  // Since S8 the ring renders no tab row at all: a chat's view is fixed by its
  // space, so the honest ring-side assertion is zero tabs, Schedule included.
  expect((audit.ringTabs as string[]).length === 0, 'the chat renders no view tab row (the space fixes the view; Schedule cannot be a tab)')
  expect((audit.railButtons as string[]).includes('Schedule'), 'the tool rail carries a Schedule button')
  await writeFile(join(out, `schedule-navigation-audit-${theme}.json`),
    `${JSON.stringify({ ringTabs: audit.ringTabs, railButtons: audit.railButtons }, null, 2)}\n`)

  // 3 + 4. The pane open at the content's 424px cap: seeded tasks under their
  // cron-minted ids, week strip legible.
  await openSchedule(page)
  // The Day lane shows the navigated day only; the seeded weekday tasks need a
  // weekday, so pick Monday off the strip (the proof may run on a weekend).
  await page.locator('[data-schedule-view] button[aria-pressed]').first().click()
  await page.waitForTimeout(500)
  const opened = await shoot(page, `schedule-rail-open-${theme}`)
  expect((opened.railPressed as string[]).join(',') === 'Schedule', `the Schedule rail button alone reads pressed (got ${JSON.stringify(opened.railPressed)})`)
  for (const id of createdIds) {
    expect((opened.taskIds as string[]).includes(id), `the pre-existing task ${id} renders under its cron-minted id`)
  }
  expect(opened.paneWidth !== null && opened.paneWidth <= 424, `the pane content caps at 424px (got ${String(opened.paneWidth)})`)
  const capped = await dragDrawerTo(page, 424)
  const atCap = await shoot(page, `schedule-rail-cap-${theme}`)
  console.log(`  drawer at cap: asked 424, settled ${String(capped)}`)
  expectStripLegible(atCap, 'at the 424px cap')

  // 5. The drawer's 320px minimum, dragged through the real handle.
  const narrowed = await dragDrawerTo(page, 320)
  const atMin = await shoot(page, `schedule-rail-min-${theme}`)
  console.log(`  drawer minimum: asked 320, settled ${String(narrowed)}`)
  expectStripLegible(atMin, 'at the 320px minimum')
  await dragDrawerTo(page, 424)
  await page.waitForTimeout(500)

  // 6. The Day lane (the frame's default): the interval task sits in ALL DAY,
  // the timed task is a block on the hour grid, and a drag of that block moves
  // it a quarter hour later and saves; the drag is put back afterwards.
  const lane = await page.evaluate(() => {
    const block = document.querySelector<HTMLElement>('[data-schedule-lane] [data-schedule-task]')
    const rect = block?.getBoundingClientRect()
    return {
      allDay: document.querySelectorAll('[data-schedule-allday] [data-schedule-task]').length,
      blocks: document.querySelectorAll('[data-schedule-lane] [data-schedule-task]').length,
      detail: block?.textContent ?? '',
      x: rect === undefined ? 0 : rect.left + rect.width / 2,
      y: rect === undefined ? 0 : rect.top + rect.height / 2,
    }
  })
  expect(lane.allDay === 1, `the interval task sits in the ALL DAY row (got ${String(lane.allDay)})`)
  expect(lane.blocks === 2, `the two seeded weekday tasks are blocks on the hour lane (got ${String(lane.blocks)})`)
  await shoot(page, `schedule-rail-day-${theme}`)
  if (lane.blocks === 2) {
    await page.mouse.move(lane.x, lane.y)
    await page.mouse.down()
    await page.mouse.move(lane.x, lane.y + 36, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(900)
    const moved = await page.locator('[role="status"]').allTextContents()
    expect(moved.some(text => /moved to \d\d:\d\d/.test(text)), `the drag reports the new time (got ${JSON.stringify(moved)})`)
    await shoot(page, `schedule-rail-rescheduled-${theme}`)
    // Put it back so the document comparison below sees the original schedule.
    // A DOMRect does not survive evaluate's serialisation; read plain numbers.
    const after = await page.evaluate(() => {
      const rect = document.querySelector<HTMLElement>('[data-schedule-lane] [data-schedule-task]')?.getBoundingClientRect()
      return rect === undefined ? null : { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    })
    if (after !== null) {
      await page.mouse.move(after.x, after.y)
      await page.mouse.down()
      await page.mouse.move(after.x, after.y - 36, { steps: 8 })
      await page.mouse.up()
      await page.waitForTimeout(900)
    }
  }

  // 7. Tap-to-add on a week column. Every column carries the seeded interval
  // task, so none is empty; the column's click handler opens Create-with-chat
  // only when the column's own surface was clicked (item clicks open the
  // editor), so dispatch the click on the column element itself.
  await page.getByRole('tab', { name: 'Week' }).click()
  await page.waitForTimeout(400)
  await page.locator('[data-schedule-view]').evaluate((view) => {
    const grid = [...view.querySelectorAll('div')].find(node =>
      getComputedStyle(node).gridTemplateColumns.split(' ').length === 7)
    const column = grid?.lastElementChild
    column?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await page.waitForTimeout(800)
  const created = await page.getByRole('heading', { name: 'New scheduled task' }).count()
  const seededSlot = await page.locator('text=/Planned for .* at 09:00/').count()
  console.log(`  tap-to-add: create heading=${String(created)} seeded slot=${String(seededSlot)}`)
  expect(created === 1, 'tapping an empty week column opens the seeded creation flow')
  expect(seededSlot === 1, 'the tapped column seeds the draft schedule at its day, 09:00')
  await shoot(page, `schedule-rail-tap-create-${theme}`)
  await page.getByRole('button', { name: 'Back to calendar' }).click()
  await page.waitForTimeout(300)

  // 7b. The Month grid. Its whole job is landing on a day, so the proof reads
  // the grid off the page (six whole weeks, the days outside the month marked,
  // the counts on the days that carry work), clicks one, and checks the Day
  // lane opened on that date.
  await page.getByRole('tab', { name: 'Month' }).click()
  await page.waitForTimeout(500)
  const month = await page.locator('[data-schedule-month]').evaluate((grid) => {
    const cells = [...grid.querySelectorAll('[data-schedule-day]')]
    return {
      cells: cells.length,
      outside: cells.filter(cell => cell.hasAttribute('data-outside')).length,
      today: cells.filter(cell => cell.hasAttribute('data-today')).length,
      withCounts: cells.filter(cell => cell.querySelector('[data-schedule-count]') !== null).length,
      strips: grid.closest('[data-schedule-view]')?.querySelectorAll('button[aria-pressed]').length ?? -1,
      // Does it fit? The same measured answer the week strip gives: the last
      // row's bottom against the pane's, and the grid's own overflow.
      overflows: grid.scrollHeight > grid.clientHeight + 1,
      spill: Math.round((cells[cells.length - 1]?.getBoundingClientRect().bottom ?? 0)
        - (grid.closest('[data-schedule-view]')?.getBoundingClientRect().bottom ?? 0)),
      shortestRow: Math.min(...cells.map(cell => Math.round(cell.getBoundingClientRect().height))),
    }
  })
  console.log(`  month grid: ${JSON.stringify(month)}`)
  expect(month.cells === 42, 'the month grid is six whole weeks, so its height does not change with the month')
  expect(month.outside > 0 && month.outside < 42, 'the adjacent months fill out the first and last weeks, and are marked as outside')
  expect(month.today === 1, 'today is marked exactly once')
  expect(month.withCounts > 0, 'the days carrying the seeded tasks say how many')
  expect(month.strips === 0, 'the week strip leaves: the month grid is the day picker')
  expect(!month.overflows, 'the six rows fit the pane: a month you have to scroll is not a month you can read')
  expect(month.spill <= 0, `the last week sits inside the pane (spill ${String(month.spill)}px)`)
  expect(month.shortestRow >= 28, `every day cell stays tappable (shortest ${String(month.shortestRow)}px)`)
  await shoot(page, `schedule-rail-month-${theme}`)

  // Pick the day after today and check the Day lane opened on it.
  const picked = await page.locator('[data-schedule-month]').evaluate((grid) => {
    const cells = [...grid.querySelectorAll<HTMLElement>('[data-schedule-day]')]
    const todayIndex = cells.findIndex(cell => cell.hasAttribute('data-today'))
    const target = cells[todayIndex + 1]
    target?.click()
    return target?.getAttribute('data-schedule-day') ?? null
  })
  await page.waitForTimeout(700)
  const landed = await page.locator('[data-schedule-view]').getAttribute('data-schedule-grain')
  const shownDate = await page.locator('[data-schedule-view] header ~ * >> text=/\\d{1,2} \\w+ \\d{4}/').first().innerText().catch(() => '')
  console.log(`  month pick: ${String(picked)} -> grain=${String(landed)} shown=${JSON.stringify(shownDate)}`)
  expect(landed === 'day', 'picking a day in the month grid opens that day in the lane')
  expect(picked !== null && shownDate.includes(String(new Date(picked).getDate())), 'the lane opened on the day that was picked')
  await shoot(page, `schedule-rail-month-picked-${theme}`)

  await page.getByRole('tab', { name: 'Day' }).click()

  // 7. A failing task fetch names its cause and offers a way out. Closing and
  // reopening the pane remounts the view, which is the refetch.
  await page.route('**/idealize/cron/tasks', route => route.fulfill({ status: 503, body: 'scheduler down' }))
  await page.getByRole('button', { name: 'Schedule', exact: true }).click()
  await page.waitForTimeout(400)
  await openSchedule(page)
  await page.locator('[data-schedule-error]').waitFor({ timeout: 20_000 })
  const cause = await page.locator('[data-schedule-error]').innerText()
  const retries = await page.getByRole('button', { name: 'Retry' }).count()
  console.log(`  failure text: ${JSON.stringify(cause)} retry buttons=${String(retries)}`)
  expect(cause.includes('503'), 'the failure states its own cause (SCH-10)')
  expect(retries === 1, 'the failure offers a recovery action (SCH-10)')
  await shoot(page, `schedule-rail-error-${theme}`)
  await page.unroute('**/idealize/cron/tasks')
  await page.getByRole('button', { name: 'Retry' }).click()
  await page.locator('[data-schedule-task]').first().waitFor({ timeout: 20_000 })

  // 8. Reading is not a migration: after everything the theme did (the drag
  // wrote 09:30 and the drag back wrote 09:00 again), every task on disk
  // carries the record it was seeded with.
  const after = JSON.parse((await readFile(cronPath)).toString('utf8')) as { tasks: Record<string, unknown>[] }
  const seeded = JSON.parse(seededDocument.toString('utf8')) as { tasks: Record<string, unknown>[] }
  const fields = ({ id, name, schedule, prompt, cwd, enabled }: Record<string, unknown>) => ({ id, name, schedule, prompt, cwd, enabled })
  expect(
    JSON.stringify(after.tasks.map(fields)) === JSON.stringify(seeded.tasks.map(fields)),
    `the cron document's tasks read as seeded after the ${theme} round trip`,
  )

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
console.log(`\nwrote Schedule rail proofs to ${out}`)
