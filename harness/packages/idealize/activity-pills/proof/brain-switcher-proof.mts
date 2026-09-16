/**
 * Proof run (not a vitest spec): boot the REAL assembled IDEalize app — the
 * whole `idealize` profile — and prove the composer's brain switcher, in a
 * Chat chat and in a Terminal chat with a live shell.
 *
 * What it proves, every state read back off the rendered DOM:
 *
 * 1. In a CHAT chat the menu offers the space's brains with the current one
 *    marked, and says nothing about restarts anywhere — there is no shell to
 *    lose.
 * 2. In a TERMINAL chat the "restarts the shell" label stands on exactly the
 *    brains whose launch command (or provider) differs from the running one,
 *    BEFORE anything is clicked. The commands come from the host's own
 *    `GET /idealize/terminal/launches`, which is also what the shell types.
 * 3. Choosing one of those brains asks first: a title, ONE line — "The
 *    terminal restarts. You may lose some context." — and two buttons.
 * 4. Cancel leaves the shell untouched: the grid still holds the command the
 *    old shell ran, and the composer still names the old brain.
 * 5. Continue restarts it: the grid shows the NEW brain's launch command
 *    actually running, and the composer names the new brain.
 *
 * WHY NOT A PLAIN BROWSER, AND WHY NOT THE PACKAGED WINDOW. There is no
 * embedded terminal in a browser: `@idealize/ui-terminal`'s host half probes
 * for the desktop shell's `desktopTerminals` service and registers nothing
 * without it. This run therefore composes `.idealize/proof-terminal-host.mjs`,
 * the repo's pty-backed stand-in for that service, so the shell in the capture
 * is a real zsh running real commands. The packaged Electron window would be
 * the other way to get one, but its vendored harness predates
 * `@idealize/spaces` — the app in `~/dev/idealize-desktop` has no
 * `/idealize/spaces` route to read a chat's brains from — so it cannot render
 * this slice at all until that vendor set is refreshed.
 *
 * Two things this run arranges outside the code under test, both through the
 * composition rather than by stubbing the browser:
 *
 * - launch commands that differ per brain (`echo` lines, so the shell's own
 *   output is the evidence that the new command ran);
 * - a scripted mock LLM route as the deployment default model, because a
 *   TERMINAL chat only shows the composer once it has started, and starting
 *   one means running a turn.
 *
 * Isolation: the run refuses to start unless `DSH_HOME` and `HOME` both point
 * inside the temporary directory it made. The user's real harness home holds
 * live sessions and is never opened.
 *
 * Usage: OUT=.idealize/proof pnpm exec tsx packages/idealize/activity-pills/proof/brain-switcher-proof.mts
 */
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
// Resolved from apps/web's devDependency: the proof borrows the web e2e browser.
import { chromium } from '../../../../apps/web/node_modules/playwright/index.mjs'
import type { Page } from '../../../../apps/web/node_modules/playwright/index.mjs'
import { assertSettled, settle, watchLaunch } from '../../../../.idealize/proof-settle.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..', '..')
const out = process.env.OUT ?? '.idealize/proof'
await mkdir(out, { recursive: true })

// ── Isolation, verified before anything is written ─────────────────────────
const root = await mkdtemp(join(tmpdir(), 'idealize-brain-switcher-proof-'))
const home = join(root, 'home')
const dshHome = join(root, 'dsh-home')
const projectDir = join(root, 'project')
for (const dir of [home, dshHome, projectDir]) await mkdir(dir, { recursive: true })

const env = {
  ...process.env,
  HOME: home,
  DSH_HOME: dshHome,
  XDG_CONFIG_HOME: join(home, '.config'),
  XDG_DATA_HOME: join(home, '.local', 'share'),
  IDEALIZE_SKIP_TOUR: '1',
  PROOF_MOCK_KEY: 'proof-key',
}
if (!env.DSH_HOME.startsWith(root) || !env.HOME.startsWith(root)) {
  throw new Error('refusing to run: DSH_HOME and HOME must both be inside the scratch root')
}
console.log(`isolated: HOME=${env.HOME}`)
console.log(`isolated: DSH_HOME=${env.DSH_HOME}`)

