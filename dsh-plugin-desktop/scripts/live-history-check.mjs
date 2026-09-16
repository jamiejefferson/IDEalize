/**
 * Attach a hidden 1280x840 BrowserWindow to the ALREADY-RUNNING packaged app's
 * renderer, open each named chat the sidebar lists, and report whether history
 * rendered. Read-only against the live host: it clicks existing chat rows and
 * never starts a new one.
 *   electron scripts/live-history-check.mjs <renderer-url> <out-dir>
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
  process.stderr.write('[live] renderer loaded\n')
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    const up = await window.webContents.executeJavaScript(
      `document.querySelectorAll('nav li, aside li, [class*="chatRow"]').length > 1`)
    if (up) break
    await new Promise(r => setTimeout(r, 500))
  }
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
    const out = []
    const rows = () => [...document.querySelectorAll('nav li, aside li, [class*="chatRow"]')]
      .filter(el => !/New chat/.test((el.textContent ?? '').trim()))
    const total = rows().length
    for (let i = 0; i < total && i < 14; i += 1) {
      const row = rows()[i]
      if (row === undefined) continue
      const label = (row.textContent ?? '').trim().slice(0, 44)
      row.click()
      await wait(2200)
      out.push({ label, ...read() })
    }
    return { mode: 'full', total, chats: out }
  })()`)
  mkdirSync(outDir, { recursive: true })
  const image = await window.webContents.capturePage(undefined, { stayHidden: true })
  writeFileSync(join(outDir, 'live-history.png'), image.toPNG())
  const errored = result.chats.filter(c => c.loadError !== null)
  const withHistory = result.chats.filter(c => c.flowNodes > 0)
  const report = {
    rendererUrl: url,
    shellMode: result.mode,
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
