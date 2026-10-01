/**
 * Proof run (not a vitest spec) for feedback 2383ce58, "md file links in the
 * chat should open in the file viewer inside idealize": boot the REAL
 * assembled IDEalize app on scratch data, drive one turn whose scripted reply
 * names the project's NOTES.md as a Markdown link and as inline code, click
 * each, and read the deck's file viewer back off the DOM. A link to a shell
 * script must stay unlinked (the viewer claims Markdown only).
 *
 * Isolation: the run refuses to start unless `DSH_HOME` and `HOME` both point
 * inside the temporary directory it made. The user's real harness home is
 * never opened.
 *
 * Usage: OUT=.idealize/proof/md-links pnpm exec tsx packages/idealize/ui-bar/proof/md-links-proof.mts
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
const root = await mkdtemp(join(tmpdir(), 'idealize-md-links-proof-'))
const home = join(root, 'home')
const dshHome = join(root, 'dsh-home')
const projectDir = join(root, 'project')
for (const dir of [home, dshHome, projectDir]) await mkdir(dir, { recursive: true })
// The files the scripted reply names.
await writeFile(join(projectDir, 'NOTES.md'), '# Notes\n\nThe viewer opened this from a link in the chat.\n')
await writeFile(join(projectDir, 'run.sh'), 'echo hi\n')

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
// One plain reply that names the project's notes three ways: a Markdown link,
// an inline-code path and a link to a file the viewer does not show.
const REPLY = 'I wrote [the notes](NOTES.md), see `NOTES.md` too, and [the script](run.sh).'
const mock = await startMockLlmServer({
  host: '127.0.0.1',
  port: 0,
  apiKey: 'mock-key',
  sequence: ['success'],
  repeatLast: true,
  successText: REPLY,
})
console.log(`mock model: ${mock.baseURL} (seed ${String(mock.randomSeed)})`)

const hostEnv = {
  ...env,
  DEEPSEEK_API_KEY: 'mock-key',
  DEEPSEEK_BASE_URL: `${mock.baseURL}/v1`,
  // The Chat brains run on OpenRouter; its route points at the scripted model.
  OPENROUTER_API_KEY: 'mock-key',
}
await writeFile(join(dshHome, 'settings.yaml'), [
  'llm-pi-ai:',
  '  providers:',
  '    openrouter:',
  '      apiKeyEnv: OPENROUTER_API_KEY',
  `      baseURL: ${mock.baseURL}/v1`,
  '',
].join('\n'))

// The embedded terminal without the Electron shell: the proof-only pty host,
// composed through a patch written into the scratch root.
const terminalPatch = join(root, 'terminal.patch.yml')
await writeFile(terminalPatch, [
  '- insert:',
  '    - id: proof-desktop-terminals',
  `      name: '${join(repoRoot, '.idealize', 'proof-terminal-host.mjs')}'`,
  '',
].join('\n'))

/** Boot `dsh --profile idealize` and wait for an IDEalize route to answer. */
async function boot(port: number): Promise<ChildProcess> {
  const child = spawn(
    'node',
    ['--import', 'tsx/esm', 'apps/cli/src/bin.ts', '--profile', 'idealize', '--patch', terminalPatch, '--host', '127.0.0.1', '--port', String(port)],
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

/** Clear first-run, the opening sequence and the showcase, then open the project. */
async function settleApp(): Promise<void> {
  await settle(page, { ready: page.getByRole('button', { name: RAIL_ANCHOR, exact: true }) })
  for (let attempt = 0; attempt < 8; attempt++) {
    if (await page.locator('[class*="scrim"]').count() === 0) break
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
  }
}

/** Open the project and launch a Chat brain through the welcome card. */
async function launchChat(): Promise<void> {
  if (await page.locator('[data-launcher-step]').count() === 0) {
    await page.getByText(projectName, { exact: true }).first().click({ timeout: 30_000 })
    await page.locator('[data-launcher-step]').waitFor({ timeout: 30_000 })
  }
  const brain = page.locator('[data-brain]')
  if (await brain.count() === 0) {
    // The space card is the button whose name starts with the space's title.
    await page.getByRole('button', { name: /^Chat/ }).first().click()
    await page.locator('[data-launcher-step="brain"]').waitFor({ timeout: 30_000 })
  }
  const brains = await page.locator('[data-brain]').evaluateAll(nodes => nodes.map(node => `${node.getAttribute('data-brain') ?? ''}: ${(node.textContent ?? '').trim()}`))
  console.log(`brains: ${JSON.stringify(brains)}`)
  // The scripted model answers on the DeepSeek API route.
  const deepseek = page.locator('[data-brain]', { hasText: /deepseek/i })
  await (await deepseek.count() > 0 ? deepseek : page.locator('[data-brain]')).first().click()
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

/** What the deck's file viewer shows, read off the DOM. */
async function viewer(): Promise<{ open: boolean; text: string }> {
  return page.evaluate(() => {
    const body = document.querySelector('[data-viewer-body]')
    return { open: body !== null, text: (body?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 120) }
  })
}

/** Close the viewer through its own close button. */
async function closeViewer(): Promise<void> {
  await page.locator('[data-viewer-body]').locator('xpath=ancestor::*[.//button[@aria-label="Close panel"]][1]')
    .getByRole('button', { name: 'Close panel', exact: true }).click()
  await page.locator('[data-viewer-body]').waitFor({ state: 'detached', timeout: 10_000 })
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
await launchChat().catch(async (error: unknown) => {
  await page.screenshot({ path: join(out, 'md-links-0-launch-failed.png') })
  const dump = await page.evaluate(() => ({
    steps: [...document.querySelectorAll('[data-launcher-step]')].map(node => node.getAttribute('data-launcher-step')),
    spaces: [...document.querySelectorAll('[data-space]')].map(node => node.getAttribute('data-space')),
    buttons: [...document.querySelectorAll('button')].map(node => (node.textContent ?? '').trim() || node.getAttribute('aria-label')).slice(0, 60),
  }))
  console.log(`launch dump: ${JSON.stringify(dump)}`)
  throw error
})
await turn('Write up the notes.')

const results: string[] = []
const link = page.getByRole('button', { name: 'the notes', exact: true })
await link.waitFor({ timeout: 30_000 })
console.log(`link title: ${String(await link.getAttribute('title'))}`)
if (await viewer().then(v => v.open)) throw new Error('the viewer was open before any click')
await assertSettled(page, 'md-links-before')
await page.screenshot({ path: join(out, 'md-links-1-reply.png') })

await link.click()
await page.locator('[data-viewer-body]').waitFor({ timeout: 15_000 })
await page.waitForTimeout(600)
const fromLink = await viewer()
await page.screenshot({ path: join(out, 'md-links-2-viewer-from-link.png') })
if (!fromLink.text.includes('The viewer opened this from a link in the chat.')) {
  throw new Error(`the link opened a viewer without the notes: ${JSON.stringify(fromLink)}`)
}
results.push(`markdown link -> viewer: ${JSON.stringify(fromLink)}`)

await closeViewer()
const code = page.locator('code button', { hasText: 'NOTES.md' })
await code.click()
await page.locator('[data-viewer-body]').waitFor({ timeout: 15_000 })
await page.waitForTimeout(600)
const fromCode = await viewer()
await page.screenshot({ path: join(out, 'md-links-3-viewer-from-code.png') })
if (!fromCode.text.includes('The viewer opened this from a link in the chat.')) {
  throw new Error(`the inline path opened a viewer without the notes: ${JSON.stringify(fromCode)}`)
}
results.push(`inline code -> viewer: ${JSON.stringify(fromCode)}`)

const script = await page.evaluate(() => {
  const text = [...document.querySelectorAll('button, a')].find(node => (node.textContent ?? '').trim() === 'the script')
  return text === undefined ? 'plain text' : text.tagName
})
if (script !== 'plain text') throw new Error(`the shell-script link rendered as ${script}; the viewer claims Markdown only`)
results.push(`run.sh link -> ${script}`)

// ── The terminal: a printed Markdown path opens the same viewer ────────────
await closeViewer()
await page.getByRole('button', { name: 'Terminal', exact: true }).click()
const grid = page.locator('[data-terminal-pane] .xterm-rows')
await grid.waitFor({ timeout: 30_000 })
await page.locator('[data-terminal-pane] .xterm').click()
await page.keyboard.type(`cd ${projectDir} && clear && echo wrote NOTES.md`)
await page.keyboard.press('Enter')
await page.waitForFunction(
  () => [...document.querySelectorAll('[data-terminal-pane] .xterm-rows > div')]
    .some(row => (row.textContent ?? '').startsWith('wrote NOTES.md')),
  undefined,
  { timeout: 20_000 },
)
// Hover the printed path, the way a person reaches for it, then click.
const target = await page.evaluate(() => {
  const row = [...document.querySelectorAll('[data-terminal-pane] .xterm-rows > div')]
    .find(node => (node.textContent ?? '').startsWith('wrote NOTES.md'))
  if (row === undefined) return null
  // The glyphs of the path itself, measured through a text range.
  const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const at = (node.textContent ?? '').indexOf('NOTES')
    if (at === -1) continue
    const range = document.createRange()
    range.setStart(node, at + 2)
    range.setEnd(node, at + 3)
    const box = range.getBoundingClientRect()
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
  }
  return null
})
if (target === null) throw new Error('the printed path never reached the grid')
await page.mouse.move(target.x - 40, target.y)
await page.mouse.move(target.x, target.y, { steps: 5 })
await page.waitForTimeout(400)
await page.screenshot({ path: join(out, 'md-links-4-terminal-hover.png') })
await page.mouse.down()
await page.mouse.up()
await page.locator('[data-viewer-body]').waitFor({ timeout: 15_000 })
await page.waitForTimeout(600)
const fromTerminal = await viewer()
await page.screenshot({ path: join(out, 'md-links-5-viewer-from-terminal.png') })
if (!fromTerminal.text.includes('The viewer opened this from a link in the chat.')) {
  throw new Error(`the terminal path opened a viewer without the notes: ${JSON.stringify(fromTerminal)}`)
}
results.push(`terminal output -> viewer: ${JSON.stringify(fromTerminal)}`)

for (const line of results) console.log(`PASS ${line}`)
if (errors.length > 0) console.log(`page errors: ${JSON.stringify(errors)}`)
await teardown()
process.exit(0)
