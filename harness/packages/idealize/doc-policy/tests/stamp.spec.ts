// The `generated` stamp and "Mark as checked", over the real file tools, the
// real local filesystem and the real observation policy: an agent's write or
// edit of a note in the documentation folder gains the stamp, and nothing
// else does.
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import * as FsPolicy from '@deepseek-ai/dsh-fs-observation-policy'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import * as docPolicy from '../src/index.ts'
import {
  DEFAULT_STAMP_EXCLUDE, USER_ACTOR, agentActor, applyGeneratedStamp, isStampExcluded, markChecked, mutatingAgent, pathWithin, readTrust,
} from '../src/index.ts'

const NOW = new Date('2026-11-16T10:00:00.123Z')
const AT = '2026-11-16T10:00:00Z'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  vi.useRealTimers()
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

interface FakeSession {
  header: { cwd?: string; agentPreset?: string }
  events: Array<{ type: string; data?: unknown }>
  requestHeader: () => { config: { model?: string } } | undefined
}

const sessionOf = (overrides: Partial<FakeSession> = {}): FakeSession => ({
  header: { agentPreset: 'idealize-build' },
  events: [],
  requestHeader: () => ({ config: { model: 'model-x' } }),
  ...overrides,
})

async function compose(config: Partial<docPolicy.DocPolicyConfig> = {}): Promise<{ ctx: Context; vault: string; repo: string }> {
  root = await realpath(await mkdtemp(join(tmpdir(), 'idealize-doc-policy-stamp-')))
  const vault = join(root, 'vault')
  const repo = join(root, 'repo')
  await mkdir(join(vault, 'Projects', 'acme', 'sessions'), { recursive: true })
  await mkdir(repo, { recursive: true })
  const ctx = new Context()
  context = ctx
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(LocalFileSystem, { cwd: repo })
  await ctx.plugin(FsPolicy)
  await ctx.plugin(ToolFs)
  await ctx.plugin(docPolicy, { documentationFolder: vault, ...config })
  await ctx.docPolicy.scan()
  return { ctx, vault, repo }
}

let calls = 0
async function call(ctx: Context, name: string, args: unknown, session: FakeSession | null = sessionOf()): Promise<string> {
  const result = await ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId(`stamp-${String(++calls)}`),
    name,
    arguments: args,
    ...session === null ? {} : { agent: { session } as never },
  })
  const text = result.content.map(block => (block.type === 'text' ? block.text : '')).join('')
  if (result.isError) throw new Error(text)
  return text
}

/** Wait for the stamp, which lands after the tool has returned. */
async function settled(path: string, expectStamp: boolean): Promise<string> {
  if (expectStamp) await vi.waitFor(async () => { expect(await readFile(path, 'utf8')).toContain('generated:') }, 2_000)
  else await new Promise(resolve => setTimeout(resolve, 150))
  return readFile(path, 'utf8')
}

