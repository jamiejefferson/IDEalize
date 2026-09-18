/** IDEalize executable: minimal Electron bootstrap around the Host Cordis root. */

import { app, crashReporter, dialog, globalShortcut, net, session, shell } from 'electron'

// Chromium caps HTTP/1.1 at six connections per origin, and every window's
// event streams hold theirs open (main + Askbar SSE pairs, a Terminal chat's
// stream). At the cap, every later loopback fetch queues forever: the first
// user-visible casualty is New chat timing out after a Terminal chat opens.
// Loopback talks only to this app's own Host, so the cap buys nothing here.
// Must run at module scope: switches appended after the app is ready are
// ignored by the network service.
app.commandLine.appendSwitch('ignore-connections-limit', '127.0.0.1,localhost')
import type { Context } from '@deepseek-ai/cordis'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  boot,
  installFailLoud,
  loadLayeredEnv,
  PROFILE_PATCH_FILENAME,
  resolveProfileDir,
  type FailLoudProcess,
} from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { DSH_LAUNCH_ENVIRONMENT_KEY } from '@deepseek-ai/dsh-launch-environment'
import {
  installDesktopDshRuntime,
  installDesktopPnpmRuntime,
} from './desktop-runtime-environment.ts'
import { desktopProductVersion, ElectronDesktopRuntime } from './electron-runtime.ts'
import {
  ElectronStderrLogger,
  installDesktopChildProcessLogging,
  installDesktopUncaughtExceptionLogging,
  type DesktopLogger,
} from './desktop-logger.ts'
import {
  beginDesktopRun,
  startDesktopCrashReporting,
  type DesktopRun,
} from './crash-evidence.ts'
import { exportDesktopDiagnostics } from './diagnostic-export.ts'
import { FileExporter } from './file-exporter.ts'
import { DESKTOP_SETTINGS_NAMESPACE, type DesktopSettings } from './index.ts'
import { clearPreviousLaunchHttpCache } from './http-cache.ts'
import { LogFileSink } from './log-files.ts'
import { maskSecrets } from './mask-secrets.ts'
import { resolveDesktopShellEnvironment } from './shell-environment.ts'
import { installProfilePackageResolver } from './module-resolution.ts'
import { packagedDependencyPath } from './packaged-runtime-path.ts'
import {
  DesktopInstallRecoveryStore,
  desktopInstallRecoveryStatePath,
  type DesktopInstallRecoveryFailureReason,
  type DesktopInstallRecoveryTransaction,
} from './install-recovery.ts'
import {
  beginDesktopProfileStartup,
  listDesktopProfiles,
  markDesktopProfileFailed,
  markDesktopProfileHealthy,
  readDesktopProfileState,
  selectDesktopProfile,
  type DesktopProfileStartup,
} from './profile-manager.ts'
import { DesktopProfileService } from './profile-service.ts'
import { DesktopActionsService } from './desktop-actions.ts'
import { IDEALIZE_SCHEME, parseIdealizeUrl, requestFromArgv, type OpenProjectRequest } from './idealize-url.ts'
import { importKeysFile, isKeysFilePath, keysFileFromArgv, keysFileNotification } from './keys-file.ts'
import { installFinderQuickAction, QUICK_ACTION_NAME } from './finder-quick-action.ts'
import { DesktopTerminalsService } from './embedded-terminal.ts'
import { DesktopPluginsService } from './desktop-plugins.ts'
import { DesktopStartupRecoveryController } from './startup-recovery-controller.ts'
import {
  DesktopStartupRecoveryWindow,
  type DesktopStartupRecoveryConfigurationPaths,
  type DesktopStartupFailureStage,
} from './startup-recovery-window.ts'
import { routeDesktopStartupFailure } from './startup-failure-routing.ts'
import {
  desktopInstallAnchor,
  prepareDesktopProfile,
  type SkippedOptionalEntry,
} from './profile.ts'
import type { DesktopPnpmBootstrap } from './pnpm.ts'
import {
  armDesktopExitWatchdog,
  createDesktopExitCoordinator,
  createDesktopShutdown,
  installShutdownRequests,
  type DesktopShutdown,
} from './shutdown.ts'
import {
  diagnoseWindowsVolumes,
  formatWindowsVolumeConcern,
  type WindowsVolumeConcern,
} from './windows-volume-diagnostics.ts'
import type { RendererBootReport } from './renderer-boot-contract.ts'
import { desktopLocaleFromLanguageTag } from './tray-locale.ts'

const BIN_NAME = 'dsh-plugin-desktop'
const PRODUCT_NAME = 'IDEalize'
/** The manifest's Electron Builder `appId`; the Windows shortcuts carry it as their App User Model ID, so the running app must announce the same one for taskbar grouping and toast notifications. */
const APP_ID = 'ai.projject.idealize.v1'

class RendererStartupFailure extends Error {
  constructor(
    readonly reason: Extract<DesktopInstallRecoveryFailureReason, 'renderer-failed' | 'renderer-timeout'>,
    report: Extract<RendererBootReport, { status: 'failed' }>,
  ) {
    super(report.error ?? `Renderer boot failed for ${String(report.plugins.length)} plugin(s)`)
    this.name = 'RendererStartupFailure'
  }
}

