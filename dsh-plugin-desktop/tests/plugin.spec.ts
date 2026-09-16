import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { LocaleId } from '@deepseek-ai/dsh-client-locale'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { ThemePreference } from '@deepseek-ai/dsh-client-ui-theme'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  apply,
  Config,
  DESKTOP_SETTINGS_NAMESPACE,
  desktopRendererUrl,
  DesktopSettingsSchema,
  inject,
  type Config as DesktopConfig,
  type DesktopSettings,
} from '../src/index.ts'
import {
  DESKTOP_DIRECTORY_PICKER_PATH,
  DESKTOP_DIRECTORY_VALIDATOR_PATH,
} from '../src/directory-picker-contract.ts'
import type { DesktopRuntime, DesktopShellSpec } from '../src/runtime.ts'
import { RENDERER_BOOT_REPORT_PATH, type RendererBootReport } from '../src/renderer-boot-contract.ts'

const config: DesktopConfig = {
  mode: 'compatibility',
  port: 0,
  width: 1280,
  height: 840,
  minWidth: 900,
  minHeight: 640,
}

afterEach(() => { vi.useRealTimers() })

interface PluginHarness {
  ctx: Context
  runtime: DesktopRuntime
  shell(): DesktopShellSpec | undefined
  update: ReturnType<typeof vi.fn<(patch: object) => Promise<void>>>
  restart: ReturnType<typeof vi.fn<() => Promise<void>>>
  setLocalePreference: ReturnType<typeof vi.fn<(locale: LocaleId | undefined) => void>>
  setThemeSource: ReturnType<typeof vi.fn<(source: ThemePreference) => void>>
  rendererBoot: ReturnType<typeof vi.fn<(report: RendererBootReport) => void>>
  pickDirectory: ReturnType<typeof vi.fn<() => Promise<string | null>>>
  validateDirectory: ReturnType<typeof vi.fn<(path: string) => Promise<boolean>>>
  confirmDiscardTerminals: ReturnType<typeof vi.fn<(count: number) => Promise<boolean>>>
  writeViewState: ReturnType<typeof vi.fn<(state: { sessionId: string }) => void>>
  setViewState(state: { sessionId: string } | undefined): void
  setLiveTerminals(count: number): void
  route(path: string): WebRoute | undefined
  notify(next: DesktopSettings, prev: DesktopSettings): Promise<void>
  notifyLocale(preference: LocaleId | undefined): void
  notifyTheme(preference: ThemePreference): void
}

