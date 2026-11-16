// The weekly review over a real settings document, doc-policy, the calendar,
// the skill registry and the local filesystem: the offer stays off until the
// person accepts, accepting saves one Monday 08:00 entry whose workspace is the
// documentation folder, the bundled skill is listed, a changed setting or
// folder rewrites the entry, and the review's own chat is refused a write into
// a never-edit folder.
import { mkdir, mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import FileSettingsProvider from '@deepseek-ai/dsh-settings-file'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import * as cron from '@idealize/cron'
import * as docPolicy from '@idealize/doc-policy'
import * as vault from '@idealize/vault'
import * as setup from '../src/index.ts'
import {
  bundledSkillsDir,
  DEFAULT_NEVER_EDIT_FOLDERS,
  folderRuleProblem,
  matchingFolderRule,
  resolveReviewFolders,
  REVIEW_SETTINGS_NAMESPACE,
  REVIEW_SKILL_NAME,
  REVIEW_TASK_NAME,
  reviewPrompt,
} from '../src/index.ts'
import { PLANTED, writeReviewFixture } from './review-fixture.ts'

const REVIEW_NS = settingsNamespace(REVIEW_SETTINGS_NAMESPACE)
const DOCS_NS = settingsNamespace('idealize-docs')

const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  for (const context of contexts.splice(0)) await context.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/** What one fake scheduled chat does with its instructions. */
type Chat = (sessionId: string, cwd: string, prompt: string) => Promise<void>

interface BootOptions {
  /** Leave the calendar out of the composition. */
  cron?: false
  /** Leave the settings provider out of the composition. */
  settings?: false
  /** Leave the skill registry out of the composition. */
  skills?: false
  /** What the scheduled chat does when its instructions arrive. */
  chat?: Chat
}

/** Boot the composition over a scratch home whose documentation folder is the review fixture. */
async function boot(options: BootOptions = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'idealize-review-')))
  roots.push(root)
  const docs = join(root, 'vault')
  await writeReviewFixture(docs)
  vi.stubEnv('DSH_HOME', join(root, 'home'))

  const ctx = new Context()
  contexts.push(ctx)
  const prompts: string[] = []
  if (options.settings !== false) await ctx.plugin(FileSettingsProvider, { path: join(root, 'settings.yaml'), watch: false })
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: join(root, 'storages') })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  ctx.provide('sessionPersistence', {
    list: async () => [],
    load: () => { throw new Error('unused') },
    inspect: () => { throw new Error('unused') },
  } as never)
  await ctx.plugin(WorkspaceRegistry)
  await ctx.plugin(LocalFileSystem, { cwd: root })
  if (options.skills !== false) await ctx.plugin(SkillRegistry)
  await ctx.plugin(docPolicy, options.settings === false ? { documentationFolder: docs } : {})
  await ctx.plugin(vault, {})
  if (options.cron !== false) {
    // The agent stack a fire needs, faked: the chat receives its session id, folder and instructions.
    ctx.provide('agents', {
      create: async ({ sessionId, meta, setup: prepare }: {
        sessionId: string
        meta: { cwd: string }
        setup: (agentCtx: Context) => void
      }) => {
        prepare(ctx)
        return {
          agent: {
            whenIdle: async () => {},
            inject: () => {},
            followup: (message: { content: { text: string }[] }) => {
              prompts.push(message.content[0]!.text)
              pending = options.chat?.(sessionId, meta.cwd, message.content[0]!.text)
            },
            session: { events: [] },
          },
        }
      },
    } as never)
    ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    ctx.provide('sessions', { flush: async () => { await pending } } as never)
    await ctx.plugin({ name: 'idealize-cron', inject: [], apply: cron.apply }).await()
  }
  let pending: Promise<void> | undefined
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(setup)

  if (options.settings !== false) {
    const deadline = Date.now() + 5_000
    while (ctx.settings.get(REVIEW_NS) === undefined || ctx.settings.get(settingsNamespace('idealize-setup')) === undefined) {
      if (Date.now() > deadline) throw new Error('the setup settings sections never registered')
      await new Promise(resolve => setTimeout(resolve, 25))
    }
  }
  const tasks = async (): Promise<cron.CronTask[]> => ctx.idealizeCron.store.tasks()
  const base = (): string => `http://127.0.0.1:${String(ctx.webServer.port)}/idealize/setup/weekly-review`
  const post = (body: unknown, auth = true): Promise<Response> => fetch(base(), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...auth ? { 'x-idealize-auth': '1' } : {} },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
  /** The offer as the route reports it. */
  const offer = async (): Promise<setup.ReviewOffer> => await (await fetch(base())).json() as setup.ReviewOffer
  /** Accept through the route, as the wizard does; a refusal rejects with the route's own sentence. */
  const accept = async (): Promise<setup.ReviewOffer> => {
    const answer = await (await post({ accept: true })).json() as { ok: boolean; offer: setup.ReviewOffer; error?: string }
    if (!answer.ok) throw new Error(answer.error)
    return answer.offer
  }
  return { ctx, root, docs, prompts, tasks, base, post, offer, accept }
}

