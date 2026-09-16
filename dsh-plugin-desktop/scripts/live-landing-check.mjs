/**
 * Attach a hidden 1280x840 BrowserWindow to the ALREADY-RUNNING packaged app's
 * renderer and reopen each named chat the sidebar lists (the spaces-and-brains
 * sidebar: rows carry "Chat actions for <name>" handles and a data-space glyph).
 * Read-only against the live host: it clicks existing chat rows and never
 * starts a chat, never dismisses the onboarding wizard, never writes settings.
 *   electron scripts/live-landing-check.mjs <renderer-url> <out-dir>
 */
import { app, BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [url, outDir = '../.idealize/proof'] = process.argv.slice(2)
setTimeout(() => { process.stderr.write('[live] timed out\n'); app.exit(2) }, 180_000).unref()
app.dock?.hide()
app.whenReady().then(main).catch((cause) => {
  process.stderr.write(`[live] failed: ${cause?.stack ?? cause}\n`)
  app.exit(1)
})

async function main() {
  const window = new BrowserWindow({
    width: 1280, height: 840, show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  await window.loadURL(url)
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    const up = await window.webContents.executeJavaScript(
      `document.querySelectorAll('[aria-label^="Chat actions for "]').length > 0`)
    if (up) break
    await new Promise(r => setTimeout(r, 500))
  }
  await new Promise(r => setTimeout(r, 4000))
  const result = await window.webContents.executeJavaScript(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms))
    const read = () => {
      const text = document.body.innerText
      return {
        loadError: text.includes('Failed to load history')
          ? text.split('Failed to load history')[1].slice(0, 200).trim() : null,
        flowNodes: document.querySelectorAll('[data-chat-flow] > *').length,
      }
    }
    const handles = [...document.querySelectorAll('[aria-label^="Chat actions for "]')]
    const rows = handles.map(h => {
      const row = h.closest('div, li, a')
      return { name: h.getAttribute('aria-label').replace('Chat actions for ', ''),
        space: row?.querySelector('[data-space]')?.getAttribute('data-space') ?? null, row }
    })
    const wizard = document.querySelector('[data-onboarding-skip-all]') !== null
    const out = []
    for (const r of rows.slice(0, 14)) {
      const target = r.row?.querySelector('[class*="title"]') ?? r.row
      if (!target) continue
      target.click()
      await wait(3000)
      out.push({ label: r.name.slice(0, 44), space: r.space, ...read() })
    }
    return { wizard, total: rows.length, chats: out }
  })()`)
  mkdirSync(outDir, { recursive: true })
  const image = await window.webContents.capturePage(undefined, { stayHidden: true })
  writeFileSync(join(outDir, 'live-history.png'), image.toPNG())
  const errored = result.chats.filter(c => c.loadError !== null)
  const withHistory = result.chats.filter(c => c.flowNodes > 0)
  const report = {
    rendererUrl: url,
    onboardingWizardShowing: result.wizard,
    chatsListed: result.total,
    chatsOpened: result.chats.length,
    chatsWithHistory: withHistory.length,
    chatsWithLoadError: errored.length,
    chats: result.chats,
    ok: errored.length === 0 && withHistory.length > 0,
  }
  writeFileSync(join(outDir, 'live-history.json'), JSON.stringify(report, null, 2) + '\n')
  process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  app.exit(report.ok ? 0 : 1)
}
