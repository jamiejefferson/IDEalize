/**
 * Host routes: the capability probe answers from the desktop service's
 * presence, open fences the directory, the stream replays then follows, and
 * input/resize/close reach the named terminal.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import {
  apply,
  type Config,
  conversationId,
  describeRun,
  type DesktopTerminalLike,
  type DesktopTerminalsLike,
  type EmbeddedTerminalEvent,
  fencedDirectory,
  gridDimension,
  KNOWLEDGE_PREAMBLE,
  LAUNCHES_PATH,
  launchBrainOf,
  launchCommandFor,
  scheduleLaunch,
  promptChannel,
  takesTurnHooks,
  type TerminalTurn,
  TURN_HOOKS,
  TURN_HOOKS_FILE,
  withKnowledge,
  withTurnHooks,
} from '../src/index.ts'

// Claude Code's conversations live under a scratch folder, so a launch never
// reads the real ~/.claude to decide whether a chat's conversation exists.
const claudeConfigDir = process.env.CLAUDE_CONFIG_DIR
let claudeHome = ''
beforeAll(async () => {
  claudeHome = await realpath(await mkdtemp(join(tmpdir(), 'idealize-terminal-claude-')))
  process.env.CLAUDE_CONFIG_DIR = claudeHome
})
afterAll(async () => {
  if (claudeConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = claudeConfigDir
  await rm(claudeHome, { recursive: true, force: true })
})

/** What a fresh launch of `program` in chat `chat` names on its command line. */
const started = (chat: string, program: string): string => `--session-id ${conversationId(chat, program)}`

