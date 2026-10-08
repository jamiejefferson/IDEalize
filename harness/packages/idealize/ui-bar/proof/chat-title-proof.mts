/**
 * Proof run (not a vitest spec) for the chat title strip (JJ, 7 Oct 2026:
 * "Kitchen quotes in Casa Madrigal", styled from the appearance controls).
 * Drives the packaged app on scratch data over CDP:
 *
 * 1. a chat in a project shows its name and "in <project>" as the title, at
 *    the designed 36px, with no rule under it;
 * 2. the transcript scrolls under the title (the scrollport is padded by the
 *    title's height);
 * 3. Appearance > Chat > Title size moves the title;
 * 4. clicking the name renames the chat;
 * 5. the terminal view shows the title in the terminal's colours, and a
 *    terminal chat with no name is named from the first prompt typed (the
 *    model's reply is stood in by the browser, as scratch data has no key).
 *
 * Usage: launch the built `IDEalize V1.app` with a scratch `HOME`,
 * `--user-data-dir` and `--remote-debugging-port=9334`, then run
 * `CDP_URL=http://127.0.0.1:9334 PROOF_HOME=<that scratch HOME> OUT=<dir>
 * pnpm exec tsx packages/idealize/ui-bar/proof/chat-title-proof.mts`.
 */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
// Resolved from apps/web's devDependency: the proof borrows the web e2e browser.
import { chromium } from '../../../../apps/web/node_modules/playwright/index.mjs'

const out = process.env.OUT ?? '.idealize/proof/chat-title'
await mkdir(out, { recursive: true })
const cdp = process.env.CDP_URL
const home = process.env.PROOF_HOME ?? ''
if (cdp === undefined || !home.includes('proof')) throw new Error('refusing to run: set CDP_URL and a scratch PROOF_HOME')
const project = join(home, 'Casa Madrigal')
await mkdir(project, { recursive: true })

const browser = await chromium.connectOverCDP(cdp)
const page = browser.contexts().flatMap(context => context.pages()).find(candidate => !candidate.url().includes('askbar'))
if (page === undefined) throw new Error('no main window over CDP')
const errors: string[] = []
page.on('pageerror', (error) => { errors.push(String(error)) })
const results: string[] = []

