/**
 * Proof run (not a vitest spec): boot the REAL assembled IDEalize app — the
 * whole `idealize` profile — and prove fresh onboarding's Tools step agrees
 * with the Brains pane's Usage tab, in light and dark at 1280×840.
 *
 * What it proves, every assertion read back off the rendered DOM:
 *
 * 1. **Fresh Tools has three space groups and six unique rows**: the four
 *    shared Chat and Terminal brains, Gallery, and Motion.
 * 2. **Motion states the localised recovery sentence without an add-key
 *    action** — the fixture backend is credentialed, so keyMissing is false
 *    and a key would not change the verdict. Leaving Tools through the back
 *    button and returning keeps a model choice already made.
 * 3. **Brains repeats the six labels and Motion recovery** from onboarding.
 * 4. **The five space headings in the declared order**, each with the brains
 *    that work in it, from the roster the running host serves.
 * 5. **Free under BOTH Chat and Terminal**, its model stated rather than
 *    picked — the free-tokens route resolves it, so there is no picker to
 *    offer.
 * 6. **Motion's own row stating its live reason**, hiding the useless
 *    add-key action. The composition registers a generation backend publishing still
 *    images and audio and no video, so the refusal is the route's runtime
 *    answer for that capability and not a constant: the same pane shows
 *    Gallery and Sound Stage picking models beside it.
 * 7. **Agent roles below, as their own section**: the brains that work in no
 *    space (Project Coordinator).
 * 8. **The add sheet asking spaces → model → instructions in that order**,
 *    with the hint "Sent with every message this brain handles.", and the
 *    model list COUNTED: shorter for Gallery (that space's compatible
 *    generation models) than for Chat (the chat catalogue).
 * 9. **Persistence**: a brain added for Sound Stage is still in the Sound
 *    Stage group after a full page reload, because the save writes the space
 *    into the `spaces` map of the `idealize-activity-pills` section.
 *
 * Arranged outside the code under test, through the composition rather than by
 * stubbing the browser: a scripted mock LLM route carrying four models as the
 * deployment default (so the chat catalogue is longer than one entry and the
 * count comparison means something), and a fixture generation backend with two
 * image models and one audio model.
 *
 * Isolation: the run refuses to start unless `DSH_HOME` and `HOME` both point
 * inside the temporary directory it made. The user's real harness home holds
 * live sessions and is never opened.
 *
 * Usage: OUT=.idealize/proof pnpm exec tsx packages/idealize/ui-bar/proof/brains-presets-proof.mts
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
import { assertSettled, launchState, settle as settleApp, watchLaunch } from '../../../../.idealize/proof-settle.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..', '..')
const out = process.env.OUT ?? '.idealize/proof'
await mkdir(out, { recursive: true })

// ── Isolation, verified before anything is written ─────────────────────────
const root = await mkdtemp(join(tmpdir(), 'idealize-brains-presets-proof-'))
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
  OPENROUTER_API_KEY: '',
  PROOF_MOCK_KEY: 'proof-key',
}
if (!env.DSH_HOME.startsWith(root) || !env.HOME.startsWith(root)) {
  throw new Error('refusing to run: DSH_HOME and HOME must both be inside the scratch root')
}
console.log(`isolated: HOME=${env.HOME}`)
console.log(`isolated: DSH_HOME=${env.DSH_HOME}`)

// Leave onboarding absent so this is a fresh run. Pre-seed only the separate
// showcase-tour section, preventing its delayed scrim from racing the proof.
await writeFile(join(dshHome, 'settings.yaml'), [
  'idealize-tour:',
  '  hasSeenTour: true',
  '',
].join('\n'))

/** The chat models the mock route publishes; the Chat brain's picker lists all four. */
const CHAT_MODELS = ['proof-model', 'proof-model-fast', 'proof-model-long', 'proof-model-cheap']
/** The generation models the fixture backend publishes: two stills, one tone, no video. */
const IMAGE_MODELS = ['fixture-still', 'fixture-still-hd']
const AUDIO_MODEL = 'fixture-tone'
/** The brain the persistence check adds, and the space it is added for. */
const ADDED_BRAIN = { name: 'Foley', id: 'foley', space: 'soundstage' }
/** The generation service's actionable sentence for an unserved video preset. */
const MOTION_RECOVERY = 'No connected provider offers a video model. Video generation waits until one does.'

