/**
 * Host routes: the capability probe answers from the desktop service's
 * presence, open fences the directory, the stream replays then follows, and
 * input/resize/close reach the named terminal.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import {
  apply,
  type Config,
  type DesktopTerminalLike,
  type DesktopTerminalsLike,
  type EmbeddedTerminalEvent,
  fencedDirectory,
  gridDimension,
  KNOWLEDGE_PREAMBLE,
  LAUNCHES_PATH,
  launchCommandFor,
  scheduleLaunch,
  promptChannel,
  withKnowledge,
} from '../src/index.ts'

type Handler = (req: FakeRequest, res: FakeResponse) => Promise<void> | void

class FakeRequest extends EventEmitter {
  headers: Record<string, string>
  constructor(public url: string, headers: Record<string, string>, private readonly body = '') {
    super()
    this.headers = { host: '127.0.0.1:3180', ...headers }
  }
  async *[Symbol.asyncIterator](): AsyncGenerator<Buffer> {
    if (this.body !== '') yield Buffer.from(this.body)
  }
}

class FakeResponse {
  status = 0
  headers: Record<string, string> = {}
  chunks: string[] = []
  ended = false
  headersSent = false
  writeHead(status: number, headers: Record<string, string>) {
    this.status = status
    this.headers = headers
    this.headersSent = true
    return this
  }
  write(chunk: string) { this.chunks.push(chunk) }
  end(chunk?: string) {
    if (chunk !== undefined) this.chunks.push(chunk)
    this.ended = true
  }
  json(): unknown { return JSON.parse(this.chunks.join('')) }
  events(): unknown[] {
    return this.chunks.join('').split('\n\n').filter(line => line.startsWith('data: '))
      .map((line): unknown => JSON.parse(line.slice('data: '.length)))
  }
}

class FakeTerminal implements DesktopTerminalLike {
  static next = 0
  readonly id = `t-${FakeTerminal.next++}`
  cols = 80
  rows = 24
  exit: { exitCode: number } | undefined = undefined
  buffer = ''
  written: string[] = []
  closed = false
  private readonly listeners = new Set<(event: EmbeddedTerminalEvent) => void>()
  constructor(readonly key: string | undefined, readonly cwd: string) {}
  replay() { return this.buffer }
  write(data: string) { this.written.push(data) }
  resize(cols: number, rows: number) { this.cols = cols; this.rows = rows }
  subscribe(listener: (event: EmbeddedTerminalEvent) => void) {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  close() { this.closed = true }
  emit(event: EmbeddedTerminalEvent) {
    if (event.kind === 'data') this.buffer += event.data
    else this.exit = { exitCode: event.exitCode }
    for (const listener of this.listeners) listener(event)
  }
}

class FakeTerminals implements DesktopTerminalsLike {
  readonly terminals: FakeTerminal[] = []
  open(options: { key?: string; cwd: string }) {
    const existing = this.terminals.find(t => t.key === options.key && options.key !== undefined && t.exit === undefined)
    if (existing !== undefined) return existing
    const terminal = new FakeTerminal(options.key, options.cwd)
    this.terminals.push(terminal)
    return terminal
  }
  get(id: string) { return this.terminals.find(t => t.id === id) }
}

/** In-memory settings capability: one layered section, shallow user-over-base, as the launch route uses it. */
function fakeSettings() {
  const sections = new Map<string, { base: Record<string, unknown>; user: Record<string, unknown> }>()
  return {
    register(ns: string, _schema: unknown, opts: { base: Record<string, unknown> }) {
      const record = { base: { ...opts.base }, user: {} }
      sections.set(ns, record)
      return { get: () => ({ ...record.base, ...record.user }), watch: () => () => {} }
    },
    update(ns: string, patch: Record<string, unknown>) {
      const record = sections.get(ns)
      if (record === undefined) throw new Error(`no section ${ns}`)
      record.user = { ...record.user, ...patch }
      return Promise.resolve()
    },
  }
}

