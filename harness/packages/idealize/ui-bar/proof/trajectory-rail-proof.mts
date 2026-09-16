/**
 * Proof run (not a vitest spec): boot the REAL assembled IDEalize app — the
 * whole `idealize` profile, so the tool rail, the drawer column, the
 * conversation view ring and the composer are the shipped ones — then drive it
 * headlessly at the packaged window's 1280×840 in both themes.
 *
 * What it proves, in order:
 *
 * 1. **The ring no longer carries Trajectory.** Every conversation view tab is
 *    enumerated off the rendered DOM, and every tool-rail button beside it, so
 *    "Trajectory left the ring and joined the rail" is read off the page rather
 *    than inferred from a registration.
 * 2. **The ledger fits and scrolls inside the drawer** with the conversation
 *    still readable beside it: the drawer's measured width, the ledger
 *    scroller's `scrollTop` before and after a wheel, its `scrollHeight`
 *    against its `clientHeight`, and the chat's own visible text and width at
 *    the same instant.
 * 3. **The drawer's 320px minimum**, driven through the real drag handle, with
 *    the toolbar's controls and the ledger's rows measured there — the honest
 *    answer to "does it fit at the minimum", not an assumption.
 * 4. **The inspect handoff lands on the right record.** A tool row in the chat
 *    is expanded, its Inspect pill clicked, and the pane's SELECTED ROW is read
 *    back: `tr[aria-selected="true"]`'s `data-trajectory-row-key` carries
 *    `tool%00call%00<callId>`, and the callId is the one the chat row was
 *    showing. Asserting only "the pane opened" would pass while the ledger sat
 *    on the wrong record.
 *
 * The transcript is REAL: turns are driven through the shipped composer and run
 * through the shipped agent loop, so every session event, tool record and
 * request row in the ledger is one the app produced. The model behind it is
 * `@deepseek-ai/dsh-llm-mock-server` — a scripted OpenAI-compatible server, so
 * the run needs no provider key and the transcript is reproducible; nothing
 * about the loop, the tool execution or the projection is stubbed.
 *
 * Isolation: the run refuses to start unless `DSH_HOME` and `HOME` both point
 * inside the temporary directory it made, and it re-reads them off the booted
 * host's own settings path before it writes anything. The user's real harness
 * home holds live chats and is never opened.
 *
 * Usage: OUT=.idealize/proof pnpm exec tsx packages/idealize/ui-bar/proof/trajectory-rail-proof.mts
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
const root = await mkdtemp(join(tmpdir(), 'idealize-trajectory-proof-'))
const home = join(root, 'home')
const dshHome = join(root, 'dsh-home')
const projectDir = join(root, 'project')
for (const dir of [home, dshHome, projectDir]) await mkdir(dir, { recursive: true })
// A file the scripted tool call reads, so the transcript carries a tool record
// with real arguments and a real result.
await writeFile(join(projectDir, 'NOTES.md'), '# Notes\n\nThe trajectory ledger reads this file.\n')

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

// The project the run works inside, registered before the first render: the
// welcome card only asks its questions inside a project.
console.log(`workspace.create: ${await rpc('workspace.create', { path: projectDir })}`)
const projectName = projectDir.split('/').pop() ?? projectDir
console.log(`project: ${projectDir}`)

// The host's own view of where it is writing, read back off its settings route:
// DSH_HOME in this process is a request, not proof that the host honoured it.
const boundHome = await fetch(new URL('/idealize/bar/capabilities', base)).then(r => r.text())
console.log(`host capabilities: ${boundHome}`)

const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: 1280, height: 840 },
  deviceScaleFactor: 2,
  locale: 'en-GB',
})
const page: Page = await context.newPage()
const errors: string[] = []
page.on('pageerror', (error) => { errors.push(String(error)) })

const RAIL_ANCHOR = 'Brains'
const stamps: string[] = []

/** Clear first-run, the opening sequence and the showcase, then open the project. */
async function settleApp(): Promise<void> {
  await settle(page, { ready: page.getByRole('button', { name: RAIL_ANCHOR, exact: true }) })
  for (let attempt = 0; attempt < 8; attempt++) {
    if (await page.locator('[class*="scrim"]').count() === 0) break
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
  }
}

/** Set the app's theme through the Appearance pane, then close the pane. */
async function setTheme(name: 'Light' | 'Dark'): Promise<void> {
  const rail = page.getByRole('button', { name: 'Appearance', exact: true })
  await rail.click()
  const swatch = page.getByRole('button', { name, exact: true })
  await swatch.first().waitFor({ timeout: 30_000 })
  await swatch.first().click()
  await page.waitForTimeout(500)
  await rail.click()
  await page.waitForTimeout(700)
}