/** The unavailable branch of one media preset's live route verdict. */
interface UnavailableMedia {
  state: 'unavailable'
  reason: 'no-backend' | 'no-compatible-model'
  recovery: string
}

/** The route fields this proof compares with both rendered surfaces. */
interface ProofMediaPreset {
  id: string
  availability: { state: 'available' } | UnavailableMedia
}

/** One rendered row in onboarding's Tools step. */
interface OnboardingToolRow {
  id: string
  label: string
  picker: boolean
  unavailableReason: string | null
  note: string | null
  addKey: boolean
}

/** One rendered space group in onboarding's Tools step. */
interface OnboardingToolGroup {
  id: string
  title: string
  rows: OnboardingToolRow[]
}

/** The complete rendered Tools step. */
interface OnboardingToolsProof {
  groups: OnboardingToolGroup[]
}

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
const base = `http://127.0.0.1:${String(appPort)}`

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
 * The proof-only composition overlay: the mock chat route with its four
 * models, and a generation backend that serves stills and audio but no video,
 * so Motion's refusal is a live capability answer rather than a fixed string.
 */
const patchPath = join(root, 'brains-presets.patch.yml')
await writeFile(patchPath, [
  '# Generated by packages/idealize/ui-bar/proof/brains-presets-proof.mts.',
  '- id: llm-pi-ai',
  '  config:',
  '    providers:',
  '      proofmock:',
  '        displayName: Proof mock',
  '        api: openai-completions',
  `        baseURL: http://127.0.0.1:${String(mockPort)}/v1`,
  '        apiKeyEnv: PROOF_MOCK_KEY',
  '        models:',
  ...CHAT_MODELS.flatMap(id => [
    `          - id: ${id}`,
    `            name: ${id}`,
    '            contextWindow: 128000',
  ]),
  '- id: agent-default-model',
  '  config:',
  '    provider: proofmock',
  `    model: ${CHAT_MODELS[0] ?? 'proof-model'}`,
  // The shipped OpenRouter generation backend publishes a static catalogue of
  // 42 image models with no key stored, which would make both model counts
  // arbitrary. Off for this run, so every candidate the pane offers is one
  // this composition declares.
  '- id: idealize-gen-openrouter',
  '  disabled: true',
  '- insert:',
  '    - id: proof-gen-fixture',
  "      name: '@idealize/gen-fixture'",
  '      config:',
  '        backendId: fixture',
  '        models:',
  ...IMAGE_MODELS.flatMap(id => [
    `          - id: ${id}`,
    '            artefact: image',
  ]),
  `          - id: ${AUDIO_MODEL}`,
  '            artefact: audio',
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

const mock = await bootMockLlm()
const app = await bootApp()

/** What `/idealize/activity/agents` serves: the field the grouping is driven from. */
async function agents(): Promise<{ id: string; spaces: string[]; modelPinned: boolean }[]> {
  const response = await fetch(`${base}/idealize/activity/agents`)
  return (await response.json() as { agents: { id: string; spaces: string[]; modelPinned: boolean }[] }).agents
}

// The five activity brains are seeded into the user preset root on first boot,
// asynchronously; the routes answer before that lands.
for (let attempt = 0; attempt < 60; attempt += 1) {
  if ((await agents()).length >= 5) break
  await new Promise(resolve => setTimeout(resolve, 1_000))
}
console.log(`agents route: ${JSON.stringify(await agents())}`)
const mediaPayload = await (await fetch(`${base}/idealize/brains/media`)).json() as { presets: ProofMediaPreset[] }
const motionRoute = mediaPayload.presets.find(row => row.id === 'motion')
if (motionRoute?.availability.state !== 'unavailable') {
  throw new Error(`the live media route did not serve Motion's unavailable verdict: ${JSON.stringify(motionRoute)}`)
}
const liveMotion = motionRoute.availability
console.log(`media route: ${JSON.stringify(mediaPayload)}`)

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1280, height: 840 }, deviceScaleFactor: 2, locale: 'en-GB' })
const page: Page = await context.newPage()
const errors: string[] = []
page.on('pageerror', (error) => { errors.push(String(error)) })