async function mount(options: { desktop: boolean; roots?: string[]; config?: Config; settings?: boolean }) {
  const ctx = new Context()
  const routes = new Map<string, Handler>()
  ctx.provide('webServer', {
    register(route: { path: string; handler: Handler }) {
      routes.set(route.path, route.handler)
      return () => { routes.delete(route.path) }
    },
  })
  ctx.provide('workspaceRegistry', {
    list: () => (options.roots ?? []).map(path => ({ path, title: path })),
  })
  const terminals = new FakeTerminals()
  if (options.desktop) ctx.provide('desktopTerminals', terminals)
  if (options.settings === true) ctx.provide('settings', fakeSettings())
  await ctx.plugin({ name: 'idealize-ui-terminal', inject: [], apply }, options.config)
  await new Promise(resolve => setTimeout(resolve, 0))
  const call = async (path: string, init: { method?: 'GET' | 'POST'; body?: unknown; auth?: boolean; query?: string } = {}) => {
    const handler = routes.get(path)
    if (handler === undefined) throw new Error(`no route ${path}`)
    const headers: Record<string, string> = init.auth === false ? {} : { 'x-idealize-auth': '1' }
    const req = new FakeRequest(`${path}${init.query ?? ''}`, headers, init.body === undefined ? '' : JSON.stringify(init.body))
    const res = new FakeResponse()
    await handler(req, res)
    return { req, res }
  }
  return { call, terminals, routes, ctx }
}

describe('helpers', () => {
  it('accepts only positive integers inside the cap', () => {
    expect(gridDimension(80, 500)).toBe(80)
    expect(gridDimension(0, 500)).toBeUndefined()
    expect(gridDimension(501, 500)).toBeUndefined()
    expect(gridDimension(2.5, 500)).toBeUndefined()
    expect(gridDimension('80', 500)).toBeUndefined()
  })

  it('fences directories to home plus the workspace roots', async () => {
    const scratch = await realpath(await mkdtemp(join(tmpdir(), 'idealize-terminal-')))
    expect(await fencedDirectory(scratch, [])).toBeUndefined()
    expect(await fencedDirectory(scratch, [scratch])).toBe(scratch)
    expect(await fencedDirectory(homedir(), [])).toBe(await realpath(homedir()))
    expect(await fencedDirectory(join(scratch, 'missing'), [scratch])).toBeUndefined()
  })
})

describe('terminal routes', () => {
  it('reports no embedded terminal without the desktop service, and refuses to open', async () => {
    const { call } = await mount({ desktop: false })
    const probe = await call('/idealize/terminal/capabilities', { method: 'GET' })
    expect(probe.res.json()).toEqual({ embedded: false })
    const open = await call('/idealize/terminal/open', { method: 'POST', body: { key: 's1', cwd: homedir() } })
    expect(open.res.status).toBe(409)
  })

  it('requires the auth header on mutating routes', async () => {
    const { call } = await mount({ desktop: true })
    const open = await call('/idealize/terminal/open', { method: 'POST', body: {}, auth: false })
    expect(open.res.status).toBe(403)
  })

  it('opens one shell per chat inside the fence, streams replay then live output, and routes input', async () => {
    const scratch = await realpath(await mkdtemp(join(tmpdir(), 'idealize-terminal-')))
    const { call, terminals } = await mount({ desktop: true, roots: [scratch] })
    expect((await call('/idealize/terminal/capabilities')).res.json()).toEqual({ embedded: true })

    const outside = await call('/idealize/terminal/open', { method: 'POST', body: { key: 's1', cwd: '/' } })
    expect(outside.res.status).toBe(403)

    const opened = await call('/idealize/terminal/open', { method: 'POST', body: { key: 's1', cwd: scratch, cols: 120, rows: 40 } })
    expect(opened.res.status).toBe(200)
    const { id } = opened.res.json() as { id: string }
    expect(terminals.terminals[0]!.cwd).toBe(scratch)
    const again = await call('/idealize/terminal/open', { method: 'POST', body: { key: 's1', cwd: scratch } })
    expect((again.res.json() as { id: string }).id).toBe(id)
    expect(terminals.terminals).toHaveLength(1)

    terminals.terminals[0]!.emit({ kind: 'data', data: '$ ' })
    const stream = await call('/idealize/terminal/stream', { method: 'GET', query: `?id=${id}` })
    expect(stream.res.headers['content-type']).toBe('text/event-stream')
    terminals.terminals[0]!.emit({ kind: 'data', data: 'hello\r\n' })
    expect(stream.res.events()).toEqual([
      { kind: 'replay', data: '$ ' },
      { kind: 'data', data: 'hello\r\n' },
    ])

    const input = await call('/idealize/terminal/input', { method: 'POST', body: { id, data: 'echo hello\r' } })
    expect(input.res.status).toBe(200)
    expect(terminals.terminals[0]!.written).toEqual(['echo hello\r'])

    const resize = await call('/idealize/terminal/resize', { method: 'POST', body: { id, cols: 100, rows: 30 } })
    expect(resize.res.json()).toEqual({ ok: true, cols: 100, rows: 30 })
    expect(terminals.terminals[0]!.cols).toBe(100)
    const badResize = await call('/idealize/terminal/resize', { method: 'POST', body: { id, cols: -1, rows: 30 } })
    expect(badResize.res.status).toBe(400)

    terminals.terminals[0]!.emit({ kind: 'exit', exitCode: 0 })
    expect(stream.res.ended).toBe(true)
    expect(stream.res.events().at(-1)).toEqual({ kind: 'exit', exitCode: 0 })

    const missing = await call('/idealize/terminal/input', { method: 'POST', body: { id: 'nope', data: 'x' } })
    expect(missing.res.status).toBe(404)

    const close = await call('/idealize/terminal/close', { method: 'POST', body: { id } })
    expect(close.res.status).toBe(200)
    expect(terminals.terminals[0]!.closed).toBe(true)
  })

  it('streams an already-exited terminal as replay + exit and ends', async () => {
    const { call, terminals } = await mount({ desktop: true })
    const opened = await call('/idealize/terminal/open', { method: 'POST', body: { key: 's2' } })
    const { id } = opened.res.json() as { id: string }
    terminals.terminals[0]!.emit({ kind: 'data', data: 'bye' })
    terminals.terminals[0]!.emit({ kind: 'exit', exitCode: 1 })
    const stream = await call('/idealize/terminal/stream', { method: 'GET', query: `?id=${id}` })
    expect(stream.res.events()).toEqual([{ kind: 'replay', data: 'bye' }, { kind: 'exit', exitCode: 1 }])
    expect(stream.res.ended).toBe(true)
  })
})

