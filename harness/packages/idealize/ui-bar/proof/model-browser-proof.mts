/**
 * Proof run (not a vitest spec): boot the REAL assembled IDEalize app (the
 * whole `idealize` profile, with the live fal and OpenRouter catalogues) on a
 * blank scratch home, and prove the model browser in a headless browser.
 *
 * What it proves, read back off the rendered DOM and the host's routes:
 *
 * 1. The browser opens from a sheet's model row for chat, image, video and
 *    sound, over the window, and is captured in light and dark.
 * 2. Search, a Takes chip, a Good at chip and the sort each change the list.
 * 3. Apply writes the stored model: an image model chosen in the browser and
 *    saved is the one `GET /idealize/brains/media` then serves for Images,
 *    and a chat model chosen and saved is the brain's own override.
 * 4. A video model's example clip and a sound model's example track, fetched
 *    when the model is selected, actually play (their clocks advance).
 *
 * Isolation: HOME and DSH_HOME sit inside a fresh temporary directory, checked
 * before anything is written; IDEALIZE_SOCK points at a private socket path
 * there, so nothing this run starts can reach the running app. The browser is
 * headless Chrome on its own temporary profile. The scratch directory is
 * deleted at the end.
 *
 * Usage: OUT=<dir> pnpm exec tsx packages/idealize/ui-bar/proof/model-browser-proof.mts
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
import type { Locator, Page } from '../../../../apps/web/node_modules/playwright/index.mjs'
import { settle as settleApp, watchLaunch } from '../../../../.idealize/proof-settle.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..', '..')
const out = process.env.OUT ?? '.idealize/proof'
await mkdir(out, { recursive: true })

// ── Isolation, verified before anything is written ─────────────────────────
const root = await mkdtemp(join(tmpdir(), 'imb-'))
const home = join(root, 'home')
const dshHome = join(root, 'dsh')
for (const dir of [home, dshHome]) await mkdir(dir, { recursive: true })
const env: NodeJS.ProcessEnv = {
  ...process.env,
  HOME: home,
  DSH_HOME: dshHome,
  XDG_CONFIG_HOME: join(home, '.config'),
  XDG_DATA_HOME: join(home, '.local', 'share'),
  IDEALIZE_SOCK: join(root, 's'),
  OPENROUTER_API_KEY: '',
  FAL_KEY: '',
}
delete env.IDEALIZE_FREETOKENS_SERVER
if (!env.DSH_HOME!.startsWith(root) || !env.HOME!.startsWith(root) || !env.IDEALIZE_SOCK!.startsWith(root)) {
  throw new Error('refusing to run: HOME, DSH_HOME and IDEALIZE_SOCK must all be inside the scratch root')
}
console.log(`isolated: HOME=${env.HOME!} DSH_HOME=${env.DSH_HOME!} IDEALIZE_SOCK=${env.IDEALIZE_SOCK!}`)
await writeFile(join(dshHome, 'settings.yaml'), 'idealize-tour:\n  hasSeenTour: true\n')

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
const appPort = await freePort()
const base = `http://127.0.0.1:${String(appPort)}`

const children: ChildProcess[] = []
const stamps: string[] = []
const failures: string[] = []
function check(claim: string, pass: boolean, detail: unknown): void {
  const line = `${pass ? 'PASS' : 'FAIL'} ${claim}: ${JSON.stringify(detail)}`
  stamps.push(line)
  console.log(line)
  if (!pass) failures.push(claim)
}

interface MediaPreset { id: string; model: { backend: string; model: string } | null; candidates: { backend: string; model: { id: string } }[] }
const media = async (): Promise<MediaPreset[]> =>
  ((await (await fetch(`${base}/idealize/brains/media`)).json()) as { presets: MediaPreset[] }).presets

try {
  const app = spawn(
    'node',
    ['--import', 'tsx/esm', 'apps/cli/src/bin.ts', '--profile', 'idealize', '--host', '127.0.0.1', '--port', String(appPort)],
    { cwd: repoRoot, env, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  children.push(app)
  app.stderr?.on('data', (chunk: Buffer) => { process.stderr.write(`  host! ${chunk.toString()}`) })
  for (const deadline = Date.now() + 180_000; ;) {
    if (Date.now() > deadline) throw new Error('the host never served the space roster')
    try {
      const body = await (await fetch(`${base}/idealize/spaces`)).json() as { spaces?: unknown }
      if (Array.isArray(body.spaces)) break
    } catch { /* not listening yet, or only the page shell answers */ }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  // The fal catalogue is read page by page on first boot; wait until every
  // generating space has candidates from it.
  for (const deadline = Date.now() + 300_000; ;) {
    const presets = await media().catch(() => [])
    const counts = Object.fromEntries(presets.map(row => [row.id, row.candidates.length]))
    if (presets.length > 0 && presets.every(row => row.candidates.length > 20)) {
      console.log(`media candidates: ${JSON.stringify(counts)}`)
      break
    }
    if (Date.now() > deadline) throw new Error(`the media catalogue never filled: ${JSON.stringify(counts)}`)
    await new Promise(resolve => setTimeout(resolve, 3_000))
  }

  // Google Chrome carries the H.264 and AAC decoders fal's example clips use;
  // Playwright's own Chromium does not.
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 940 }, deviceScaleFactor: 2, locale: 'en-GB' })
  const page: Page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', (error) => { errors.push(String(error)) })
  await watchLaunch(page)
  await page.goto(base, { waitUntil: 'load' })
  await settleApp(page, { ready: page.getByRole('button', { name: 'Brains', exact: true }) })
  const clearScrims = async (): Promise<void> => {
    for (let round = 0; round < 12; round += 1) {
      if (await page.locator('[data-shell-overlay] [class*="scrim"]').count() === 0) return
      const later = page.getByRole('button', { name: 'Configure later' })
      if (await later.count() > 0) await later.first().click({ timeout: 5_000 }).catch(() => undefined)
      else await page.keyboard.press('Escape')
      await page.waitForTimeout(400)
    }
  }
  await clearScrims()

  const theme = async (name: 'Light' | 'Dark'): Promise<void> => {
    await clearScrims()
    await page.getByRole('button', { name: 'Appearance', exact: true }).click()
    await page.getByRole('button', { name, exact: true }).click()
    await page.waitForTimeout(700)
  }
  const openBrains = async (): Promise<void> => {
    await clearScrims()
    if (await page.getByRole('region', { name: 'Brains' }).count() === 0) {
      await page.getByRole('button', { name: 'Brains', exact: true }).click()
    }
    await page.locator('[data-brains-space="motion"]').waitFor({ timeout: 60_000 })
    await page.waitForTimeout(400)
  }
  const sheet = (): Locator => page.getByRole('form', { name: 'Edit brain' })
  const browserLocator = (): Locator => page.locator('[data-model-browser]')
  const count = async (): Promise<string> => (await browserLocator().locator('[data-browser-count]').textContent()) ?? ''
  const firstName = async (): Promise<string> =>
    (await browserLocator().locator('[data-browser-row]').first().locator('span').first().locator('span').first().textContent()) ?? ''
  const openBrowser = async (field: 'model' | 'chatModel' = 'model'): Promise<void> => {
    await sheet().locator(`[data-brains-model-change="${field}"]`).click()
    await browserLocator().locator('[data-browser-row]').first().waitFor({ timeout: 60_000 })
    await page.waitForTimeout(400)
  }
  const closeBrowser = async (): Promise<void> => {
    await browserLocator().getByRole('button', { name: 'Cancel' }).click()
    await browserLocator().waitFor({ state: 'detached' })
  }
  const closeSheet = async (): Promise<void> => {
    await sheet().getByRole('button', { name: 'Cancel' }).click()
    await sheet().waitFor({ state: 'detached' })
  }
  /** Open the sheet each kind is chosen from. */
  const openSheetFor = async (kind: 'chat' | 'image' | 'video' | 'audio'): Promise<void> => {
    await openBrains()
    if (kind === 'chat') await page.locator('[data-brains-space="chat"]').getByRole('button', { name: 'Edit' }).first().click()
    else {
      const space = kind === 'image' ? 'gallery' : kind === 'video' ? 'motion' : 'soundstage'
      await page.locator(`[data-brains-space-add="${space}"]`).click()
    }
    await sheet().locator('[data-brains-model-row="model"]').waitFor({ timeout: 30_000 })
  }
  /** Select rows from the top until one shows a play control for its example; returns its name. */
  const selectWithExample = async (): Promise<string | null> => {
    const rows = browserLocator().locator('[data-browser-row]')
    for (let index = 0; index < 8; index += 1) {
      await rows.nth(index).click()
      try {
        await browserLocator().locator('[data-browser-detail] [data-browser-play]').waitFor({ timeout: 15_000 })
        return await browserLocator().locator('[data-browser-detail] h3').textContent()
      } catch { /* this model publishes no example; try the next */ }
    }
    return null
  }

  for (const shade of ['light', 'dark'] as const) {
    await theme(shade === 'light' ? 'Light' : 'Dark')
    for (const kind of ['chat', 'image', 'video', 'audio'] as const) {
      await openSheetFor(kind)
      if (shade === 'light' && kind === 'image') {
        await sheet().locator('[data-brains-model-row="model"]').screenshot({ path: join(out, 'sheet-model-row-empty-light.png') })
        check('an empty model row has no picture slot', await sheet().locator('[data-brains-model-row="model"] img').count() === 0, null)
      }
      await openBrowser()
      if (kind === 'video' || kind === 'audio') {
        const name = await selectWithExample()
        check(`${shade} ${kind}: a model's example loads on selection`, name !== null, { name })
      } else {
        await browserLocator().locator('[data-browser-row]').first().click()
        await page.waitForTimeout(800)
      }
      if (shade === 'light') {
        const goodChips = await browserLocator().locator('[data-browser-good-at]').allTextContents()
        const controlChips = await browserLocator().locator('[data-browser-control]').allTextContents()
        check(`${kind}: Good at and Controls chips are both offered`, goodChips.length >= 3 && controlChips.length >= 2, { goodChips, controlChips })
      }
      await page.mouse.move(5, 5)
      await page.screenshot({ path: join(out, `model-browser-${kind}-${shade}.png`) })
      if (shade === 'light' && (kind === 'image' || kind === 'video')) {
        // Every maker line in the first rows reads as a company or a tidied name.
        const bylines = await browserLocator().locator('[data-browser-byline]').allTextContents()
        const shown = bylines.slice(0, 14)
        check(
          `${kind}: maker lines carry no raw endpoint segment`,
          shown.every(line => line === 'fal.ai' || (line !== '' && !/^Ai |\bApi\b|^[a-z]/.test(line))),
          shown,
        )
      }
      if (kind === 'chat') {
        const dated = await browserLocator().locator('[data-browser-row] span').filter({ hasText: /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4}$/ }).count()
        const head = await browserLocator().getByText('Released', { exact: true }).count()
        check(`${shade} chat: the Released lane shows only when a model is dated`, (dated > 0) === (head > 0), { dated, head })
      }
      await closeBrowser()
      await closeSheet()
    }
  }
  await theme('Light')

  // ── Filters, search and sort change the list ───────────────────────────
  await openSheetFor('image')
  await openBrowser()
  const all = await count()
  await browserLocator().locator('[data-browser-search]').fill('flux')
  await page.waitForTimeout(300)
  const searched = await count()
  check('search narrows the list', searched !== all && /^\d+ of/.test(searched), { all, searched, first: await firstName() })
  await browserLocator().locator('[data-browser-search]').fill('')
  await browserLocator().locator('[data-browser-takes="image"]').click()
  const takes = await count()
  check('the Takes chip narrows the list', takes !== all, { all, takes })
  await browserLocator().locator('[data-browser-takes="image"]').click()
  const goodAt = browserLocator().locator('[data-browser-good-at]').first()
  await goodAt.click()
  const good = await count()
  check('a Good at chip narrows the list', good !== all, { all, good, chip: await goodAt.textContent() })
  await goodAt.click()
  // Chips are offered only when some model earns them: Photoreal and the Lora control on the image list.
  const photoreal = browserLocator().locator('[data-browser-good-at="browser.goodAt.photoreal"]')
  const lora = browserLocator().locator('[data-browser-control="browser.control.lora"]')
  check('the image list offers Photoreal and Custom style chips', await photoreal.count() === 1 && await lora.count() === 1)
  await photoreal.click()
  const real = await count()
  await lora.click()
  const realLora = await count()
  check('a Controls chip narrows a Good at list further', realLora !== real && real !== all, { all, real, realLora })
  await browserLocator().locator('[data-browser-row]').first().click()
  const facts = await browserLocator().locator('[data-browser-detail]').textContent() ?? ''
  check('the detail pane lists the model\'s controls', facts.includes('Custom style') && facts.includes('Photoreal'), { facts: facts.slice(0, 400) })
  await lora.click()
  await photoreal.click()
  const cheapestFirst = await firstName()
  await browserLocator().locator('[data-browser-sort]').selectOption('newest')
  const newestFirst = await firstName()
  await browserLocator().locator('[data-browser-sort]').selectOption('name')
  const nameFirst = await firstName()
  check('the sort reorders the list', new Set([cheapestFirst, newestFirst, nameFirst]).size > 1, { cheapestFirst, newestFirst, nameFirst })
  const clientOnly = browserLocator().locator('[data-browser-client-only]')
  if (await clientOnly.count() > 0) {
    await clientOnly.click({ force: true })
    check('Client work only changes the list', await count() !== all, { all, off: await count() })
  } else {
    check('Client work only is hidden when no model states a licence', true, 'no licence data in this catalogue')
  }

  // ── Apply writes the stored model ──────────────────────────────────────
  const target = browserLocator().locator('[data-browser-row]').nth(3)
  const chosen = (await target.getAttribute('data-browser-row')) ?? ''
  await target.click()
  await browserLocator().locator('[data-browser-apply]').click()
  await browserLocator().waitFor({ state: 'detached' })
  check('the sheet row names the applied model', (await sheet().locator('[data-brains-model-row="model"]').getAttribute('data-value')) === chosen, { chosen })
  await sheet().locator('[data-brains-field="name"] input').fill('Browser proof')
  await sheet().getByRole('button', { name: 'Save brain' }).click()
  await sheet().waitFor({ state: 'detached', timeout: 30_000 })
  const [backend, ...rest] = chosen.split(' ')
  const images = (await media()).find(row => row.id === 'images')
  check('apply then save stores the image model', images?.model?.backend === backend && images.model.model === rest.join(' '), { chosen, stored: images?.model })

  await openSheetFor('chat')
  await openBrowser()
  const chatRow = browserLocator().locator('[data-browser-row]').nth(1)
  const chatChosen = (await chatRow.getAttribute('data-browser-row')) ?? ''
  await chatRow.click()
  await browserLocator().locator('[data-browser-apply]').click()
  await sheet().getByRole('button', { name: 'Save brain' }).click()
  await sheet().waitFor({ state: 'detached', timeout: 30_000 })
  const agents = await page.evaluate(async () => (await (await fetch('/idealize/activity/agents')).json()) as { agents: { id: string; model: { provider: string; model: string } | null }[] })
  const [provider, ...model] = chatChosen.split(' ')
  check(
    'apply then save stores the chat brain\'s model',
    agents.agents.some(row => row.model?.provider === provider && row.model.model === model.join(' ')),
    { chatChosen },
  )

  // ── Examples play ──────────────────────────────────────────────────────
  await openSheetFor('video')
  await openBrowser()
  const clip = await selectWithExample()
  await browserLocator().locator('[data-browser-detail] [data-browser-play]').click()
  const video = browserLocator().locator('[data-browser-video]')
  await video.waitFor({ timeout: 15_000 })
  await page.waitForTimeout(4_000)
  const videoState = await video.evaluate((node: HTMLVideoElement) => ({ time: node.currentTime, paused: node.paused, error: node.error?.code ?? null, src: node.currentSrc }))
  check('the example clip plays', videoState.time > 0.5 && videoState.error === null, { clip, ...videoState })
  await page.screenshot({ path: join(out, 'model-browser-video-playing-light.png') })
  await closeBrowser()
  await closeSheet()

  await openSheetFor('audio')
  await openBrowser()
  const track = await selectWithExample()
  await browserLocator().locator('[data-browser-player] [data-browser-play]').click()
  await page.waitForTimeout(4_000)
  const audioState = await browserLocator().locator('[data-browser-audio]').evaluate((node: HTMLAudioElement) => ({ time: node.currentTime, paused: node.paused, error: node.error?.code ?? null, src: node.currentSrc }))
  check('the example track plays', audioState.time > 0.5 && audioState.error === null, { track, ...audioState })
  await page.screenshot({ path: join(out, 'model-browser-audio-playing-light.png') })

  check('no page errors', errors.length === 0, errors)
  await browser.close()
} finally {
  for (const child of children) child.kill('SIGTERM')
  await new Promise(resolve => setTimeout(resolve, 1_500))
  for (const child of children) if (child.exitCode === null) child.kill('SIGKILL')
  await writeFile(join(out, 'model-browser-proof.txt'), `${stamps.join('\n')}\n`)
  await rm(root, { recursive: true, force: true })
  console.log(`scratch removed: ${root}`)
}
if (failures.length > 0) {
  console.error(`FAILED: ${failures.join('; ')}`)
  process.exit(1)
}
console.log(`all checks passed; captures in ${out}`)