describe('the generated stamp over the real file tools', () => {
  it('an agent\'s write gains generated, and the rest of the file is the agent\'s bytes', async () => {
    const { ctx, vault } = await compose()
    const path = join(vault, 'Projects', 'acme', 'plan.md')
    const content = '---\nproject: acme\ntype: plan\n---\n# Plan\n\nShip on Friday.\n'
    await call(ctx, 'write', { file_path: path, content })
    const text = await settled(path, true)
    const generated = readTrust(text).generated
    expect(generated?.by).toBe('idealize/idealize-build/model-x')
    expect(Number.isNaN(Date.parse(generated?.at ?? ''))).toBe(false)
    expect(text).toBe(content.replace('type: plan\n---', `type: plan\ngenerated: { by: ${String(generated?.by)}, at: ${String(generated?.at)} }\n---`))
    // The stamp leaves no temporary file beside the note.
    expect((await readdir(join(vault, 'Projects', 'acme'))).sort()).toEqual(['plan.md', 'sessions'])
  })

  it('the same agent can edit the note again without re-reading it, and the stamp follows the latest writer', async () => {
    const { ctx, vault } = await compose()
    const path = join(vault, 'Reference', 'colour.md')
    await call(ctx, 'write', { file_path: path, content: '# Colour\n\nUse heliotrope.\n' })
    expect(await settled(path, true))
      .toMatch(/^---\ngenerated: \{ by: idealize\/idealize-build\/model-x, at: \S+ \}\n---\n# Colour\n\nUse heliotrope\.\n$/)

    const session = sessionOf({
      events: [{ type: 'idealize/brain', data: { brain: 'Design Lead' } }],
      requestHeader: () => ({ config: { model: 'vendor/model-y' } }),
    })
    // A second chat must read before it edits, as for any file; its edit is then stamped as its own.
    await call(ctx, 'read', { file_path: path }, session)
    await call(ctx, 'edit', { file_path: path, old_string: 'heliotrope', new_string: 'ultramarine' }, session)
    await vi.waitFor(async () => { expect(await readFile(path, 'utf8')).toContain('Design-Lead') }, 2_000)
    // The stamp is recorded for the chat that wrote, so its next edit is not refused as stale.
    await call(ctx, 'edit', { file_path: path, old_string: 'ultramarine', new_string: 'viridian' }, session)
    await vi.waitFor(async () => { expect(await readFile(path, 'utf8')).toContain('viridian') }, 2_000)
    const text = await readFile(path, 'utf8')
    expect(readTrust(text).generated?.by).toBe('idealize/Design-Lead/vendor/model-y')
    expect(text.match(/generated:/g)).toHaveLength(1)
  })

  it('never stamps a file under sessions/, a file outside the folder, a non-Markdown file, or a read', async () => {
    const { ctx, vault, repo } = await compose()
    const transcript = join(vault, 'Projects', 'acme', 'sessions', '2026-11-16-chat.md')
    const outside = join(repo, 'README.md')
    const data = join(vault, 'Reference', 'table.csv')
    const seen = join(vault, 'Reference', 'seen.md')
    await writeFile(seen, '# Seen\n')
    await call(ctx, 'write', { file_path: transcript, content: '# Chat\n' })
    await call(ctx, 'write', { file_path: outside, content: '# Repo\n' })
    await call(ctx, 'write', { file_path: data, content: 'a,b\n' })
    await call(ctx, 'read', { file_path: seen })
    expect(await settled(transcript, false)).toBe('# Chat\n')
    expect(await readFile(outside, 'utf8')).toBe('# Repo\n')
    expect(await readFile(data, 'utf8')).toBe('a,b\n')
    expect(await readFile(seen, 'utf8')).toBe('# Seen\n')
  })

  it('never stamps a write that no agent made', async () => {
    const { ctx, vault } = await compose()
    const path = join(vault, 'Reference', 'mine.md')
    // The user's own write: on disk directly, and through the registry with no agent.
    await writeFile(path, '# Mine\n')
    expect(await settled(path, false)).toBe('# Mine\n')
    const direct = join(vault, 'Reference', 'direct.md')
    await call(ctx, 'write', { file_path: direct, content: '# Direct\n' }, null)
    expect(await settled(direct, false)).toBe('# Direct\n')
  })

  it('follows the stampExclude setting, and stamps sessions/ once the user removes it', async () => {
    const { ctx, vault } = await compose({ stampExclude: ['Reference/imported'] })
    expect(ctx.docPolicy.stampExclude()).toEqual(['Reference/imported'])
    await mkdir(join(vault, 'Reference', 'imported'), { recursive: true })
    const imported = join(vault, 'Reference', 'imported', 'paper.md')
    const transcript = join(vault, 'Projects', 'acme', 'sessions', 'chat.md')
    await call(ctx, 'write', { file_path: imported, content: '# Paper\n' })
    await call(ctx, 'write', { file_path: transcript, content: '# Chat\n' })
    expect(await settled(transcript, true)).toContain('generated:')
    expect(await readFile(imported, 'utf8')).toBe('# Paper\n')
  })

  it('defaults stampExclude to sessions/', async () => {
    const { ctx } = await compose()
    expect(DEFAULT_STAMP_EXCLUDE).toEqual(['sessions/'])
    expect(ctx.docPolicy.stampExclude()).toEqual(['sessions/'])
    // A settings document written before the field existed carries none: the default still applies.
    Object.assign(ctx.docPolicy, { source: () => ({}) })
    expect(ctx.docPolicy.stampExclude()).toEqual(['sessions/'])
  })
})

describe('applyGeneratedStamp against a stub filesystem', () => {
  async function stub(options: { folder?: () => string | undefined; version?: () => string | undefined } = {}): Promise<{
    ctx: Context
    path: string
    warnings: unknown[]
    emit: (version: string, actor?: object) => void
  }> {
    root = await realpath(await mkdtemp(join(tmpdir(), 'idealize-doc-policy-stub-')))
    const path = join(root, 'note.md')
    await writeFile(path, '# Note\n')
    const ctx = new Context()
    context = ctx
    const version = options.version ?? (() => 'v1')
    ctx.provide('fs', { stat: () => Promise.resolve(version() === undefined ? undefined : { version: version(), type: 'file' }) } as never)
    const warnings: unknown[] = []
    await ctx.plugin({
      name: 'stamp-under-test',
      inject: ['fs'],
      apply(inner: Context) {
        inner.logger.warn = (message: unknown) => { warnings.push(message) }
        applyGeneratedStamp(inner, { folder: options.folder ?? (() => root), stampExclude: () => [] }, () => NOW)
      },
    })
    const actor = { name: 'write', arguments: {}, agent: { session: sessionOf() } }
    const emit = (observed: string, by: object = actor): void => {
      ctx.emit('fs/observed', { targetKey: path, displayPath: path } as never, { kind: 'present', version: observed } as never, by)
    }
    return { ctx, path, warnings, emit }
  }

  it('stamps with the pinned clock, whole seconds', async () => {
    const { path, emit } = await stub()
    emit('v1')
    expect(await settled(path, true)).toBe(`---\ngenerated: { by: idealize/idealize-build/model-x, at: ${AT} }\n---\n# Note\n`)
  })

  it('leaves a file that changed again after the write it is stamping', async () => {
    const { path, emit } = await stub({ version: () => 'v2' })
    emit('v1')
    expect(await settled(path, false)).toBe('# Note\n')
  })

  it('does nothing with no documentation folder, an absent observation, or no actor', async () => {
    const { ctx, path, emit } = await stub({ folder: () => undefined })
    emit('v1')
    ctx.emit('fs/observed', { targetKey: path, displayPath: path } as never, { kind: 'absent' }, { name: 'write', agent: { session: sessionOf() } })
    ctx.emit('fs/observed', { targetKey: path, displayPath: path } as never, { kind: 'present', version: 'v1' } as never, undefined)
    expect(await settled(path, false)).toBe('# Note\n')
  })

  it('logs a failed stamp and leaves the agent\'s text', async () => {
    const { ctx, path, warnings, emit } = await stub()
    await chmod(root!, 0o500)
    try {
      emit('v1')
      await vi.waitFor(() => { expect(warnings.length).toBeGreaterThan(0) }, 2_000)
    } finally {
      await chmod(root!, 0o700)
    }
    expect(await readFile(path, 'utf8')).toBe('# Note\n')
    expect(String(warnings[0])).toContain('stamping `generated` failed')
    await ctx.fiber.dispose()
    context = undefined
  })
})

describe('mutatingAgent and agentActor', () => {
  const agent = { session: sessionOf() }

  it('names the agent for a write, an edit, and the editor\'s mutating commands only', () => {
    expect(mutatingAgent({ name: 'write', agent })).toBe(agent)
    expect(mutatingAgent({ name: 'edit', agent })).toBe(agent)
    for (const command of ['create', 'str_replace', 'insert']) {
      expect(mutatingAgent({ name: 'str_replace_editor', arguments: { command }, agent })).toBe(agent)
    }
    expect(mutatingAgent({ name: 'str_replace_editor', arguments: { command: 'view' }, agent })).toBeUndefined()
    expect(mutatingAgent({ name: 'str_replace_editor', arguments: null, agent })).toBeUndefined()
    expect(mutatingAgent({ name: 'read', agent })).toBeUndefined()
    expect(mutatingAgent({ name: 'write' })).toBeUndefined()
    expect(mutatingAgent(undefined)).toBeUndefined()
  })

  it('reads the brain from the chat\'s record, then its preset selection, then its header', () => {
    expect(agentActor({ session: sessionOf() })).toBe('idealize/idealize-build/model-x')
    expect(agentActor({ session: sessionOf({ events: [{ type: 'agent-preset/selected', data: { agentPreset: 'idealize-write' } }] }) }))
      .toBe('idealize/idealize-write/model-x')
    expect(agentActor({
      session: sessionOf({
        events: [
          { type: 'idealize/brain', data: { brain: 'first' } },
          { type: 'agent-preset/selected', data: { agentPreset: 'idealize-write' } },
          { type: 'idealize/brain', data: { brain: ' My  Brain ' } },
          { type: 'idealize/brain' },
        ],
      }),
    })).toBe('idealize/idealize-write/model-x')
  })

  it('leaves out what the session does not record', () => {
    expect(agentActor({ session: sessionOf({ header: {} }) })).toBe('idealize/model-x')
    expect(agentActor({ session: sessionOf({ requestHeader: () => undefined }) })).toBe('idealize/idealize-build')
    expect(agentActor({ session: sessionOf({ header: {}, requestHeader: () => ({ config: { model: ' ' } }) }) })).toBe('idealize/agent')
  })
})

describe('pathWithin and isStampExcluded', () => {
  it('resolves symlinks on both sides and refuses what is outside', async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'idealize-doc-policy-within-')))
    const vault = join(root, 'vault')
    await mkdir(join(vault, 'Projects', 'acme'), { recursive: true })
    await writeFile(join(vault, 'Projects', 'acme', 'n.md'), '')
    await writeFile(join(root, 'outside.md'), '')
    await symlink(vault, join(root, 'link'), 'dir')
    expect(await pathWithin(join(root, 'link'), join(vault, 'Projects', 'acme', 'n.md'))).toBe('Projects/acme/n.md')
    expect(await pathWithin(vault, join(root, 'link', 'Projects', 'acme', 'n.md'))).toBe('Projects/acme/n.md')
    expect(await pathWithin(vault, join(root, 'outside.md'))).toBeUndefined()
    expect(await pathWithin(vault, vault)).toBeUndefined()
    expect(await pathWithin(vault, join(vault, 'gone.md'))).toBeUndefined()
    expect(await pathWithin(vault, 'Projects/acme/n.md')).toBeUndefined()
  })

  it('matches a folder of the given name at any depth, and a path from the root', () => {
    expect(isStampExcluded('sessions/a.md', ['sessions/'])).toBe(true)
    expect(isStampExcluded('Projects/acme/sessions/a.md', ['sessions/'])).toBe(true)
    expect(isStampExcluded('Projects/acme/sessions.md', ['sessions/'])).toBe(false)
    expect(isStampExcluded('Projects/acme/my-sessions/a.md', ['sessions'])).toBe(false)
    expect(isStampExcluded('Projects/Jacq/notes/a.md', ['/Projects/Jacq/'])).toBe(true)
    expect(isStampExcluded('Projects/acme/a.md', ['', ' / ', 'Projects/Jacq'])).toBe(false)
  })
})