describe('auto-launch', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  const CONFIG: Config = {
    launchCommand: 'claude --dangerously-skip-permissions',
    launchByActivity: { design: 'design-cli --go' },
  }

  it('types the default launch command into a fresh shell once its prompt shows', async () => {
    const { call, terminals } = await mount({ desktop: true, config: CONFIG })
    vi.useFakeTimers()
    const opened = await call('/idealize/terminal/open', { method: 'POST', body: { key: 's1', activity: 'coding' } })
    expect((opened.res.json() as { launch?: string }).launch).toBe('claude --dangerously-skip-permissions')
    const shell = terminals.terminals[0]!
    expect(shell.written).toEqual([])
    shell.emit({ kind: 'data', data: '$ ' })
    await vi.advanceTimersByTimeAsync(300)
    expect(shell.written).toEqual(['\u0015claude --dangerously-skip-permissions\r'])
    // The fallback firing later must not type a second launch.
    await vi.advanceTimersByTimeAsync(2000)
    expect(shell.written).toHaveLength(1)
  })

  it('a plain open types nothing and records no chat for the activity watcher', async () => {
    const { call, terminals, ctx } = await mount({ desktop: true, config: CONFIG })
    vi.useFakeTimers()
    const opened = await call('/idealize/terminal/open', {
      method: 'POST', body: { key: 'idealize-terminal-pane', activity: 'coding', plain: true },
    })
    expect((opened.res.json() as { launch?: string }).launch).toBeUndefined()
    const shell = terminals.terminals[0]!
    shell.emit({ kind: 'data', data: '$ ' })
    await vi.advanceTimersByTimeAsync(2500)
    expect(shell.written).toEqual([])
    // Output on a plain shell is nobody's run: the watcher never names it as a working chat.
    const working = (ctx.get('idealizeTerminals') as { working(): string[] }).working()
    expect(working).toEqual([])
  })

  it('the per-activity override outranks the default', async () => {
    const { call, terminals } = await mount({ desktop: true, config: CONFIG })
    vi.useFakeTimers()
    const opened = await call('/idealize/terminal/open', { method: 'POST', body: { key: 's1', activity: 'design' } })
    expect((opened.res.json() as { launch?: string }).launch).toBe('design-cli --go')
    terminals.terminals[0]!.emit({ kind: 'data', data: '% ' })
    await vi.advanceTimersByTimeAsync(300)
    expect(terminals.terminals[0]!.written).toEqual(['\u0015design-cli --go\r'])
  })

  it('a reattach (replay present) never types a second launch', async () => {
    const { call, terminals } = await mount({ desktop: true, config: CONFIG })
    vi.useFakeTimers()
    await call('/idealize/terminal/open', { method: 'POST', body: { key: 's1', activity: 'coding' } })
    const shell = terminals.terminals[0]!
    shell.emit({ kind: 'data', data: '$ ' })
    await vi.advanceTimersByTimeAsync(300)
    expect(shell.written).toHaveLength(1)
    const again = await call('/idealize/terminal/open', { method: 'POST', body: { key: 's1', activity: 'coding' } })
    expect((again.res.json() as { launch?: string }).launch).toBeUndefined()
    await vi.advanceTimersByTimeAsync(3000)
    expect(shell.written).toHaveLength(1)
  })

  it('falls back to typing after two seconds when the shell reports no output', async () => {
    const { call, terminals } = await mount({ desktop: true, config: CONFIG })
    vi.useFakeTimers()
    await call('/idealize/terminal/open', { method: 'POST', body: { key: 's1' } })
    await vi.advanceTimersByTimeAsync(2000)
    expect(terminals.terminals[0]!.written).toEqual(['\u0015claude --dangerously-skip-permissions\r'])
  })

  it('without config (or with a blanked command) nothing is typed', async () => {
    const { call, terminals } = await mount({ desktop: true })
    vi.useFakeTimers()
    const opened = await call('/idealize/terminal/open', { method: 'POST', body: { key: 's1', activity: 'coding' } })
    expect((opened.res.json() as { launch?: string }).launch).toBeUndefined()
    terminals.terminals[0]!.emit({ kind: 'data', data: '$ ' })
    await vi.advanceTimersByTimeAsync(3000)
    expect(terminals.terminals[0]!.written).toEqual([])
  })

  it('waits for the shell to fall quiet, so a prompt drawn in several chunks is finished first', async () => {
    vi.useFakeTimers()
    const shell = new FakeTerminal('s1', '/tmp')
    scheduleLaunch(shell, 'claude')
    // A prompt in three pieces, each more than the settle apart: arming once
    // on the first chunk typed the command into the middle of it.
    shell.emit({ kind: 'data', data: '\u001b[1m' })
    await vi.advanceTimersByTimeAsync(250)
    expect(shell.written).toEqual([])
    shell.emit({ kind: 'data', data: 'jamie@mac' })
    await vi.advanceTimersByTimeAsync(250)
    expect(shell.written).toEqual([])
    shell.emit({ kind: 'data', data: ' ~ $ ' })
    await vi.advanceTimersByTimeAsync(299)
    expect(shell.written).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(shell.written).toEqual(['\u0015claude\r'])
  })

  it('types at the deadline when the shell never falls quiet', async () => {
    vi.useFakeTimers()
    const shell = new FakeTerminal('s1', '/tmp')
    scheduleLaunch(shell, 'claude')
    // A shell printing steadily faster than the settle: the quiet never comes,
    // and only the deadline gets the agent started.
    for (let elapsed = 0; elapsed < 2000; elapsed += 100) {
      shell.emit({ kind: 'data', data: '.' })
      await vi.advanceTimersByTimeAsync(100)
    }
    expect(shell.written).toEqual(['\u0015claude\r'])
    // The deadline fired once; later chunks do not type a second command.
    shell.emit({ kind: 'data', data: '.' })
    await vi.advanceTimersByTimeAsync(1000)
    expect(shell.written).toEqual(['\u0015claude\r'])
  })

  it('a shell that exits before the prompt cancels the pending launch', async () => {
    vi.useFakeTimers()
    const shell = new FakeTerminal('s1', '/tmp')
    scheduleLaunch(shell, 'claude')
    shell.emit({ kind: 'exit', exitCode: 1 })
    await vi.advanceTimersByTimeAsync(3000)
    expect(shell.written).toEqual([])
  })
})