function createHarness(platform: DesktopRuntime['platform'] = 'darwin'): PluginHarness {
  let shell: DesktopShellSpec | undefined
  let watcher: ((next: DesktopSettings, prev: DesktopSettings) => void | Promise<void>) | undefined
  const update = vi.fn(async (_patch: object) => {})
  const restart = vi.fn(async () => {})
  const setLocalePreference = vi.fn<(locale: LocaleId | undefined) => void>()
  const setThemeSource = vi.fn<(source: ThemePreference) => void>()
  const rendererBoot = vi.fn<(report: RendererBootReport) => void>()
  const pickDirectory = vi.fn(async () => null)
  const validateDirectory = vi.fn(async () => true)
  const confirmDiscardTerminals = vi.fn(async (_count: number) => true)
  let viewState: { sessionId: string } | undefined
  const writeViewState = vi.fn((state: { sessionId: string }) => { viewState = state })
  let liveTerminals = 0
  const routes = new Map<string, WebRoute>()
  const settingsUpdated = new Set<(namespace: unknown, next: unknown) => void>()
  let localePreference: LocaleId | undefined
  let themePreference: ThemePreference = 'system'
  const runtime: DesktopRuntime = {
    platform,
    locale: 'en',
    updates: {
      isPackaged: false,
      canDownload: platform === 'darwin' || platform === 'win32',
      currentVersion: '2.0.0',
      statePath: '/tmp/dsh-desktop-update-state.json',
      request: async () => new Response(null, { status: 304 }),
      confirmDownload: async () => false,
      showManualCheckResult: async () => {},
      downloadAndOpen: async () => {},
      notify: () => {},
    },
    schedule: (spec) => {
      shell = spec
      return async () => {}
    },
    mountScheduled: async () => {},
    show: () => {},
    refreshAskbar: vi.fn(),
    registerTrayItem: () => ({ refresh: () => {}, dispose: () => {} }),
    openTerminal: () => {},
    exportDiagnostics: async () => {},
    pickDirectory,
    validateDirectory,
    reportRendererBoot: rendererBoot,
    setLocalePreference,
    setThemeSource,
    requestRestart: restart,
    readViewState: () => viewState,
    writeViewState,
    confirmDiscardTerminals,
    prepareToQuit: () => {},
  }
  const settings = {
    get: vi.fn((namespace: unknown) => {
      if (String(namespace) === 'ui-theme') return { preference: themePreference }
      if (String(namespace) === 'locale') return { preference: localePreference }
      return undefined
    }),
    register: vi.fn(() => ({
      get: () => ({ mode: config.mode }),
      watch: (callback: typeof watcher) => {
        watcher = callback
        return () => { watcher = undefined }
      },
      update,
      replace: vi.fn(async () => {}),
    })),
  }
  const ctx = {
    desktopRuntime: runtime,
    webServer: {
      host: '127.0.0.1',
      port: 43120,
      register: vi.fn((route: WebRoute) => {
        routes.set(route.path, route)
        return () => { if (routes.get(route.path) === route) routes.delete(route.path) }
      }),
    },
    settings,
    logger: { warn: vi.fn(), error: vi.fn() },
    get: vi.fn((key: unknown) => {
      if (String(key) === 'desktopRuntime') return runtime
      if (String(key) === 'desktopTerminals') {
        return {
          list: () => Array.from({ length: liveTerminals }, () => ({ exit: undefined })),
        }
      }
      return () => {}
    }),
    effect: vi.fn((register: () => unknown) => register()),
    on: vi.fn((event: string, listener: (namespace: unknown, next: unknown) => void) => {
      if (event === 'settings/updated') settingsUpdated.add(listener)
      return () => { settingsUpdated.delete(listener) }
    }),
  } as unknown as Context
  return {
    ctx,
    runtime,
    shell: () => shell,
    update,
    restart,
    setLocalePreference,
    setThemeSource,
    rendererBoot,
    pickDirectory,
    validateDirectory,
    confirmDiscardTerminals,
    writeViewState,
    setViewState: (state) => { viewState = state },
    setLiveTerminals: (count) => { liveTerminals = count },
    route: path => routes.get(path),
    notify: async (next, prev) => { await watcher?.(next, prev) },
    notifyLocale: (preference) => {
      localePreference = preference
      for (const listener of settingsUpdated) listener(settingsNamespace('locale'), { preference })
    },
    notifyTheme: (preference) => {
      themePreference = preference
      for (const listener of settingsUpdated) listener(settingsNamespace('ui-theme'), { preference })
    },
  }
}

