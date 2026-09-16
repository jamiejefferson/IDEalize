/**
 * Proof run (not a vitest spec): boot the REAL assembled IDEalize app — the
 * whole `idealize` profile, so the sidebar, the tool rail and the composer are
 * the shipped ones — then drive the Studio chat headlessly at the packaged
 * window's 1280×840 in both themes.
 *
 * What it proves, in order:
 *
 * 1. The coordination record is created through `@idealize/studio`'s own
 *    routes BEFORE the app the browser drives ever boots: assignments and
 *    task updates through `/idealize/studio/event`, one addressed message
 *    through `/idealize/studio/deliver`. The second boot reads it all back
 *    off disk through the pane.
 * 2. **The pinned Studio card sits above the projects, and the rail carries no
 *    Studio button** — both enumerated off the rendered DOM beside a live
 *    chat. Pressing the card opens the one Studio chat in the centre column:
 *    the Studio view fills it over the ordinary composer, the card reads
 *    current, and the project tree lists no row for that chat. The dark
 *    theme's boot finds the same Studio chat again instead of minting a
 *    second (one `studio` space record on disk across both themes).
 * 3. **The view renders the seeded fold**: the stale-marked synthesis, the
 *    unresolved-attention row apart from the full task list, both tasks under
 *    their seeded ids, the per-agent rows with presence honestly unreachable
 *    (no seeded owner is a live session), and the timeline with the message's
 *    Open chat way back to its source thread.
 * 4. **A failing state fetch states its own cause and offers Retry while the
 *    stale view stays visible** — stale coordination beats none — and Retry
 *    recovers once the route answers again.
 * 5. **Open chat restores position (FR-P0-23)**: a message delivered mid-run
 *    whose source thread is the REAL live chat, when its timeline row's Open
 *    chat is pressed, lands the transcript on a `data-chat-revealed` row —
 *    the reveal aimed at the event's instant, consumed by the chat's mount.
 * 6. **The ordinary composer speaks to one or all**: typing `@` offers the
 *    agents, a `@name` send lands in the timeline addressed to that
 *    participant alone, and an unaddressed send lands as a group post — on
 *    the timeline for everyone, invoking nobody. Neither send reaches a model:
 *    the host takes a Studio chat's message at `agent/pre-step`.
 * 7. **The timeline file on disk keeps its seeded prefix byte-intact** and
 *    every appended record is one this walk itself sent: the pane's reads
 *    are not a migration.
 *
 * The model behind the one real turn is `@deepseek-ai/dsh-llm-mock-server`, so
 * the run needs no provider key; the turn exists to give the pane an active
 * chat whose working directory is the seeded project.
 *
 * Isolation: the run refuses to start unless `DSH_HOME` and `HOME` both point
 * inside the temporary directory it made.
 *
 * Usage: OUT=.idealize/proof pnpm exec tsx packages/idealize/ui-studio/proof/studio-proof.mts
 */
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
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
const root = await mkdtemp(join(tmpdir(), 'idealize-studio-proof-'))
const home = join(root, 'home')
const dshHome = join(root, 'dsh-home')
let projectDir = join(root, 'project')
for (const dir of [home, dshHome, projectDir]) await mkdir(dir, { recursive: true })
// macOS tmp rides a symlink (/tmp → /private/tmp): the workspace store
// canonicalises its path, so the seeded timeline must use the same spelling —
// studio's route resolves but does not realpath, and two spellings of one
// folder would be two timelines (recorded in @idealize/studio's Known
// Limitations).
projectDir = await realpath(projectDir)
// A file the scripted tool call reads, so the turn carries a tool record.
await writeFile(join(projectDir, 'NOTES.md'), '# Notes\n\nThe Studio pane proof reads this file.\n')

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