/** The launch command each brain types into a fresh shell, as this run configures them. */
const DEFAULT_LAUNCH = 'echo IDEALIZE-PI-SHELL'
const CODING_LAUNCH = 'echo IDEALIZE-CLAUDE-SHELL'
/** The brain the run launches the Terminal chat on, and the one it switches to. */
const FROM_BRAIN = 'design'
const TO_BRAIN = 'coding'

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

const mockPort = await freePort()
const appPort = await freePort()

/** Boot the scripted mock LLM route the app's default model points at. */
async function bootMockLlm(): Promise<ChildProcess> {
  const child = spawn(
    'node',
    [
      '--import', 'tsx/esm', 'packages/test-support/llm-mock-server/src/bin.ts',
      '--port', String(mockPort), '--sequence', 'success', '--repeat-last',
      '--success-text', 'Ready.',
    ],
    { cwd: repoRoot, env, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error('the mock LLM server never reported ready')) }, 60_000)
    child.stdout?.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('"ready"')) {
        clearTimeout(timer)
        resolve()
      }
    })
    child.stderr?.on('data', (chunk: Buffer) => { process.stderr.write(`  mock! ${chunk.toString()}`) })
  })
  return child
}

/**
 * The desktop shell's action service, as far as the roster read looks at it:
 * `@idealize/spaces` answers `desktop-only` for the Terminal space unless
 * `desktopActions.openTerminal` is a function, and there is no shell here to
 * open — the pty stand-in below is what actually serves the grid.
 */
const actionsPath = join(root, 'proof-desktop-actions.mjs')
await writeFile(actionsPath, [
  "export const name = 'proof-desktop-actions'",
  '',
  '/** @param {import(\'@deepseek-ai/cordis\').Context} ctx */',
  'export function apply(ctx) {',
  "  ctx.provide('desktopActions', { openTerminal: () => {} })",
  '}',
  '',
].join('\n'))

/**
 * The proof-only composition overlay: the pty-backed `desktopTerminals`
 * stand-in, the desktop-shell marker beside it, the per-brain launch commands,
 * and the mock model route.
 */
const patchPath = join(root, 'brain-switcher.patch.yml')
await writeFile(patchPath, [
  '# Generated by packages/idealize/activity-pills/proof/brain-switcher-proof.mts.',
  '- insert:',
  '    - id: proof-desktop-terminals',
  `      name: '${join(repoRoot, '.idealize', 'proof-terminal-host.mjs')}'`,
  '    - id: proof-desktop-actions',
  `      name: '${actionsPath}'`,
  '- id: idealize-ui-terminal',
  "  name: '@idealize/ui-terminal'",
  '  config:',
  `    launchCommand: '${DEFAULT_LAUNCH}'`,
  '    launchByActivity:',
  `      ${TO_BRAIN}: '${CODING_LAUNCH}'`,
  '- id: llm-pi-ai',
  '  config:',
  '    providers:',
  '      proofmock:',
  '        displayName: Proof mock',
  '        api: openai-completions',
  `        baseURL: http://127.0.0.1:${String(mockPort)}/v1`,
  '        apiKeyEnv: PROOF_MOCK_KEY',
  '        models:',
  '          - id: proof-model',
  '            name: Proof model',
  '            contextWindow: 128000',
  '- id: agent-default-model',
  '  config:',
  '    provider: proofmock',
  '    model: proof-model',
  '# Free is otherwise pinned to the free-tokens route, which resolves no model',
  '# here; without this its row would read as a provider change rather than',
  '# proving the launch-command rule.',
  '- id: idealize-activity-pills',
  '  config:',
  '    models:',
  '      free:',
  '        provider: proofmock',
  '        model: proof-model',
  '',
].join('\n'))

