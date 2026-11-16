/**
 * The vault plugin over a real git repo and a real project note: what a
 * closing session appends, when it stays silent, and what the reconcile
 * endpoint answers.
 */

import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { promisify } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import { projectNoteFor } from '@idealize/doc-policy'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, commitsSince } from '../src/index.ts'

const run = promisify(execFile)

const scratches: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  for (const context of contexts.splice(0)) await context.fiber.dispose()
  for (const scratch of scratches.splice(0)) await rm(scratch, { recursive: true, force: true })
})

/** A git repo holding one commit per subject, oldest first. */
async function repoWith(subjects: string[]): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), 'idealize-vault-repo-'))
  scratches.push(repo)
  await run('git', ['-C', repo, 'init', '-q', '-b', 'main'])
  await run('git', ['-C', repo, 'config', 'user.email', 'spec@idealize.test'])
  await run('git', ['-C', repo, 'config', 'user.name', 'Vault Spec'])
  for (const subject of subjects) {
    await writeFile(join(repo, `${subject.replace(/\W+/g, '-')}.txt`), subject)
    await run('git', ['-C', repo, 'add', '-A'])
    await run('git', ['-C', repo, 'commit', '-q', '-m', subject])
  }
  return repo
}

/** A documentation folder holding one project note pointed at `repo`. */
/**
 * A project note as IDEalize scaffolded it before the log moved to `log.md`:
 * the current template with its closing `## Log` section replaced by the old
 * `## Session log` section and the two lines the old template shipped there.
 */
function legacyNote(note: string): string {
  return `${note.slice(0, note.indexOf('## Log\n'))}## Session log\n\n`
    + 'Maintained automatically by `scripts/session-close.py`. Commits land here with\n'
    + 'their short hashes; nothing else should be written in this section by hand.\n'
}

async function folderFor(repo: string, lastTouched = '2020-01-01'): Promise<{ folder: string; note: string }> {
  const folder = await mkdtemp(join(tmpdir(), 'idealize-vault-docs-'))
  scratches.push(folder)
  const dir = join(folder, 'Projects', 'p')
  await mkdir(dir, { recursive: true })
  const note = join(dir, '_index.md')
  await writeFile(note, projectNoteFor('p', repo, lastTouched))
  return { folder, note }
}

type Handler = (req: { headers: Record<string, string> }, res: FakeResponse) => Promise<void>

class FakeResponse {
  status = 0
  body = ''
  writeHead(status: number) { this.status = status; return this }
  end(chunk?: string) { if (chunk !== undefined) this.body += chunk }
}

/** One host root with the three services the vault may acquire. */
async function mount(folder: string | undefined, scan: () => Promise<void> = async () => {}) {
  const ctx = new Context()
  contexts.push(ctx)
  const scans: number[] = []
  const infos: string[] = []
  const warnings: unknown[] = []
  const handlers = new Map<string, Handler>()

  ctx.provide('docPolicy', {
    folder: () => folder,
    scan: async () => { scans.push(scans.length + 1); await scan() },
  } as never)
  ctx.provide('settings', {
    register: () => ({ get: () => ({}), watch: () => () => {} }),
  } as never)
  ctx.provide('webServer', {
    register(route: { path: string; handler: Handler }) {
      handlers.set(route.path, route.handler)
      return () => { handlers.delete(route.path) }
    },
  } as never)
  ctx.logger.info = ((message: string) => { infos.push(message) }) as typeof ctx.logger.info
  ctx.logger.warn = ((message: unknown) => { warnings.push(message) }) as typeof ctx.logger.warn

  const fiber = ctx.plugin({ name: 'idealize-vault', inject: [...(await import('../src/index.ts')).inject], apply }, { projectsRoot: join(tmpdir(), 'projects') })
  await fiber.await()

  // A chat nobody has spoken in: the Markdown copy has nothing to write, so these tests read the commit evidence alone.
  const quiet = { events: [], deriveMessages: () => [] }
  const flush = (cwd: string | undefined) => { ctx.emit('session/flush', { header: { id: 's1', cwd }, ...quiet } as never) }
  // An empty host stands for a request that carries no Host header at all.
  const call = async (host: string) => {
    const handler = handlers.get('/idealize/vault/reconcile')
    if (handler === undefined) throw new Error('the reconcile route was never registered')
    const res = new FakeResponse()
    await handler({ headers: host === '' ? {} : { host } }, res)
    return res
  }
  /** One request to the migrate route: its method, headers and raw body. */
  const migrate = async (method: string, headers: Record<string, string>, body = '') => {
    const handler = handlers.get('/idealize/vault/migrate-log')
    if (handler === undefined) throw new Error('the migrate route was never registered')
    const res = new FakeResponse()
    await handler(Object.assign(Readable.from(body === '' ? [] : [Buffer.from(body)]), { method, headers }) as never, res)
    return res
  }
  return { ctx, fiber, flush, call, migrate, scans, infos, warnings }
}

