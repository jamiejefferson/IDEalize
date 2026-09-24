/**
 * Proof run (not a vitest spec): drive a booted IDEalize web app headlessly,
 * open the Brains pane from the tool rail, and screenshot each wireframe
 * state — Usage, the Edit Activity Agent sheet, Models — at the
 * Paper frame's 1504×941.
 *
 * Usage: BASE_URL=http://127.0.0.1:3145 OUT=.idealize/proof pnpm exec tsx packages/idealize/ui-bar/proof/brains-proof.mts
 */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
// Resolved from apps/web's devDependency: the proof borrows the web e2e browser.
import { chromium } from '../../../../apps/web/node_modules/playwright/index.mjs'
import { assertSettled, settle, watchLaunch } from '../../../../.idealize/proof-settle.mjs'

const base = process.env.BASE_URL ?? 'http://127.0.0.1:3145'
const out = process.env.OUT ?? '.idealize/proof'
await mkdir(out, { recursive: true })

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1504, height: 941 }, locale: 'en-GB' })
const page = await context.newPage()
const errors: string[] = []
page.on('pageerror', (error) => { errors.push(String(error)) })

await watchLaunch(page)
await page.goto(base, { waitUntil: 'load' })
// First-run wizard, opening sequence and showcase tour, through their own
// hooks; the helper throws rather than let a capture land mid-slide.
await settle(page, { ready: page.getByRole('button', { name: 'Brains' }) })
// A fresh home raises the DeepSeek key onboarding dialog; defer it.
const later = page.getByRole('button', { name: 'Configure later' })
if (await later.isVisible()) await later.click()
await page.getByRole('button', { name: 'Brains' }).click()
const pane = page.getByRole('region', { name: 'Brains' })
await pane.getByRole('table', { name: 'Roles' }).waitFor({ timeout: 30_000 })
// The drawer column animates open; screenshot it at rest.
await page.waitForTimeout(1_000)
await assertSettled(page, 'brains-usage')
await page.screenshot({ path: join(out, 'brains-usage.png') })

await pane.getByRole('button', { name: 'Edit' }).first().click()
await pane.getByRole('form', { name: 'Edit Activity Agent' }).waitFor()
await page.screenshot({ path: join(out, 'brains-edit-activity.png') })
await pane.getByRole('button', { name: 'Cancel' }).click()

await pane.getByRole('tab', { name: 'Models' }).click()
await pane.getByRole('combobox', { name: 'Routing strategy' }).waitFor()
await page.waitForTimeout(300)
console.log('providers listed:', (await pane.locator('strong').allTextContents()).join(', '))
await page.screenshot({ path: join(out, 'brains-models.png') })

await browser.close()
if (errors.length > 0) {
  console.error('page errors:', errors)
  process.exit(1)
}
console.log(`wrote brains-usage.png, brains-edit-activity.png, brains-models.png to ${out}`)