/** Wait until `read` answers true; settings watchers run after the write settles. */
async function eventually(read: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 5_000
  while (!await read()) {
    if (Date.now() > deadline) throw new Error('the expected state never arrived')
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}

describe('the review fixture', () => {
  it('plants a stale note, an oversized index and a note with an unrecognised type', async () => {
    const { docs } = await boot({ cron: false })
    const index = await readFile(join(docs, PLANTED.oversizeIndex), 'utf8')
    expect(index.length).toBeGreaterThan(9_500)
    expect(index.length).toBeLessThan(10_500)
    const staleAfter = /^stale_after: (.+)$/m.exec(await readFile(join(docs, PLANTED.staleNote), 'utf8'))?.[1]
    expect(Date.parse(staleAfter ?? '')).toBeLessThan(Date.now())
    expect(await readFile(join(docs, PLANTED.listingNote), 'utf8')).toMatch(/^type: listing$/m)
    expect(await readFile(join(docs, PLANTED.bareNote), 'utf8')).not.toMatch(/^---/)
    // The stale note sits outside the review's 7-day window; the bare note sits inside it.
    expect(Date.now() - (await stat(join(docs, PLANTED.staleNote))).mtimeMs).toBeGreaterThan(7 * 24 * 3_600_000)
    expect(Date.now() - (await stat(join(docs, PLANTED.bareNote))).mtimeMs).toBeLessThan(7 * 24 * 3_600_000)
  })
})

describe('folder rules', () => {
  it('cover a folder by path, or by name at any depth, without regard to case', () => {
    expect(matchingFolderRule('sessions/2026-11-13-chat.md', ['sessions'])).toBe('sessions')
    expect(matchingFolderRule('Sessions/deep/chat.md', ['./sessions/'])).toBe('./sessions/')
    expect(matchingFolderRule('Projects/Lighthouse/Meetings/monday.md', ['**/Meetings'])).toBe('**/Meetings')
    expect(matchingFolderRule('Projects/Lighthouse/Meetings/monday.md', ['Meetings', 'Projects/Lighthouse/Meetings'])).toBe('Projects/Lighthouse/Meetings')
    expect(matchingFolderRule('Projects/Lighthouse/brief.md', ['**/Meetings', 'sessions'])).toBeUndefined()
    // A file is never taken for the folder it is named like.
    expect(matchingFolderRule('sessions', ['sessions'])).toBeUndefined()
  })

  it('are refused when they leave the documentation folder or name nothing', () => {
    expect(folderRuleProblem('Daily')).toBeUndefined()
    expect(folderRuleProblem('**/Meetings')).toBeUndefined()
    expect(folderRuleProblem('  ')).toMatch(/names no folder/)
    expect(folderRuleProblem('**/')).toMatch(/names no folder/)
    expect(folderRuleProblem('/Users/someone')).toMatch(/relative to the documentation folder/)
    expect(folderRuleProblem('C:\\notes')).toMatch(/relative to the documentation folder/)
    expect(folderRuleProblem('../elsewhere')).toMatch(/plain folder path/)
    expect(folderRuleProblem('Projects/**/Meetings')).toMatch(/plain folder path/)
  })

  it('default to never editing the chat transcripts, and to skipping nothing', () => {
    expect(resolveReviewFolders({})).toEqual({ skipFolders: [], neverEditFolders: [...DEFAULT_NEVER_EDIT_FOLDERS] })
    expect(resolveReviewFolders({ skipFolders: [' Archive/ ', ''], neverEditFolders: [] })).toEqual({ skipFolders: ['Archive'], neverEditFolders: [] })
  })

  it('reach the model in the entry\'s instructions', () => {
    expect(reviewPrompt({ skipFolders: [], neverEditFolders: ['sessions', '**/Meetings'] })).toBe([
      'Run the weekly review of this documentation folder. Load the `vault-review` skill with the skill tool and follow it exactly.',
      '',
      'Settings for this run:',
      '- Folders to skip: none',
      '- Folders never to edit: `sessions`, `**/Meetings`',
    ].join('\n'))
  })
})

describe('the bundled skill', () => {
  it('is listed in the skill registry under its own name', async () => {
    const { ctx } = await boot({ cron: false })
    await eventually(async () => (await ctx.skills.list()).some(skill => skill.name === REVIEW_SKILL_NAME))
    const skill = (await ctx.skills.list()).find(candidate => candidate.name === REVIEW_SKILL_NAME)
    expect(skill?.description).toMatch(/^Weekly review of the documentation folder/)
  })

  it('names nothing from the vault it was adapted from', async () => {
    const text = await readFile(join(bundledSkillsDir(), REVIEW_SKILL_NAME, 'SKILL.md'), 'utf8')
    expect(text).not.toMatch(/jacq|airtable|meeting desk|\bJJ\b|active priorities|obsidian/i)
    // The limits the review is trusted with are stated in the skill itself.
    expect(text).toMatch(/Never rename, move or delete a note or a folder/)
    expect(text).toMatch(/Never change the value of a field that already has a value/)
    expect(text).toMatch(/Reference\/Weekly Reviews\/<YYYY-MM-DD>-review\.md/)
  })

  it('is not mounted without a skill registry', async () => {
    const { ctx, offer } = await boot({ cron: false, skills: false })
    expect(ctx.get('skills')).toBeUndefined()
    expect((await offer()).accepted).toBe(false)
  })
})

describe('the offer', () => {
  it('schedules nothing until the person accepts, then saves one Monday 08:00 entry in the documentation folder', async () => {
    const { ctx, docs, tasks, post, offer, accept } = await boot()
    // Before a documentation folder is chosen there is nothing to run in.
    await expect(accept()).rejects.toThrow(/Choose a documentation folder first/)
    expect((await offer()).folder).toBeUndefined()

    await ctx.workspaceAliases.set('documentation', docs)
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    expect(await offer()).toEqual({
      folder: docs,
      schedule: { kind: 'weekly', at: '08:00', timeZone: zone, days: [1] },
      accepted: false,
      enabled: false,
      skipFolders: [],
      neverEditFolders: ['sessions'],
    })
    expect(await tasks()).toEqual([])

    const accepted = await post({ accept: true })
    expect(accepted.status).toBe(200)
    expect((await accepted.json() as { offer: setup.ReviewOffer }).offer).toMatchObject({ accepted: true, enabled: true })
    const [task] = await tasks()
    expect(await tasks()).toHaveLength(1)
    expect(task).toMatchObject({
      name: REVIEW_TASK_NAME,
      schedule: { kind: 'weekly', at: '08:00', timeZone: zone, days: [1] },
      cwd: docs,
      enabled: true,
      prompt: reviewPrompt({ skipFolders: [], neverEditFolders: ['sessions'] }),
    })
    expect(task?.awaitingApproval).toBeUndefined()
    // The next fire is a Monday at 08:00 in the host's zone.
    const next = (await ctx.idealizeCron.taskViews())[0]?.nextFireAt
    expect(cron.zoneWeekday(new Date(next ?? ''), zone)).toBe(1)
    expect(new Date(next ?? '').toLocaleTimeString('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit' })).toBe('08:00')
    expect(ctx.settings.get(REVIEW_NS)).toMatchObject({ taskId: task?.id })
  })

  it('keeps the person\'s own time and switches the entry back on when they accept again', async () => {
    const { ctx, docs, tasks, offer, accept } = await boot()
    await ctx.workspaceAliases.set('documentation', docs)
    await accept()
    const [first] = await tasks()
    await ctx.idealizeCron.saveTask({ ...first, schedule: { kind: 'weekly', at: '17:30', timeZone: 'Europe/London', days: [5] }, enabled: false })
    expect(await offer()).toMatchObject({ accepted: true, enabled: false })

    await accept()
    expect(await tasks()).toHaveLength(1)
    expect((await tasks())[0]).toMatchObject({ id: first?.id, enabled: true, schedule: { at: '17:30', days: [5] } })

    // An entry the person deleted is no longer accepted; accepting makes a new one.
    await ctx.idealizeCron.deleteTask(first?.id ?? '')
    expect((await offer()).accepted).toBe(false)
    await accept()
    expect((await tasks())[0]?.id).not.toBe(first?.id)
  })

  it('is fenced to this machine and the app, and says why it cannot be accepted', async () => {
    const { ctx, docs, post, tasks } = await boot()
    expect((await post({ accept: true }, false)).status).toBe(403)
    // A request that names another host is not this machine's own.
    const foreign = await new Promise<number | undefined>((resolve, reject) => {
      request({ host: '127.0.0.1', port: ctx.webServer.port, path: '/idealize/setup/weekly-review', headers: { host: 'example.com' } }, (res) => {
        res.resume()
        resolve(res.statusCode)
      }).on('error', reject).end()
    })
    expect(foreign).toBe(403)
    expect((await post('not json')).status).toBe(400)
    const off = await post({ accept: false })
    expect(off.status).toBe(400)
    expect((await off.json() as { error: string }).error).toMatch(/switched off in the Schedule pane/)
    // No documentation folder yet.
    const early = await post({ accept: true })
    expect(early.status).toBe(400)
    expect((await early.json() as { error: string }).error).toMatch(/Choose a documentation folder first/)
    // A documentation folder that is the home folder is one the calendar refuses.
    vi.stubEnv('HOME', docs)
    await ctx.workspaceAliases.set('documentation', docs)
    const refused = await post({ accept: true })
    expect(refused.status).toBe(400)
    expect((await refused.json() as { error: string }).error).toMatch(/not a project the person has opened/)
    expect(await tasks()).toEqual([])
  })

  it('cannot be accepted without the calendar or without a settings provider', async () => {
    const bare = await boot({ cron: false })
    await bare.ctx.workspaceAliases.set('documentation', bare.docs)
    await expect(bare.accept()).rejects.toThrow(/schedule is not part of this build/)
    expect(await bare.offer()).toMatchObject({ folder: bare.docs, accepted: false })

    const unsaved = await boot({ settings: false })
    expect((await unsaved.offer()).neverEditFolders).toEqual(['sessions'])
    await expect(unsaved.accept()).rejects.toThrow(/no settings provider is composed/)
  })
})

