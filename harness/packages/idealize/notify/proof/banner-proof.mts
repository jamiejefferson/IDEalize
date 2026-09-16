/**
 * Proof run (not a vitest spec): drive a booted IDEalize web app headlessly,
 * mock the announcement route with one row, and screenshot the banner; then
 * dismiss it, reload, and prove the dismissal persisted (the banner stays
 * away). Also opens the settings modal and screenshots the chime row.
 *
 * Usage: BASE_URL=http://127.0.0.1:3145 OUT=.idealize/proof pnpm exec tsx packages/idealize/notify/proof/banner-proof.mts
 */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
// Resolved from apps/web's devDependency: the proof borrows the web e2e browser.
import { chromium } from '../../../../apps/web/node_modules/playwright/index.mjs'
import { assertSettled, settle, watchLaunch } from '../../../../.idealize/proof-settle.mjs'

const base = process.env.BASE_URL ?? 'http://127.0.0.1:3145'
const out = process.env.OUT ?? '.idealize/proof'
await mkdir(out, { recursive: true })

const row = {
  id: `proof-${Date.now()}`, // fresh per run: the last dismissal persists in the scratch home
  title: 'IDEalize 1.0.1 is ready',
  body: 'Your feedback fixed the file deck and the owl now blinks. Update from the link.',
  cta_label: 'Get the update',
  cta_url: 'https://example.test/update',
  min_app_version: '1.0.0',
  max_app_version: '1.0.0',
  active: true,
  created_at: '2026-08-20T00:00:00Z',
}

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-GB' })
await context.route('**/idealize/announcements', route => route.fulfill({ json: [row] }))
const page = await context.newPage()
const errors: string[] = []
page.on('pageerror', (error) => { errors.push(String(error)) })

await watchLaunch(page)
await page.goto(base, { waitUntil: 'load' })
const banner = page.locator(`[data-announcement-id="${row.id}"]`)
await banner.waitFor({ timeout: 60_000 })
// First-run wizard, opening sequence and showcase tour, through their own
// hooks; the helper throws rather than let a capture land mid-slide.
await settle(page, { ready: page.getByRole('textbox').first() })
await assertSettled(page, 'announcement-banner')
await page.screenshot({ path: join(out, 'announcement-banner.png') })
console.log('banner rendered:', await banner.innerText())

// Dismiss → persisted in the idealize-notify settings section → absent after reload.
await banner.getByRole('button', { name: 'Dismiss' }).click()
await banner.waitFor({ state: 'detached', timeout: 10_000 })
await page.waitForTimeout(1_000)
await page.reload({ waitUntil: 'load' })
await settle(page, { ready: page.locator('[class*="frame"]').first() })
const after = await banner.count()
console.log('banner after dismiss + reload:', after === 0 ? 'absent (dismiss persisted)' : 'STILL PRESENT')
if (after !== 0) process.exitCode = 1

// The chime row in the settings modal (the sidebar-foot trigger opens it).
const trigger = page.locator('[class*="sidebar"] button', { hasText: /Service hatch|Settings/i }).first()
if (await trigger.count() > 0) {
  await trigger.click()
  const general = page.getByRole('dialog').getByText(/^General$/).first()
  if (await general.count() > 0) await general.click()
  const rowEl = page.locator('[data-chime-row]')
  await rowEl.waitFor({ timeout: 15_000 })
  await page.screenshot({ path: join(out, 'chime-settings-row.png') })
  console.log('chime row rendered:', (await rowEl.innerText()).replace(/\s+/g, ' '))
} else {
  console.log('settings trigger not found; chime row screenshot skipped')
}
if (errors.length > 0) console.log('page errors:', errors)
await browser.close()