const stamps: string[] = []
const failures: string[] = []

/** Record a checked claim; the run exits non-zero if any failed. */
function check(claim: string, pass: boolean, detail: unknown): void {
  stamps.push(`${pass ? 'PASS' : 'FAIL'} ${claim}: ${JSON.stringify(detail)}`)
  if (!pass) failures.push(claim)
}

/**
 * Clear whatever modal stands over the frame. On a fresh home the app raises a
 * provider-key dialog, and it can arrive after the first settle; while its
 * scrim stands, every rail click is intercepted. Scoped to the shell's overlay
 * layer, so the Brains pane's own edit sheet is never dismissed by this.
 */
const OVERLAY_SCRIM = '[data-shell-overlay] [class*="scrim"]'

async function clearScrims(): Promise<void> {
  for (let round = 0; round < 12; round += 1) {
    if (await page.locator(OVERLAY_SCRIM).count() === 0) return
    const later = page.getByRole('button', { name: 'Configure later' })
    if (await later.count() > 0) await later.first().click({ timeout: 5_000 }).catch(() => undefined)
    else await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
  }
  throw new Error('a modal scrim would not clear off the shell overlay layer')
}

/** Read the fresh Tools step exactly as the browser renders it. */
async function readOnboardingTools(): Promise<OnboardingToolsProof> {
  return page.evaluate(() => ({
    groups: [...document.querySelectorAll('[data-tools-space]')].map(group => ({
      id: group.getAttribute('data-tools-space') ?? '',
      title: (group.querySelector('[data-tools-space-title]')?.textContent ?? '').trim(),
      rows: [...group.querySelectorAll('[data-tools-row]')].map(row => {
        const label = [...row.children]
          .find(child => (child.tagName === 'SPAN' || child.tagName === 'LABEL')
            && !child.hasAttribute('data-tools-unavailable')
            && (child.textContent ?? '').trim() !== '✓')
        const unavailable = row.querySelector('[data-tools-unavailable]')
        return {
          id: row.getAttribute('data-tools-row') ?? '',
          label: (label?.textContent ?? '').trim(),
          picker: row.querySelector('[data-tools-select]') !== null,
          unavailableReason: unavailable?.getAttribute('data-tools-unavailable') ?? null,
          note: (unavailable?.textContent ?? '').trim() || null,
          addKey: row.querySelector('[data-tools-add-key]') !== null,
        }
      }),
    })),
  }))
}

/** Refuse an onboarding capture when another first-run layer is competing. */
async function assertFreshToolsFrame(file: string): Promise<void> {
  const state = await launchState(page)
  const scrims = await page.locator(OVERLAY_SCRIM).count()
  const viewport = page.viewportSize()
  const panel = await page.locator('[data-onboarding-step="tools"]').evaluate((node) => ({
    clientHeight: node.clientHeight,
    scrollHeight: node.scrollHeight,
    top: node.getBoundingClientRect().top,
    bottom: node.getBoundingClientRect().bottom,
  }))
  if (!state.watcher
    || !state.onboarding
    || state.onboardingStep !== 'tools'
    || state.bodyAttribute !== null
    || state.tour
    || scrims > 0
    || panel.scrollHeight > panel.clientHeight + 1
    || panel.top < 0
    || panel.bottom > 840
    || viewport?.width !== 1280
    || viewport?.height !== 840) {
    throw new Error(`refusing to capture fresh Tools "${file}": ${JSON.stringify({ state, scrims, viewport, panel })}`)
  }
}

