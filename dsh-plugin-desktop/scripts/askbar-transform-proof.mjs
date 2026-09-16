/**
 * Electron proof for the Askbar collapse/expand transform. Runs inside Electron:
 *   electron scripts/askbar-transform-proof.mjs <out-dir>
 * Boots the complete desktop profile through the REAL ElectronDesktopRuntime
 * against a scratch DSH home and user-data directory, so the main window and
 * the Askbar window are the production ones. Proves JJ's 2 Sep 2026 rule
 * that the two are never both on screen:
 *   (a) after boot the main window is visible and the Askbar is not, even
 *       once the bar's page has loaded;
 *   (b) collapseToBar() shows the Askbar and hides the main window;
 *   (c) expandFromBar() shows the main window and hides the Askbar.
 * Writes askbar-transform.json plus a PNG of each window. The windows do
 * appear on screen for a few seconds: visibility is the subject under test.
 */
import { app, BrowserWindow } from 'electron'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boot } from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import {
  createLaunchEnvironmentSnapshot,
  DSH_LAUNCH_ENVIRONMENT_KEY,
} from '@deepseek-ai/dsh-launch-environment'
import { installDesktopPnpmRuntime } from '../lib/desktop-runtime-environment.js'
import { ElectronDesktopRuntime } from '../lib/electron-runtime.js'
import { installProfilePackageResolver } from '../lib/module-resolution.js'
import { prepareDesktopProfile } from '../lib/profile.js'
import { DesktopProfileService } from '../lib/profile-service.js'
import DesktopActionsService from '../lib/desktop-actions.js'

const BIN_NAME = 'dsh-plugin-desktop-askbar-transform-proof'
const [outDir = '../.idealize/proof'] = process.argv.slice(2)
const failures = []
const checks = []
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  checks.push({ name, ok })
  if (!ok) failures.push({ name, actual, expected })
  return ok
}
const step = (label) => { process.stderr.write(`[proof] ${label}\n`) }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function poll(label, deadlineMs, probe) {
  const deadline = Date.now() + deadlineMs
  let last
  while (Date.now() < deadline) {
    last = await probe()
    if (last !== undefined && last !== false && last !== null) return last
    await sleep(100)
  }
  failures.push({ name: `${label} before the deadline`, actual: last ?? null, expected: 'value' })
  return undefined
}

// Scratch home and user data: the proof must never read or write the live
// IDEalize data. Both are set before Electron is ready and removed at exit.
const home = mkdtempSync(join(tmpdir(), 'dsh-desktop-askbar-transform-'))
process.env.DSH_HOME = home
app.setPath('userData', join(home, 'user-data'))

setTimeout(() => { step('watchdog: timed out'); app.exit(2) }, 180_000).unref()
app.dock?.hide()
app.on('window-all-closed', () => {})
app.whenReady().then(main).catch((cause) => {
  step(`failed: ${cause instanceof Error ? cause.stack ?? cause.message : String(cause)}`)
  rmSync(home, { recursive: true, force: true })
  app.exit(1)
})

const visibility = (main, askbar) => ({ main: main.isVisible(), askbar: askbar.isVisible() })