describe('standing rules for a terminal agent', () => {
  const dshHome = process.env.DSH_HOME
  let home: string | undefined

  afterEach(async () => {
    if (dshHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = dshHome
    if (home !== undefined) await rm(home, { recursive: true, force: true })
    home = undefined
  })

  /** Mount with a scratch harness home and a docPolicy-shaped provider. */
  async function mountWithRules(config: Config, rules: (cwd: string) => Promise<string | undefined>) {
    home = await realpath(await mkdtemp(join(tmpdir(), 'idealize-terminal-knowledge-')))
    process.env.DSH_HOME = home
    const mounted = await mount({ desktop: true, config })
    mounted.ctx.provide('docPolicy', { terminalKnowledge: rules })
    return mounted
  }

  it('appends the rules to a Claude Code launch, reports the configured command, and clears the file when the shell ends', async () => {
    const seen: string[] = []
    const { call, terminals } = await mountWithRules(
      { launchCommand: 'claude --dangerously-skip-permissions' },
      (cwd) => { seen.push(cwd); return Promise.resolve('Write every piece of project documentation in /vault.') },
    )
    const opened = await call('/idealize/terminal/open', { method: 'POST', body: { key: 's1' } })
    // A brain switch compares the configured command, so that is what the route reports.
    expect((opened.res.json() as { launch?: string }).launch).toBe('claude --dangerously-skip-permissions')
    expect(seen).toEqual([homedir()])
    const shell = terminals.terminals[0]!
    const file = join(home!, 'idealize', 'terminal-knowledge', `${shell.id}.md`)
    expect(await readFile(file, 'utf8')).toBe(`${KNOWLEDGE_PREAMBLE}\n\nWrite every piece of project documentation in /vault.\n`)
    shell.emit({ kind: 'data', data: '$ ' })
    await vi.waitFor(() => { expect(shell.written).toHaveLength(1) }, { timeout: 2_000 })
    expect(shell.written[0]).toBe(`\u0015claude --dangerously-skip-permissions --append-system-prompt "$(cat '${file}')"\r`)
    shell.emit({ kind: 'exit', exitCode: 0 })
    await vi.waitFor(async () => { await expect(readFile(file, 'utf8')).rejects.toThrow() })
  })

  it('types another CLI, a switched-off setting, and a provider with nothing to say as configured', async () => {
    const rules = (): Promise<string | undefined> => Promise.resolve('rules')
    for (const [config, provider] of [
      [{ launchCommand: 'kimi' }, rules],
      [{ launchCommand: 'claude', appendKnowledge: false }, rules],
      [{ launchCommand: 'claude' }, () => Promise.resolve(undefined)],
      [{ launchCommand: 'claude' }, () => Promise.reject(new Error('folder unreadable'))],
    ] as const) {
      const { call, terminals } = await mountWithRules(config, provider)
      await call('/idealize/terminal/open', { method: 'POST', body: { key: 's1' } })
      const shell = terminals.terminals[0]!
      shell.emit({ kind: 'data', data: '$ ' })
      await vi.waitFor(() => { expect(shell.written).toHaveLength(1) }, { timeout: 2_000 })
      expect(shell.written[0]).toBe(`\u0015${config.launchCommand}\r`)
      await rm(home!, { recursive: true, force: true })
    }
  })

  it('types a Pi launch with the same option and a Codex launch with its config override after the executable', async () => {
    for (const [launchCommand, typed] of [
      ['pi', (file: string) => `pi --append-system-prompt "$(cat '${file}')"`],
      ['codex --yolo', (file: string) => `codex -c developer_instructions="$(cat '${file}')" --yolo`],
    ] as const) {
      const { call, terminals } = await mountWithRules({ launchCommand }, () => Promise.resolve('rules'))
      await call('/idealize/terminal/open', { method: 'POST', body: { key: 's1' } })
      const shell = terminals.terminals[0]!
      const file = join(home!, 'idealize', 'terminal-knowledge', `${shell.id}.md`)
      shell.emit({ kind: 'data', data: '$ ' })
      await vi.waitFor(() => { expect(shell.written).toHaveLength(1) }, { timeout: 2_000 })
      expect(shell.written[0]).toBe(`\u0015${typed(file)}\r`)
      await rm(home!, { recursive: true, force: true })
    }
  })

  it('leaves a launch that sets its own instructions alone, and recognises a CLI by its executable', () => {
    expect(promptChannel('claude --dangerously-skip-permissions')).toBeDefined()
    expect(promptChannel(' /opt/homebrew/bin/claude ')).toBeDefined()
    expect(promptChannel('pi')).toBeDefined()
    expect(promptChannel('codex --yolo')).toBeDefined()
    expect(promptChannel('claude --append-system-prompt "mine"')).toBeUndefined()
    expect(promptChannel('claude --system-prompt-file=./p.md')).toBeUndefined()
    expect(promptChannel('pi --system-prompt "mine"')).toBeUndefined()
    expect(promptChannel('codex -c developer_instructions="mine"')).toBeUndefined()
    expect(promptChannel('claude-squad')).toBeUndefined()
    expect(promptChannel('kimi')).toBeUndefined()
    expect(promptChannel('constructor')).toBeUndefined()
    expect(promptChannel('')).toBeUndefined()
  })

  it('quotes a harness home holding a space and an apostrophe, and gives another CLI nothing', () => {
    expect(withKnowledge('claude', '/Users/j/Application Support/JJ\'s app/k.md'))
      .toBe('claude --append-system-prompt "$(cat \'/Users/j/Application Support/JJ\'\\\'\'s app/k.md\')"')
    expect(withKnowledge('kimi', '/k.md')).toBeUndefined()
  })
})

describe('launch commands, read', () => {
  const CONFIG: Config = {
    launchCommand: 'claude --dangerously-skip-permissions',
    launchByActivity: { design: 'design-cli --go' },
  }

  it('resolves the override first, then the default, and trims both', () => {
    const launches = { default: '  claude  ', byActivity: { design: ' design-cli --go ' } }
    expect(launchCommandFor('design', launches)).toBe('design-cli --go')
    expect(launchCommandFor('coding', launches)).toBe('claude')
    expect(launchCommandFor(undefined, launches)).toBe('claude')
    expect(launchCommandFor('coding', { default: '', byActivity: {} })).toBe('')
  })

  it('serves the configured commands, so a client can say which brains restart the shell', async () => {
    const { call } = await mount({ desktop: true, config: CONFIG })
    const read = await call(LAUNCHES_PATH, { method: 'GET' })
    expect(read.res.status).toBe(200)
    expect(read.res.json()).toMatchObject({
      default: 'claude --dangerously-skip-permissions',
      byActivity: { design: 'design-cli --go' },
    })
  })

  it('answers with empty commands when the deployment configured none', async () => {
    const { call } = await mount({ desktop: false })
    expect((await call(LAUNCHES_PATH, { method: 'GET' })).res.json()).toMatchObject({ default: '', byActivity: {}, catalog: [] })
  })

  it.skipIf(process.platform === 'win32')('serves the CLI catalogue with each command probed through the login shell', async () => {
    const { call } = await mount({
      desktop: true,
      config: {
        clis: [
          { id: 'list', label: 'List', command: 'ls -la' },
          { id: 'nope', label: 'Nope', command: 'no-such-cli-for-idealize-c6' },
          { id: 'shell', label: 'Plain shell', command: '' },
        ],
      },
    })
    const body = (await call(LAUNCHES_PATH, { method: 'GET' })).res.json() as { catalog: unknown }
    expect(body.catalog).toEqual([
      { id: 'list', label: 'List', command: 'ls -la', installed: true },
      { id: 'nope', label: 'Nope', command: 'no-such-cli-for-idealize-c6', installed: false },
      // A plain shell needs no executable, so it is always there.
      { id: 'shell', label: 'Plain shell', command: '', installed: true },
    ])
  })

  it('persists a launch choice per brain, and the default without an activity', async () => {
    const { call } = await mount({ desktop: true, config: CONFIG, settings: true })
    const perBrain = await call('/idealize/terminal/launch', { method: 'POST', body: { activity: 'coding', command: 'codex' } })
    expect(perBrain.res.status).toBe(200)
    const fallback = await call('/idealize/terminal/launch', { method: 'POST', body: { command: 'gemini' } })
    expect(fallback.res.status).toBe(200)
    expect((await call(LAUNCHES_PATH, { method: 'GET' })).res.json()).toMatchObject({
      default: 'gemini',
      // The pre-configured design override survives the coding write: the map merges.
      byActivity: { coding: 'codex', design: 'design-cli --go' },
    })
  })

  it('refuses a command that is not one bounded line, and an unauthenticated write', async () => {
    const { call } = await mount({ desktop: true, config: CONFIG, settings: true })
    expect((await call('/idealize/terminal/launch', { method: 'POST', body: { command: 'a\nb' } })).res.status).toBe(400)
    expect((await call('/idealize/terminal/launch', { method: 'POST', body: { command: 'x'.repeat(201) } })).res.status).toBe(400)
    expect((await call('/idealize/terminal/launch', { method: 'POST', body: { activity: '', command: 'codex' } })).res.status).toBe(400)
    const denied = await call('/idealize/terminal/launch', { method: 'POST', body: { command: 'codex' }, auth: false })
    expect(denied.res.status).toBeGreaterThanOrEqual(401)
    // And the choices are unchanged.
    expect((await call(LAUNCHES_PATH, { method: 'GET' })).res.json()).toMatchObject({
      default: 'claude --dangerously-skip-permissions',
    })
  })
})