/** Boot `dsh --profile idealize` over the overlay and wait for the space roster to answer. */
async function bootApp(): Promise<ChildProcess> {
  const child = spawn(
    'node',
    [
      '--import', 'tsx/esm', 'apps/cli/src/bin.ts', '--profile', 'idealize',
      '--patch', patchPath, '--host', '127.0.0.1', '--port', String(appPort),
    ],
    { cwd: repoRoot, env, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  child.stdout?.on('data', (chunk: Buffer) => { process.stdout.write(`  host| ${chunk.toString()}`) })
  child.stderr?.on('data', (chunk: Buffer) => { process.stderr.write(`  host! ${chunk.toString()}`) })
  const deadline = Date.now() + 180_000
  for (;;) {
    if (Date.now() > deadline) throw new Error('the host never served the space roster')
    try {
      const response = await fetch(`${base}/idealize/spaces`)
      if (response.ok) {
        const body = await response.json() as { spaces?: unknown[] }
        if (Array.isArray(body.spaces)) return child
      }
    } catch {
      // Not listening yet, or the SPA shell is still the only answer.
    }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
}

const base = `http://127.0.0.1:${String(appPort)}`

const mock = await bootMockLlm()
const app = await bootApp()

/** One JSON-RPC call over the app's own HTTP surface; the reply may be empty. */
async function rpc(method: string, payload: unknown): Promise<string> {
  const response = await fetch(new URL(`/api/${method}`, base), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method, payload }),
  })
  return `${String(response.status)} ${await response.text()}`
}

const projectName = projectDir.split('/').pop() ?? projectDir
console.log(`workspace.create: ${await rpc('workspace.create', { path: projectDir })}`)

const launches = await (await fetch(`${base}/idealize/terminal/launches`)).json() as {
  default: string
  byActivity: Record<string, string>
}
console.log(`launches route: ${JSON.stringify(launches)}`)

/** The roster both welcome steps and the brain menu read. */
async function roster(): Promise<{ id: string; brainCount: number; brains: { id: string }[]; models: string; reason?: string }[]> {
  const response = await fetch(`${base}/idealize/spaces`)
  return (await response.json() as { spaces: { id: string; brainCount: number; brains: { id: string }[]; models: string; reason?: string }[] }).spaces
}

// The five activity brains are seeded into the user preset root on first boot,
// asynchronously; the roster answers before that lands.
for (let attempt = 0; attempt < 60; attempt += 1) {
  const spaces = await roster()
  if ((spaces.find(space => space.id === 'chat')?.brainCount ?? 0) > 0) break
  await new Promise(resolve => setTimeout(resolve, 1_000))
}
console.log(`roster: ${JSON.stringify(await roster())}`)

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1280, height: 840 }, deviceScaleFactor: 2, locale: 'en-GB' })
const page: Page = await context.newPage()
const errors: string[] = []
page.on('pageerror', (error) => { errors.push(String(error)) })

const stamps: string[] = []

/**
 * What the running app renders, read back off the DOM: the switcher's trigger,
 * every menu row with the line beside it, the dialog on screen, the ring's
 * active view (read off `data-blank-view`; the ring renders no tab row), and
 * what the shell grid currently holds.
 */
async function observe(): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const trigger = document.querySelector('[data-brain-switcher]')
    const dialog = document.querySelector('[role="dialog"]')
    const grid = document.querySelector('.xterm')
    return {
      trigger: trigger === null ? null : {
        label: (trigger.textContent ?? '').trim(),
        current: trigger.getAttribute('data-brain-current'),
        space: trigger.getAttribute('data-space'),
        expanded: trigger.getAttribute('aria-expanded'),
      },
      // One row per brain, with the exact line the user reads beside its name
      // and whether that line is the restart warning.
      rows: [...document.querySelectorAll('[data-brain]')].map((row) => {
        const meta = row.querySelector('[data-brain-meta]')
        return {
          brain: row.getAttribute('data-brain'),
          meta: (meta?.textContent ?? '').trim(),
          restarts: meta?.hasAttribute('data-brain-restarts') ?? false,
        }
      }),
      restartLabels: document.querySelectorAll('[data-brain-restarts]').length,
      // The heading row is the only leaf `presentation` node in the list; the
      // scrolling viewport around the rows carries the same role.
      menuHeading: [...document.querySelectorAll('[role="menu"] [role="presentation"]')]
        .filter(node => node.children.length === 0)
        .map(node => (node.textContent ?? '').trim())[0] ?? null,
      dialog: dialog === null ? null : {
        title: dialog.getAttribute('aria-label'),
        line: dialog.querySelector('[data-brain-restart-line]')?.textContent ?? null,
        lines: dialog.querySelectorAll('p').length,
        buttons: [...dialog.querySelectorAll('button')]
          .map(button => (button.textContent ?? '').trim()).filter(text => text.length > 0),
      },
      blankView: document.querySelector('[data-blank-view]')?.getAttribute('data-blank-view') ?? null,
      // The shell's own output is the evidence that a launch command ran.
      shell: grid === null ? null : (grid.textContent ?? '').replace(/\s+/g, ' ').trim().slice(-400),
    }
  })
}

