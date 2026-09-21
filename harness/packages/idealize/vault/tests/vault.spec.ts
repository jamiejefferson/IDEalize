/**
 * The vault plugin over a real git repo and a real project note: what a
 * closing session appends, when it stays silent, and what the reconcile
 * endpoint answers.
 */

import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
  let handler: Handler | undefined

  ctx.provide('docPolicy', {
    folder: () => folder,
    scan: async () => { scans.push(scans.length + 1); await scan() },
  } as never)
  ctx.provide('settings', {
    register: () => ({ get: () => ({}), watch: () => () => {} }),
  } as never)
  ctx.provide('webServer', {
    register(route: { handler: Handler }) { handler = route.handler; return () => { handler = undefined } },
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
    if (handler === undefined) throw new Error('the reconcile route was never registered')
    const res = new FakeResponse()
    await handler({ headers: host === '' ? {} : { host } }, res)
    return res
  }
  return { ctx, fiber, flush, call, scans, infos, warnings }
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

    const markdown = await readFile(note, 'utf8')
    expect(markdown).toContain('the first commit')
    expect(markdown).not.toContain('last_touched: 2020-01-01')
    expect(scans).toHaveLength(1)
    expect(infos[0]).toContain('appended 1 commit(s)')
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
    // A directory that is no repository, and a repository no note claims.
    configured.flush(tmpdir())
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