/** Follow the system theme while the blocking onboarding panel is on stage. */
async function onboardingTheme(name: 'light' | 'dark'): Promise<void> {
  await page.emulateMedia({ colorScheme: name })
  await page.waitForFunction(
    dark => document.body.hasAttribute('data-ds-dark-theme') === dark,
    name === 'dark',
    { timeout: 30_000 },
  )
  await page.waitForTimeout(300)
}

/** Capture the Tools step after its dedicated layer guard passes. */
async function shootOnboarding(file: string): Promise<void> {
  await page.mouse.move(700, 760)
  await assertFreshToolsFrame(file)
  await page.screenshot({ path: join(out, `${file}.png`) })
}

/** Index onboarding rows after the uniqueness assertion has passed. */
function onboardingRows(tools: OnboardingToolsProof): Record<string, OnboardingToolRow> {
  return Object.fromEntries(tools.groups.flatMap(group => group.rows.map(row => [row.id, row])))
}

/** Assert the S5b grouping, labels, controls, and live recovery copy. */
function checkOnboardingTools(tools: OnboardingToolsProof): void {
  const summaries = tools.groups.map(group => ({
    id: group.id,
    title: group.title,
    rows: group.rows.map(row => row.id),
  }))
  check(
    'fresh Tools renders the three declared space groups',
    JSON.stringify(summaries) === JSON.stringify([
      { id: 'chat-terminal', title: 'Chat and Terminal', rows: ['design', 'coding', 'admin', 'free'] },
      { id: 'gallery', title: 'Images', rows: ['images'] },
      { id: 'motion', title: 'Video', rows: ['motion'] },
    ]),
    summaries,
  )

  const rows = tools.groups.flatMap(group => group.rows)
  const ids = rows.map(row => row.id)
  check(
    'fresh Tools renders six unique choices',
    ids.length === 6
      && new Set(ids).size === 6
      && JSON.stringify(ids) === JSON.stringify(['design', 'coding', 'admin', 'free', 'images', 'motion']),
    ids,
  )

  const byId = onboardingRows(tools)
  const labels = Object.fromEntries(ids.map(id => [id, byId[id]?.label ?? null]))
  check(
    'fresh Tools renders the approved six labels',
    JSON.stringify(labels) === JSON.stringify({
      design: 'Design',
      coding: 'Coding',
      admin: 'Admin',
      free: 'Free',
      images: 'Images',
      motion: 'Video',
    }),
    labels,
  )

  const controls = Object.fromEntries(ids.map(id => [id, byId[id]?.picker ?? null]))
  check(
    'fresh Tools offers pickers only for rows with live candidates',
    JSON.stringify(controls) === JSON.stringify({
      design: true,
      coding: true,
      admin: true,
      free: false,
      images: true,
      motion: false,
    }),
    controls,
  )

  const motion = byId.motion
  // The step renders the localised recovery selected by the route's structured
  // reason (the same sentence the Brains pane shows), not the route's English
  // fallback; the fallback only surfaces for refusals with no known reason.
  // No provider in this composition serves video and openrouter-gen is off,
  // so a key would not change the verdict: the add-key action must not render.
  const videoRecovery = 'No connected provider offers a video model. Video generation waits until one does.'
  check(
    'fresh Tools states Motion\'s live recovery without a useless key action',
    liveMotion.reason === 'no-compatible-model'
      && liveMotion.recovery.length > 0
      && motion !== undefined
      && motion.unavailableReason === liveMotion.reason
      && motion.note === videoRecovery
      && !motion.addKey,
    { route: liveMotion, rendered: motion },
  )
}

/** Settle a page whose onboarding flow has already been completed. */
async function settle(): Promise<void> {
  await settleApp(page, {
    ready: page.getByRole('button', { name: 'Brains', exact: true }),
    onboarding: 'none',
  })
  await clearScrims()
}