/** Boot `dsh --profile idealize` and wait for the studio route to answer. */
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
      // Wait until the studio ROUTE itself answers with a folded state — the
      // moment its registration landed — AND until the `/api` RPC channel
      // answers, which `workspace.create` needs.
      const response = await fetch(`http://127.0.0.1:${String(port)}/idealize/studio/state?project=${encodeURIComponent(projectDir)}`)
      if (response.ok && Array.isArray((await response.json() as { tasks?: unknown[] }).tasks)) {
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

/** The coordination the project already holds before the pane ever renders. */
const SEEDED_EVENTS = [
  { kind: 'assignment', subtype: 'new-task', author: 'user', target: 'agent-alpha', taskId: 't-wire', body: 'Wire the roster' },
  { kind: 'task-update', subtype: 'working', author: 'agent-alpha', taskId: 't-wire' },
  { kind: 'request', subtype: 'needs-input', author: 'agent-alpha', target: 'user', taskId: 't-wire', body: 'Which port should the roster use?' },
  { kind: 'synthesis', subtype: 'current', author: 'session-lead', body: 'Iteration one is on track; the roster wiring is the open question.' },
  // A later assignment stales the synthesis and queues a second task.
  { kind: 'assignment', subtype: 'new-task', author: 'user', target: 'agent-beta', taskId: 't-pane', body: 'Ship the pane' },
]

// ── Step 1: create the record through studio's own routes, browser absent ───
const seedPort = await freePort()
const seedHost = await boot(seedPort)

for (const event of SEEDED_EVENTS) {
  const response = await fetch(`http://127.0.0.1:${String(seedPort)}/idealize/studio/event`, {
    method: 'POST', headers: AUTH, body: JSON.stringify({ project: projectDir, ...event }),
  })
  if (!response.ok) throw new Error(`seeding ${event.kind} failed: ${String(response.status)} ${await response.text()}`)
}
// One addressed message through deliver — the one message path (FR-P0-09) —
// carrying its source thread, so the timeline offers Open chat.
const delivered = await fetch(`http://127.0.0.1:${String(seedPort)}/idealize/studio/deliver`, {
  method: 'POST',
  headers: AUTH,
  body: JSON.stringify({
    project: projectDir, author: 'user', kind: 'message', target: 'agent-alpha',
    body: 'Please pick up the roster review next.', messageId: 'proof-m-1', source: { thread: 'agent-alpha' },
  }),
})
if (!delivered.ok) throw new Error(`seeding the message failed: ${String(delivered.status)} ${await delivered.text()}`)
await stop(seedHost)

const studioDir = join(dshHome, 'idealize', 'studio')
const [timelineFile] = await readdir(studioDir)
if (timelineFile === undefined) throw new Error('no timeline file was written under idealize/studio')
const timelinePath = join(studioDir, timelineFile)
const seededTimeline = await readFile(timelinePath)
console.log(`seeded ${String(SEEDED_EVENTS.length + 1)} events into ${timelineFile} (${String(seededTimeline.length)} bytes)`)

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
  if (!response.ok) throw new Error(`${method} failed: ${reply}`)
  return reply
}

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
  // A relaunch lands on the last open chat. When that is the Studio chat (the
  // dark theme boots after the light theme left it current), the welcome card
  // is retired under it: start a fresh chat first.
  if (await page.locator('[data-studio-pane]').count() > 0) {
    await page.getByRole('button', { name: 'New chat' }).first().click()
    const fresh = await page.locator('[data-launcher-step="space"] [data-space="chat"]').waitFor({ state: 'visible', timeout: 30_000 })
      .then(() => true, () => false)
    if (!fresh) {
      await page.screenshot({ path: join(out, 'debug-studio-newchat.png') })
      console.log(`  newchat-debug: ${JSON.stringify(await observe(page))}`)
      throw new Error('New chat from the Studio chat never showed the welcome card')
    }
  }
  if (await page.locator('[data-launcher-step]').count() === 0) {
    await page.getByText(projectName, { exact: true }).first().click({ timeout: 30_000 })
    await page.locator('[data-launcher-step]').waitFor({ timeout: 30_000 })
  }
  const brain = page.locator('[data-brain]')
  if (await brain.count() === 0) {
    for (let attempt = 0; attempt < 5; attempt++) {
      await page.locator('[data-launcher-step="space"] [data-space="chat"]').click()
      const advanced = await page.locator('[data-launcher-step="brain"]').waitFor({ timeout: 5_000 })
        .then(() => true, () => false)
      if (advanced) break
      if (attempt === 4) {
        await page.screenshot({ path: join(out, 'debug-studio-launch.png') })
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
  await page.keyboard.press('Meta+Enter')
  await page.waitForFunction(
    () => document.querySelectorAll('[data-running], [data-turn-running]').length === 0,
    undefined,
    { timeout: 90_000 },
  ).catch(() => undefined)
  await page.waitForTimeout(2_500)
}

/** What the running app renders, read off the DOM. */
async function observe(page: Page): Promise<Record<string, unknown>> {
  // No inner function may be bound to a const here: tsx compiles this module
  // through esbuild's keepNames, which wraps such a binding in a `__name`
  // helper that does not exist inside the page.
  return page.evaluate(() => {
    const synthesis = document.querySelector('[data-studio-synthesis]')
    const card = document.querySelector('[data-studio-card]')
    const seat = document.querySelector('[data-composer-seat]')
    return {
      railButtons: [...document.querySelectorAll('[data-slot="shell.rail"] button')]
        .map(button => button.getAttribute('aria-label') ?? ''),
      card: card === null
        ? null
        : {
          label: card.getAttribute('aria-label'),
          current: card.hasAttribute('data-current'),
          presence: card.querySelector('[data-studio-card-presence]')?.getAttribute('data-studio-card-presence') ?? null,
          unread: card.querySelector('[data-studio-card-unread]')?.textContent ?? null,
          attention: card.querySelector('[data-studio-card-attention]')?.textContent ?? null,
        },
      // The Studio chat owns its column: the composer seat is retired under it.
      composerSeatShown: seat !== null && getComputedStyle(seat).display !== 'none',
      blankView: document.querySelector('[data-blank-view]')?.getAttribute('data-blank-view') ?? null,
      sidebarRowTitles: [...document.querySelectorAll('[role="treeitem"]')]
        .map(row => (row.textContent ?? '').trim()),
      paneOpen: document.querySelector('[data-studio-pane]') !== null,
      synthesisText: synthesis?.textContent ?? null,
      synthesisStale: synthesis?.hasAttribute('data-stale') ?? null,
      attentionIds: [...document.querySelectorAll('[data-studio-attention]')]
        .map(node => node.getAttribute('data-studio-attention')),
      attentionText: [...document.querySelectorAll('[data-studio-attention]')]
        .map(node => (node.textContent ?? '').trim()),
      taskIds: [...document.querySelectorAll('[data-studio-task]')]
        .map(node => node.getAttribute('data-studio-task')),
      agents: [...document.querySelectorAll('[data-studio-agent]')].map(node => ({
        id: node.getAttribute('data-studio-agent'),
        presence: node.querySelector('[data-presence]')?.getAttribute('data-presence') ?? null,
        text: (node.textContent ?? '').trim(),
      })),
      eventCount: document.querySelectorAll('[data-studio-event]').length,
      openChatButtons: [...document.querySelectorAll('[data-studio-pane] button')]
        .filter(button => (button.textContent ?? '').trim() === 'Open chat').length,
      errorText: document.querySelector('[data-studio-error]')?.textContent ?? null,
      focusedEventId: document.querySelector('[data-studio-focused]')?.getAttribute('data-studio-event-id') ?? null,
      unreadEventIds: [...document.querySelectorAll('[data-studio-unread]')]
        .map(node => node.getAttribute('data-studio-event-id')),
      resolutions: [...document.querySelectorAll('[data-studio-resolution]')].map(node => ({
        event: node.closest('[data-studio-event-id]')?.getAttribute('data-studio-event-id') ?? null,
        state: node.getAttribute('data-studio-resolution'),
        text: (node.textContent ?? '').trim(),
      })),
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

/** How many chats the host lists in the `studio` space: one per project once its card has been pressed. */
async function studioChatCount(): Promise<number> {
  const response = await fetch(new URL('/api/session.list', base), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: 'session.list', payload: {} }),
  })
  const body = await response.json() as { result: { value: { items: { projections?: { values?: { space?: { space?: string } } } }[] } } }
  return body.result.value.items.filter(item => item.projections?.values?.space?.space === 'studio').length
}

/** The attention ledger: where the person has read to, and what became of each alert. */
async function ledger(): Promise<{ read: Record<string, number>; notifications: { event: string; row: string; state: string }[] }> {
  const response = await fetch(`${base}/idealize/notify/attention`)
  if (!response.ok) throw new Error(`the attention ledger refused: ${String(response.status)}`)
  return await response.json() as { read: Record<string, number>; notifications: { event: string; row: string; state: string }[] }
}

/** One recorded event of a kind, off the timeline route. */
async function seededEvent(kind: string, subtype: string): Promise<{ id: string; seq: number }> {
  const response = await fetch(`${base}/idealize/studio/timeline?project=${encodeURIComponent(projectDir)}`)
  const events = (await response.json() as { events: { id: string; seq: number; kind: string; subtype?: string }[] }).events
  const found = events.find(event => event.kind === kind && event.subtype === subtype)
  if (found === undefined) throw new Error(`no ${kind}/${subtype} event on the timeline`)
  return { id: found.id, seq: found.seq }
}

/** Open the project's Studio chat from the pinned card (skipped when it is already on screen) and wait for the seeded fold to land. */
async function openStudio(page: Page): Promise<void> {
  if (await page.locator('[data-studio-pane]').count() === 0) {
    await page.locator('[data-studio-card]').click()
  }
  await page.locator('[data-studio-pane]').waitFor({ timeout: 30_000 })
  // The pane polls its routes; the seeded tasks landing is the honest ready signal.
  await page.locator('[data-studio-task="t-wire"]').waitFor({ timeout: 20_000 })
  await page.waitForTimeout(500)
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
  // Un-blank the chat so the pane has an active chat whose cwd is the project.
  await turn(page, 'Read NOTES.md and tell me what it says.')

  // The live chat's id, read off the workspace record BEFORE the Studio chat
  // is minted (it joins the same record); step 4 addresses it.
  const listed = await fetch(new URL('/api/workspace.list', base), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: 'workspace.list', payload: {} }),
  })
  const workspaces = (await listed.json() as { result: { value: { items: { path: string; sessionIds: string[] }[] } } }).result.value.items
  const liveSession = workspaces.find(candidate => candidate.path === projectDir)?.sessionIds.at(-1)
  expect(liveSession !== undefined, `the workspace record names the live chat (got ${JSON.stringify(workspaces)})`)

  // 2. The pinned card and the rail, enumerated off the DOM.
  const audit = await observe(page)
  console.log(`  tool rail: ${JSON.stringify(audit.railButtons)}; card: ${JSON.stringify(audit.card)}`)
  expect(!(audit.railButtons as string[]).includes('Studio'), 'the tool rail carries no Studio button')
  const card = audit.card as { label: string | null; current: boolean } | null
  expect(card !== null, 'the pinned Studio card sits above the projects')
  expect(card?.label === 'Open the Studio', `the card opens the one Studio (got ${JSON.stringify(card?.label)})`)
  expect(card?.current === false, 'the card does not read current while a plain chat is open')
  // FR-P0-19, first record: unread is what the person has not looked at. The
  // light run meets an unread Studio; the dark run meets what light read.
  const cardMarks = audit.card as { unread: string | null; attention: string | null } | null
  const unreadExpected = theme === 'light'
  expect((cardMarks?.unread !== null) === unreadExpected,
    `the card's unread mark ${unreadExpected ? 'counts the unread Studio' : 'stays clear: what the light run read stays read'} (got ${JSON.stringify(cardMarks?.unread)})`)
  expect(cardMarks?.attention !== null, 'the card counts unresolved attention beside it, as its own record')
  expect(audit.composerSeatShown === true, 'the plain chat keeps its composer')
  await writeFile(join(out, `studio-audit-${theme}.json`),
    `${JSON.stringify({ railButtons: audit.railButtons, card: audit.card }, null, 2)}\n`)

  // 3. The seeded fold, rendered in the centre column.
  await openStudio(page)
  const opened = await shoot(page, `studio-open-${theme}`)
  expect(opened.paneOpen === true, 'the Studio view is on screen')
  // Light opens a Studio chat that has never posted: a blank chat on the
  // `studio` view. Dark reopens the same chat after the light run's posts;
  // it is an active chat now and the ring still shows the Studio view.
  const blankExpected = theme === 'light' ? 'studio' : null
  expect(opened.blankView === blankExpected, `the Studio chat renders on the Studio view (blank view ${JSON.stringify(opened.blankView)}, expected ${JSON.stringify(blankExpected)})`)
  expect(opened.composerSeatShown === true, 'the Studio chat keeps the ordinary composer (JJ, 3 Sep 2026)')
  expect((opened.card as { current: boolean } | null)?.current === true, 'the card reads current while its Studio chat is open')
  expect(!(opened.sidebarRowTitles as string[]).some(title => title.startsWith('Studio')), `the project tree lists no row for the Studio chat (rows: ${JSON.stringify(opened.sidebarRowTitles)})`)
  expect(await studioChatCount() === 1, `one Studio chat exists after the ${theme} open (got ${String(await studioChatCount())})`)
  expect(String(opened.synthesisText).includes('Iteration one is on track'), 'the seeded synthesis renders')
  expect(opened.synthesisStale === true, 'the synthesis is marked stale (a later assignment moved past it)')
  expect((opened.attentionIds as string[]).join(',') === 't-wire', `only the task holding attention lists under Needs attention (got ${JSON.stringify(opened.attentionIds)})`)
  expect((opened.attentionText as string[]).some(text => text.includes('Needs input')), 'the attention row names its state')
  for (const id of ['t-wire', 't-pane']) {
    expect((opened.taskIds as string[]).includes(id), `the seeded task ${id} renders under its id`)
  }
  const agents = opened.agents as { id: string | null; presence: string | null; text: string }[]
  const alpha = agents.find(agent => agent.id === 'agent-alpha')
  expect(alpha !== undefined && alpha.text.includes('Wire the roster'), 'agent-alpha\'s row carries its active task\'s goal')
  expect(agents.every(agent => agent.presence === 'unreachable'), 'presence is honestly unreachable (no seeded owner is a live session)')
  expect((opened.eventCount as number) >= 6, `the timeline renders the seeded events (got ${String(opened.eventCount)})`)
  expect((opened.openChatButtons as number) >= 1, 'the delivered message offers Open chat back to its source thread')

  // 3b. A6: the alerts, and the three records kept apart. The seeded
  // needs-input request alerted in the seeding boot, before any browser
  // existed; its record is still on the ledger.
  const seededRequest = await seededEvent('request', 'needs-input')
  const raised = await ledger()
  const seededAlert = raised.notifications.find(record => record.event === seededRequest.id)
  expect(seededAlert !== undefined, `the seeded needs-input request raised an alert with no window attached (ledger: ${JSON.stringify(raised.notifications)})`)
  expect(seededAlert?.row === 'needs-input', `the alert names the MVP table row that raised it (got ${JSON.stringify(seededAlert?.row)})`)
  expect((raised.read[projectDir] ?? 0) >= seededRequest.seq,
    `showing the Studio moved the read position past the seeded request (read ${String(raised.read[projectDir] ?? 0)}, seq ${String(seededRequest.seq)})`)
  const readCleared = await observe(page)
  expect((readCleared.unreadEventIds as string[]).length === 0,
    `every row reads as read while the Studio is on screen (got ${JSON.stringify(readCleared.unreadEventIds)})`)

  // One fresh request this theme owns, so each run answers its own.
  const askedResponse = await fetch(`${base}/idealize/studio/event`, {
    method: 'POST',
    headers: AUTH,
    body: JSON.stringify({
      project: projectDir, author: 'agent-beta', kind: 'request', subtype: 'needs-input',
      target: 'user', taskId: 't-pane', body: `alert check ${theme}: which font?`,
    }),
  })
  expect(askedResponse.ok, `the ${theme} request records (${String(askedResponse.status)})`)
  const asked = (await askedResponse.json() as { event: { id: string } }).event
  const alerted = await page.waitForFunction(
    (eventId) => document.querySelector(`[data-studio-event-id="${eventId}"]`) !== null,
    asked.id,
    { timeout: 20_000 },
  ).then(() => true, () => false)
  expect(alerted, 'the fresh request reaches the pane timeline')
  const freshAlert = (await ledger()).notifications.find(record => record.event === asked.id)
  expect(freshAlert?.state === 'sent', `the fresh request raised its own alert (got ${JSON.stringify(freshAlert)})`)

  // Dismissing the alert changes the alert's record and nothing else.
  const dismissed = await fetch(`${base}/idealize/notify/attention/state`, {
    method: 'POST', headers: AUTH, body: JSON.stringify({ event: asked.id, state: 'dismissed' }),
  })
  expect(dismissed.ok, `the dismissal is recorded (${String(dismissed.status)})`)
  expect((await ledger()).notifications.find(record => record.event === asked.id)?.state === 'dismissed', 'the alert reads dismissed')
  const afterDismiss = await observe(page)
  expect((afterDismiss.attentionIds as string[]).includes('t-pane'),
    `the dismissed alert leaves the unanswered request unanswered (attention: ${JSON.stringify(afterDismiss.attentionIds)}, FR-P0-19)`)

  // Opening an alert lands the view on its exact event, showing what the
  // request is still waiting for.
  await page.evaluate((eventId) => {
    document.dispatchEvent(new CustomEvent('idealize:open-studio', { detail: { studioEvent: eventId } }))
  }, asked.id)
  const landedOnEvent = await page.waitForFunction(
    (eventId) => document.querySelector('[data-studio-focused]')?.getAttribute('data-studio-event-id') === eventId,
    asked.id,
    { timeout: 20_000 },
  ).then(() => true, () => false)
  expect(landedOnEvent, 'an opened alert lands the Studio on its exact event')
  const onEvent = await observe(page)
  const requestRow = (onEvent.resolutions as { event: string | null; state: string | null; text: string }[])
    .find(row => row.event === asked.id)
  expect(requestRow?.state === 'open', `the open request says it is waiting (got ${JSON.stringify(requestRow)})`)
  expect(requestRow?.text === 'Waiting for you', `the waiting row names what it waits for (got ${JSON.stringify(requestRow?.text)})`)
  await shoot(page, `studio-alert-${theme}`)

  // The answer is the only thing that resolves it, and an alert opened after
  // the answer shows the answer.
  const answered = await fetch(`${base}/idealize/studio/event`, {
    method: 'POST',
    headers: AUTH,
    body: JSON.stringify({ project: projectDir, author: 'user', kind: 'system', subtype: 'resolve-request', taskId: 't-pane', source: { event: asked.id } }),
  })
  expect(answered.ok, `the request is answered through the Studio's own route (${String(answered.status)})`)
  const nowAnswered = await page.waitForFunction(
    (eventId) => document.querySelector(`[data-studio-event-id="${eventId}"] [data-studio-resolution]`)?.getAttribute('data-studio-resolution') === 'answered',
    asked.id,
    { timeout: 20_000 },
  ).then(() => true, () => false)
  expect(nowAnswered, 'the answered request shows its recorded resolution, with nothing left to answer')
  expect((await ledger()).notifications.find(record => record.event === asked.id)?.state === 'dismissed',
    'answering the request left the alert\'s own record where it was')

  // 4. FR-P0-23: a message whose source thread is the REAL live chat, then
  // Open chat on its row — the transcript must land on a revealed row. The
  // session id came off the workspace record above, not a guess.
  if (liveSession !== undefined) {
    const reveal = await fetch(`${base}/idealize/studio/deliver`, {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({
        project: projectDir, author: 'agent-alpha', kind: 'message', target: 'user',
        body: 'Come back to the roster thread.', messageId: `proof-reveal-${theme}`,
        source: { thread: liveSession },
      }),
    })
    expect(reveal.ok, `the reveal message delivers (${String(reveal.status)})`)
    // The pane polls every 3s; the new row's Open chat is the wait signal.
    const rowArrived = await page.waitForFunction(
      () => [...document.querySelectorAll('[data-studio-pane] button')]
        .filter(button => (button.textContent ?? '').trim() === 'Open chat').length >= 2,
      undefined,
      { timeout: 20_000 },
    ).then(() => true, () => false)
    if (!rowArrived) {
      const routeView = await fetch(`${base}/idealize/studio/timeline?project=${encodeURIComponent(projectDir)}`)
      const routeEvents = (await routeView.json() as { events: { kind: string; messageId?: string; source?: { thread?: string } }[] }).events
      console.log(`  reveal-debug route events: ${JSON.stringify(routeEvents.map(event => [event.kind, event.messageId ?? '', event.source?.thread ?? '']))}`)
      console.log(`  reveal-debug pane: ${JSON.stringify(await observe(page))}`)
      await page.screenshot({ path: join(out, `debug-reveal-${theme}.png`) })
    }
    expect(rowArrived, 'the delivered reveal message reaches the pane timeline')
    if (rowArrived) {
      // The Studio chat is current, so the live chat is not: the Open chat
      // press mounts it and consumes the reveal.
      await page.locator('[data-studio-pane] button', { hasText: 'Open chat' }).last().click()
      const landed = await page.locator('[data-chat-revealed]').waitFor({ timeout: 20_000 })
        .then(() => true, () => false)
      if (!landed) await page.screenshot({ path: join(out, `debug-reveal-land-${theme}.png`) })
      expect(landed, 'Open chat lands the transcript on a data-chat-revealed row (FR-P0-23)')
      if (landed) await shoot(page, `studio-reveal-${theme}`)
      // Back to the Studio chat for the composer and failure steps: the card
      // finds the existing chat rather than minting another.
      await openStudio(page)
      expect(await studioChatCount() === 1, 'reopening from the card reuses the project\'s Studio chat')
    }
  }

  // 5. The ordinary composer speaks to one or all: a send from the Studio
  // chat never reaches a model — the host takes it at pre-step, delivers a
  // leading @name to that participant, and records the rest as a group post.
  // The address must name a real participant: the roster serves the
  // project's chats under their drawn agent names, so the walk addresses the
  // first chip, and the `@` menu must offer that name.
  const rosterRead = await fetch(`${base}/idealize/askbar/roster?project=${encodeURIComponent(projectDir)}`)
  const chips = (await rosterRead.json() as { chips: { id: string; name: string }[] }).chips
  const chip = chips[0]
  expect(chip !== undefined, `the roster names the project's chats (${String(chips.length)} chips)`)
  const composer = page.locator('[data-composer-seat] textarea').first()
  await composer.waitFor({ timeout: 30_000 })
  await composer.click()
  await composer.pressSequentially('@', { delay: 50 })
  const menuOffers = await page.waitForFunction(
    ({ needle }) => (document.body.textContent ?? '').includes(needle),
    { needle: chip?.name ?? '' },
    { timeout: 10_000 },
  ).then(() => true, () => false)
  expect(menuOffers, `typing @ offers the agent ${String(chip?.name)} in the composer menu`)
  await page.keyboard.press('Escape')
  await composer.fill(`@${chip?.name ?? ''} composer check ${theme}`)
  await page.keyboard.press('Enter')
  const composedRow = await page.waitForFunction(
    ({ needle }) => [...document.querySelectorAll('[data-studio-event]')]
      .some(row => (row.textContent ?? '').includes(needle)),
    { needle: `composer check ${theme}` },
    { timeout: 20_000 },
  ).then(() => true, () => false)
  if (!composedRow) {
    const routeView = await fetch(`${base}/idealize/studio/timeline?project=${encodeURIComponent(projectDir)}`)
    const routeEvents = (await routeView.json() as { events: { kind: string; body?: string; target?: string }[] }).events
    console.log(`  composer-debug route tail: ${JSON.stringify(routeEvents.slice(-4))}`)
    console.log(`  composer-debug pane: ${JSON.stringify(await observe(page))}`)
    await page.screenshot({ path: join(out, `debug-composer-${theme}.png`) })
  }
  expect(composedRow, 'the @name send lands in the pane timeline')
  const addressedRow = await page.evaluate(({ needle }) => {
    const row = [...document.querySelectorAll('[data-studio-event]')]
      .find(candidate => (candidate.textContent ?? '').includes(needle))
    return row?.textContent ?? null
  }, { needle: `composer check ${theme}` })
  expect(addressedRow !== null && addressedRow.includes(`user → ${chip?.id ?? ''}`), `the @name send lands addressed to ${String(chip?.id)} alone (${String(addressedRow)})`)
  await composer.fill(`group note ${theme}: detail lives in the vault doc`)
  await page.keyboard.press('Enter')
  const groupPosted = await page.waitForFunction(
    ({ needle }) => [...document.querySelectorAll('[data-studio-event]')]
      .some(row => (row.textContent ?? '').includes(needle)),
    { needle: `group note ${theme}` },
    { timeout: 20_000 },
  ).then(() => true, () => false)
  expect(groupPosted, 'the unaddressed send lands as a group post on the timeline')
  const groupRow = await page.evaluate(({ needle }) => {
    const row = [...document.querySelectorAll('[data-studio-event]')]
      .find(candidate => (candidate.textContent ?? '').includes(needle))
    return row?.textContent ?? null
  }, { needle: `group note ${theme}` })
  expect(groupRow !== null && !groupRow.includes('→'), `the group post invokes nobody (${String(groupRow)})`)
  await shoot(page, `studio-composer-${theme}`)

  // 6. A failing overview fetch: cause + Retry, stale view kept, recovery.
  await page.route('**/idealize/studio/overview*', route => route.fulfill({ status: 503, body: 'studio down' }))
  await page.locator('[data-studio-error]').waitFor({ timeout: 20_000 })
  const failed = await shoot(page, `studio-error-${theme}`)
  expect(String(failed.errorText).includes('503'), 'the failure states its own cause')
  const retries = await page.getByRole('button', { name: 'Retry' }).count()
  expect(retries === 1, 'the failure offers a recovery action')
  expect((failed.taskIds as string[]).includes('t-wire'), 'the stale view stays visible under the failure')
  await page.unroute('**/idealize/studio/overview*')
  await page.getByRole('button', { name: 'Retry' }).click()
  await page.locator('[data-studio-error]').waitFor({ state: 'detached', timeout: 20_000 })
  expect(true, 'Retry recovers once the routes answer again')

  // 7. Reading is not a migration: the seeded prefix is byte-intact, and
  // every appended line is a message this walk itself sent (the reveal or a
  // composer send) or its recorded delivery state.
  const after = (await readFile(timelinePath)).toString('utf8')
  expect(after.startsWith(seededTimeline.toString('utf8')), `the seeded timeline prefix is byte-intact after the ${theme} round trip`)
  const appended = after.slice(seededTimeline.toString('utf8').length).split('\n').filter(line => line !== '')
  expect(
    appended.every((line) => {
      const record = JSON.parse(line) as { messageId?: string; subtype?: string; body?: string }
      return record.messageId?.startsWith('proof-reveal') === true || record.messageId?.startsWith('sm-') === true
        || record.subtype?.startsWith('delivery-') === true || record.subtype === 'resolve-request'
        || record.body?.startsWith('alert check') === true
    }),
    `every appended record is the delivered reveal, a composer send, a delivery state or the walk's own answer (${String(appended.length)} appended)`,
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
console.log(`\nwrote Studio proofs to ${out}`)