describe('an accepted entry', () => {
  it('takes a changed folder list and a changed documentation folder', async () => {
    const { ctx, root, docs, tasks, accept } = await boot()
    await ctx.workspaceAliases.set('documentation', docs)
    await accept()

    await ctx.settings.update(REVIEW_NS, { skipFolders: ['Archive'], neverEditFolders: ['sessions', '**/Meetings'] })
    await eventually(async () => (await tasks())[0]?.prompt.includes('`Archive`') === true)
    expect((await tasks())[0]?.prompt).toBe(reviewPrompt({ skipFolders: ['Archive'], neverEditFolders: ['sessions', '**/Meetings'] }))

    const moved = join(root, 'vault-two')
    await mkdir(moved)
    await ctx.workspaceAliases.set('documentation', moved)
    expect((await tasks())[0]).toMatchObject({ cwd: moved, enabled: true })

    // A folder the calendar refuses leaves the entry as it was.
    vi.stubEnv('HOME', docs)
    await ctx.workspaceAliases.set('documentation', docs)
    expect((await tasks())[0]?.cwd).toBe(moved)
  })

  it('refuses a folder list that leaves the documentation folder, and keeps the stored one', async () => {
    const { ctx, offer } = await boot()
    await expect(ctx.settings.update(REVIEW_NS, { neverEditFolders: ['/etc'] })).rejects.toThrow(/relative to the documentation folder/)
    expect((await offer()).neverEditFolders).toEqual(['sessions'])
  })

  it('stops its own chat writing into a never-edit folder, and no other chat', async () => {
    const outcomes: Record<string, string> = {}
    let reviewSession = ''
    const attempt = async (ctx: Context, label: string, sessionId: unknown, path: string): Promise<void> => {
      const target = await ctx.fs.resolve(path)
      const actor = sessionId === undefined ? undefined : { agent: { session: { id: sessionId } } }
      const write = await ctx.waterfall('fs/write-intent', target, actor, () => undefined).then(() => 'allowed', (error: Error) => error.message)
      const edit = await ctx.waterfall('fs/edit-intent', target, actor, () => undefined).then(() => 'allowed', (error: Error) => error.message)
      outcomes[label] = write === edit ? write : `${write} / ${edit}`
    }
    const booted = await boot({
      chat: async (sessionId, cwd) => {
        reviewSession = sessionId
        await attempt(booted.ctx, 'transcript', sessionId, join(cwd, PLANTED.neverEdit))
        await attempt(booted.ctx, 'new file in the folder', sessionId, join(cwd, 'Sessions', 'new.md'))
        await attempt(booted.ctx, 'meeting note', sessionId, join(cwd, 'Projects', 'Lighthouse', 'Meetings', 'monday.md'))
        await attempt(booted.ctx, 'bare note', sessionId, join(cwd, PLANTED.bareNote))
        await attempt(booted.ctx, 'review note', sessionId, join(cwd, 'Reference', 'Weekly Reviews', '2026-11-16-review.md'))
        await attempt(booted.ctx, 'the folder itself', sessionId, cwd)
        await attempt(booted.ctx, 'outside the folder', sessionId, join(cwd, '..', 'sessions', 'elsewhere.md'))
        await attempt(booted.ctx, 'another chat', 'session-someone-else', join(cwd, PLANTED.neverEdit))
        await attempt(booted.ctx, 'no chat', undefined, join(cwd, PLANTED.neverEdit))
      },
    })
    const { ctx, docs, prompts, tasks, accept } = booted
    await ctx.workspaceAliases.set('documentation', docs)
    await ctx.settings.update(REVIEW_NS, { neverEditFolders: ['sessions', '**/Meetings'] })
    await accept()
    // Another entry's chat is no review, whatever folder it runs in.
    const other = await ctx.idealizeCron.saveTask({ name: 'Other', schedule: { kind: 'every', seconds: 3_600 }, prompt: 'Tidy.', cwd: docs })
    await ctx.idealizeCron.fire(other.id)
    expect(outcomes.transcript).toBe('allowed')

    const [task] = await tasks()
    const run = await ctx.idealizeCron.fire(task?.id ?? '')
    expect(run.status).toBe('ok')
    expect(prompts.at(-1)).toBe(task?.prompt)
    expect(outcomes).toEqual({
      transcript: `The weekly review may not change files in "sessions", so ${join(docs, PLANTED.neverEdit)} was left as it was. `
        + 'Report what you found there under Flagged and carry on.',
      'new file in the folder': expect.stringContaining('may not change files in "sessions"') as string,
      'meeting note': expect.stringContaining('may not change files in "**/Meetings"') as string,
      'bare note': 'allowed',
      'review note': 'allowed',
      'the folder itself': 'allowed',
      'outside the folder': 'allowed',
      'another chat': 'allowed',
      'no chat': 'allowed',
    })
    // Once the run has finished, the same session is an ordinary chat again.
    await attempt(ctx, 'after the run', reviewSession, join(docs, PLANTED.neverEdit))
    expect(outcomes['after the run']).toBe('allowed')
    expect(ctx.settings.get(DOCS_NS)).toMatchObject({ documentationFolder: docs })
  })
})