/** Report profile recovery without changing startup or rollback outcomes. */
function notifyProfileRecovery(runtime: ElectronDesktopRuntime, logger: DesktopLogger, body: string): void {
  try {
    runtime.updates.notify({ title: 'Unable to Open Profile', body })
  } catch (cause) {
    logger.error(`${BIN_NAME}: failed to show profile recovery notification: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
}

/** Explain a completed cross-restart install rollback after Desktop is healthy again. */
async function showInstallRollbackNotice(
  transaction: DesktopInstallRecoveryTransaction,
  locale: 'en' | 'zh',
  logger: DesktopLogger,
): Promise<boolean> {
  const copy = locale === 'zh'
    ? {
        title: '插件安装已回滚',
        message: `IDEalize 已恢复安装 ${transaction.packageName} 前的配置。`,
        detail: '上一次启动未能通过健康验证。IDEalize 已在本地保存诊断信息，并恢复 package.json、pnpm-lock.yaml 和 pnpm-workspace.yaml；诊断信息不会自动上传。',
        confirm: '知道了',
      }
    : {
        title: 'Plugin installation rolled back',
        message: `IDEalize restored the configuration from before ${transaction.packageName} was installed.`,
        detail: 'The previous startup did not pass its health check. IDEalize saved diagnostics locally and restored package.json, pnpm-lock.yaml, and pnpm-workspace.yaml. Diagnostics are not uploaded automatically.',
        confirm: 'OK',
      }
  try {
    await dialog.showMessageBox({
      type: 'info',
      title: copy.title,
      message: copy.message,
      detail: copy.detail,
      buttons: [copy.confirm],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    })
    return true
  } catch (cause) {
    logger.error(`${BIN_NAME}: failed to show install rollback notice: ${cause instanceof Error ? cause.message : String(cause)}`)
    return false
  }
}

/** Report optional user UI plugins skipped to keep startup recoverable. */
function notifySkippedOptionalEntries(
  runtime: ElectronDesktopRuntime,
  logger: DesktopLogger,
  entries: readonly SkippedOptionalEntry[],
): void {
  if (entries.length === 0) return
  const names = entries.map(entry => entry.name)
  const suffix = names.length > 1 ? ` and ${names.length - 1} more` : ''
  try {
    runtime.updates.notify({
      title: 'Skipped Unavailable UI Plugin',
      body: `${names[0]} is not installed in this profile${suffix}.`,
    })
  } catch (cause) {
    logger.error(`${BIN_NAME}: failed to show skipped plugin notification: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
}

/** Surface path/volume risks that otherwise become obscure sandbox or pnpm failures later. */
function warnWindowsVolumeConcerns(logger: DesktopLogger, concerns: readonly WindowsVolumeConcern[]): void {
  for (const concern of concerns) {
    logger.error(`${BIN_NAME}: Windows volume warning: ${formatWindowsVolumeConcern(concern)}`)
  }
}

/** Notify once after the UI is ready; stderr carries the exact paths. */
function notifyWindowsVolumeConcerns(
  runtime: ElectronDesktopRuntime,
  logger: DesktopLogger,
  concerns: readonly WindowsVolumeConcern[],
): void {
  if (concerns.length === 0) return
  try {
    runtime.updates.notify({
      title: 'Storage May Be Unsupported',
      body: `${concerns[0]?.label ?? 'A configured path'} is on a volume that may break sandboxed commands or plugin installs.`,
    })
  } catch (cause) {
    logger.error(`${BIN_NAME}: failed to show Windows volume warning: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
}

/** Start one Electron process and leave lifetime to the mounted desktop plugin. */
async function start(): Promise<void> {
  // Finder's "Idealize this" reaches the app over `idealize://project?path=…`.
  // macOS delivers it as an `open-url` event, which can fire before the Host
  // is up, so the request is held here and handed over once there is a window
  // to hand it to. Windows and Linux put the URL in the argument list instead.
  let pendingProject: OpenProjectRequest | undefined = requestFromArgv(process.argv)
  let deliverProject: (request: OpenProjectRequest) => void = (request) => { pendingProject = request }
  app.setAsDefaultProtocolClient(IDEALIZE_SCHEME)
  app.on('open-url', (event, url) => {
    const request = parseIdealizeUrl(url)
    if (request === undefined) return
    event.preventDefault()
    deliverProject(request)
  })
  // A double-clicked `.idealizekeys` file arrives the same way: `open-file`
  // on macOS, an argument elsewhere, possibly before the Host is up. The
  // path is held until the import route exists, then posted once. macOS
  // also hands a running instance the path as a second-instance argument,
  // so there the argument list is ignored or the file would import twice.
  const keysFileFromArguments = (argv: readonly string[]): string | undefined =>
    process.platform === 'darwin' ? undefined : keysFileFromArgv(argv)
  let pendingKeysFile: string | undefined = keysFileFromArguments(process.argv)
  let deliverKeysFile: (path: string) => void = (path) => { pendingKeysFile = path }
  app.on('open-file', (event, path) => {
    if (!isKeysFilePath(path)) return
    event.preventDefault()
    deliverKeysFile(path)
  })
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }

  let current: Context | undefined
  let hostDisposeTask: Promise<boolean> | undefined
  let profileStartup: DesktopProfileStartup | undefined
  let profileStatePath: string | undefined
  let shutdown: DesktopShutdown | undefined
  let removeShutdownRequests: (() => void) | undefined
  let removeUncaughtExceptionLogging: (() => void) | undefined
  let removeChildProcessLogging: (() => void) | undefined
  let disposeDshRuntime: (() => void) | undefined
  let disposePnpmRuntime: (() => void) | undefined
  let fileExporter: FileExporter | undefined
  let runtime!: ElectronDesktopRuntime
  let logSink: LogFileSink | undefined
  let installRecovery: DesktopInstallRecoveryStore | undefined
  let startupRecoveryController: DesktopStartupRecoveryController | undefined
  let startupRecoveryWindow: DesktopStartupRecoveryWindow | undefined
  let startupRecoveryConfigurationPaths: DesktopStartupRecoveryConfigurationPaths | undefined
  let verifyingInstall: DesktopInstallRecoveryTransaction | undefined
  let verifiedInstallToClear: DesktopInstallRecoveryTransaction | undefined
  let rolledBackInstallToNotify: DesktopInstallRecoveryTransaction | undefined
  let rendererBootSettled = false
  let resolveRendererBoot!: (report: RendererBootReport) => void
  const rendererBoot = new Promise<RendererBootReport>((resolve) => {
    resolveRendererBoot = resolve
  })
  const generationId = randomUUID()
  let startupStage: DesktopStartupFailureStage = 'electron-ready'
  try {
    logSink = new LogFileSink(join(app.getPath('userData'), 'logs'), {
      maxFileBytes: 10 * 1024 * 1024,
      maxDirectoryBytes: 200 * 1024 * 1024,
      // Each append blocks the main thread (a median 8 ms per line on JJ's
      // machine, 0.8-3.8 s for a 60-line skill-catalogue burst).
      coalesceMs: 100,
    })
    logSink.enforceDirectoryCap()
    logSink.purgeOlderThan(7)
    logSink.writeHeader(`--- ${BIN_NAME} ${PRODUCT_NAME} ${desktopProductVersion()} ${process.platform} node ${process.version} run ${Date.now()} ---`)
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    process.stderr.write(`${BIN_NAME}: file logging unavailable: ${maskSecrets(detail)}\n`)
    logSink = undefined
  }
  const electronLogger = new ElectronStderrLogger(logSink)
  try {
    startDesktopCrashReporting(crashReporter, {
      productName: PRODUCT_NAME,
      version: desktopProductVersion(),
      platform: process.platform,
      arch: process.arch,
    })
  } catch (cause) {
    electronLogger.error(`${BIN_NAME}: local crash reporting unavailable: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
  let desktopRun: DesktopRun | undefined
  try {
    desktopRun = beginDesktopRun(
      join(app.getPath('userData'), 'crash-evidence', 'active-run.json'),
      {
        startedAt: new Date().toISOString(),
        pid: process.pid,
        version: desktopProductVersion(),
      },
    )
    const previousRun = desktopRun.previousRun
    if (previousRun !== undefined) {
      electronLogger.error('unreadable' in previousRun
        ? `${BIN_NAME}: previous desktop run did not shut down cleanly (active run marker unreadable)`
        : `${BIN_NAME}: previous desktop run did not shut down cleanly (startedAt: ${previousRun.startedAt}, pid: ${String(previousRun.pid)}, version: ${previousRun.version})`)
    }
  } catch (cause) {
    electronLogger.error(`${BIN_NAME}: active run tracking unavailable: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
  removeChildProcessLogging = installDesktopChildProcessLogging(app, electronLogger)
  const nativeExit = createDesktopExitCoordinator(
    {
      prepareToQuit: () => { runtime.prepareToQuit() },
      relaunch: () => { app.relaunch() },
      exit: code => { app.exit(code) },
      armExitWatchdog: () => { armDesktopExitWatchdog(process.pid, process.platform, spawn) },
    },
    () => {
      removeShutdownRequests?.()
      removeUncaughtExceptionLogging?.()
      removeChildProcessLogging?.()
      try {
        desktopRun?.markClean()
      } catch (cause) {
        electronLogger.error(`${BIN_NAME}: failed to clear active run marker: ${cause instanceof Error ? cause.message : String(cause)}`)
      }
      logSink?.flush()
    },
  )
  let restartRequested = false
  runtime = new ElectronDesktopRuntime(async () => {
    if (shutdown === undefined) {
      throw new Error('dsh-plugin-desktop: shutdown coordinator is not ready')
    }
    if (restartRequested) return
    restartRequested = true
    nativeExit.requestRelaunch()
    await shutdown.request(0)
  }, (report) => {
    if (!rendererBootSettled) {
      rendererBootSettled = true
      resolveRendererBoot(report)
    }
    // Main owns every pre-health failure branch. Returning true prevents the
    // legacy Renderer recovery dialog from racing the native startup window.
    return report.status === 'failed'
  }, electronLogger)
  const finalExit = (code: number): void => { nativeExit.finish(code) }
  shutdown = createDesktopShutdown(
    async () => {
      try {
        if (hostDisposeTask !== undefined) {
          const stopped = await hostDisposeTask
          if (!stopped) await current?.fiber.dispose()
        } else {
          await current?.fiber.dispose()
        }
      } finally {
        disposeDshRuntime?.()
        disposePnpmRuntime?.()
      }
    },
    finalExit,
  )
  const requestQuit = (code: number): void => { void shutdown.request(code) }
  removeUncaughtExceptionLogging = installDesktopUncaughtExceptionLogging(
    process,
    electronLogger,
    requestQuit,
  )
  removeShutdownRequests = installShutdownRequests(process, app, requestQuit)

  const openStartupRecoveryWindow = async (
    failureDetail: string,
    controller: DesktopStartupRecoveryController | undefined,
  ): Promise<'restart' | 'quit' | 'unavailable'> => {
    if (!app.isReady()) return 'unavailable'
    try {
      startupRecoveryWindow = new DesktopStartupRecoveryWindow({
        ...(controller === undefined ? {} : { controller }),
        ...(startupRecoveryConfigurationPaths === undefined
          ? {}
          : { configurationPaths: startupRecoveryConfigurationPaths }),
        locale: desktopLocaleFromLanguageTag(app.getLocale()),
        failureStage: startupStage,
        failureDetail: maskSecrets(failureDetail),
        exportDiagnostics: async () => await exportDesktopDiagnostics(app.getPath('userData'), {
          appVersion: desktopProductVersion(),
          crashDumpsDir: app.getPath('crashDumps'),
        }),
      })
      return await startupRecoveryWindow.run()
    } catch (cause) {
      electronLogger.error(
        `${BIN_NAME}: failed to open startup recovery window: ${cause instanceof Error ? cause.message : String(cause)}`,
      )
      return 'unavailable'
    } finally {
      startupRecoveryWindow = undefined
    }
  }

  const quiesceHostForRecovery = async (): Promise<boolean> => {
    const host = current
    if (host === undefined) return true
    hostDisposeTask ??= Promise.resolve().then(async () => {
      await host.fiber.dispose()
      current = undefined
      return true
    }).catch((cause: unknown) => {
      electronLogger.error(
        `${BIN_NAME}: failed to stop the plugin Host before recovery: ${cause instanceof Error ? cause.message : String(cause)}`,
      )
      return false
    })
    let timeout: ReturnType<typeof setTimeout> | undefined
    const timedOut = new Promise<false>(resolve => {
      timeout = setTimeout(() => { resolve(false) }, 5_000)
    })
    const result = await Promise.race([hostDisposeTask, timedOut])
    if (timeout !== undefined) clearTimeout(timeout)
    if (!result) electronLogger.error(`${BIN_NAME}: plugin Host did not stop in time; mutating recovery actions are unavailable`)
    return result
  }

  app.on('second-instance', (_event, argv) => {
    const request = requestFromArgv(argv)
    if (request !== undefined) deliverProject(request)
    const keysFile = keysFileFromArguments(argv)
    if (keysFile !== undefined) deliverKeysFile(keysFile)
    if (startupRecoveryWindow !== undefined) startupRecoveryWindow.show()
    else runtime.show()
  })
  try {
    await app.whenReady()
    // Detached: the clear runs in Chromium's cache thread while the Host boots.
    void clearPreviousLaunchHttpCache(
      session.defaultSession,
      (message) => { electronLogger.error(`${BIN_NAME}: ${message}`) },
    )
    startupStage = 'shell-environment'
    if (process.platform === 'win32') app.setAppUserModelId(APP_ID)
    if (app.isPackaged && process.cwd() === '/') process.chdir(app.getPath('home'))
    const shellEnvironmentResolution = await resolveDesktopShellEnvironment({
      environment: process.env,
      home: app.getPath('home'),
      isPackaged: app.isPackaged,
      platform: process.platform,
    })
    for (const [name, value] of Object.entries(shellEnvironmentResolution.updates)) process.env[name] = value
    // IDEalize keeps its Harness home inside the app's own user-data
    // directory so it never collides with a stock ~/.dsh install on the same
    // machine. An explicit DSH_HOME in the environment still wins.
    if ((process.env.DSH_HOME ?? '').trim().length === 0) {
      process.env.DSH_HOME = join(app.getPath('userData'), 'harness')
    }
    // IDEalize ships the forked FreeLLMAPI server as a single-file bundle;
    // point the freetokens plugin at it so every install gets the embedded
    // free-tokens engine with zero setup. An explicit env value wins (dev
    // runs against a fork checkout that way).
    if ((process.env.IDEALIZE_FREETOKENS_SERVER ?? '').trim().length === 0) {
      const freetokensServer = app.isPackaged
        ? join(process.resourcesPath, 'freellmapi', 'server.mjs')
        : fileURLToPath(new URL('../../vendor/freellmapi/server.mjs', import.meta.url))
      if (existsSync(freetokensServer)) process.env.IDEALIZE_FREETOKENS_SERVER = freetokensServer
    }
    const homeDir = resolveDshHome()
    const windowsVolumeConcerns = diagnoseWindowsVolumes(process.platform, [
      { label: 'application install', path: process.execPath },
      { label: 'desktop user data', path: app.getPath('userData') },
      { label: 'harness home', path: homeDir },
    ])
    warnWindowsVolumeConcerns(electronLogger, windowsVolumeConcerns)

    const failLoudProcess: FailLoudProcess = {
      on: (event, handler) => process.on(event, handler),
      off: (event, handler) => process.off(event, handler),
      stderr: electronLogger,
      exit: finalExit,
    }
    installFailLoud(BIN_NAME, failLoudProcess, async () => {
      try {
        await current?.fiber.dispose()
      } finally {
        disposeDshRuntime?.()
        disposePnpmRuntime?.()
      }
    })

    startupStage = 'runtime-bootstrap'
    const installRecoveryStatePath = desktopInstallRecoveryStatePath(app.getPath('userData'))
    const environment = loadLayeredEnv(BIN_NAME, process.cwd())
    const electronVersion = process.versions.electron
    if (electronVersion === undefined) {
      throw new Error(`${BIN_NAME}: plugin runtime requires the Electron runtime version`)
    }
    const pnpmBinPath = packagedDependencyPath(import.meta.url, 'pnpm/bin/pnpm.mjs')
    // The `idealize` command every agent's prompt names (`@idealize/comm`'s
    // COMMANDS_SECTION) joins pnpm on the Host PATH; the packaged app ships the
    // CLI without a bin entry (JJ, 8 Sep 2026: an agent ran an unrelated CLI instead).
    const idealizeCliPath = packagedDependencyPath(import.meta.url, '@idealize/comm/lib/cli.js')
    const pnpmRuntime = installDesktopPnpmRuntime({
      platform: process.platform,
      appExecutable: process.execPath,
      pnpmBinPath,
      idealizeCliPath,
      electronVersion,
      stateDir: join(app.getPath('userData'), 'runtime-commands'),
      environment: process.env,
    })
    const releasePnpmRuntime = (): void => { pnpmRuntime.dispose() }
    disposePnpmRuntime = releasePnpmRuntime
    const selectionStatePath = join(app.getPath('userData'), 'profile-selection', 'state.json')
    const pluginManagementStatePath = join(app.getPath('userData'), 'plugin-management', 'state.json')
    startupStage = 'profile-selection'
    profileStatePath = selectionStatePath
    profileStartup = beginDesktopProfileStartup(selectionStatePath, homeDir)
    const activeProfileName = profileStartup.profileName
    const activeProfileDir = resolveProfileDir(activeProfileName, homeDir)
    startupRecoveryConfigurationPaths = {
      profilePatch: join(activeProfileDir, PROFILE_PATCH_FILENAME),
      profileManifest: join(activeProfileDir, 'package.json'),
      profileDirectory: activeProfileDir,
    }
    installRecovery = new DesktopInstallRecoveryStore({
      statePath: installRecoveryStatePath,
      profileName: activeProfileName,
      profileDir: activeProfileDir,
      generationId,
    })
    startupRecoveryController = new DesktopStartupRecoveryController({
      pluginState: {
        profileName: activeProfileName,
        homeDir,
        statePath: pluginManagementStatePath,
      },
      generationId,
      currentGeneration: () => ({
        profileName: readDesktopProfileState(selectionStatePath).active,
        generationId,
      }),
      installRecovery,
    })
    startupStage = 'install-recovery'
    const recoveryClaim = await installRecovery.claim()
    if (recoveryClaim.action === 'prompt') {
      electronLogger.error(
        `${BIN_NAME}: protected plugin install ${recoveryClaim.transaction.packageName} (${recoveryClaim.transaction.transactionId}) requires a recovery choice after ${recoveryClaim.reason}`,
      )
      const recoveryResult = await openStartupRecoveryWindow(
        `Protected plugin installation ${recoveryClaim.transaction.packageName}@${recoveryClaim.transaction.packageVersion} requires a recovery choice after ${recoveryClaim.reason}.`,
        startupRecoveryController,
      )
      startupRecoveryController.dispose()
      startupRecoveryController = undefined
      if (recoveryResult === 'restart') nativeExit.requestRelaunch()
      await shutdown.request(recoveryResult === 'restart' ? 0 : 1)
      return
    } else if (recoveryClaim.action === 'verify') {
      verifyingInstall = recoveryClaim.transaction
    } else if (
      recoveryClaim.action === 'terminal'
      && recoveryClaim.transaction.phase === 'manual-recovery-required'
    ) {
      throw new Error(`${BIN_NAME}: plugin install recovery requires manual repair before this profile can start`)
    } else if (
      recoveryClaim.action === 'terminal'
      && recoveryClaim.transaction.phase === 'verified'
    ) {
      verifiedInstallToClear = recoveryClaim.transaction
    } else if (
      recoveryClaim.action === 'terminal'
      && recoveryClaim.transaction.phase === 'rolled-back'
      && recoveryClaim.transaction.rollbackNotifiedAt === undefined
    ) {
      rolledBackInstallToNotify = recoveryClaim.transaction
    } else if (recoveryClaim.action === 'deferred') {
      electronLogger.error(
        `${BIN_NAME}: deferred plugin install recovery (${recoveryClaim.reason}) for ${recoveryClaim.transaction.packageName}`,
      )
    }
    startupStage = 'profile-composition'
    const prepared = prepareDesktopProfile(
      process.env.DSH_TELEMETRY_DISABLED,
      homeDir,
      process.platform,
      activeProfileName,
      pluginManagementStatePath,
    )
    startupStage = 'runtime-bootstrap'
    const dshBootstrapPath = fileURLToPath(new URL('./desktop-cli.js', import.meta.url))
    const dshRuntime = process.platform === 'win32'
      ? installDesktopDshRuntime({
          platform: process.platform,
          appExecutable: process.execPath,
          dshBootstrapPath,
          profileName: activeProfileName,
          homeDir,
          stateDir: join(app.getPath('userData'), 'host-commands', activeProfileName),
          installRecoveryStatePath,
          environment: process.env,
        })
      : undefined
    const releaseDshRuntime = (): void => { dshRuntime?.dispose() }
    disposeDshRuntime = releaseDshRuntime
    const desktopPnpmBootstrap: DesktopPnpmBootstrap = {
      activeProfileName,
      activeProfileDir: prepared.profile.dir,
      homeDir,
      appExecutable: process.execPath,
      pnpmBinPath,
      electronVersion,
      nodeBinDir: pnpmRuntime.nodeBinDir,
      nodeShimPath: pnpmRuntime.nodeShimPath,
      clearEnvironmentPath: pnpmRuntime.clearEnvironmentPath,
      dshBootstrapPath,
      installRecoveryStatePath,
      generationId,
    }
    startupStage = 'host-boot'
    const releasePackageResolver = installProfilePackageResolver(prepared.bareModuleBaseUrl)
    const ctx = await boot(
      BIN_NAME,
      prepared.rootConfig,
      prepared.patches,
      async (hostCtx) => {
        hostCtx.effect(
          () => releasePnpmRuntime,
          'dsh-plugin-desktop: packaged pnpm runtime PATH',
        )
        if (dshRuntime !== undefined) {
          hostCtx.effect(
            () => releaseDshRuntime,
            'dsh-plugin-desktop: packaged dsh runtime PATH',
          )
        }
        current = hostCtx
        hostCtx.effect(
          () => releasePackageResolver,
          'dsh-plugin-desktop: profile package resolution',
        )
        hostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, environment)
        hostCtx.provide('desktopRuntime', runtime)
        hostCtx.provide('desktopPnpmBootstrap', desktopPnpmBootstrap)
        await hostCtx.plugin(DesktopActionsService, {
          openTerminal: () => { runtime.openTerminal() },
          requestRestart: () => runtime.requestRestart(),
          trashItem: path => shell.trashItem(path),
          collapseToBar: () => { runtime.collapseToBar() },
          expandFromBar: () => { runtime.expandFromBar() },
          setBarWidth: (width) => { runtime.setBarWidth(width) },
          focusBar: (focus) => { runtime.focusBar(focus) },
          notify: notification => { runtime.updates.notify(notification) },
        })
        // Embedded terminals for the in-chat toggle. node-pty ships N-API
        // prebuilds, so the import succeeds under Electron; should it not,
        // the service stays absent and the web client hides the toggle.
        try {
          const pty = await import('node-pty')
          await hostCtx.plugin(DesktopTerminalsService, { spawn: pty.spawn })
        } catch (cause) {
          hostCtx.logger.warn('embedded terminals unavailable: %s', cause instanceof Error ? cause.message : String(cause))
        }
        await hostCtx.plugin(DesktopPluginsService, {
          profileName: activeProfileName,
          homeDir,
          statePath: pluginManagementStatePath,
          installAnchor: desktopInstallAnchor(),
        })
        if (logSink !== undefined) {
          fileExporter = new FileExporter(logSink)
          hostCtx.logger.exporter(fileExporter)
        }
        await hostCtx.plugin(DesktopProfileService, {
          current: {
            name: activeProfileName,
            dir: prepared.profile.dir,
          },
          list: () => listDesktopProfiles(homeDir),
          persistSelection: name => { selectDesktopProfile(selectionStatePath, homeDir, name) },
          requestRestart: () => runtime.requestRestart(),
        })
        provideCmdline(hostCtx, {
          args: ['--host', '127.0.0.1', '--port', String(prepared.port)],
          exit: requestQuit,
        })
      },
      prepared.bareModuleBaseUrl,
    ).catch((cause: unknown) => {
      releasePackageResolver()
      throw cause
    })
    current = ctx
    // The settings service is a plugin like the rest and can still be
    // mounting when the boot promise settles on a cold data directory (seen
    // twice on 1 Sep and again 2 Sep: `ctx.settings` undefined here crashed
    // the first launch before any window). Read it as the optional service it
    // is at this instant; the `settings/updated` listener below applies the
    // level the moment the section lands.
    const settingsNow = ctx.get('settings')
    fileExporter?.setThreshold((settingsNow?.get(DESKTOP_SETTINGS_NAMESPACE) as DesktopSettings | undefined)?.logLevel ?? 'info')
    ctx.on('settings/updated', (namespace, next) => {
      if (namespace !== DESKTOP_SETTINGS_NAMESPACE) return
      fileExporter?.setThreshold((next as DesktopSettings).logLevel)
    })
    runtime.configureTerminal({
      profileName: activeProfileName,
      profileDir: prepared.profile.dir,
      homeDir: prepared.homeDir,
    })
    startupStage = 'renderer-startup'
    runtime.beginRendererBootMonitoring()
    await runtime.mountScheduled()
    // ⌃⌥A: the collapse/expand transform from anywhere. With the main window
    // hidden behind the Askbar no IDEalize window need have focus, and
    // before-input-event handlers only fire focused, so the shortcut is global.
    if (!globalShortcut.register('Control+Alt+A', () => { runtime.toggleAskbarTransform() })) {
      process.stderr.write(`${BIN_NAME}: the Askbar transform shortcut (Ctrl+Alt+A) is taken by another application\n`)
    }
    app.on('will-quit', () => { globalShortcut.unregister('Control+Alt+A') })
    // The Finder right-click entry. The app is copied into /Applications by
    // hand, so there is no installer to put this in place and the app does it
    // on each launch, rewriting only when the shipped text has changed.
    if (process.platform === 'darwin') {
      void installFinderQuickAction(join(app.getPath('home'), 'Library', 'Services'))
        .then((outcome) => {
          if (outcome === 'written') process.stderr.write(`${BIN_NAME}: installed the "${QUICK_ACTION_NAME}" Finder Quick Action\n`)
        })
        .catch((cause: unknown) => {
          electronLogger.error(`${BIN_NAME}: could not install the "${QUICK_ACTION_NAME}" Finder Quick Action: ${cause instanceof Error ? cause.message : String(cause)}`)
        })
    }
    // From here the Host is up and a window exists, so an `idealize://project`
    // request goes straight onto the bridge feed the window listens to. The
    // one that arrived before this point goes now: the window scans the feed's
    // retained tail on attach, so a cold start started by the Quick Action
    // still lands.
    deliverProject = (request) => {
      const bridge = current?.get('idealizeBridge') as { buffer: { push(event: Record<string, unknown>): void } } | undefined
      if (bridge === undefined) {
        electronLogger.error(`${BIN_NAME}: no bridge to open ${request.path} on`)
        return
      }
      bridge.buffer.push({ kind: 'open-folder', title: 'Idealize this', body: request.path, folder: request.path })
      runtime.show()
    }
    if (pendingProject !== undefined) {
      deliverProject(pendingProject)
      pendingProject = undefined
    }
    deliverKeysFile = (path) => {
      // The profile's configured port is 0 (an ephemeral choice), so the
      // route is reached on the port the web server actually took.
      const webServer = current?.get('webServer') as { port: number } | undefined
      if (webServer === undefined) {
        runtime.updates.notify(keysFileNotification({ ok: false, reason: 'the app is still starting; open the file again in a moment' }))
        return
      }
      void importKeysFile({
        path,
        port: webServer.port,
        readFile: target => readFile(target, 'utf8'),
        request: (url, init) => net.fetch(url, init),
      }).then((outcome) => {
        if (!outcome.ok) electronLogger.error(`${BIN_NAME}: keys file ${path} not applied: ${outcome.reason}`)
        runtime.updates.notify(keysFileNotification(outcome))
      })
    }
    if (pendingKeysFile !== undefined) {
      deliverKeysFile(pendingKeysFile)
      pendingKeysFile = undefined
    }
    const rendererReport = await rendererBoot
    if (rendererReport.status === 'healthy') {
      startupStage = 'health-commit'
      if (verifyingInstall !== undefined) {
        if (installRecovery === undefined) {
          throw new Error(`${BIN_NAME}: plugin install recovery store is unavailable`)
        }
        await installRecovery.markHealthy(verifyingInstall.transactionId)
        verifiedInstallToClear = verifyingInstall
        verifyingInstall = undefined
      }
      markDesktopProfileHealthy(selectionStatePath, activeProfileName)
      if (verifiedInstallToClear !== undefined && installRecovery !== undefined) {
        try {
          await installRecovery.clear(verifiedInstallToClear.transactionId)
          verifiedInstallToClear = undefined
        } catch (cause) {
          electronLogger.error(
            `${BIN_NAME}: failed to clear verified plugin install recovery state: ${cause instanceof Error ? cause.message : String(cause)}`,
          )
        }
      }
      if (rolledBackInstallToNotify !== undefined) {
        const notified = await showInstallRollbackNotice(
          rolledBackInstallToNotify,
          desktopLocaleFromLanguageTag(app.getLocale()),
          electronLogger,
        )
        if (notified && installRecovery !== undefined) {
          try {
            await installRecovery.markRollbackNotified(rolledBackInstallToNotify.transactionId)
            rolledBackInstallToNotify = undefined
          } catch (cause) {
            electronLogger.error(
              `${BIN_NAME}: failed to persist install rollback notice: ${cause instanceof Error ? cause.message : String(cause)}`,
            )
          }
        }
      }
    } else if (verifyingInstall !== undefined) {
      throw new RendererStartupFailure(
        runtime.rendererBootFailureReason ?? 'renderer-failed',
        rendererReport,
      )
    } else {
      throw new RendererStartupFailure(
        runtime.rendererBootFailureReason ?? 'renderer-failed',
        rendererReport,
      )
    }
    notifySkippedOptionalEntries(runtime, electronLogger, prepared.skippedOptionalEntries)
    notifyWindowsVolumeConcerns(runtime, electronLogger, windowsVolumeConcerns)
    if (profileStartup.rolledBackFrom !== undefined) {
      notifyProfileRecovery(
        runtime,
        electronLogger,
        `Reopened last-known-good profile ${activeProfileName}.`,
      )
    }
  } catch (cause) {
    runtime.stopRendererBootMonitoring()
    electronLogger.errorCause(cause)
    let exitCode = 1
    let installRecoveryRelaunch = false
    const failureRoute = routeDesktopStartupFailure({
      appReady: app.isReady(),
      stage: startupStage,
      verifyingProtectedInstall: verifyingInstall !== undefined,
      ...(profileStartup === undefined
        ? {}
        : {
            profile: {
              active: profileStartup.profileName,
              lastKnownGood: profileStartup.state.lastKnownGood,
            },
          }),
    })
    const recoveryActionsSafe = await quiesceHostForRecovery()
    if (failureRoute === 'protected-install-recovery'
      && verifyingInstall !== undefined
      && installRecovery !== undefined) {
      const transaction = verifyingInstall
      const failureReason: DesktopInstallRecoveryFailureReason = cause instanceof RendererStartupFailure
        ? cause.reason
        : runtime.rendererBootFailureReason ?? 'startup-failed'
      electronLogger.error(
        `${BIN_NAME}: plugin install ${transaction.packageName} (${transaction.transactionId}) requires recovery after ${failureReason}`,
      )
      try {
        await installRecovery.recordFailure(transaction.transactionId, failureReason)
      } catch (recoveryCause) {
        electronLogger.error(
          `${BIN_NAME}: failed to persist plugin recovery choice state for ${transaction.packageName}: ${recoveryCause instanceof Error ? recoveryCause.message : String(recoveryCause)}`,
        )
      }
    }
    if (profileStartup !== undefined && profileStatePath !== undefined) {
      try {
        if (failureRoute !== 'protected-install-recovery') {
          markDesktopProfileFailed(profileStatePath, profileStartup.profileName)
        }
        if (!installRecoveryRelaunch && failureRoute === 'last-known-good') {
          nativeExit.requestRelaunch()
          exitCode = 0
          notifyProfileRecovery(
            runtime,
            electronLogger,
            `Reopening last-known-good profile ${profileStartup.state.lastKnownGood}.`,
          )
        }
      } catch (stateCause) {
        electronLogger.error(`dsh-plugin-desktop: failed to roll back desktop profile state: ${stateCause instanceof Error ? stateCause.message : String(stateCause)}`)
      }
    }
    if (exitCode !== 0
      && (failureRoute === 'protected-install-recovery' || failureRoute === 'startup-recovery')) {
      const detail = cause instanceof Error ? cause.message : String(cause)
      const recoveryResult = await openStartupRecoveryWindow(
        detail,
        recoveryActionsSafe ? startupRecoveryController : undefined,
      )
      if (recoveryResult === 'restart') {
        installRecoveryRelaunch = true
        nativeExit.requestRelaunch()
        exitCode = 0
      }
    }
    startupRecoveryController?.dispose()
    await shutdown.request(exitCode)
  }
}

/**
 * Per-user data directory name for this shell. The Swift V0 app installed at
 * /Applications/IDEalize.app already owns ~/Library/Application Support/IDEalize,
 * so Electron's default (derived from the app name) would mix both apps' data.
 */
const USER_DATA_DIRECTORY_NAME = 'IDEalize V1'

async function run(): Promise<void> {
  app.setName(PRODUCT_NAME)
  if (!process.argv.some(argument => argument.startsWith('--user-data-dir'))) {
    app.setPath('userData', join(app.getPath('appData'), USER_DATA_DIRECTORY_NAME))
  }
  if (process.argv.includes('--export-diagnostics')) {
    try {
      await app.whenReady()
      const path = await exportDesktopDiagnostics(app.getPath('userData'), {
        appVersion: desktopProductVersion(),
        crashDumpsDir: app.getPath('crashDumps'),
      })
      await new Promise<void>((resolve, reject) => {
        process.stdout.write(`${path}\n`, error => {
          if (error === undefined || error === null) resolve()
          else reject(error)
        })
      })
      app.exit(0)
    } catch (cause) {
      const message = `dsh-plugin-desktop: failed to export diagnostics: ${cause instanceof Error ? cause.stack ?? cause.message : String(cause)}\n`
      await new Promise<void>(resolve => {
        process.stderr.write(message, () => { resolve() })
      })
      app.exit(1)
    }
    return
  }
  await start()
}

/** Last-resort branch for launcher failures that happen before start's owned coordinator exists. */
async function handleFatalLauncherFailure(cause: unknown): Promise<void> {
  const detail = maskSecrets(cause instanceof Error ? cause.stack ?? cause.message : String(cause))
  process.stderr.write(`${BIN_NAME}: fatal launcher failure: ${detail}\n`)
  if (!app.isReady()) {
    app.exit(1)
    return
  }
  try {
    const recoveryWindow = new DesktopStartupRecoveryWindow({
      locale: desktopLocaleFromLanguageTag(app.getLocale()),
      failureStage: 'electron-ready',
      failureDetail: detail,
      exportDiagnostics: async () => await exportDesktopDiagnostics(app.getPath('userData'), {
        appVersion: desktopProductVersion(),
        crashDumpsDir: app.getPath('crashDumps'),
      }),
    })
    const result = await recoveryWindow.run()
    if (result === 'restart') {
      app.relaunch()
      app.exit(0)
    } else {
      app.exit(1)
    }
  } catch (windowCause) {
    process.stderr.write(
      `${BIN_NAME}: fatal recovery window failure: ${maskSecrets(windowCause instanceof Error ? windowCause.stack ?? windowCause.message : String(windowCause))}\n`,
    )
    app.exit(1)
  }
}

void run().catch(async (cause: unknown) => { await handleFatalLauncherFailure(cause) })
