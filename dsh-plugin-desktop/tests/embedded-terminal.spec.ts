import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import DesktopTerminalsService, {
  defaultShell,
  type EmbeddedPtyProcess,
  type EmbeddedPtySpawn,
  type EmbeddedTerminalEvent,
  REPLAY_CAP,
  shellEnvironment,
} from '../src/embedded-terminal.ts'

interface FakePty extends EmbeddedPtyProcess {
  readonly file: string
  readonly args: string[]
  readonly options: Parameters<EmbeddedPtySpawn>[2]
  readonly written: string[]
  readonly resized: Array<[number, number]>
  killed: boolean
  emitData(data: string): void
  emitExit(exitCode: number): void
}

function fakeSpawn(): { spawn: EmbeddedPtySpawn; ptys: FakePty[] } {
  const ptys: FakePty[] = []
  const spawn: EmbeddedPtySpawn = (file, args, options) => {
    const dataListeners = new Set<(data: string) => void>()
    const exitListeners = new Set<(event: { exitCode: number }) => void>()
    const pty: FakePty = {
      file,
      args,
      options,
      pid: 1000 + ptys.length,
      written: [],
      resized: [],
      killed: false,
      write(data) { pty.written.push(data) },
      resize(columns, rows) { pty.resized.push([columns, rows]) },
      kill() { pty.killed = true },
      onData(listener) {
        dataListeners.add(listener)
        return { dispose: () => { dataListeners.delete(listener) } }
      },
      onExit(listener) {
        exitListeners.add(listener)
        return { dispose: () => { exitListeners.delete(listener) } }
      },
      emitData(data) { for (const listener of dataListeners) listener(data) },
      emitExit(exitCode) { for (const listener of exitListeners) listener({ exitCode }) },
    }
    ptys.push(pty)
    return pty
  }
  return { spawn, ptys }
}

async function mount(spawn: EmbeddedPtySpawn, limit?: number) {
  const ctx = new Context()
  const fiber = ctx.plugin(DesktopTerminalsService, {
    spawn,
    platform: 'darwin',
    environment: { SHELL: '/bin/zsh', PATH: '/usr/bin', ELECTRON_RUN_AS_NODE: '1' },
    ...(limit === undefined ? {} : { limit }),
  })
  await fiber
  return { service: ctx.desktopTerminals, dispose: fiber.dispose }
}

describe('embedded terminals Host service', () => {
  it('spawns a login shell in the requested directory with the terminal identity', async () => {
    const { spawn, ptys } = fakeSpawn()
    const { service } = await mount(spawn)
    const terminal = service.open({ key: 'chat-1', cwd: '/tmp/work', cols: 100, rows: 30 })
    expect(ptys).toHaveLength(1)
    expect(ptys[0]!.file).toBe('/bin/zsh')
    expect(ptys[0]!.args).toEqual(['-l'])
    expect(ptys[0]!.options.cwd).toBe('/tmp/work')
    expect(ptys[0]!.options.cols).toBe(100)
    expect(ptys[0]!.options.env.TERM).toBe('xterm-256color')
    expect(ptys[0]!.options.env.ELECTRON_RUN_AS_NODE).toBeUndefined()
    expect(service.get(terminal.id)).toBe(terminal)
  })

  it('reattaches to the live terminal of the same key and replays its output', async () => {
    const { spawn, ptys } = fakeSpawn()
    const { service } = await mount(spawn)
    const first = service.open({ key: 'chat-1', cwd: '/tmp' })
    ptys[0]!.emitData('hello\r\n')
    const again = service.open({ key: 'chat-1', cwd: '/tmp' })
    expect(again).toBe(first)
    expect(ptys).toHaveLength(1)
    expect(again.replay()).toBe('hello\r\n')
    // A different key is a different shell.
    service.open({ key: 'chat-2', cwd: '/tmp' })
    expect(ptys).toHaveLength(2)
  })

  it('forwards input and resizes, then reports the exit to subscribers', async () => {
    const { spawn, ptys } = fakeSpawn()
    const { service } = await mount(spawn)
    const terminal = service.open({ cwd: '/tmp' })
    const events: EmbeddedTerminalEvent[] = []
    const unsubscribe = terminal.subscribe(event => events.push(event))
    terminal.write('echo hello\r')
    terminal.resize(120, 40)
    terminal.resize(120, 40)
    terminal.resize(1, 0)
    ptys[0]!.emitData('hello')
    ptys[0]!.emitExit(0)
    expect(ptys[0]!.written).toEqual(['echo hello\r'])
    expect(ptys[0]!.resized).toEqual([[120, 40]])
    expect(events).toEqual([{ kind: 'data', data: 'hello' }, { kind: 'exit', exitCode: 0 }])
    expect(terminal.exit).toEqual({ exitCode: 0 })
    // An exited shell takes no more input; the key is free for a new shell.
    terminal.write('x')
    expect(ptys[0]!.written).toHaveLength(1)
    unsubscribe()
    const replacement = service.open({ key: 'k', cwd: '/tmp' })
    expect(replacement).not.toBe(terminal)
  })

  it('caps the replay buffer', async () => {
    const { spawn, ptys } = fakeSpawn()
    const { service } = await mount(spawn)
    const terminal = service.open({ cwd: '/tmp' })
    ptys[0]!.emitData('a'.repeat(REPLAY_CAP))
    ptys[0]!.emitData('tail')
    expect(terminal.replay()).toHaveLength(REPLAY_CAP)
    expect(terminal.replay().endsWith('tail')).toBe(true)
  })

  it('closing kills the shell and forgets it; disposal closes everything', async () => {
    const { spawn, ptys } = fakeSpawn()
    const { service, dispose } = await mount(spawn)
    const terminal = service.open({ cwd: '/tmp' })
    const onEvent = vi.fn()
    terminal.subscribe(onEvent)
    terminal.close()
    expect(ptys[0]!.killed).toBe(true)
    expect(onEvent).toHaveBeenCalledWith({ kind: 'exit', exitCode: -1 })
    expect(service.get(terminal.id)).toBeUndefined()
    const survivor = service.open({ cwd: '/tmp' })
    await dispose()
    expect(ptys[1]!.killed).toBe(true)
    expect(survivor.exit).toEqual({ exitCode: -1 })
    expect(() => service.open({ cwd: '/tmp' })).toThrow(/service disposed/u)
  })

  it('refuses to open past the limit', async () => {
    const { spawn } = fakeSpawn()
    const { service } = await mount(spawn, 1)
    service.open({ cwd: '/tmp' })
    expect(() => service.open({ cwd: '/tmp' })).toThrow(/limit \(1\) reached/u)
  })

  it('selects the platform shell', () => {
    expect(defaultShell('darwin', {})).toEqual({ file: '/bin/zsh', args: ['-l'] })
    expect(defaultShell('linux', { SHELL: '/usr/bin/fish' })).toEqual({ file: '/usr/bin/fish', args: ['-l'] })
    expect(defaultShell('win32', { COMSPEC: 'C:\\Windows\\System32\\cmd.exe' })).toEqual({ file: 'C:\\Windows\\System32\\cmd.exe', args: [] })
    expect(shellEnvironment({ A: '1', B: undefined }).A).toBe('1')
    expect('B' in shellEnvironment({ A: '1', B: undefined })).toBe(false)
  })
})