describe('markChecked', () => {
  it('adds the user to verified with the date and keeps the rest of the note and its mode', async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'idealize-doc-policy-checked-')))
    const path = join(root, 'note.md')
    await writeFile(path, '---\nproject: acme\ngenerated: { by: idealize/build/model-x, at: 2026-11-01T00:00:00Z }\n---\n# Note\n')
    await chmod(path, 0o600)
    expect(await markChecked(path, NOW)).toEqual({ ok: true, by: USER_ACTOR, at: AT })
    expect(await readFile(path, 'utf8')).toBe(
      '---\nproject: acme\ngenerated: { by: idealize/build/model-x, at: 2026-11-01T00:00:00Z }\n'
      + `verified:\n  - { by: human:user, at: ${AT} }\n---\n# Note\n`,
    )
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect(await readdir(root)).toEqual(['note.md'])
  })

  it('refuses a file that is not Markdown or cannot be read, and writes nothing', async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'idealize-doc-policy-checked-')))
    await writeFile(join(root, 'data.csv'), 'a,b\n')
    expect(await markChecked(join(root, 'data.csv'))).toEqual({ ok: false, reason: 'not-markdown' })
    expect(await markChecked(join(root, 'gone.md'))).toEqual({ ok: false, reason: 'unreadable' })
    expect(await readdir(root)).toEqual(['data.csv'])
  })

  it('the service method records the user on a real note', async () => {
    const { ctx, vault } = await compose()
    const path = join(vault, 'Reference', 'checked.md')
    await writeFile(path, '# Checked\n')
    const result = await ctx.docPolicy.markChecked(path)
    expect(result.ok).toBe(true)
    expect(readTrust(await readFile(path, 'utf8')).verified?.[0]?.by).toBe('human:user')
  })
})