/** Open the Brains pane and wait until the space groups have arrived. */
async function openBrains(): Promise<void> {
  await clearScrims()
  const pane = page.getByRole('region', { name: 'Brains' })
  if (await pane.count() === 0) await page.getByRole('button', { name: 'Brains', exact: true }).click()
  await page.locator('[data-brains-space="motion"]').waitFor({ timeout: 60_000 })
  await page.locator('[data-brains-space="gallery"] select').first().waitFor({ timeout: 60_000 })
  await page.waitForTimeout(500)
}

/** The Usage tab as it renders: the groups, their rows, and the roles section. */
async function readGroups(): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const groups = [...document.querySelectorAll('[data-brains-space]')]
    const rolesTable = [...document.querySelectorAll('[role="table"]')]
      .find(table => table.getAttribute('aria-label') === 'Agent roles')
    return {
      order: groups.map(node => node.getAttribute('data-brains-space')),
      headings: groups.map(node =>
        (node.querySelector('[role="table"]')?.previousElementSibling?.textContent ?? '').trim()),
      rows: Object.fromEntries(groups.map(node => [
        node.getAttribute('data-brains-space'),
        [...node.querySelectorAll('[role="row"]')].map(row => ({
          name: (row.querySelector('span:first-child')?.textContent ?? '').trim(),
          brain: row.getAttribute('data-brain'),
          media: row.getAttribute('data-media-preset'),
          picker: row.querySelector('select') !== null,
          pinned: (row.querySelector('[data-brain-pinned]')?.textContent ?? '').trim() || null,
          reason: row.querySelector('[data-media-reason]')?.getAttribute('data-media-reason') ?? null,
          note: (row.querySelector('[data-media-reason]')?.textContent ?? '').trim() || null,
          addKey: [...row.querySelectorAll('button')]
            .some(button => (button.textContent ?? '').trim() === 'Add OpenRouter key'),
        })),
      ])),
      addRows: [...document.querySelectorAll('[data-brains-space-add]')]
        .map(node => node.getAttribute('data-brains-space-add')),
      // The roles section, and its position relative to the last space group.
      roles: rolesTable === undefined
        ? null
        : {
            rows: [...rolesTable.querySelectorAll('[role="row"] > span:first-child')]
              .map(cell => (cell.textContent ?? '').trim()),
            belowSpaces: groups.length === 0
              || (groups[groups.length - 1]!.compareDocumentPosition(rolesTable)
                & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
          },
    }
  })
}

/** The open add/edit sheet as it renders: field order, checked spaces, the model list. */
async function readSheet(): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const sheet = [...document.querySelectorAll('form')]
      .find(form => form.querySelector('[data-brains-field]') !== null)
    if (sheet === undefined) return { open: false }
    const model = sheet.querySelector('[data-brains-model]') as HTMLSelectElement | null
    return {
      open: true,
      title: (sheet.querySelector('[data-brains-field]')?.previousElementSibling?.textContent ?? '').trim(),
      fields: [...sheet.querySelectorAll('[data-brains-field]')].map(node => node.getAttribute('data-brains-field')),
      addSpace: sheet.querySelector('[data-brains-add-space]')?.getAttribute('data-brains-add-space') ?? null,
      checked: [...sheet.querySelectorAll('input[type="checkbox"]')]
        .filter(box => (box as HTMLInputElement).checked)
        .map(box => (box.parentElement?.textContent ?? '').trim()),
      modelOptions: model === null ? [] : [...model.options].map(option => option.textContent),
      modelCount: model === null ? 0 : model.options.length,
      hint: (sheet.querySelector('[data-brains-instructions-hint]')?.textContent ?? '').trim(),
    }
  })
}

/**
 * Capture one frame with the settle guard in front of it. The pointer is parked
 * over the empty chat column first: left on the rail, its hover tooltip stands
 * over the pane's own tabs in the shot.
 */