/** Capture one frame with the settle guard in front of it. */
async function shoot(file: string): Promise<Record<string, unknown>> {
  await assertSettled(page, file)
  await page.screenshot({ path: join(out, `${file}.png`) })
  const state = await observe()
  stamps.push(`${file}: ${JSON.stringify(state)}`)
  return state
}

/** Clear first-run, the opening sequence and the tour, then open the project. */
async function ready(): Promise<void> {
  await settle(page, { ready: page.getByRole('button', { name: 'Brains', exact: true }) })
  for (let attempt = 0; attempt < 8; attempt++) {
    if (await page.locator('[class*="scrim"]').count() === 0) break
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
  }
  if (await page.locator('[data-launcher-step]').count() === 0
    && await page.locator('[data-brain-switcher]').count() === 0) {
    await page.getByText(projectName, { exact: true }).first().click({ timeout: 30_000 })
    await page.locator('[data-launcher-step]').waitFor({ timeout: 30_000 })
  }
}

/** Reload onto a fresh blank chat showing step 1 of the welcome card. */
async function newChat(): Promise<void> {
  await page.reload({ waitUntil: 'load' })
  await page.getByRole('button', { name: 'Brains', exact: true }).waitFor({ timeout: 60_000 })
  await ready()
  await page.locator('[data-launcher-step="space"]').waitFor({ timeout: 30_000 })
  await page.waitForTimeout(600)
}

/** Launch this chat into one space on one brain, through the welcome card. */
async function launch(space: string, brain: string): Promise<void> {
  await page.locator(`[data-launcher-step="space"] [data-space="${space}"]`).first().click()
  await page.locator('[data-launcher-step="brain"]').waitFor({ timeout: 30_000 })
  const row = page.locator(`[data-launcher-step="brain"] [data-brain="${brain}"]`).first()
  await row.waitFor({ timeout: 30_000 }).catch(async (cause: unknown) => {
    const step = await page.locator('[data-launcher-step="brain"]').first().innerHTML()
    await page.screenshot({ path: join(out, `debug-${space}-brain-step.png`) })
    throw new Error(`no "${brain}" row in the ${space} brain step: ${step}\n  cause: ${String(cause)}`)
  })
  await row.click()
  await page.waitForTimeout(2_500)
}

/** Open the composer's brain menu. */
async function openMenu(): Promise<void> {
  await page.locator('[data-brain-switcher]').first().click()
  await page.locator('[role="menu"]').waitFor({ timeout: 15_000 })
  await page.waitForTimeout(400)
}

await watchLaunch(page)
await page.goto(base, { waitUntil: 'load' })
await page.getByRole('button', { name: 'Brains', exact: true }).waitFor({ timeout: 60_000 })
await ready()

// ── 1. A Chat chat: brains, the current one marked, and no restart anywhere ─
await newChat()
await launch('chat', FROM_BRAIN)
await page.locator('[data-brain-switcher]').waitFor({ timeout: 30_000 })
await openMenu()
const chatMenu = await shoot('brain-switcher-chat-menu')
if ((chatMenu.restartLabels as number) !== 0) {
  throw new Error(`a Chat chat labelled ${String(chatMenu.restartLabels)} restarts; there is no shell to lose`)
}
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