describe('desktop Host plugin', () => {
  it('defaults to compatibility mode and validates both schemas', () => {
    expect(Config({} as DesktopConfig)).toEqual(config)
    expect(Config({ mode: 'advanced' } as DesktopConfig)).toEqual({ ...config, mode: 'advanced' })
    expect(DesktopSettingsSchema({} as DesktopSettings)).toEqual({ mode: 'compatibility', port: 0, logLevel: 'info', askbarSide: 'left' })
    // The pre-Askbar mini shell's stored value still validates; apply() runs it as compatibility.
    expect(DesktopSettingsSchema({ mode: 'mini' } as DesktopSettings).mode).toBe('mini')
    expect(Config({ mode: 'mini' } as DesktopConfig).mode).toBe('mini')
    expect(() => DesktopSettingsSchema({ port: -1 } as DesktopSettings)).toThrow()
    expect(() => DesktopSettingsSchema({ port: 1.5 } as DesktopSettings)).toThrow()
    expect(() => DesktopSettingsSchema({ port: 65_536 } as DesktopSettings)).toThrow()
    expect(() => Config({ mode: 'custom' } as never)).toThrow()
    expect(String(DESKTOP_SETTINGS_NAMESPACE)).toBe('dsh-desktop')
  })

  it('prints a launcher reminder and registers nothing without desktopRuntime', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const registerRoute = vi.fn()
    const ctx = {
      webServer: { host: '127.0.0.1', port: 43120, register: registerRoute },
      settings: {
        register: vi.fn(),
        get: vi.fn(() => undefined),
        watch: vi.fn(() => () => {}),
        update: vi.fn(async () => {}),
      },
      logger: { warn: vi.fn(), error: vi.fn() },
      get: vi.fn(() => undefined),
      effect: vi.fn((register: () => unknown) => register()),
      on: vi.fn(() => () => {}),
    } as unknown as Context

    apply(ctx, config)

    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('desktop launcher'))
    expect(registerRoute).not.toHaveBeenCalled()
    expect(vi.mocked(ctx.settings.register)).not.toHaveBeenCalled()
    stderr.mockRestore()
  })

  it('builds the loopback root with validated renderer mode and platform markers', () => {
    const url = new URL(desktopRendererUrl(43120, 'advanced', 'darwin'))
    expect(url.origin).toBe('http://127.0.0.1:43120')
    expect(url.pathname).toBe('/')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      'dsh-desktop-mode': 'advanced',
      'dsh-desktop-platform': 'darwin',
    })
  })

  it('registers settings and the active Web port without re-entering Loader settlement', async () => {
    const harness = createHarness()
    const loaderAwait = vi.fn(() => new Promise<void>(() => {}))
    Object.assign(harness.ctx, { loader: { await: loaderAwait } })

    apply(harness.ctx, config)

    expect(inject).toContain('settings')
    expect(inject).not.toContain('loader')
    const register = vi.mocked(harness.ctx.settings.register)
    expect(register.mock.calls[0]?.[2]).toEqual(expect.objectContaining({ applies: 'restart' }))
    expect(register.mock.calls[0]?.[2]).not.toHaveProperty('base')
    expect(loaderAwait).not.toHaveBeenCalled()
    expect(harness.shell()).toEqual(expect.objectContaining({
      mode: 'compatibility',
      url: 'http://127.0.0.1:43120/?dsh-desktop-mode=compatibility&dsh-desktop-platform=darwin',
      productName: 'IDEalize',
      windowTitle: 'IDEalize',
      readThemeSource: expect.any(Function),
    }))
    expect(harness.shell()?.iconPath.endsWith(join('build', 'app-icon-mac.png'))).toBe(true)
    expect(harness.shell()?.trayIcons.templatePath.endsWith(join('build', 'tray-iconTemplate.png'))).toBe(true)
    expect(harness.shell()?.trayIcons.bluePath.endsWith(join('build', 'tray-icon-blue.png'))).toBe(true)
    expect(harness.shell()?.readThemeSource()).toBe('system')
    harness.notifyTheme('dark')
    expect(harness.setThemeSource).not.toHaveBeenCalled()

    await harness.shell()?.requestModeChange('advanced')
    expect(harness.update).toHaveBeenCalledWith({ mode: 'advanced' })
  })

  it('forwards same-origin renderer boot reports through the Host route', async () => {
    const harness = createHarness()
    apply(harness.ctx, config)
    const route = harness.route(RENDERER_BOOT_REPORT_PATH)
    expect(route).toEqual(expect.objectContaining({
      kind: 'exact',
      path: RENDERER_BOOT_REPORT_PATH,
    }))
    const report = { status: 'failed', plugins: ['dsh-vision-router'], error: 'slot conflict' } as const
    const req = {
      method: 'POST',
      headers: {
        origin: 'http://127.0.0.1:43120',
        'content-type': 'application/json',
      },
      async * [Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(report)) },
    } as unknown as IncomingMessage
    const res = { statusCode: 200, end: vi.fn() } as unknown as ServerResponse

    await route?.handler(req, res)

    expect(harness.rendererBoot).toHaveBeenCalledWith(report)
    expect(res.statusCode).toBe(204)
  })

  it('serves the Windows native picker through a same-origin desktop route', async () => {
    const harness = createHarness('win32')
    harness.pickDirectory.mockResolvedValue('C:\\Work')
    apply(harness.ctx, config)
    const route = harness.route(DESKTOP_DIRECTORY_PICKER_PATH)
    expect(route).toEqual(expect.objectContaining({
      kind: 'exact',
      path: DESKTOP_DIRECTORY_PICKER_PATH,
    }))
    const req = {
      method: 'POST',
      headers: { origin: 'http://127.0.0.1:43120' },
    } as unknown as IncomingMessage
    let body = ''
    const res = {
      statusCode: 200,
      setHeader: vi.fn(),
      end: vi.fn((value?: string) => { body = value ?? '' }),
    } as unknown as ServerResponse

    await route?.handler(req, res)

    expect(harness.pickDirectory).toHaveBeenCalledOnce()
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(body)).toEqual({ path: 'C:\\Work' })
  })

  it('validates a Windows workspace through a same-origin desktop route', async () => {
    const harness = createHarness('win32')
    harness.validateDirectory.mockResolvedValue(false)
    apply(harness.ctx, config)
    const route = harness.route(DESKTOP_DIRECTORY_VALIDATOR_PATH)
    const req = {
      method: 'POST',
      headers: {
        origin: 'http://127.0.0.1:43120',
        'content-type': 'application/json',
      },
      async * [Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ path: 'E:\\repo' })) },
    } as unknown as IncomingMessage
    let body = ''
    const res = {
      statusCode: 200,
      setHeader: vi.fn(),
      end: vi.fn((value?: string) => { body = value ?? '' }),
    } as unknown as ServerResponse

    await route?.handler(req, res)

    expect(harness.validateDirectory).toHaveBeenCalledWith('E:\\repo')
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(body)).toEqual({ allowed: false })
  })

  it.each(['win32', 'linux'] as const)(
    'keeps the full-size application icon on %s',
    (platform) => {
      const harness = createHarness(platform)

      apply(harness.ctx, config)

      expect(harness.shell()?.iconPath.endsWith(join('build', 'app-icon.png'))).toBe(true)
    },
  )

  it('serves and records the renderer view state through the Host route', async () => {
    const harness = createHarness()
    apply(harness.ctx, config)
    const route = harness.route('/_dsh/desktop/view-state')
    expect(route).toEqual(expect.objectContaining({ kind: 'exact', path: '/_dsh/desktop/view-state' }))

    const post = {
      method: 'POST',
      headers: {
        origin: 'http://127.0.0.1:43120',
        'content-type': 'application/json',
      },
      async * [Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ sessionId: 'session-7' })) },
    } as unknown as IncomingMessage
    const postRes = { statusCode: 200, setHeader: vi.fn(), end: vi.fn() } as unknown as ServerResponse
    await route?.handler(post, postRes)
    expect(postRes.statusCode).toBe(204)
    expect(harness.writeViewState).toHaveBeenCalledWith({ sessionId: 'session-7' })

    let body = ''
    const getRes = {
      statusCode: 200,
      setHeader: vi.fn(),
      end: vi.fn((value?: string) => { body = value ?? '' }),
    } as unknown as ServerResponse
    await route?.handler({ method: 'GET', headers: {} } as IncomingMessage, getRes)
    expect(JSON.parse(body)).toEqual({ sessionId: 'session-7' })
  })

  it('asks before a mode switch ends live terminals and reverts on decline', async () => {
    vi.useFakeTimers()
    const harness = createHarness()
    apply(harness.ctx, config)
    harness.setLiveTerminals(1)
    harness.confirmDiscardTerminals.mockResolvedValue(false)

    await harness.notify(
      { mode: 'advanced', port: 0, logLevel: 'info', askbarSide: 'left' },
      { mode: 'compatibility', port: 0, logLevel: 'info', askbarSide: 'left' },
    )
    await vi.runAllTimersAsync()

    expect(harness.confirmDiscardTerminals).toHaveBeenCalledWith(1)
    expect(harness.update).toHaveBeenCalledWith({ mode: 'compatibility' })
    expect(harness.restart).not.toHaveBeenCalled()
  })

  it('restarts once the user confirms ending live terminals', async () => {
    vi.useFakeTimers()
    const harness = createHarness()
    apply(harness.ctx, config)
    harness.setLiveTerminals(2)
    harness.confirmDiscardTerminals.mockResolvedValue(true)

    await harness.notify(
      { mode: 'advanced', port: 0, logLevel: 'info', askbarSide: 'left' },
      { mode: 'compatibility', port: 0, logLevel: 'info', askbarSide: 'left' },
    )
    await vi.runAllTimersAsync()

    expect(harness.confirmDiscardTerminals).toHaveBeenCalledWith(2)
    expect(harness.restart).toHaveBeenCalledOnce()
    expect(harness.update).not.toHaveBeenCalled()
  })

  it('skips the terminal question while none is live', async () => {
    vi.useFakeTimers()
    const harness = createHarness()
    apply(harness.ctx, config)

    await harness.notify(
      { mode: 'advanced', port: 0, logLevel: 'info', askbarSide: 'left' },
      { mode: 'compatibility', port: 0, logLevel: 'info', askbarSide: 'left' },
    )
    await vi.runAllTimersAsync()

    expect(harness.confirmDiscardTerminals).not.toHaveBeenCalled()
    expect(harness.restart).toHaveBeenCalledOnce()
  })

  it('requests one orderly restart after the settings scope commits another mode', async () => {
    vi.useFakeTimers()
    const harness = createHarness()
    apply(harness.ctx, config)

    await harness.notify(
      { mode: 'compatibility', port: 0, logLevel: 'info', askbarSide: 'left' },
      { mode: 'compatibility', port: 0, logLevel: 'info', askbarSide: 'left' },
    )
    expect(harness.restart).not.toHaveBeenCalled()

    harness.restart.mockImplementation(() => new Promise<void>(() => {}))
    await harness.notify(
      { mode: 'advanced', port: 0, logLevel: 'info', askbarSide: 'left' },
      { mode: 'compatibility', port: 0, logLevel: 'info', askbarSide: 'left' },
    )
    await vi.runAllTimersAsync()
    expect(harness.restart).toHaveBeenCalledOnce()
  })

  it('runs a stored legacy mini mode as compatibility with one warning and no restart loop', async () => {
    vi.useFakeTimers()
    const harness = createHarness()
    apply(harness.ctx, { ...config, mode: 'mini' })
    const shell = harness.shell()
    expect(shell?.mode).toBe('compatibility')
    expect(new URL(shell!.url).searchParams.get('dsh-desktop-mode')).toBe('compatibility')
    expect(shell?.readShellMode()).toBe('compatibility')
    const logger = (harness.ctx as unknown as { logger: { warn: ReturnType<typeof vi.fn> } }).logger
    expect(logger.warn).toHaveBeenCalledOnce()
    expect(logger.warn.mock.calls[0]?.[0]).toContain('"mini"')

    // The settings watcher sees the same stored value again: no restart.
    await harness.notify(
      { mode: 'mini', port: 0, logLevel: 'info', askbarSide: 'left' },
      { mode: 'mini', port: 0, logLevel: 'info', askbarSide: 'left' },
    )
    await vi.runAllTimersAsync()
    expect(harness.restart).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledOnce()
  })

  it('re-docks the Askbar and rebuilds the tray when the desktop settings change', () => {
    const harness = createHarness()
    apply(harness.ctx, config)
    const settingsUpdated = (harness.ctx.on as unknown as ReturnType<typeof vi.fn>).mock.calls
      .filter(([event]) => event === 'settings/updated')
      .map(([, listener]) => listener as (namespace: unknown, next: unknown) => void)
    for (const listener of settingsUpdated) listener(settingsNamespace('dsh-desktop'), { askbarSide: 'right' })
    expect(harness.runtime.refreshAskbar).toHaveBeenCalledOnce()
  })

  it('reads and persists the remembered Askbar position through the desktop settings', async () => {
    const harness = createHarness()
    apply(harness.ctx, config)
    const shell = harness.shell()
    if (shell === undefined) throw new Error('no shell scheduled')
    // Nothing stored yet: the bar docks by side.
    expect(shell.readAskbarPosition()).toBeUndefined()
    await shell.requestAskbarPosition({ displayId: 2, x: 1700, y: 0 })
    expect(harness.update).toHaveBeenCalledWith({ askbarPosition: { displayId: 2, x: 1700, y: 0 } })
    ;(harness.ctx.settings.get as unknown as ReturnType<typeof vi.fn>).mockImplementation((namespace: unknown) => (
      String(namespace) === 'dsh-desktop' ? { askbarSide: 'left', askbarPosition: { displayId: 2, x: 1700, y: 0 } } : undefined
    ))
    expect(shell.readAskbarPosition()).toEqual({ displayId: 2, x: 1700, y: 0 })
    // A stored position names every field, or the settings file fails its load.
    expect(DesktopSettingsSchema({ askbarPosition: { displayId: 2, x: 1700, y: 0 } } as DesktopSettings).askbarPosition).toEqual({ displayId: 2, x: 1700, y: 0 })
    expect(DesktopSettingsSchema({ askbarPosition: null } as DesktopSettings).askbarPosition).toBeNull()
    expect(() => DesktopSettingsSchema({ askbarPosition: { displayId: 2 } } as unknown as DesktopSettings)).toThrow()
  })

  it('requests one orderly restart after the configured Web port changes', async () => {
    vi.useFakeTimers()
    const harness = createHarness()
    apply(harness.ctx, config)

    await harness.notify(
      { mode: 'compatibility', port: 0, logLevel: 'debug', askbarSide: 'left' },
      { mode: 'compatibility', port: 0, logLevel: 'info', askbarSide: 'left' },
    )
    expect(harness.restart).not.toHaveBeenCalled()

    harness.restart.mockImplementation(() => new Promise<void>(() => {}))
    await harness.notify(
      { mode: 'compatibility', port: 43_189, logLevel: 'debug', askbarSide: 'left' },
      { mode: 'compatibility', port: 0, logLevel: 'debug', askbarSide: 'left' },
    )
    await vi.runAllTimersAsync()
    expect(harness.restart).toHaveBeenCalledOnce()
  })

  it('projects live built-in theme changes into an advanced native material', () => {
    const harness = createHarness()
    apply(harness.ctx, { ...config, mode: 'advanced' })

    expect(harness.shell()?.readThemeSource()).toBe('system')
    harness.notifyTheme('dark')
    expect(harness.setThemeSource).toHaveBeenCalledWith('dark')
  })

  it('projects the Host-backed locale preference into the native tray', () => {
    const harness = createHarness('win32')
    apply(harness.ctx, config)

    expect(harness.shell()?.readLocalePreference()).toBeUndefined()
    expect(harness.setLocalePreference).not.toHaveBeenCalled()

    harness.notifyLocale('zh')
    expect(harness.shell()?.readLocalePreference()).toBe('zh')
    expect(harness.setLocalePreference).toHaveBeenCalledWith('zh')

    harness.notifyLocale(undefined)
    expect(harness.setLocalePreference).toHaveBeenLastCalledWith(undefined)
  })

  it('requires the desktop Web carrier to remain loopback-only', () => {
    const harness = createHarness()
    Object.assign(harness.ctx.webServer, { host: '0.0.0.0' })

    expect(() => apply(harness.ctx, config)).toThrow('requires a loopback Web server')
  })

  it('refuses advanced settings on Linux before persistence', () => {
    const harness = createHarness('linux')
    apply(harness.ctx, config)
    const register = vi.mocked(harness.ctx.settings.register)
    const options = register.mock.calls[0]?.[2]

    expect(() => options?.validate?.({ mode: 'advanced' })).toThrow(
      'supported on macOS and Windows',
    )
    expect(() => options?.validate?.({ mode: 'compatibility' })).not.toThrow()
  })
})