async function shoot(file: string): Promise<void> {
  await clearScrims()
  await page.mouse.move(700, 300)
  await page.waitForTimeout(200)
  await assertSettled(page, file)
  await page.screenshot({ path: join(out, `${file}.png`) })
}

/** Switch the theme through the Appearance pane. */
async function theme(name: 'Light' | 'Dark'): Promise<void> {
  await clearScrims()
  await page.getByRole('button', { name: 'Appearance', exact: true }).click()
  await page.getByRole('button', { name, exact: true }).waitFor({ timeout: 30_000 })
  await page.getByRole('button', { name, exact: true }).click()
  await page.waitForTimeout(700)
}

/** Open one space group's add row, and answer nothing. */
async function openAddSheet(space: string): Promise<Record<string, unknown>> {
  await page.locator(`[data-brains-space-add="${space}"]`).click()
  await page.locator('[data-brains-field="model"]').waitFor({ timeout: 30_000 })
  await page.waitForTimeout(300)
  return readSheet()
}

async function closeSheet(): Promise<void> {
  await page.getByRole('button', { name: 'Cancel' }).click()
  await page.locator('[data-brains-field="model"]').waitFor({ state: 'detached', timeout: 30_000 })
}

/** The whole Usage-tab sweep in one theme. */
async function sweep(suffix: string, tools: OnboardingToolsProof): Promise<void> {
  await openBrains()
  const groups = await readGroups()
  const order = groups.order as string[]
  const rows = groups.rows as Record<string, { name: string; brain: string | null; media: string | null; picker: boolean; pinned: string | null; reason: string | null; note: string | null; addKey: boolean }[]>
  const roles = groups.roles as { rows: string[]; belowSpaces: boolean } | null
  const toolsById = onboardingRows(tools)

  check(
    `${suffix}: the five space headings in the declared order`,
    JSON.stringify(order) === JSON.stringify(['chat', 'terminal', 'gallery', 'soundstage', 'motion']),
    { order, headings: groups.headings },
  )
  check(
    `${suffix}: every space group offers its own add row`,
    JSON.stringify(groups.addRows) === JSON.stringify(order),
    groups.addRows,
  )
  // Free in BOTH Chat and Terminal, its model stated and not picked.
  const freeChat = rows.chat?.find(row => row.brain === 'free')
  check(
    `${suffix}: Free is a brain under chat, with its pinned model stated`,
    freeChat !== undefined && !freeChat.picker && freeChat.pinned !== null && freeChat.pinned !== '',
    freeChat ?? null,
  )
  // Under Terminal every brain row carries the CLI picker, Free included.
  const freeTerminal = rows.terminal?.find(row => row.brain === 'free')
  check(
    `${suffix}: Free is a brain under terminal, carrying the CLI picker`,
    freeTerminal !== undefined && freeTerminal.picker,
    freeTerminal ?? null,
  )

  // Gallery's picker rides its brain row (named for the brain), so the label
  // comparison covers the rows both surfaces render under the same name.
  const brainLabels = {
    design: rows.chat?.find(row => row.brain === 'design')?.name ?? null,
    coding: rows.chat?.find(row => row.brain === 'coding')?.name ?? null,
    admin: rows.chat?.find(row => row.brain === 'admin')?.name ?? null,
    free: rows.chat?.find(row => row.brain === 'free')?.name ?? null,
    motion: rows.motion?.find(row => row.media === 'motion')?.name ?? null,
  }
  const toolLabels = {
    design: toolsById.design?.label ?? null,
    coding: toolsById.coding?.label ?? null,
    admin: toolsById.admin?.label ?? null,
    free: toolsById.free?.label ?? null,
    motion: toolsById.motion?.label ?? null,
  }
  check(
    `${suffix}: Brains repeats onboarding's row labels where both surfaces show one`,
    JSON.stringify(brainLabels) === JSON.stringify(toolLabels),
    { onboarding: toolLabels, brains: brainLabels },
  )

  // Motion's own row: the live reason, and no add-key action — the pane
  // gates it on keyMissing, which the credentialed fixture backend makes false.
  const motion = rows.motion?.find(row => row.media === 'motion')
  check(
    `${suffix}: Brains repeats onboarding's live Motion recovery`,
    motion !== undefined
      && motion.reason === liveMotion.reason
      && motion.note === MOTION_RECOVERY
      && motion.note === toolsById.motion?.note
      && !motion.addKey,
    { route: liveMotion, onboarding: toolsById.motion, brains: motion ?? null },
  )
  // Beside it, the two generating spaces that CAN be served still pick models,
  // which is what makes Motion's refusal an answer rather than a constant.
  for (const space of ['gallery', 'soundstage']) {
    // The picker rides the space's brain row when one exists, else the
    // space's own media row; either way one unrefused picker must render.
    const row = rows[space]?.find(entry => entry.picker && entry.reason === null)
    check(
      `${suffix}: ${space} picks its generation model from the same live route`,
      row !== undefined,
      rows[space] ?? null,
    )
  }
  check(
    `${suffix}: agent roles list below the space groups as their own section`,
    roles !== null && roles.belowSpaces && roles.rows.length > 0,
    roles,
  )
  await shoot(`brains-spaces-${suffix}`)
  // The pane is taller than the window, so the groups below the fold get their
  // own frame: the three generating spaces and the agent-role section.
  await page.locator('[role="table"][aria-label="Agent roles"]').scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  await shoot(`brains-spaces-lower-${suffix}`)
  await page.locator('[data-brains-space="chat"]').scrollIntoViewIfNeeded()

  // The add sheet: the order of its questions, and the two model-list counts.
  const gallery = await openAddSheet('gallery')
  check(
    `${suffix}: the add sheet asks spaces, then the model, then the instructions`,
    JSON.stringify(gallery.fields) === JSON.stringify(['spaces', 'name', 'model', 'instructions']),
    gallery.fields,
  )
  check(
    `${suffix}: the sheet opens on Gallery alone, stamped with the space`,
    JSON.stringify(gallery.checked) === JSON.stringify(['Images']) && gallery.addSpace === 'gallery',
    { checked: gallery.checked, addSpace: gallery.addSpace },
  )
  check(
    `${suffix}: the instructions carry the approved hint`,
    gallery.hint === 'Sent with every message this brain handles.',
    gallery.hint,
  )
  await shoot(`brains-add-gallery-${suffix}`)
  await closeSheet()

  const chat = await openAddSheet('chat')
  check(
    `${suffix}: the model list is shorter for Gallery than for Chat`,
    (gallery.modelCount as number) < (chat.modelCount as number),
    { gallery: gallery.modelCount, chat: chat.modelCount, galleryOptions: gallery.modelOptions, chatOptions: chat.modelOptions },
  )
  await shoot(`brains-add-chat-${suffix}`)
  await closeSheet()
}