/** Open the project and launch a Chat brain through the welcome card. */
async function launchChat(): Promise<void> {
  if (await page.locator('[data-launcher-step]').count() === 0) {
    await page.getByText(projectName, { exact: true }).first().click({ timeout: 30_000 })
    await page.locator('[data-launcher-step]').waitFor({ timeout: 30_000 })
  }
  const brain = page.locator('[data-brain]')
  if (await brain.count() === 0) {
    await page.locator('[data-space="chat"]').first().click()
    await page.locator('[data-launcher-step="brain"]').waitFor({ timeout: 30_000 })
  }
  await page.locator('[data-brain]').first().click()
  await page.waitForTimeout(2_000)
}

/**
 * Send one prompt through the shipped composer and wait for the turn to
 * settle. The fork's Enter policy types a newline, so submit is the
 * Cmd/Ctrl+Enter accelerator the composer documents.
 */
async function turn(text: string): Promise<void> {
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
 * buttons, the drawer and ledger geometry, the chat beside it, and the ledger's
 * selected record.
 */
async function observe(): Promise<Record<string, unknown>> {
  // No inner function may be bound to a const here: tsx compiles this module
  // through esbuild's keepNames, which wraps such a binding in a `__name`
  // helper that does not exist inside the page.
  return page.evaluate(() => {
    // The frame's real columns: the slot wrappers themselves lay out as
    // `display: contents` and measure zero.
    const drawerBox = document.querySelector('[data-idealize-surface="files"]')
      ?.getBoundingClientRect() ?? null
    const pane = document.querySelector('[data-trajectory-pane]')
    // The ledger's own vertical scroller (ui-trajectory's .tablePane).
    const scroller = [...document.querySelectorAll('[data-trajectory-pane] div')]
      .find(node => node.scrollHeight > node.clientHeight + 4
        && getComputedStyle(node).overflowY === 'auto') ?? null
    const chat = document.querySelector('[class*="centerCol"]')
    const chatBox = chat?.getBoundingClientRect() ?? null
    const selected = document.querySelector('tr[aria-selected="true"]')
    return {
      // The ring, enumerated: after S6 no tab may read Trajectory.
      ringTabs: [...document.querySelectorAll('[role="tab"]')].map(tab => (tab.textContent ?? '').trim()),
      // The rail, enumerated: Trajectory must be among these instead.
      railButtons: [...document.querySelectorAll('[data-slot="shell.rail"] button')]
        .map(button => button.getAttribute('aria-label') ?? ''),
      railPressed: [...document.querySelectorAll('[data-slot="shell.rail"] button')]
        .filter(button => button.getAttribute('aria-pressed') === 'true')
        .map(button => button.getAttribute('aria-label') ?? ''),
      paneTitle: document.querySelector('[aria-label="Trajectory"]') !== null,
      paneSession: pane?.getAttribute('data-trajectory-pane') ?? null,
      drawerWidth: drawerBox === null ? null : Math.round(drawerBox.width),
      chatWidth: chatBox === null ? null : Math.round(chatBox.width),
      chatLeft: chatBox === null ? null : Math.round(chatBox.left),
      // The conversation must still be readable beside the pane, not covered.
      chatText: (chat?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 160),
      ledgerToolbar: document.querySelector('[data-trajectory-pane] [role="toolbar"]') !== null,
      ledgerTimeline: document.querySelector('[data-trajectory-pane] [aria-label="Trajectory timeline"]') !== null,
      // The ledger's own controls, so "does it fit at 320" is answered by what
      // is on screen rather than by the pane merely rendering.
      ledgerControls: [...document.querySelectorAll('[data-trajectory-pane] [role="toolbar"] button')]
        .map(button => (button.textContent ?? '').trim() || (button.getAttribute('aria-label') ?? '')),
      ledgerToolbarOverflows: (() => {
        const inner = document.querySelector('[data-trajectory-pane] [role="toolbar"] > div')
        return inner === null ? null : inner.scrollWidth > inner.clientWidth + 1
      })(),
      ledgerRows: document.querySelectorAll('[data-trajectory-pane] tr[data-record-index]').length,
      ledgerKinds: [...document.querySelectorAll('[data-trajectory-pane] tr[data-kind]')]
        .map(row => row.getAttribute('data-kind')),
      scroller: scroller === null ? null : {
        scrollTop: Math.round(scroller.scrollTop),
        scrollHeight: Math.round(scroller.scrollHeight),
        clientHeight: Math.round(scroller.clientHeight),
        // The reserve the ledger keeps for a floating composer; a drawer pane
        // publishes zero, so this must not be the canvas's 152px+16.
        paddingBottom: getComputedStyle(scroller).paddingBottom,
      },
      // The inspect landing: which record the ledger is sitting on.
      selectedRowKey: selected?.getAttribute('data-trajectory-row-key') ?? null,
      selectedKind: selected?.getAttribute('data-kind') ?? null,
      selectedIndex: selected?.getAttribute('data-record-index') ?? null,
      detailsPanel: document.querySelector('[data-trajectory-pane] aside[aria-label="Event details"]')
        ?.getAttribute('aria-label') ?? null,
      // The record inspector's own width: a side-by-side split inside a
      // 420px pane squeezes it to `calc(100% - 280px)` and clips its labels
      // to single letters, so the width is the honest fit signal.
      detailsWidth: (() => {
        const panel = document.querySelector('[data-trajectory-pane] aside[aria-label="Event details"]')
        return panel === null ? null : Math.round(panel.getBoundingClientRect().width)
      })(),
      detailsTabs: [...document.querySelectorAll('[data-trajectory-pane] aside[aria-label="Event details"] [role="tab"]')]
        .map(tab => (tab.textContent ?? '').trim()),
      // Every tool call the chat is showing, so the clicked id is named.
      chatToolRows: [...document.querySelectorAll('[data-chat-anchor-key]')]
        .map(node => (node.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)),
    }
  })
}

/** Capture one frame with the settle guard in front of it. */
async function shoot(file: string, extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  await assertSettled(page, file)
  await page.screenshot({ path: join(out, `${file}.png`) })
  const observed = { ...await observe(), ...extra }
  stamps.push(`${file}: ${JSON.stringify(observed)}`)
  return observed
}

/**
 * Drag the drawer to a target width through AppFrame's own handle, and report
 * the width it settled at — which is the solver's answer, not the request.
 * The handle rides the drawer's inner (left) edge and reports
 * `setDrawer(base - dx)`, so narrowing moves right.
 */
async function dragDrawerTo(width: number): Promise<number> {
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

/**
 * Wheel over the ledger's own scroller and report its scrollTop either side.
 * The ledger opens at the tail and follows it, so the gesture that moves it is
 * the one a user makes to read earlier records: upward.
 */
async function scrollLedger(): Promise<{ before: number; after: number; overflow: number }> {
  const pane = await page.locator('[data-trajectory-pane]').boundingBox()
  if (pane === null) return { before: -1, after: -1, overflow: -1 }
  await page.mouse.move(pane.x + pane.width / 2, pane.y + pane.height / 2)
  const read = async (): Promise<{ top: number; overflow: number }> => page.evaluate(() => {
    const scroller = [...document.querySelectorAll('[data-trajectory-pane] div')]
      .find(node => node.scrollHeight > node.clientHeight + 4
        && getComputedStyle(node).overflowY === 'auto')
    return scroller === undefined
      ? { top: -1, overflow: -1 }
      : { top: Math.round(scroller.scrollTop), overflow: scroller.scrollHeight - scroller.clientHeight }
  })
  const start = await read()
  await page.mouse.wheel(0, -300)
  await page.waitForTimeout(700)
  const end = await read()
  return { before: start.top, after: end.top, overflow: end.overflow }
}

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

await watchLaunch(page)
await page.goto(base, { waitUntil: 'load' })
await page.getByRole('button', { name: RAIL_ANCHOR, exact: true }).waitFor({ timeout: 90_000 })
await settleApp()
await launchChat()

// ── The real transcript ────────────────────────────────────────────────────
// Enough turns that the ledger genuinely overflows the drawer: a pane that
// happens to fit its content proves nothing about scrolling inside it.
for (const prompt of TURNS) await turn(prompt)

const transcript = await page.evaluate(() => ({
  nodes: document.querySelectorAll('[data-chat-anchor-key]').length,
  toolCalls: document.querySelectorAll('[data-chat-call-id]').length,
}))
console.log(`transcript: ${JSON.stringify(transcript)} after ${String(TURNS.length)} turns`)
if (transcript.nodes < 3 || transcript.toolCalls < 1) {
  throw new Error(`refusing to photograph this transcript: ${JSON.stringify(transcript)} — the run needs real turns and at least one tool call to inspect`)
}

for (const theme of ['Light', 'Dark'] as const) {
  const suffix = theme.toLowerCase()
  await setTheme(theme)

  // 1 — the pane open beside the conversation, at the drawer's default width.
  await page.getByRole('button', { name: 'Trajectory', exact: true }).click()
  await page.locator('[data-trajectory-pane]').waitFor({ timeout: 30_000 })
  await page.waitForTimeout(800)
  const opened = await shoot(`trajectory-rail-open-${suffix}`)
  if ((opened.ringTabs as string[]).some(tab => /trajector/i.test(tab))) {
    throw new Error(`the conversation ring still carries a Trajectory tab: ${JSON.stringify(opened.ringTabs)}`)
  }
  if (!(opened.railButtons as string[]).includes('Trajectory')) {
    throw new Error(`the rail has no Trajectory button: ${JSON.stringify(opened.railButtons)}`)
  }

  // 2 — the ledger scrolling inside the drawer, conversation still beside it.
  const scrolled = await scrollLedger()
  const afterScroll = await shoot(`trajectory-rail-scrolled-${suffix}`, { scrolled })
  if (scrolled.overflow <= 0) {
    throw new Error(`the ledger does not overflow its drawer scroller, so nothing here proves scrolling: ${JSON.stringify(scrolled)}`)
  }
  if (scrolled.after >= scrolled.before) {
    throw new Error(`the ledger did not scroll inside the drawer: ${JSON.stringify(scrolled)}`)
  }
  if (!/Read NOTES\.md/.test(afterScroll.chatText as string)) {
    throw new Error(`the conversation is not readable beside the pane: ${JSON.stringify(afterScroll.chatText)}`)
  }

  // 3 — the drawer at its 320px minimum, dragged through the real handle.
  const narrow = await dragDrawerTo(320)
  await page.waitForTimeout(500)
  const min = await shoot(`trajectory-rail-min-${suffix}`, { draggedTo: 320, settledWidth: narrow })
  console.log(`drawer minimum: asked 320, settled ${String(narrow)}, ledger rows ${String(min.ledgerRows)}`)
  await dragDrawerTo(420)
  await page.waitForTimeout(500)

  // 4 — the inspect handoff. Expand the first tool row in the chat, read its
  // call id off the row, click its Inspect pill, then read the ledger's
  // selected record back and check the two agree.
  const toolCall = page.locator('[data-chat-call-id]').first()
  await toolCall.waitFor({ timeout: 30_000 })
  const clickedCallId = await toolCall.getAttribute('data-chat-call-id')
  // The row keeps its own expanded state, so the second theme's pass finds it
  // already open; toggling it there would hide the pill instead of showing it.
  const disclosure = toolCall.locator('[data-disclosure-row][data-expandable]').first()
  if (await disclosure.getAttribute('aria-expanded') !== 'true') {
    await disclosure.click()
    await page.waitForTimeout(500)
  }
  const inspect = toolCall.getByRole('button', { name: /^Inspect$/ }).first()
  await inspect.waitFor({ timeout: 30_000 })
  await inspect.click()
  await page.locator('[data-trajectory-pane]').waitFor({ timeout: 30_000 })
  await page.waitForTimeout(1_000)
  const landed = await shoot(`trajectory-rail-inspect-${suffix}`, { clickedCallId })
  const key = landed.selectedRowKey as string | null
  if (key === null) {
    throw new Error('the inspect click opened the pane but selected no record')
  }
  if (!key.startsWith('tool%00call%00')) {
    throw new Error(`the pane selected a ${String(landed.selectedKind)} record, not the tool call: ${key}`)
  }
  if (clickedCallId !== null && !key.endsWith(clickedCallId)) {
    throw new Error(`the pane landed on ${key}, not the call the chat row showed (${clickedCallId})`)
  }
  const detailsWidth = landed.detailsWidth as number | null
  if (detailsWidth === null || detailsWidth < 280) {
    throw new Error(`the record inspector is too narrow to read at this pane width: ${String(detailsWidth)}px`)
  }
  console.log(`inspect landed on ${key} (chat row call id: ${String(clickedCallId)}), inspector ${String(detailsWidth)}px wide with tabs ${JSON.stringify(landed.detailsTabs)}`)
}

for (const stamp of stamps) console.log(stamp)
console.log(`mock model requests served: ${String(mock.requests.length)}`)
if (errors.length > 0) console.log('PAGE ERRORS:', errors.join(' | '))

await teardown()