// ── 2. A Terminal chat with a live shell ───────────────────────────────────
// The composer (and the switcher on it) belongs to a STARTED chat: a blank
// Terminal chat is still the welcome card's question. So the run launches into
// Terminal, runs one turn from the Chat view, and comes back. The ring renders
// no tab row (S8), so the flip is ui-terminal's ⌘J shortcut in both directions.
await newChat()
await launch('terminal', FROM_BRAIN)
await page.locator('.xterm').waitFor({ timeout: 30_000 })
for (let attempt = 0; attempt < 20; attempt += 1) {
  const grid = await page.locator('.xterm').innerText()
  if (grid.includes('IDEALIZE-PI-SHELL')) break
  await page.waitForTimeout(1_000)
}
await shoot('brain-switcher-terminal-launched')

await page.keyboard.press('Meta+j')
await page.waitForTimeout(600)
await page.locator('[data-composer-card] textarea').first().fill('Say ready.')
await page.keyboard.press('Enter')
await page.waitForTimeout(6_000)
await page.keyboard.press('Meta+j')
await page.waitForTimeout(1_200)

// The label stands in the menu row, BEFORE anything is clicked.
await openMenu()
const terminalMenu = await shoot('brain-switcher-terminal-menu')
const rows = terminalMenu.rows as { brain: string; meta: string; restarts: boolean }[]
const marked = rows.filter(row => row.restarts).map(row => row.brain).sort()
const expected = Object.entries(launches.byActivity)
  .filter(([, command]) => command.trim() !== launches.default.trim())
  .map(([brain]) => brain).sort()
if (JSON.stringify(marked) !== JSON.stringify(expected)) {
  throw new Error(`the menu marked ${JSON.stringify(marked)}; the launch commands differ for ${JSON.stringify(expected)}`)
}

// ── 3. The confirm: a title, one line, two buttons ─────────────────────────
await page.locator(`[data-brain="${TO_BRAIN}"]`).first().click()
await page.locator('[role="dialog"]').waitFor({ timeout: 15_000 })
await page.waitForTimeout(400)
const confirm = await shoot('brain-switcher-confirm')
const dialog = confirm.dialog as { line: string; buttons: string[] }
if (dialog.line !== 'The terminal restarts. You may lose some context.') {
  throw new Error(`the confirm line reads ${JSON.stringify(dialog.line)}`)
}
if (JSON.stringify(dialog.buttons) !== JSON.stringify(['Cancel', 'Continue'])) {
  throw new Error(`the confirm offers ${JSON.stringify(dialog.buttons)}`)
}

// ── 4. Cancel leaves the shell untouched ───────────────────────────────────
const before = (await observe()).shell as string
await page.locator('[data-brain-cancel]').first().click()
await page.waitForTimeout(1_500)
const cancelled = await shoot('brain-switcher-cancelled')
if (cancelled.dialog !== null) throw new Error('Cancel left the dialog on screen')
if ((cancelled.shell as string) !== before) {
  throw new Error('Cancel changed the shell')
}
if ((cancelled.trigger as { current: string }).current !== FROM_BRAIN) {
  throw new Error(`Cancel moved the chat onto ${(cancelled.trigger as { current: string }).current}`)
}
if ((cancelled.shell as string).includes('IDEALIZE-CLAUDE-SHELL')) {
  throw new Error('Cancel started the new brain anyway')
}

// ── 5. Continue restarts the shell on the new brain ────────────────────────
await openMenu()
await page.locator(`[data-brain="${TO_BRAIN}"]`).first().click()
await page.locator('[role="dialog"]').waitFor({ timeout: 15_000 })
await page.locator('[data-brain-confirm]').first().click()
let ran = false
for (let attempt = 0; attempt < 30; attempt += 1) {
  await page.waitForTimeout(1_000)
  const grid = await page.locator('.xterm').innerText()
  if (grid.includes('IDEALIZE-CLAUDE-SHELL')) { ran = true; break }
}
const restarted = await shoot('brain-switcher-restarted')
if (!ran) throw new Error('the new brain\'s launch command never ran in the shell')
if ((restarted.trigger as { current: string }).current !== TO_BRAIN) {
  throw new Error(`the composer still names ${(restarted.trigger as { current: string }).current}`)
}

for (const stamp of stamps) console.log(stamp)
if (errors.length > 0) console.log('PAGE ERRORS:', errors.join(' | '))
console.log('PROOF OK')

await browser.close()
app.kill('SIGTERM')
mock.kill('SIGTERM')