/** One host RPC from the window's own origin. */
async function rpc(method: string, payload: unknown): Promise<unknown> {
  return await page!.evaluate(async ({ method, payload, rpcId }) => {
    const response = await fetch(`/api/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
    })
    const body = await response.json() as { error?: unknown; result?: { value?: unknown } }
    if (body.error !== undefined) throw new Error(`${method}: ${JSON.stringify(body.error)}`)
    return body.result?.value
  }, { method, payload, rpcId: randomUUID() })
}

/** The visible title strip's text and computed sizes. */
async function titleState(): Promise<{ text: string; nameSize: string; projectSize: string; headerHeight: string; borderBottom: string }> {
  return await page!.evaluate(() => {
    const title = document.querySelector('[data-session-title]')
    const name = title?.querySelector('[data-session-title-part="name"]')
    const parts = title?.querySelectorAll('[data-session-title-part="name"]')
    const header = title?.closest('header')
    return {
      text: (title?.textContent ?? '').replace(/\s+/g, ' ').trim(),
      nameSize: name === null || name === undefined ? '' : getComputedStyle(name).fontSize,
      projectSize: parts === undefined || parts.length < 2 ? '' : getComputedStyle(parts[1]!).fontSize,
      headerHeight: header === null || header === undefined ? '' : getComputedStyle(header.parentElement!).getPropertyValue('--dsh-session-header-height'),
      borderBottom: header === null || header === undefined ? '' : getComputedStyle(header).borderBottomWidth,
    }
  })
}

try {
  const skip = page.getByRole('button', { name: 'Skip setup' })
  if (await skip.isVisible().catch(() => false)) await skip.click()
  await page.getByRole('button', { name: 'Notes', exact: true }).waitFor({ timeout: 60_000 })
  // Step the first-run tour off the window: its card's last button advances, then finishes.
  await page.getByRole('button', { name: 'Next', exact: true }).waitFor({ timeout: 10_000 }).catch(() => undefined)
  for (let attempt = 0; attempt < 14; attempt++) {
    const step = page.getByRole('button', { name: /^(Next|Done|Finish|Got it|Start|Get started)$/ })
    if (!await step.first().isVisible().catch(() => false)) break
    await step.last().click()
    await page.waitForTimeout(400)
  }
  const later = page.getByRole('button', { name: 'Configure later' })
  if (await later.isVisible()) await later.click()

  // Seed: a project, and a chat in it with a first prompt and a name.
  const listed = await rpc('workspace.list', {}) as { items?: { path: string; workspaceId: string }[] }
  const existing = listed.items?.find(item => item.path === project)
  const created = existing ?? ((await rpc('workspace.create', { path: project })) as { workspace?: { workspaceId: string }; workspaceId?: string })
  const workspaceId = 'workspace' in created && created.workspace !== undefined ? created.workspace.workspaceId : (created as { workspaceId: string }).workspaceId
  const { sessionId } = await rpc('session.create', { workspaceId }) as { sessionId: string }
  await rpc('session.prompt', { sessionId, mode: 'queue', content: [{ type: 'text', text: 'Get me three kitchen quotes for the flat' }] })
  await rpc('session.rename', { sessionId, title: 'Kitchen quotes' })

  // 1. The chat's title: name, then "in" and the project, at the designed sizes.
  const row = page.getByText('Kitchen quotes', { exact: true }).first()
  if (!await row.isVisible().catch(() => false)) await page.getByText('Casa Madrigal', { exact: true }).first().click()
  await row.click()
  await page.locator('[data-session-title]').filter({ hasText: 'Casa Madrigal' }).waitFor({ timeout: 20_000 })
  await page.waitForTimeout(800)
  const first = await titleState()
  if (first.text !== 'Kitchen quotes in Casa Madrigal' || first.nameSize !== '36px') throw new Error(`title wrong: ${JSON.stringify(first)}`)
  results.push(`chat title reads ${JSON.stringify(first.text)}; name ${first.nameSize}, project ${first.projectSize}; no rule (border ${first.borderBottom}); scrollport padded ${first.headerHeight}`)
  await page.screenshot({ path: join(out, 'title-1-chat.png') })

  // 3. Appearance > Chat > Title size moves the title.
  await page.getByRole('button', { name: 'Appearance', exact: true }).click()
  await page.getByRole('tab', { name: 'Chat', exact: true }).or(page.getByRole('button', { name: 'Chat', exact: true })).first().click()
  const size = page.getByRole('slider', { name: 'Title size' })
  await size.fill('48')
  await page.waitForTimeout(500)
  const resized = await titleState()
  // The panel narrows the column: the name must keep room beside the project.
  const nameWidth = await page.locator('[data-session-title] button[data-session-title-part="name"]').evaluate(node => (node as HTMLElement).offsetWidth)
  if (nameWidth < 100) throw new Error(`the name collapsed in the narrow column: ${String(nameWidth)}px`)
  if (resized.nameSize !== '48px') throw new Error(`Title size did not reach the title: ${JSON.stringify(resized)}`)
  results.push(`Appearance > Chat > Title size 48 → name ${resized.nameSize}, project ${resized.projectSize}; beside the open panel the name keeps ${String(nameWidth)}px`)
  await page.screenshot({ path: join(out, 'title-2-appearance.png') })
  await size.fill('36')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Appearance', exact: true }).click().catch(() => undefined)
  await page.waitForTimeout(400)
  if (await page.getByRole('slider', { name: 'Title size' }).isVisible()) await page.getByRole('button', { name: 'Appearance', exact: true }).click()

  // 4. Clicking the name renames the chat.
  await page.locator('[data-session-title] button[data-session-title-part="name"]').click()
  const field = page.locator('[data-session-title] input')
  await field.fill('Kitchen and bath quotes')
  await field.press('Enter')
  await page.locator('[data-session-title]').filter({ hasText: 'Kitchen and bath quotes' }).waitFor({ timeout: 10_000 })
  const listedAfter = await rpc('session.list', {}) as { items?: { sessionId: string; projections?: { values?: { title?: string } } }[] }
  const stored = listedAfter.items?.find(item => item.sessionId === sessionId)?.projections?.values?.title
  if (stored !== 'Kitchen and bath quotes') throw new Error(`rename did not reach the host: ${String(stored)}`)
  results.push(`clicking the name renamed the chat on the host: ${JSON.stringify(stored)}`)

  // 5. A fresh, unnamed chat in the project, launched as a terminal, named from what is typed.
  let asked = ''
  await page.route('**/idealize/terminal/title', async (route) => {
    asked = (JSON.parse(route.request().postData() ?? '{}') as { text?: string }).text ?? ''
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ title: 'Bathroom tile options' }) })
  })
  await page.getByRole('button', { name: 'New chat', exact: true }).first().click()
  await page.getByRole('button', { name: /^Terminal.*real shell/ }).first().click({ timeout: 20_000 })
  await page.waitForTimeout(800)
  await page.screenshot({ path: join(out, 'title-step2.png') })
  // Step 2 picks the brain to run in the shell: take the first offered.
  await page.getByText('Coding', { exact: true }).first().click()
  const grid = page.locator('.xterm-helper-textarea').first()
  await grid.waitFor({ timeout: 20_000 })
  await page.waitForTimeout(1500)
  const terminalHeader = await page.evaluate(() => {
    const header = document.querySelector('header[data-view="terminal"]')
    const title = header?.querySelector('[data-session-title]')
    return header === null || title === null || title === undefined
      ? undefined
      : { background: getComputedStyle(header).backgroundColor, colour: getComputedStyle(title).color, text: title.textContent ?? '', terminalBg: getComputedStyle(document.documentElement).getPropertyValue('--dsh-terminal-bg') }
  })
  if (terminalHeader === undefined) throw new Error('no title strip over the terminal view')
  if (terminalHeader.text.replace(/\s+/g, ' ').trim() !== 'Terminal in Casa Madrigal') throw new Error(`unnamed terminal title: ${JSON.stringify(terminalHeader.text)}`)
  results.push(`terminal view title ${JSON.stringify(terminalHeader.text)} on ${terminalHeader.background} in ${terminalHeader.colour} (terminal ground ${terminalHeader.terminalBg})`)
  await page.screenshot({ path: join(out, 'title-3-terminal-before.png') })
  await grid.focus()
  await page.keyboard.type('ls')
  await page.keyboard.press('Enter')
  await page.keyboard.type('compare bathroom tile options for the flat')
  await page.keyboard.press('Enter')
  await page.locator('header[data-view="terminal"] [data-session-title]').filter({ hasText: 'Bathroom tile options' }).waitFor({ timeout: 15_000 })
  await page.locator('nav, aside, [class*="sidebar"]').getByText('Bathroom tile options', { exact: true }).first().waitFor({ timeout: 10_000 })
  if (asked !== 'compare bathroom tile options for the flat') throw new Error(`the naming request carried ${JSON.stringify(asked)}`)
  results.push(`terminal chat skipped "ls" and its sidebar row took the name, asked to be named from ${JSON.stringify(asked)}, and now reads ${JSON.stringify((await page.locator('header[data-view="terminal"] [data-session-title]').textContent()) ?? '')}`)
  await page.screenshot({ path: join(out, 'title-4-terminal-named.png') })

  for (const line of results) console.log(`PASS ${line}`)
  if (errors.length > 0) console.log(`page errors: ${JSON.stringify(errors)}`)
} catch (error) {
  for (const line of results) console.log(`PASS ${line}`)
  await page.screenshot({ path: join(out, 'title-failure.png') }).catch(() => undefined)
  throw error
} finally {
  await browser.close()
}
process.exit(errors.length > 0 ? 1 : 0)