/** Where a launch under this harness home loads Claude Code's turn hooks from. */
function hooksFile(home: string): string {
  return join(home, 'idealize', 'terminal-turns', TURN_HOOKS_FILE)
}

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
  it('names a terminal chat through the probed LLM service, which the plugin never injects', async () => {
    const { call, ctx } = await mount({ desktop: true })
    const asked: unknown[] = []
    // Provided from a plugin's own scope, as the shipped LLM service is: that
    // is what makes an uninjected `ctx.llm` read throw.
    await ctx.plugin({
      name: 'fake-llm',
      apply(llmCtx: Context) {
        llmCtx.provide('llm', {
          async* stream(options: unknown) {
            asked.push(options)
            yield { type: 'block-start', index: 0, blockType: 'text' }
            yield { type: 'text-delta', index: 0, text: 'Header alignment fix' }
            yield { type: 'finish', reason: { kind: 'stop' } }
          },
        })
      },
    })
    ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'p', model: 'm' }) })
    const named = await call('/idealize/terminal/title', { method: 'POST', body: { text: 'fix the header alignment please' } })
    expect(named.res.status).toBe(200)
    expect(named.res.json()).toEqual({ title: 'Header alignment fix' })
    expect(asked).toHaveLength(1)
  })

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
  // A Claude Code launch writes its turn hooks under the harness home, so the
  // home is a scratch folder, never the one this shell runs in.
  const dshHome = process.env.DSH_HOME
  let home = ''
  beforeEach(async () => {
    home = await realpath(await mkdtemp(join(tmpdir(), 'idealize-terminal-launch-')))
    process.env.DSH_HOME = home
  })
  afterEach(async () => {
    vi.useRealTimers()
    if (dshHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = dshHome
    await rm(home, { recursive: true, force: true })
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
    expect(shell.written).toEqual([`\u0015claude --dangerously-skip-permissions ${started('s1', 'claude')} --settings '${hooksFile(home)}'\r`])
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
    expect(terminals.terminals[0]!.written).toEqual([`\u0015claude --dangerously-skip-permissions ${started('s1', 'claude')} --settings '${hooksFile(home)}'\r`])
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

  it('clears the line with Escape on Windows, where Ctrl-U is unbound in PowerShell and printed by cmd', async () => {
    vi.useFakeTimers()
    const shell = new FakeTerminal('s1', 'C:\\work')
    scheduleLaunch(shell, 'claude', 'win32')
    shell.emit({ kind: 'data', data: 'PS C:\\work> ' })
    await vi.advanceTimersByTimeAsync(300)
    expect(shell.written).toEqual(['\u001bclaude\r'])
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
    expect(shell.written[0]).toBe(`\u0015claude --dangerously-skip-permissions ${started('s1', 'claude')} --settings '${hooksFile(home!)}' --append-system-prompt "$(cat '${file}')"\r`)
    shell.emit({ kind: 'exit', exitCode: 0 })
    await vi.waitFor(async () => { await expect(readFile(file, 'utf8')).rejects.toThrow() })
  })

  it('types another CLI and a switched-off setting as configured, and a Claude Code launch with no rules to carry with its turn hooks alone', async () => {
    const rules = (): Promise<string | undefined> => Promise.resolve('rules')
    for (const [config, provider, hooked] of [
      [{ launchCommand: 'kimi' }, rules, false],
      [{ launchCommand: 'claude', appendKnowledge: false }, rules, false],
      [{ launchCommand: 'claude' }, () => Promise.resolve(undefined), true],
      [{ launchCommand: 'claude' }, () => Promise.reject(new Error('folder unreadable')), true],
    ] as const) {
      const { call, terminals } = await mountWithRules(config, provider)
      await call('/idealize/terminal/open', { method: 'POST', body: { key: 's1' } })
      const shell = terminals.terminals[0]!
      shell.emit({ kind: 'data', data: '$ ' })
      await vi.waitFor(() => { expect(shell.written).toHaveLength(1) }, { timeout: 2_000 })
      // Claude Code still names the chat's conversation; Kimi takes no id from the caller.
      const named = config.launchCommand === 'kimi' ? 'kimi' : `${config.launchCommand} ${started('s1', 'claude')}`
      expect(shell.written[0]).toBe(`\u0015${hooked ? withTurnHooks(named, hooksFile(home!)) : named}\r`)
      await rm(home!, { recursive: true, force: true })
    }
  })

  it('types a Pi launch with the same option and a Codex launch with its config override after the executable', async () => {
    for (const [launchCommand, typed] of [
      ['pi', (file: string) => `pi ${started('s1', 'pi')} --append-system-prompt "$(cat '${file}')"`],
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

  // The Windows embedded terminal is PowerShell 5.1. `"$(cat file)"` would
  // join the file's lines with spaces there, and 5.1 passes embedded double
  // quotes to a native program unescaped (PC test drive, 18 Sep 2026).
  it('types the PowerShell form on Windows: the file read whole into a variable, quotes escaped for a native program', () => {
    const file = 'C:\\Users\\j\\AppData\\Roaming\\JJ\'s app\\k.md'
    const read = '$idealizeKnowledge = ((Get-Content -Raw -LiteralPath \'C:\\Users\\j\\AppData\\Roaming\\JJ\'\'s app\\k.md\').TrimEnd() -replace \'(\\\\*)"\',\'$1$1\\"\' -replace \'(\\\\+)$\',\'$1$1\')'
    expect(withKnowledge('claude --dangerously-skip-permissions', file, 'win32'))
      .toBe(`${read}; claude --dangerously-skip-permissions --append-system-prompt $idealizeKnowledge`)
    expect(withKnowledge('codex exec', file, 'win32'))
      .toBe(`${read}; codex -c "developer_instructions=$idealizeKnowledge" exec`)
    expect(withKnowledge('kimi', file, 'win32')).toBeUndefined()
  })

  it('knows a CLI by its name under a Windows path and launcher suffix', () => {
    expect(promptChannel('C:\\tools\\claude.exe --verbose')?.option).toBe('--append-system-prompt ')
    expect(promptChannel('claude.cmd')?.option).toBe('--append-system-prompt ')
  })
})

describe("a chat's own conversation", () => {
  const CONFIG: Config = {
    launchCommand: 'claude --dangerously-skip-permissions',
    launchByActivity: { admin: 'pi', design: 'codex', writing: 'kimi' },
  }

  // A scratch harness home: a Claude Code launch writes its turn hooks under it.
  const dshHome = process.env.DSH_HOME
  let home = ''
  beforeEach(async () => {
    home = await realpath(await mkdtemp(join(tmpdir(), 'idealize-terminal-conversation-')))
    process.env.DSH_HOME = home
  })
  afterEach(async () => {
    await rm(join(claudeHome, 'projects'), { recursive: true, force: true })
    if (dshHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = dshHome
    await rm(home, { recursive: true, force: true })
  })

  /** A Claude Code line as the shell types it: the turn hooks follow the conversation. */
  const claude = (line: string): string => `\u0015${withTurnHooks(line, hooksFile(home))}\r`

  /** Open a chat's shell, let its prompt show, and return the one line the launch typed. */
  async function launch(call: Awaited<ReturnType<typeof mount>>['call'], terminals: FakeTerminals, key: string, activity?: string): Promise<string> {
    const before = terminals.terminals.length
    await call('/idealize/terminal/open', { method: 'POST', body: { key, ...activity === undefined ? {} : { activity } } })
    const shell = terminals.terminals[before]!
    shell.emit({ kind: 'data', data: '$ ' })
    await vi.waitFor(() => { expect(shell.written).toHaveLength(1) }, { timeout: 2_000 })
    return shell.written[0]!
  }

  /** Claude Code's file for one conversation, as it writes it on the first message. */
  async function saveClaudeConversation(id: string): Promise<void> {
    await mkdir(join(claudeHome, 'projects', '-tmp-project'), { recursive: true })
    await writeFile(join(claudeHome, 'projects', '-tmp-project', `${id}.jsonl`), '{}\n')
  }

  it('starts a fresh chat on its own conversation id, a UUID that stays the same for that chat', async () => {
    const id = conversationId('s1', 'claude')
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(conversationId('s1', 'claude')).toBe(id)
    const { call, terminals } = await mount({ desktop: true, config: CONFIG })
    expect(await launch(call, terminals, 's1')).toBe(claude(`claude --dangerously-skip-permissions --session-id ${id}`))
  })

  it('reopens the conversation after a restart, and types nothing more into it', async () => {
    const id = conversationId('s1', 'claude')
    await saveClaudeConversation(id)
    // A restart: a new host with no memory of the shell before it.
    const { call, terminals } = await mount({ desktop: true, config: CONFIG })
    expect(await launch(call, terminals, 's1')).toBe(claude(`claude --dangerously-skip-permissions --resume ${id}`))
    await new Promise(resolve => setTimeout(resolve, 2_100))
    expect(terminals.terminals[0]!.written).toHaveLength(1)
  })

  it('starts the same id again while Claude Code has saved nothing under it', async () => {
    const first = await mount({ desktop: true, config: CONFIG })
    const again = await mount({ desktop: true, config: CONFIG })
    const typed = claude(`claude --dangerously-skip-permissions --session-id ${conversationId('s1', 'claude')}`)
    expect(await launch(first.call, first.terminals, 's1')).toBe(typed)
    expect(await launch(again.call, again.terminals, 's1')).toBe(typed)
  })

  it('gives two chats in one folder a conversation each', async () => {
    const { call, terminals } = await mount({ desktop: true, config: CONFIG })
    const one = await launch(call, terminals, 's1')
    const two = await launch(call, terminals, 's2')
    expect(conversationId('s1', 'claude')).not.toBe(conversationId('s2', 'claude'))
    expect(one).toContain(conversationId('s1', 'claude'))
    expect(two).toContain(conversationId('s2', 'claude'))
  })

  it('gives a brain switch onto another CLI that CLI\'s own conversation, and reopens the first on the way back', async () => {
    const { call, terminals } = await mount({ desktop: true, config: CONFIG })
    expect(await launch(call, terminals, 's1')).toBe(claude(`claude --dangerously-skip-permissions --session-id ${conversationId('s1', 'claude')}`))
    await saveClaudeConversation(conversationId('s1', 'claude'))
    // restartTerminal ends the shell before the view reopens on the new brain.
    terminals.terminals[0]!.emit({ kind: 'exit', exitCode: 0 })
    expect(await launch(call, terminals, 's1', 'admin')).toBe(`\u0015pi --session-id ${conversationId('s1', 'pi')}\r`)
    terminals.terminals[1]!.emit({ kind: 'exit', exitCode: 0 })
    expect(await launch(call, terminals, 's1')).toBe(claude(`claude --dangerously-skip-permissions --resume ${conversationId('s1', 'claude')}`))
  })

  it('launches a CLI that takes no id from the caller, or a command that picks its own conversation, as configured', async () => {
    const { call, terminals } = await mount({
      desktop: true,
      config: { launchByActivity: { coding: 'claude --continue', design: 'codex', writing: 'kimi' } },
    })
    expect(await launch(call, terminals, 's1', 'design')).toBe('\u0015codex\r')
    expect(await launch(call, terminals, 's2', 'writing')).toBe('\u0015kimi\r')
    expect(await launch(call, terminals, 's3', 'coding')).toBe(claude('claude --continue'))
  })

  it('launches as configured when Claude Code\'s folder cannot be read, so a fresh conversation beats none', async () => {
    // A file where the projects folder should be: the look for the conversation throws.
    await writeFile(join(claudeHome, 'projects'), '')
    const { call, terminals } = await mount({ desktop: true, config: CONFIG })
    expect(await launch(call, terminals, 's1')).toBe(claude('claude --dangerously-skip-permissions'))
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

  it('launches a chat on its logged brain, so a switch survives a restart', () => {
    // The AMI chat (30 Oct 2026): created on Design, switched to Coding before
    // its first prompt. The header still says design; the log says coding.
    const switched = { agentPreset: 'design', projectionValues: { brain: { brain: 'coding' } } }
    expect(launchBrainOf(switched)).toBe('coding')
  })

  it('falls back to the launch preset, then to the default, when no brain is logged', () => {
    expect(launchBrainOf({ agentPreset: 'design', projectionValues: {} })).toBe('design')
    expect(launchBrainOf({ agentPreset: 'design', projectionValues: { brain: { brain: '' } } })).toBe('design')
    expect(launchBrainOf({ agentPreset: 'design' })).toBe('design')
    expect(launchBrainOf({})).toBeUndefined()
    expect(launchBrainOf(undefined)).toBeUndefined()
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

describe('a terminal agent reporting its own turns', () => {
  const dshHome = process.env.DSH_HOME
  let home = ''
  beforeEach(async () => {
    home = await realpath(await mkdtemp(join(tmpdir(), 'idealize-terminal-turns-')))
    process.env.DSH_HOME = home
  })
  afterEach(async () => {
    vi.useRealTimers()
    if (dshHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = dshHome
    await rm(home, { recursive: true, force: true })
  })

  /**
   * A Terminal chat's shell in a project folder, with the bridge and the Studio
   * recording what reaches them. The clock is faked before the plugin mounts,
   * because the watcher reads the time through the clock it found then.
   */
  async function chatShell() {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { call, terminals, ctx } = await mount({ desktop: true, roots: [home] })
    const chimes: { kind: string; sessionId: string }[] = []
    const posts: string[] = []
    const provide = (ctx as unknown as { provide(name: string, value: unknown): void }).provide.bind(ctx)
    provide('idealizeBridge', { buffer: { push: (event: { kind: string; sessionId: string }) => { chimes.push(event) } } })
    provide('idealizeStudio', { record: (input: { body: string }) => { posts.push(input.body); return Promise.resolve() } })
    await call('/idealize/terminal/open', { method: 'POST', body: { key: 's1', cwd: home } })
    const shell = terminals.terminals[0]!
    const terminalsService = ctx.get('idealizeTerminals') as { turn(sessionId: string, turn: TerminalTurn): boolean }
    const turn = (report: TerminalTurn, sessionId = 's1'): boolean => terminalsService.turn(sessionId, report)
    /** The CLI printing steadily for a stretch, then falling quiet long enough for the watcher to call it done. */
    const run = async (ms: number): Promise<void> => {
      for (let elapsed = 0; elapsed <= ms; elapsed += 500) {
        shell.emit({ kind: 'data', data: '.' })
        await vi.advanceTimersByTimeAsync(500)
      }
      await vi.advanceTimersByTimeAsync(2_000)
    }
    return { call, shell, turn, run, chimes, posts }
  }

  it('chimes once on the reported stop, timed from the reported start, and posts the group-chat line', async () => {
    const { turn, run, chimes, posts } = await chatShell()
    expect(turn('open')).toBe(true)
    expect(turn('start')).toBe(true)
    const startedAt = Date.now()
    // A pause in the middle of the turn, such as a long tool run, is not its end.
    await run(6_000)
    await run(6_000)
    expect(chimes).toEqual([])
    expect(turn('stop')).toBe(true)
    expect(chimes).toEqual([{ kind: 'agent-finished', title: 'Agent finished', body: '', sessionId: 's1' }])
    expect(posts).toEqual([`Finished a run in the terminal (${describeRun(Date.now() - startedAt)}).`])
  })

  it('leaves the watcher in charge until the agent reports, and again once its session closes', async () => {
    const { turn, run, chimes, posts } = await chatShell()
    await run(6_000)
    expect(chimes).toHaveLength(1)
    turn('open')
    await run(6_000)
    expect(chimes).toHaveLength(1)
    // A stop whose start went unheard still finishes, without a time.
    turn('stop')
    expect(chimes).toHaveLength(2)
    expect(posts.at(-1)).toBe('Finished a run in the terminal.')
    turn('close')
    await run(6_000)
    expect(chimes).toHaveLength(3)
  })

  it('answers false for a chat with no terminal open here', async () => {
    const { turn } = await chatShell()
    expect(turn('stop', 's2')).toBe(false)
  })

  // Feedback 1047a635: typing a long prompt chimed at every pause.
  it('raises no chime while the person types, however long the prompt', async () => {
    const { call, shell, chimes } = await chatShell()
    for (let elapsed = 0; elapsed < 8_000; elapsed += 200) {
      await call('/idealize/terminal/input', { method: 'POST', body: { id: shell.id, data: 'a' } })
      shell.emit({ kind: 'data', data: 'a' })
      await vi.advanceTimersByTimeAsync(200)
    }
    await vi.advanceTimersByTimeAsync(2_000)
    expect(shell.written.join('')).toBe('a'.repeat(40))
    expect(chimes).toEqual([])
  })

  it('types a Claude Code launch loading the turn hooks from a file that holds exactly them', async () => {
    const { call, terminals } = await mount({ desktop: true, config: { launchCommand: 'claude --dangerously-skip-permissions' } })
    await call('/idealize/terminal/open', { method: 'POST', body: { key: 's1' } })
    const shell = terminals.terminals[0]!
    shell.emit({ kind: 'data', data: '$ ' })
    await vi.waitFor(() => { expect(shell.written).toHaveLength(1) }, { timeout: 2_000 })
    expect(shell.written[0]).toBe(`\u0015claude --dangerously-skip-permissions ${started('s1', 'claude')} --settings '${hooksFile(home)}'\r`)
    expect(JSON.parse(await readFile(hooksFile(home), 'utf8'))).toEqual(TURN_HOOKS)
    expect(TURN_HOOKS.hooks.Stop).toEqual([{ hooks: [{ type: 'command', command: 'idealize turn stop >/dev/null 2>&1 || true', timeout: 10 }] }])
  })

  it('types a Claude Code launch without its hooks when the file cannot be written', async () => {
    // Claude Code refuses to start on a missing --settings file, so no file means no option.
    const blocker = join(home, 'not-a-folder')
    await writeFile(blocker, '')
    process.env.DSH_HOME = blocker
    const { call, terminals } = await mount({ desktop: true, config: { launchCommand: 'claude' } })
    await call('/idealize/terminal/open', { method: 'POST', body: { key: 's1' } })
    const shell = terminals.terminals[0]!
    shell.emit({ kind: 'data', data: '$ ' })
    await vi.waitFor(() => { expect(shell.written).toHaveLength(1) }, { timeout: 2_000 })
    expect(shell.written[0]).toBe(`\u0015claude ${started('s1', 'claude')}\r`)
  })

  it('gives the hooks to Claude Code alone, on a POSIX shell, and leaves a command with its own settings alone', () => {
    expect(takesTurnHooks('claude --dangerously-skip-permissions', 'darwin')).toBe(true)
    expect(takesTurnHooks(' /opt/homebrew/bin/claude ', 'linux')).toBe(true)
    expect(takesTurnHooks('claude --settings ./mine.json', 'darwin')).toBe(false)
    expect(takesTurnHooks('claude --settings=./mine.json', 'darwin')).toBe(false)
    expect(takesTurnHooks('claude', 'win32')).toBe(false)
    expect(takesTurnHooks('codex --yolo', 'darwin')).toBe(false)
    expect(takesTurnHooks('claude-squad', 'darwin')).toBe(false)
    expect(withTurnHooks('claude ', '/Users/j/JJ\'s app/claude-turns.json')).toBe('claude --settings \'/Users/j/JJ\'\\\'\'s app/claude-turns.json\'')
  })
})

describe('pausing a terminal agent (feedback 495cec0a)', () => {
  afterEach(() => { vi.useRealTimers() })

  /** Open a chat's shell with an agent CLI in front, past its launch. */
  async function openAgentShell() {
    // The activity watcher reads the clock it was built with, so time is faked first.
    vi.useFakeTimers()
    const mounting = mount({ desktop: true, config: { launchCommand: '' } })
    await vi.advanceTimersByTimeAsync(10)
    const mounted = await mounting
    const sessions: string[] = []
    const service = mounted.ctx.get('idealizeTerminals') as {
      deliver(sessionId: string, text: string, wanted?: () => boolean, options?: { interruptWith?: string }): Promise<string> | undefined
      interrupt(sessionId: string): boolean
      turn(sessionId: string, turn: TerminalTurn): boolean
      onOpened(listener: (sessionId: string) => void): () => void
    }
    const chimes: string[] = []
    ;(mounted.ctx as unknown as { provide(name: string, value: unknown): void })
      .provide('idealizeBridge', { buffer: { push: (event: { kind: string }) => { chimes.push(event.kind) } } })
    const off = service.onOpened((sessionId) => { sessions.push(sessionId) })
    await mounted.call('/idealize/terminal/open', { method: 'POST', body: { key: 's1' } })
    const shell = Object.assign(mounted.terminals.terminals[0]!, { foreground: () => 'claude' })
    /** The CLI printing steadily for `ms`, long enough to count as working past the watcher's minimum. */
    const print = async (ms: number): Promise<void> => {
      for (let elapsed = 0; elapsed <= ms; elapsed += 500) {
        shell.emit({ kind: 'data', data: '.' })
        await vi.advanceTimersByTimeAsync(500)
      }
    }
    return { ...mounted, service, shell, sessions, off, chimes, print }
  }

  it('tells a listener which chat opened, and types a line then waits for the answer', async () => {
    const { service, shell, sessions, off } = await openAgentShell()
    expect(sessions).toEqual(['s1'])
    off()
    expect(service.deliver('nobody', 'save your notes')).toBeUndefined()
    let outcome: string | undefined
    void service.deliver('s1', 'save your notes')?.then((value) => { outcome = value })
    expect(shell.written).toEqual(['save your notes'])
    await vi.advanceTimersByTimeAsync(150)
    expect(shell.written).toEqual(['save your notes', '\r'])
    // The answer: output for longer than the watcher's minimum run, then quiet.
    for (let elapsed = 0; elapsed <= 5000; elapsed += 500) {
      shell.emit({ kind: 'data', data: '.' })
      await vi.advanceTimersByTimeAsync(500)
    }
    expect(outcome).toBeUndefined()
    await vi.advanceTimersByTimeAsync(2000)
    expect(outcome).toBe('answered')
  })

  it('takes the answer from the agent\'s own turn report when it gives one, so a quiet spell mid-turn is not the answer', async () => {
    const { service, shell } = await openAgentShell()
    const turn = (report: 'open' | 'start' | 'stop'): boolean =>
      (service as unknown as { turn(sessionId: string, turn: string): boolean }).turn('s1', report)
    expect(turn('open')).toBe(true)
    let outcome: string | undefined
    void service.deliver('s1', 'save your notes')?.then((value) => { outcome = value })
    await vi.advanceTimersByTimeAsync(150)
    expect(shell.written).toEqual(['save your notes', '\r'])
    turn('start')
    // Output, then a quiet spell long enough for the watcher to call it done:
    // a long tool run inside the turn, which is not the answer.
    for (let elapsed = 0; elapsed <= 5000; elapsed += 500) {
      shell.emit({ kind: 'data', data: '.' })
      await vi.advanceTimersByTimeAsync(500)
    }
    await vi.advanceTimersByTimeAsync(5000)
    expect(outcome).toBeUndefined()
    turn('stop')
    await vi.advanceTimersByTimeAsync(0)
    expect(outcome).toBe('answered')
  })

  it('interrupts with Escape and drops the line it was holding', async () => {
    const { service, shell } = await openAgentShell()
    // The agent is mid-run, so the line is held.
    shell.emit({ kind: 'data', data: 'working' })
    let outcome: string | undefined
    void service.deliver('s1', 'save your notes')?.then((value) => { outcome = value })
    expect(shell.written).toEqual([])
    expect(service.interrupt('s1')).toBe(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(outcome).toBe('dropped')
    expect(shell.written).toEqual(['\u001b'])
    await vi.advanceTimersByTimeAsync(3000)
    expect(shell.written).toEqual(['\u001b'])
    expect(service.interrupt('nobody')).toBe(false)
  })

  it('presses no Escape on an agent at its prompt, where a second one opens rewind or backtrack', async () => {
    const { service, shell } = await openAgentShell()
    expect(service.interrupt('s1')).toBe(true)
    await vi.advanceTimersByTimeAsync(3000)
    expect(shell.written).toEqual([])
  })

  it('interrupts an agent in the middle of a run, then empties its input box and types the wrap-up line once its prompt is back', async () => {
    // JJ, 30 Oct 2026: "if a terminal agent is in the middle of a run, the
    // pause button needs to interrupt and get the agent to wrap up safely".
    const { service, shell, chimes, print } = await openAgentShell()
    await print(5000)
    let outcome: string | undefined
    void service.deliver('s1', 'save your notes', undefined, { interruptWith: 'wrap up' })?.then((value) => { outcome = value })
    expect(shell.written).toEqual(['\u001b'])
    // The CLI redraws its prompt, then falls quiet: the interrupted run ends
    // without a chime, and the input box is emptied before the line, because
    // Claude Code puts the interrupted prompt back in it.
    shell.emit({ kind: 'data', data: 'Interrupted by user' })
    await vi.advanceTimersByTimeAsync(1500)
    expect(shell.written).toEqual(['\u001b', '\u0015'.repeat(32)])
    await vi.advanceTimersByTimeAsync(100)
    expect(shell.written).toEqual(['\u001b', '\u0015'.repeat(32), 'wrap up'])
    await vi.advanceTimersByTimeAsync(150)
    expect(shell.written).toEqual(['\u001b', '\u0015'.repeat(32), 'wrap up', '\r'])
    expect(chimes).toEqual([])
    // The wrap-up is the answer, and it chimes as a finished turn.
    await print(5000)
    await vi.advanceTimersByTimeAsync(2000)
    expect(outcome).toBe('answered')
    expect(chimes).toEqual(['agent-finished'])
  })

  it('gives an agent at its prompt the save line, with no key pressed first', async () => {
    const { service, shell } = await openAgentShell()
    void service.deliver('s1', 'save your notes', undefined, { interruptWith: 'wrap up' })
    await vi.advanceTimersByTimeAsync(150)
    expect(shell.written).toEqual(['save your notes', '\r'])
  })

  it('takes a reported Claude turn as working, closes it with no chime, and types once the prompt has been quiet', async () => {
    const { service, shell, chimes } = await openAgentShell()
    expect(service.turn('s1', 'open')).toBe(true)
    service.turn('s1', 'start')
    let outcome: string | undefined
    void service.deliver('s1', 'save your notes', undefined, { interruptWith: 'wrap up' })?.then((value) => { outcome = value })
    expect(shell.written).toEqual(['\u001b'])
    // Claude Code runs no Stop hook for an interrupted turn. This one printed
    // nothing after the key, so the line goes in once the quiet has passed.
    await vi.advanceTimersByTimeAsync(1750)
    await vi.advanceTimersByTimeAsync(250)
    expect(shell.written).toEqual(['\u001b', '\u0015'.repeat(32), 'wrap up', '\r'])
    service.turn('s1', 'start')
    service.turn('s1', 'stop')
    await vi.advanceTimersByTimeAsync(0)
    expect(outcome).toBe('answered')
    // One chime, for the wrap-up turn; none for the turn the pause cut short.
    expect(chimes).toEqual(['agent-finished'])
  })
})