await watchLaunch(page)
await page.goto(base, { waitUntil: 'load' })

// Keep the opening sequence parked while the fresh wizard exposes Tools.
await page.locator('[data-onboarding-step="agents"]').waitFor({ timeout: 60_000 })
await page.locator('[data-onboarding-skip-step]').click()
await page.locator('[data-onboarding-step="tools"]').waitFor({ timeout: 30_000 })
await page.locator('[data-tools-row="motion"]').waitFor({ timeout: 60_000 })
await page.waitForFunction(() => document.querySelectorAll('[data-tools-row]').length === 6)

const tools = await readOnboardingTools()
checkOnboardingTools(tools)

await onboardingTheme('light')
await shootOnboarding('onboarding-tools-spaces-light')
await onboardingTheme('dark')
await shootOnboarding('onboarding-tools-spaces-dark')
await onboardingTheme('light')

const retainedDraft = JSON.stringify(['proofmock', 'proof-model-fast'])
const codingPicker = page.locator('[data-tools-row="coding"] [data-tools-select]')
await codingPicker.selectOption(retainedDraft)
const draftBeforeRecovery = await codingPicker.inputValue()
check(
  'Tools accepted a changed Coding model before the recovery',
  draftBeforeRecovery === retainedDraft,
  draftBeforeRecovery,
)
// The proof's fixture backend is credentialed, so motion's verdict is
// keyMissing:false and the wizard hides the add-key shortcut (a key would
// change nothing). The add-key -> agents route is covered by the jsdom
// suite; here the retention trip leaves Tools through the back button.
await page.locator('[data-onboarding-back]').click()
await page.locator('[data-onboarding-step="agents"]').waitFor({ timeout: 30_000 })
await page.locator('[data-agent-card="openrouter"]').waitFor({ timeout: 30_000 })
const backRoute = await page.evaluate(() => ({
  step: document.querySelector('[data-onboarding-step]')?.getAttribute('data-onboarding-step') ?? null,
  openRouterCard: document.querySelector('[data-agent-card="openrouter"]') !== null,
}))
check(
  'stepping back from Tools lands on the Agents step',
  backRoute.step === 'agents' && backRoute.openRouterCard,
  backRoute,
)