async function main() {
  step('ready')
  const platform = process.platform === 'win32' ? 'win32' : process.platform === 'linux' ? 'linux' : 'darwin'
  const packageRoot = new URL('../', import.meta.url)
  const pnpmBinPath = fileURLToPath(new URL('node_modules/pnpm/bin/pnpm.mjs', packageRoot))
  const idealizeCliPath = fileURLToPath(new URL('node_modules/@idealize/comm/lib/cli.js', packageRoot))
  const electronVersion = JSON.parse(
    readFileSync(new URL('node_modules/electron/package.json', packageRoot), 'utf8'),
  ).version
  let ctx
  let releaseResolver
  let pnpmRuntime
  let runtime
  try {
    writeFileSync(join(home, 'settings.yaml'), ['dsh-desktop:', '  mode: compatibility', '  askbarSide: left', ''].join('\n'))
    pnpmRuntime = installDesktopPnpmRuntime({
      platform: process.platform,
      appExecutable: process.execPath,
      pnpmBinPath,
      idealizeCliPath,
      electronVersion,
      stateDir: join(home, 'runtime-commands'),
      environment: process.env,
    })
    const prepared = prepareDesktopProfile('1', home, platform)
    releaseResolver = installProfilePackageResolver(prepared.bareModuleBaseUrl)
    // A failed renderer boot is reported as handled so no recovery dialog
    // blocks the proof; the visibility rules under test do not depend on it.
    runtime = new ElectronDesktopRuntime(async () => {}, () => true)

    step('booting the profile through the real Electron runtime')
    ctx = await boot(
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
          generationId: 'askbar-transform-proof',
        })
        await host.plugin(DesktopActionsService, {
          openTerminal: () => {},
          requestRestart: () => {},
          trashItem: async () => {},
          collapseToBar: () => { runtime.collapseToBar() },
          expandFromBar: () => { runtime.expandFromBar() },
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
        provideCmdline(host, {
          args: ['--host', '127.0.0.1', '--port', '0'],
          exit: () => {},
        })
      },
      prepared.bareModuleBaseUrl,
    )
    await runtime.mountScheduled()
    step('shell mounted')

    const windows = BrowserWindow.getAllWindows()
    check('two windows exist: main and Askbar', windows.length, 2)
    // The bar's loadURL is still in flight right after mount; wait for its URL to commit.
    const askbar = await poll('Askbar window identified by its URL', 30_000, () => (
      windows.find(window => window.webContents.getURL().includes('dsh-desktop-mode=askbar'))
    ))
    const main = windows.find(window => window !== askbar)
    if (askbar === undefined || main === undefined) throw new Error('could not tell the Askbar window from the main window')

    // (a) Boot: the main window shows on ready-to-show; the bar loads but stays hidden.
    step('waiting for the main window to show and the Askbar page to load')
    const mainShown = await poll('main window visible', 60_000, () => main.isVisible())
    check('main window visible after boot', mainShown === true, true)
    const barLoaded = await poll('Askbar page loaded', 60_000, () => !askbar.webContents.isLoading())
    check('Askbar page finished loading', barLoaded === true, true)
    // ready-to-show follows the first paint; give it time to fire so a
    // regression back to show-on-ready would be caught here.
    await sleep(1500)
    const afterBoot = visibility(main, askbar)
    check('after boot: main visible, Askbar hidden', afterBoot, { main: true, askbar: false })

    // (b) Collapse: the bar shows, the main window glides and hides.
    step('collapsing to the Askbar')
    runtime.collapseToBar()
    const collapsed = await poll('collapsed state', 5_000, () => {
      const state = visibility(main, askbar)
      return state.askbar && !state.main ? state : false
    })
    check('after collapseToBar: Askbar visible, main hidden', collapsed ?? visibility(main, askbar), { main: false, askbar: true })
    mkdirSync(outDir, { recursive: true })
    const askbarImage = await askbar.webContents.capturePage()
    writeFileSync(join(outDir, 'askbar-transform-collapsed.png'), askbarImage.toPNG())
    const askbarBounds = askbar.getBounds()
    check('Askbar docked to the left edge, 72px wide', { x: askbarBounds.x, width: askbarBounds.width }, { x: askbarBounds.x, width: 72 })

    // (c) Expand: the main window returns and the bar hides.
    step('expanding from the Askbar')
    runtime.expandFromBar()
    const expanded = await poll('expanded state', 5_000, () => {
      const state = visibility(main, askbar)
      return state.main && !state.askbar ? state : false
    })
    check('after expandFromBar: main visible, Askbar hidden', expanded ?? visibility(main, askbar), { main: true, askbar: false })
    await sleep(300)
    const mainImage = await main.webContents.capturePage()
    writeFileSync(join(outDir, 'askbar-transform-expanded.png'), mainImage.toPNG())

    const report = {
      home,
      afterBoot,
      collapsed: collapsed ?? null,
      expanded: expanded ?? null,
      askbarBounds,
      checks,
      screenshots: [
        join(outDir, 'askbar-transform-collapsed.png'),
        join(outDir, 'askbar-transform-expanded.png'),
      ],
      failures,
      ok: failures.length === 0,
    }
    writeFileSync(join(outDir, 'askbar-transform.json'), JSON.stringify(report, null, 2) + '\n')
    console.log(JSON.stringify(report, null, 2))
  } finally {
    step('tearing down')
    try {
      await ctx?.fiber.dispose()
    } catch (cause) {
      step(`teardown: ${cause instanceof Error ? cause.message : String(cause)}`)
    }
    releaseResolver?.()
    pnpmRuntime?.dispose()
    rmSync(home, { recursive: true, force: true })
  }
  app.exit(failures.length === 0 ? 0 : 1)
}
