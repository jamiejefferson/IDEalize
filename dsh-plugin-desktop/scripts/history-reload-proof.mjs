/**
 * Headless Electron proof for the named-chat history reload. Runs inside Electron:
 *   electron scripts/history-reload-proof.mjs <out-dir> <dsh-home>
 * Boots the complete desktop profile in compatibility mode against a home
 * carrying real named sessions (each logs `idealize/agent-name`), loads the
 * renderer in a hidden 1280x840 BrowserWindow, opens every named chat in turn
 * and proves the conversation reports no load error. Writes a JSON report and
 * a PNG. The window is never shown, so nothing is foregrounded.
 */
import { app, BrowserWindow } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boot } from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import {
  createLaunchEnvironmentSnapshot,
  DSH_LAUNCH_ENVIRONMENT_KEY,
} from '@deepseek-ai/dsh-launch-environment'
import { installDesktopPnpmRuntime } from '../lib/desktop-runtime-environment.js'
import { installProfilePackageResolver } from '../lib/module-resolution.js'
import { prepareDesktopProfile } from '../lib/profile.js'
import { DesktopProfileService } from '../lib/profile-service.js'

const BIN_NAME = 'dsh-plugin-desktop-history-reload-proof'
const [outDir = '../.idealize/proof', home] = process.argv.slice(2)
if (home === undefined) { process.stderr.write('usage: history-reload-proof.mjs <out-dir> <dsh-home>\n'); app.exit(2) }
const failures = []
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures.push({ name, actual, expected })
  return ok
}
const step = (label) => { process.stderr.write(`[proof] ${label}\n`) }

setTimeout(() => { step('watchdog: timed out'); app.exit(2) }, 300_000).unref()
app.dock?.hide()
app.whenReady().then(main).catch((cause) => {
  step(`failed: ${cause instanceof Error ? cause.stack ?? cause.message : String(cause)}`)
  app.exit(1)
})

