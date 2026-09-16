/**
 * Proof run (not a vitest spec): drive a booted IDEalize web app headlessly
 * at the app's default 1280×840 and screenshot every restyled drawer pane —
 * Schedule, Brains, Files, Service hatch, Feedback — in the light and dark
 * themes, submit one live feedback report through the pane, then set a
 * custom action colour and a larger interface size and show the panes
 * following them.
 *
 * Usage: BASE_URL=http://127.0.0.1:<port> OUT=.idealize/proof pnpm exec tsx packages/idealize/ui-bar/proof/pane-restyle-proof.mts
 */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
// Resolved from apps/web's devDependency: the proof borrows the web e2e browser.
import { chromium } from '../../../../apps/web/node_modules/playwright/index.mjs'
import { assertSettled, settle as settleApp, watchLaunch } from '../../../../.idealize/proof-settle.mjs'

const base = process.env.BASE_URL ?? 'http://127.0.0.1:3145'
const out = process.env.OUT ?? '.idealize/proof'
await mkdir(out, { recursive: true })

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1280, height: 840 }, deviceScaleFactor: 2, locale: 'en-GB' })
const page = await context.newPage()
const errors: string[] = []
page.on('pageerror', (error) => { errors.push(String(error)) })

/**
 * Clear first-run and the opening sequence, then whatever else is up. The
 * onboarding wizard and `body[data-idealize-launch]` are handled by the shared
 * helper, which throws rather than let a capture land mid-slide; the DeepSeek
 * key dialog and the showcase tour's scrim are cleared after it as before.
 */
async function settle(): Promise<void> {
  await settleApp(page, { ready: page.getByRole('button', { name: 'Brains' }) })
  const later = page.getByRole('button', { name: 'Configure later' })
  if (await later.isVisible()) await later.click()
  for (let i = 0; i < 5; i++) {
    if (await page.locator('[class*="scrim"]').count() === 0) break
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
  }
}

/** Open a rail pane and screenshot it once the given marker is visible. */
async function shoot(railButton: string, marker: () => ReturnType<typeof page.getByText>, file: string): Promise<void> {
  await page.getByRole('button', { name: railButton, exact: true }).click()
  await marker().first().waitFor({ timeout: 30_000 })
  await page.waitForTimeout(700)
  await assertSettled(page, file)
  await page.screenshot({ path: join(out, file) })
}

async function paneSweep(suffix: string): Promise<void> {
  await shoot('Schedule', () => page.getByText('Plan and manage recurring tasks.'), `pane-schedule-${suffix}.png`)
  await shoot('Brains', () => page.getByRole('region', { name: 'Brains' }), `pane-brains-${suffix}.png`)
  await shoot('Files', () => page.getByRole('region', { name: 'Files' }), `pane-files-${suffix}.png`)
  await shoot('Service hatch', () => page.getByText('Warning, Service Hatch Open…'), `pane-service-${suffix}.png`)
  await shoot('Feedback', () => page.getByPlaceholder('What’s on your mind?'), `pane-feedback-${suffix}.png`)
}

await watchLaunch(page)
await page.goto(base, { waitUntil: 'load' })
await settle()

// ── Light theme: the five panes ─────────────────────────────────────────
await paneSweep('light')

// ── Live submit through the Feedback pane (the pane is open) ────────────
await page.getByLabel('Feedback text').fill('P4 pane-restyle proof — live submit check from the rebuilt Feedback pane.')
await page.getByRole('button', { name: 'Send', exact: true }).click()
await page.locator('[role="status"]:not(:empty)').waitFor({ timeout: 30_000 })
const submitStatus = (await page.locator('[role="status"]').innerText()).trim()
console.log('feedback submit:', submitStatus)
await page.screenshot({ path: join(out, 'pane-feedback-submitted.png') })

// ── Dark theme via the Appearance pane, then the same sweep ─────────────
await page.getByRole('button', { name: 'Appearance' }).click()
await page.getByRole('button', { name: 'Dark', exact: true }).waitFor({ timeout: 30_000 })
await page.getByRole('button', { name: 'Dark', exact: true }).click()
await page.waitForTimeout(700)
await paneSweep('dark')

// ── Custom accent + larger interface size, shown on the Schedule pane ───
await page.getByRole('button', { name: 'Appearance' }).click()
await page.getByRole('button', { name: 'Light', exact: true }).waitFor({ timeout: 30_000 })
await page.getByRole('button', { name: 'Light', exact: true }).click()
const accent = page.getByLabel('Colour', { exact: true })
await accent.fill('E4572E')
await accent.press('Enter')
const size = page.getByLabel('Interface size')
await size.focus()
for (let i = 0; i < 4; i++) await size.press('ArrowRight')
await page.waitForTimeout(500)
await shoot('Schedule', () => page.getByText('Plan and manage recurring tasks.'), 'pane-accent-size-schedule.png')
await shoot('Feedback', () => page.getByPlaceholder('What’s on your mind?'), 'pane-accent-size-feedback.png')

await browser.close()
if (errors.length > 0) {
  console.error('page errors:', errors)
  process.exit(1)
}
console.log(`wrote pane restyle proofs to ${out}`)