/**
 * The vault route's answer, decoded.
 * @param body - the route's JSON body.
 * @returns whether a vault is configured and the notes it reports stale.
 */
function answerOf(body: string): { configured: boolean; stale: Record<string, unknown>[] } {
  return JSON.parse(body) as { configured: boolean; stale: Record<string, unknown>[] }
}

describe('commitsSince', () => {
  it('reads a repo’s commits oldest first, and can start from a date', async () => {
    const repo = await repoWith(['first change', 'second change'])
    const all = await commitsSince(repo, undefined)
    expect(all.map(commit => commit.subject)).toEqual(['first change', 'second change'])
    expect(all[0]?.hash).toMatch(/^[0-9a-f]{7,}$/)
    // Every commit here was made today, so today's window still holds both.
    const since = await commitsSince(repo, all[0]!.date)
    expect(since).toHaveLength(2)
  })
})

describe('a session closing over a documented repo', () => {
  it('appends the commits, advances the note, and refreshes the docs index', async () => {
    const repo = await repoWith(['the first commit'])
    const { folder, note } = await folderFor(repo)
    const { fiber, flush, scans, infos } = await mount(folder)

    flush(repo)
    await fiber.dispose()

    const { hash, date } = (await commitsSince(repo, undefined))[0]!
    const log = await readFile(join(folder, 'Projects', 'p', 'log.md'), 'utf8')
    expect(log).toBe(`---\ntype: log\nproject: p\ncreated: ${date}\n---\n# p log\n\n`
      + 'IDEalize adds a line here for each commit a chat ends with, and for each chat that ends with changed files and no commit.\n'
      + `\n## ${date}\n\n- \`${hash}\` "the first commit"\n`)
    // The note changes in its date alone.
    expect(await readFile(note, 'utf8')).toBe(projectNoteFor('p', repo, '2020-01-01').replace('last_touched: 2020-01-01', `last_touched: ${date}`))
    expect(scans).toHaveLength(1)
    expect(infos[0]).toBe(`idealize-vault: appended 1 commit(s) to ${join(folder, 'Projects', 'p', 'log.md')}`)

    // A later save with no new commit writes nothing.
    const again = await mount(folder)
    again.flush(repo)
    await again.fiber.dispose()
    expect(await readFile(join(folder, 'Projects', 'p', 'log.md'), 'utf8')).toBe(log)
    expect(again.scans).toEqual([])
  })

  it('keeps a Markdown copy of the chat in the project note’s folder', async () => {
    const repo = await repoWith(['a commit'])
    const { folder } = await folderFor(repo)
    const { ctx, fiber } = await mount(folder)
    const messages = [
      { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Name the colours' }] },
      { role: 'assistant', source: { kind: 'model', provider: 'p', model: 'gpt-5.5' }, content: [{ type: 'text', text: 'Ink and Linen.' }] },
    ]
    const session = {
      header: { id: 'session-0000-abcd1234', cwd: repo },
      events: [{ type: 'session', time: Date.parse('2026-09-21T12:00:00Z') }, { type: 'session/title', data: { title: 'Palette' } }],
      deriveMessages: () => messages,
    }
    ctx.emit('session/flush', session as never)
    await fiber.dispose()

    const files = await readdir(join(folder, 'Projects', 'p', 'sessions'))
    expect(files).toEqual(['2026-09-21-palette-abcd1234.md'])
    const text = await readFile(join(folder, 'Projects', 'p', 'sessions', files[0] ?? ''), 'utf8')
    expect(text).toContain('## You\n\nName the colours')
    expect(text).toContain('## gpt-5.5\n\nInk and Linen.')
  })

  it('checks once per 15 seconds, however often the session flushes', async () => {
    const repo = await repoWith(['the only commit'])
    const { folder } = await folderFor(repo)
    const { ctx, fiber, scans } = await mount(folder)

    const session = { header: { id: 's1', cwd: repo }, events: [], deriveMessages: () => [] }
    ctx.emit('session/flush', session as never)
    ctx.emit('session/flush', session as never)
    await fiber.dispose()

    expect(scans).toHaveLength(1)
  })

  it('writes nothing when the commits are already in the note', async () => {
    const repo = await repoWith(['a recorded commit'])
    const { folder, note } = await folderFor(repo)
    const { hash } = (await commitsSince(repo, undefined))[0]!
    await writeFile(note, `${await readFile(note, 'utf8')}\n- \`${hash}\` already here\n`)
    const { fiber, flush, scans } = await mount(folder)

    flush(repo)
    await fiber.dispose()
    expect(scans).toEqual([])
  })

  it('stays silent with no documentation folder, no cwd, no repo, or no note', async () => {
    const repo = await repoWith(['unrecorded'])
    const unconfigured = await mount(undefined)
    unconfigured.flush(repo)
    await unconfigured.fiber.dispose()
    expect(unconfigured.scans).toEqual([])

    const { folder } = await folderFor(repo)
    const configured = await mount(folder)
    configured.flush(undefined)
    // A directory that is no repository, a folder that is gone, and a repository no note claims.
    configured.flush(tmpdir())
    configured.flush(join(tmpdir(), 'idealize-vault-nowhere'))
    const other = await repoWith(['elsewhere'])
    configured.flush(other)
    await configured.fiber.dispose()
    expect(configured.scans).toEqual([])
  })

  it('reports its own failure to the log and leaves the session alone', async () => {
    const repo = await repoWith(['a commit the index refuses'])
    const { folder } = await folderFor(repo)
    const { fiber, flush, warnings } = await mount(folder, () => Promise.reject(new Error('the docs index is locked')))

    flush(repo)
    await vi.waitFor(() => { expect(warnings.length).toBeGreaterThan(0) })
    await fiber.dispose()
    expect(warnings[0]).toBe('idealize-vault: session documentation failed (session unaffected)')
  })
})

describe('the reconcile endpoint', () => {
  it('answers loopback alone', async () => {
    const { call } = await mount(undefined)
    expect((await call('example.com')).status).toBe(403)
    expect((await call('')).status).toBe(403)
    expect((await call('127.0.0.1:3180')).status).toBe(200)
    expect((await call('[::1]')).status).toBe(200)
  })

  it('says so when no documentation folder is configured', async () => {
    const { call } = await mount(undefined)
    expect(JSON.parse((await call('localhost:3180')).body)).toEqual({ configured: false, stale: [] })
  })

  it('marks a note whose repo pointer no longer reads as a repository', async () => {
    const repo = await repoWith(['a commit'])
    const { folder, note } = await folderFor(repo)
    // The folder still exists, so realpath succeeds; git has nothing to say
    // about it, which is the second way a pointer goes bad.
    await writeFile(note, projectNoteFor('p', tmpdir(), '2020-01-01'))
    const missing = await folderFor(repo)
    await writeFile(missing.note, projectNoteFor('p', join(tmpdir(), 'idealize-vault-gone'), '2020-01-01'))

    const notARepo = answerOf((await (await mount(folder)).call('127.0.0.1:3180')).body)
    expect(notARepo.stale).toEqual([{ note, repo: tmpdir(), lastTouched: '2020-01-01', commitsBehind: -1 }])

    const gone = answerOf((await (await mount(missing.folder)).call('127.0.0.1:3180')).body)
    expect(gone.stale[0]).toMatchObject({ commitsBehind: -1 })
  })

  it('names the notes their repos have moved ahead of', async () => {
    const repo = await repoWith(['a commit the note never saw'])
    const { folder, note } = await folderFor(repo)
    const { call } = await mount(folder)

    const answer = answerOf((await call('127.0.0.1:3180')).body)
    expect(answer.configured).toBe(true)
    expect(answer.stale).toEqual([{ note, repo, lastTouched: '2020-01-01', commitsBehind: 1 }])
  })

  it('leaves out a note that already records everything its repo holds', async () => {
    const repo = await repoWith(['a commit the note records'])
    const { folder, note } = await folderFor(repo)
    const { hash } = (await commitsSince(repo, undefined))[0]!
    await writeFile(note, `${await readFile(note, 'utf8')}\n- \`${hash}\` already here\n`)

    expect(answerOf((await (await mount(folder)).call('127.0.0.1:3180')).body).stale).toEqual([])
  })

  it('leaves out a note whose log file records everything its repo holds', async () => {
    const repo = await repoWith(['a commit the log records'])
    const { folder } = await folderFor(repo)
    const { hash } = (await commitsSince(repo, undefined))[0]!
    await writeFile(join(folder, 'Projects', 'p', 'log.md'), `## 2026-11-16\n\n- \`${hash}\` "a commit the log records"\n`)

    expect(answerOf((await (await mount(folder)).call('127.0.0.1:3180')).body).stale).toEqual([])
  })
})

describe('the migrate-log endpoint', () => {
  const auth = { 'host': '127.0.0.1:3180', 'x-idealize-auth': '1' }

  it('moves a legacy section when asked, and refreshes the docs index', async () => {
    const repo = await repoWith(['a commit'])
    const { folder, note } = await folderFor(repo)
    await writeFile(note, `${legacyNote(await readFile(note, 'utf8'))}- 2026-08-02 \`abc1234\` "an old commit"\n`)
    const { migrate, scans } = await mount(folder)

    const moved = await migrate('POST', auth, JSON.stringify({ note }))
    expect(moved.status).toBe(200)
    expect(JSON.parse(moved.body)).toEqual({ moved: 1, log: join(await realpath(folder), 'Projects', 'p', 'log.md') })
    expect(await readFile(join(folder, 'Projects', 'p', 'log.md'), 'utf8')).toContain('## 2026-08-02\n\n- `abc1234` "an old commit"')
    expect(await readFile(note, 'utf8')).toContain('## Session log\n\nThe session log is in [log.md](log.md).\n')
    expect(scans).toHaveLength(1)

    // Asked again, it finds nothing to move and leaves the index alone.
    expect(JSON.parse((await migrate('POST', auth, JSON.stringify({ note }))).body)).toMatchObject({ moved: 0 })
    expect(scans).toHaveLength(1)
  })

  it('answers loopback POSTs that carry the app header, and nothing else', async () => {
    const repo = await repoWith(['a commit'])
    const { folder, note } = await folderFor(repo)
    const { migrate } = await mount(folder)
    expect((await migrate('POST', { 'host': 'example.com', 'x-idealize-auth': '1' }, JSON.stringify({ note }))).status).toBe(403)
    expect((await migrate('POST', { 'x-idealize-auth': '1' }, JSON.stringify({ note }))).status).toBe(403)
    expect((await migrate('GET', auth)).status).toBe(405)
    expect((await migrate('POST', { host: 'localhost' }, JSON.stringify({ note }))).status).toBe(403)
    expect((await migrate('POST', auth, 'not json')).status).toBe(400)
    expect((await migrate('POST', auth, 'null')).status).toBe(400)
    expect((await migrate('POST', auth, JSON.stringify({ note: 7 }))).status).toBe(400)
    expect(await readFile(note, 'utf8')).toBe(projectNoteFor('p', repo, '2020-01-01'))
    expect((await (await mount(undefined)).migrate('POST', auth, JSON.stringify({ note }))).status).toBe(409)
  })

  it('refuses a path that is not a project index in the documentation folder', async () => {
    const repo = await repoWith(['a commit'])
    const { folder } = await folderFor(repo)
    const { migrate } = await mount(folder)
    const outside = join(repo, '_index.md')
    await writeFile(outside, '# Outside\n\n## Session log\n- 2026-08-02 `abc1234` "kept"\n')
    await writeFile(join(folder, 'Projects', 'p', 'plan.md'), '# Plan\n\n## Session log\n- 2026-08-02 `abc1234` "kept"\n')
    for (const note of [outside, join(folder, 'Projects', 'p', 'plan.md'), join(folder, 'Projects', 'gone', '_index.md')]) {
      expect((await migrate('POST', auth, JSON.stringify({ note }))).status).toBe(404)
    }
    expect(await readFile(outside, 'utf8')).toContain('"kept"')
    // A documentation folder with no Projects folder holds no project index.
    const bare = await mkdtemp(join(tmpdir(), 'idealize-vault-bare-'))
    scratches.push(bare)
    expect((await (await mount(bare)).migrate('POST', auth, JSON.stringify({ note: outside }))).status).toBe(404)
  })
})

describe('the chat copy and the 15-second window', () => {
  it('writes the state of a save that landed inside the window', async () => {
    const repo = await repoWith(['a commit'])
    const { folder } = await folderFor(repo)
    const { ctx, fiber } = await mount(folder)
    const messages: unknown[] = [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Name the colours' }] }]
    const session = {
      header: { id: 'session-0000-abcd1234', cwd: repo },
      events: [{ type: 'session', time: Date.parse('2026-09-21T12:00:00Z') }],
      deriveMessages: () => messages,
    }
    ctx.emit('session/flush', session as never)
    // The reply arrives a moment later, inside the window the first save opened.
    messages.push({ role: 'assistant', source: { kind: 'model', provider: 'p', model: 'gpt-5.5' }, content: [{ type: 'text', text: 'Ink and Linen.' }] })
    ctx.emit('session/flush', session as never)
    await fiber.dispose()

    const dir = join(folder, 'Projects', 'p', 'sessions')
    const text = await readFile(join(dir, (await readdir(dir))[0] ?? ''), 'utf8')
    expect(text).toContain('Ink and Linen.')
  })
})

describe('a chat that changes files and commits nothing', () => {
  const day = (): string => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  }
  const uncommitted = (log: string): string[] => log.split('\n').filter(line => line.includes('(uncommitted)'))

  /** One mounted vault and one chat in `repo`; each `save` is a flush the 15-second window lets through. */
  async function chat(repo: string, folder: string, spoken: boolean) {
    const mounted = await mount(folder)
    const clock = vi.spyOn(Date, 'now')
    let ahead = 0
    const real = performance.timeOrigin
    clock.mockImplementation(() => Math.round(real + performance.now()) + ahead)
    const session = {
      header: { id: 'session-0000-abcd1234', cwd: repo },
      events: spoken ? [{ type: 'session', time: Date.parse('2026-09-21T12:00:00Z') }, { type: 'session/title', data: { title: 'Palette' } }] : [],
      deriveMessages: () => (spoken ? [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Name the colours' }] }] : []),
    }
    const save = (): void => {
      ahead += 16_000
      mounted.ctx.emit('session/flush', session as never)
    }
    const log = (): Promise<string> => readFile(join(folder, 'Projects', 'p', 'log.md'), 'utf8')
    /** The first save: it records the repo's one commit, and the scan that follows shows the first reading is taken. */
    const open = async (): Promise<void> => {
      save()
      await vi.waitFor(() => { expect(mounted.scans).toHaveLength(1) })
    }
    return { ...mounted, save, log, open }
  }

  afterEach(() => { vi.restoreAllMocks() })

  it('gets one line, however often it saves, and its later commit gets the usual line', async () => {
    const repo = await repoWith(['the first commit'])
    const { folder } = await folderFor(repo)
    const { fiber, save, log, open, scans } = await chat(repo, folder, true)
    await open()

    await writeFile(join(repo, 'sketch.css'), 'body {}')
    save()
    const line = '- "Palette": 1 file changed (uncommitted). [Transcript](sessions/2026-09-21-palette-abcd1234.md)'
    await vi.waitFor(async () => { expect(uncommitted(await log())).toEqual([line]) })
    expect((await log()).endsWith(`## ${day()}\n\n- \`${(await commitsSince(repo, undefined))[0]!.hash}\` "the first commit"\n${line}\n`)).toBe(true)
    expect(scans).toHaveLength(2)

    save()
    save()
    save()
    await writeFile(join(repo, 'the-first-commit.txt'), 'edited by the chat')
    save()
    await vi.waitFor(async () => { expect(uncommitted(await log())).toEqual([line.replace('1 file', '2 files')]) })

    await run('git', ['-C', repo, 'add', '-A'])
    await run('git', ['-C', repo, 'commit', '-q', '-m', 'the chat commits'])
    await writeFile(join(repo, 'after.txt'), 'left after the commit')
    save()
    await vi.waitFor(async () => { expect(await log()).toContain('"the chat commits"') })
    save()
    await fiber.dispose()
    expect(uncommitted(await log())).toEqual([line.replace('1 file', '2 files')])
  })

  it('gets no line when it changes nothing', async () => {
    const repo = await repoWith(['the first commit'])
    const { folder } = await folderFor(repo)
    const { fiber, save, log, open, scans } = await chat(repo, folder, true)
    await open()
    save()
    save()
    await fiber.dispose()
    expect(uncommitted(await log())).toEqual([])
    expect(scans).toHaveLength(1)
  })

  it('gets no line for a file that was already uncommitted, until the chat changes that file', async () => {
    const repo = await repoWith(['the first commit'])
    const { folder } = await folderFor(repo)
    await writeFile(join(repo, 'the-first-commit.txt'), 'edited before the chat')
    await writeFile(join(repo, 'draft.md'), 'left from last week')
    const first = await chat(repo, folder, false)
    await first.open()
    first.save()
    await first.fiber.dispose()
    expect(uncommitted(await first.log())).toEqual([])
    vi.restoreAllMocks()

    // The chat's copy is written after the working tree is read, so its file shows the first reading is taken.
    const second = await chat(repo, folder, true)
    second.save()
    await vi.waitFor(async () => { expect(await readdir(join(folder, 'Projects', 'p', 'sessions'))).toHaveLength(1) })
    await writeFile(join(repo, 'draft.md'), 'left from last week, and picked up again')
    second.save()
    await second.fiber.dispose()
    expect(uncommitted(await second.log())).toEqual(['- "Palette": 1 file changed (uncommitted). [Transcript](sessions/2026-09-21-palette-abcd1234.md)'])
  })

  it('starts the log itself when no commit has', async () => {
    const repo = await repoWith(['a recorded commit'])
    const { folder, note } = await folderFor(repo)
    const { hash } = (await commitsSince(repo, undefined))[0]!
    await writeFile(note, `${await readFile(note, 'utf8')}- 2020-01-01 \`${hash}\` "a recorded commit"\n`)
    const { fiber, save, log, infos } = await chat(repo, folder, true)
    save()
    await vi.waitFor(async () => { expect(await readdir(join(folder, 'Projects', 'p', 'sessions'))).toHaveLength(1) })
    await writeFile(join(repo, 'sketch.css'), 'body {}')
    save()
    await fiber.dispose()
    expect(infos).toEqual([])
    expect(await log()).toBe(`---\ntype: log\nproject: p\ncreated: ${day()}\n---\n# p log\n\n`
      + 'IDEalize adds a line here for each commit a chat ends with, and for each chat that ends with changed files and no commit.\n'
      + `\n## ${day()}\n\n- "Palette": 1 file changed (uncommitted). [Transcript](sessions/2026-09-21-palette-abcd1234.md)\n`)
  })

  it('writes the line without a link for a chat that has no copy', async () => {
    const repo = await repoWith(['the first commit'])
    const { folder } = await folderFor(repo)
    const { fiber, save, log, open } = await chat(repo, folder, false)
    await open()
    await writeFile(join(repo, 'sketch.css'), 'body {}')
    save()
    await fiber.dispose()
    expect(uncommitted(await log())).toEqual(['- "Untitled chat": 1 file changed (uncommitted).'])
  })

  it('writes a chat’s copy and no log for a project outside git', async () => {
    const plain = await realpath(await mkdtemp(join(tmpdir(), 'idealize-vault-plain-')))
    scratches.push(plain)
    const { folder } = await folderFor(plain)
    const { fiber, save } = await chat(plain, folder, true)
    save()
    await writeFile(join(plain, 'sketch.css'), 'body {}')
    save()
    await fiber.dispose()
    expect(await readdir(join(folder, 'Projects', 'p'))).toEqual(['_index.md', 'sessions'])
  })

  it('keeps the line an earlier run of the app wrote for the same chat', async () => {
    const repo = await repoWith(['the first commit'])
    const { folder } = await folderFor(repo)
    const first = await chat(repo, folder, true)
    await first.open()
    await writeFile(join(repo, 'sketch.css'), 'body {}')
    first.save()
    await first.fiber.dispose()
    const written = uncommitted(await first.log())
    expect(written).toHaveLength(1)
    vi.restoreAllMocks()

    await run('git', ['-C', repo, 'add', '-A'])
    await run('git', ['-C', repo, 'commit', '-q', '-m', 'between runs'])
    const second = await chat(repo, folder, true)
    await second.open()
    await writeFile(join(repo, 'more.css'), 'main {}')
    second.save()
    await writeFile(join(repo, 'again.css'), 'nav {}')
    second.save()
    await second.fiber.dispose()
    expect(uncommitted(await second.log())).toEqual(written)
  })

  it('does not count what IDEalize itself writes when the documentation folder is inside the repository', async () => {
    const repo = await realpath(await repoWith(['the first commit']))
    const folder = join(repo, 'docs')
    await mkdir(join(folder, 'Projects', 'p'), { recursive: true })
    await writeFile(join(folder, 'Projects', 'p', '_index.md'), projectNoteFor('p', repo, '2020-01-01'))
    const { fiber, save, log, open } = await chat(repo, folder, true)
    await open()
    save()
    await fiber.dispose()
    expect(uncommitted(await log())).toEqual([])
  })

  it('still records commits when the working tree cannot be read, and says so in the log', async () => {
    const repo = await repoWith(['the first commit'])
    const { folder } = await folderFor(repo)
    await writeFile(join(repo, '.git', 'index'), 'not an index')
    const { fiber, log, open, warnings } = await chat(repo, folder, false)
    await open()
    await fiber.dispose()
    expect(await log()).toContain('"the first commit"')
    expect(String(warnings[0])).toContain('idealize-vault: uncommitted changes were not read:')
  })
})