async function main() {
  step('ready')
  let mountedSpec
  let window
  const platform = process.platform === 'win32' ? 'win32' : process.platform === 'linux' ? 'linux' : 'darwin'
  const prepared = prepareDesktopProfile('1', home, platform)
  const packageRoot = new URL('../', import.meta.url)
  const pnpmBinPath = fileURLToPath(new URL('node_modules/pnpm/bin/pnpm.mjs', packageRoot))
  const idealizeCliPath = fileURLToPath(new URL('node_modules/@idealize/comm/lib/cli.js', packageRoot))
  const electronVersion = JSON.parse(
    readFileSync(new URL('node_modules/electron/package.json', packageRoot), 'utf8'),
  ).version
  const pnpmRuntime = installDesktopPnpmRuntime({
    platform: process.platform,
    appExecutable: process.execPath,
    pnpmBinPath,
    idealizeCliPath,
    electronVersion,
    stateDir: join(home, 'runtime-commands'),
    environment: process.env,
  })
  installProfilePackageResolver(prepared.bareModuleBaseUrl)
  const runtime = {
    platform,
    locale: 'en',
    updates: {
      isPackaged: false,
      canDownload: true,
      currentVersion: '2.0.0',
      statePath: join(home, 'update-state.json'),
      request: async () => { throw new Error('history reload proof must not perform update requests') },
      confirmDownload: async () => false,
      showManualCheckResult: async () => {},
      downloadAndOpen: async () => {},
      notify: () => {},
    },
    schedule(spec) { mountedSpec = spec; return async () => {} },
    async mountScheduled() { if (mountedSpec === undefined) throw new Error('desktop shell was not registered') },
    show() {},
    registerTrayItem() { return { refresh() {}, dispose() {} } },
    openTerminal() {},
    setLocalePreference() {},
    setThemeSource() {},
    async requestRestart() {},
    prepareToQuit() {},
  }
  step('booting profile')
  await boot(
    BIN_NAME,
    prepared.rootConfig,
    prepared.patches,
    async (host) => {
      host.provide(DSH_LAUNCH_ENVIRONMENT_KEY, createLaunchEnvironmentSnapshot([]))
      host.provide('desktopRuntime', runtime)
      host.provide('desktopPnpmBootstrap', {
        activeProfileName: 'desktop',
        activeProfileDir: prepared.profile.dir,
        homeDir: prepared.homeDir,
        appExecutable: process.execPath,
        pnpmBinPath,
        electronVersion,
        nodeBinDir: pnpmRuntime.nodeBinDir,
        nodeShimPath: pnpmRuntime.nodeShimPath,
        clearEnvironmentPath: pnpmRuntime.clearEnvironmentPath,
        dshBootstrapPath: fileURLToPath(new URL('../lib/desktop-cli.js', import.meta.url)),
        installRecoveryStatePath: join(home, 'plugin-install-recovery', 'state.json'),
        generationId: 'history-reload-proof-generation',
      })
      await host.plugin(DesktopProfileService, {
        current: { name: 'desktop', dir: prepared.profile.dir },
        list: () => [{
          name: 'desktop',
          dir: prepared.profile.dir,
          exists: true,
          bundles: prepared.profile.layers.map(layer => layer.packageName),
          webCapable: true,
        }],
        persistSelection: () => {},
        requestRestart: () => {},
      })
      provideCmdline(host, { args: ['--host', '127.0.0.1', '--port', '0'], exit: () => {} })
    },
    prepared.bareModuleBaseUrl,
  )
  await runtime.mountScheduled()
  step(`profile up at ${mountedSpec.url}`)
  check('renderer URL selects compatibility mode', new URL(mountedSpec.url).searchParams.get('dsh-desktop-mode'), 'compatibility')

  window = new BrowserWindow({
    width: 1280,
    height: 840,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  const consoleErrors = []
  window.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) consoleErrors.push(message)
  })
  await window.loadURL(mountedSpec.url)
  step('renderer loaded; waiting for the chat flow')

  const deadline = Date.now() + 120_000
  let ready = false
  while (Date.now() < deadline) {
    ready = await window.webContents.executeJavaScript(
      `document.querySelectorAll('nav li, aside li, [class*="chatRow"]').length > 1`,
    )
    if (ready) break
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  check('chat list rendered', ready, true)

  // The chats list: every named chat the store projects. Selectors are probed
  // rather than assumed, so the report says what the renderer actually offers.
  const listing = await window.webContents.executeJavaScript(`(() => {
    const text = el => (el.textContent ?? '').trim()
    const buttons = [...document.querySelectorAll('button, [role="option"], li, a')]
    return {
      bodyMode: document.body.dataset.dshDesktopMode ?? null,
      chatFlow: document.querySelector('[data-chat-flow]') !== null,
      loadErrorVisible: document.body.innerText.includes('Failed to load history'),
      candidates: buttons.map(text).filter(t => t.length > 0 && t.length < 40).slice(0, 400),
    }
  })()`)
  step(`listing probed (mode=${listing.bodyMode})`)

  // Drive every chat row the sidebar lists, by DOM position: the renderer's
  // own list is the authority on what the user can reopen.
  const perChat = await window.webContents.executeJavaScript(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms))
    const more = [...document.querySelectorAll('button, a, li')]
      .find(el => /Show \\d+ more chat/.test((el.textContent ?? '').trim()))
    if (more !== undefined) { more.click(); await wait(1200) }
    const rows = () => [...document.querySelectorAll('[class*="chatRow"], [class*="ChatRow"], [class*="sessionRow"], [data-session-id], nav li, aside li')]
    const seen = rows()
    const out = []
    for (let i = 0; i < seen.length && i < 16; i += 1) {
      const row = rows()[i]
      if (row === undefined) continue
      const label = (row.textContent ?? '').trim().slice(0, 40)
      row.click()
      await wait(2500)
      const text = document.body.innerText
      out.push({
        index: i,
        label,
        loadError: text.includes('Failed to load history')
          ? text.split('Failed to load history')[1].slice(0, 400).trim()
          : null,
        flowNodes: document.querySelectorAll('[data-chat-flow] > *').length,
      })
    }
    return out
  })()`)
  for (const entry of perChat) {
    check(`chat row ${entry.index} ("${entry.label}") reopens without a history load error`, entry.loadError, null)
  }

  check('no "Failed to load history" anywhere in the frame', listing.loadErrorVisible, false)

  mkdirSync(outDir, { recursive: true })
  step('capturing')
  const image = await window.webContents.capturePage(undefined, { stayHidden: true })
  writeFileSync(join(outDir, 'history-reload.png'), image.toPNG())

  const report = {
    mode: listing.bodyMode,
    chatFlowMounted: listing.chatFlow,
    chatsOpened: perChat,
    consoleErrors: consoleErrors.slice(0, 20),
    screenshot: join(outDir, 'history-reload.png'),
    failures,
    ok: failures.length === 0,
  }
  writeFileSync(join(outDir, 'history-reload.json'), JSON.stringify(report, null, 2) + '\n')
  process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  app.exit(failures.length === 0 ? 0 : 1)
}