await page.locator('[data-onboarding-skip-step]').click()
await page.locator('[data-onboarding-step="tools"]').waitFor({ timeout: 30_000 })
await page.locator('[data-tools-row="motion"]').waitFor({ timeout: 60_000 })
const draftAfterRecovery = await page.locator('[data-tools-row="coding"] [data-tools-select]').inputValue()
check(
  'leaving Tools and returning retains model choices already made',
  draftAfterRecovery === draftBeforeRecovery,
  { before: draftBeforeRecovery, after: draftAfterRecovery },
)
await page.locator('[data-onboarding-skip-all]').click()
await page.locator('[data-idealize-onboarding]').waitFor({ state: 'detached', timeout: 30_000 })
await settle()

await theme('Light')
await sweep('light', tools)
await theme('Dark')
await sweep('dark', tools)
await theme('Light')

// ── Persistence: the added space survives a reload ─────────────────────────
await openBrains()
await openAddSheet(ADDED_BRAIN.space)
await page.locator('[data-brains-field="name"] input').fill(ADDED_BRAIN.name)
await page.getByRole('button', { name: 'Save brain' }).click()
await page.locator('[data-brains-field="model"]').waitFor({ state: 'detached', timeout: 30_000 })
await page.locator(`[data-brains-space="${ADDED_BRAIN.space}"] [data-brain="${ADDED_BRAIN.id}"]`)
  .waitFor({ timeout: 30_000 })
const stored = await agents()
check(
  `the saved brain records its space on the host`,
  stored.find(row => row.id === ADDED_BRAIN.id)?.spaces.join(',') === ADDED_BRAIN.space,
  stored.find(row => row.id === ADDED_BRAIN.id) ?? null,
)
await shoot('brains-added-soundstage')

await page.reload({ waitUntil: 'load' })
await settle()
await openBrains()
const after = await readGroups()
const afterRows = after.rows as Record<string, { brain: string | null }[]>
check(
  'after a reload the added brain is still in its own space group',
  afterRows[ADDED_BRAIN.space]?.some(row => row.brain === ADDED_BRAIN.id) === true,
  { soundstage: afterRows[ADDED_BRAIN.space], chat: afterRows.chat?.map(row => row.brain) },
)
await shoot('brains-added-soundstage-reloaded')

await browser.close()
app.kill('SIGTERM')
mock.kill('SIGTERM')

for (const stamp of stamps) console.log(stamp)
if (errors.length > 0) console.log('PAGE ERRORS:', errors.join(' | '))
if (failures.length > 0) {
  console.error(`FAILED: ${failures.join('; ')}`)
  process.exit(1)
}
console.log(`wrote the Brains-by-space proofs to ${out}`)
