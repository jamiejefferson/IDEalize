/**
 * The weekly documentation review, offered at setup (JJ, 16 Nov 2026): the
 * bundled `vault-review` skill, the `idealize-vault-review` settings section
 * (folders to skip, folders never to edit, and the calendar entry the person
 * accepted), the calendar entry itself, and the check that stops the review's
 * chat writing into a never-edit folder.
 *
 * Nothing is scheduled until the person accepts. Accepting saves one weekly
 * task in `@idealize/cron`, Monday 08:00 in the host's zone, whose workspace is
 * the documentation folder and whose instructions name the skill and carry the
 * two folder lists. A changed list or a changed documentation folder rewrites
 * the entry's instructions and workspace.
 *
 * @module @idealize/setup/review
 */

import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import type { FileSystem, FsTarget } from '@deepseek-ai/dsh-fs'
// Type-only: the `skills` Context merge the bundled provider waits for.
import type {} from '@deepseek-ai/dsh-skill'
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem'
// Type-only: the `idealizeCron` Context merge and the task types.
import type { CronTask, Schedule } from '@idealize/cron'
// Type-only: the `docPolicy` Context merge (the documentation folder).
import type {} from '@idealize/doc-policy'

/** The settings namespace the weekly review owns. */
export const REVIEW_SETTINGS_NAMESPACE = 'idealize-vault-review'

const NS = settingsNamespace(REVIEW_SETTINGS_NAMESPACE)

/** The name the bundled skill registers under, as its `SKILL.md` frontmatter states it. */
export const REVIEW_SKILL_NAME = 'vault-review'

/** The provider name the bundled skills register under. */
export const BUNDLED_SKILLS_PROVIDER_NAME = 'idealize-bundled'

/** The calendar entry's title. */
export const REVIEW_TASK_NAME = 'Weekly documentation review'

/** The entry's time of day, in the host's zone. */
export const REVIEW_TIME = '08:00'

/** The entry's weekday: Monday (0 = Sunday). */
export const REVIEW_DAY = 1

/** Folders the review never edits when the person has listed none: the chat transcripts IDEalize writes. */
export const DEFAULT_NEVER_EDIT_FOLDERS: readonly string[] = ['sessions']

/** The durable `idealize-vault-review` section. */
export interface ReviewSettings {
  /**
   * Folders the review neither reads nor reports on, relative to the documentation folder. A rule that starts with
   * {@link ANY_DEPTH} matches at any depth.
   */
  skipFolders?: string[]
  /**
   * Folders the review may read and never change, written the same way. Absent means
   * {@link DEFAULT_NEVER_EDIT_FOLDERS}; an empty list means none.
   */
  neverEditFolders?: string[]
  /** The calendar entry the person accepted; absent until they accept. */
  taskId?: string
}

/** Runtime schema for {@link ReviewSettings}. */
export const ReviewSettingsSchema: z<ReviewSettings> = z.object({
  skipFolders: z.array(z.string()).default([]),
  neverEditFolders: z.array(z.string()).default([...DEFAULT_NEVER_EDIT_FOLDERS]),
  taskId: z.string(),
})

/** The two folder lists with their defaults applied. */
export interface ReviewFolders {
  /** Folders the review skips. */
  skipFolders: readonly string[]
  /** Folders the review never edits. */
  neverEditFolders: readonly string[]
}

/** The marker that makes a folder rule match at any depth: two asterisks and a slash, before the folder's name. */
export const ANY_DEPTH = '**/'

/** One rule as written, trimmed of spaces, a leading `./` and trailing slashes. */
function tidyRule(rule: string): string {
  return rule.trim().replace(/^\.\//, '').replace(/\/+$/, '')
}

/**
 * Why one folder rule cannot be used.
 * @param rule - the rule as stored.
 * @returns a plain sentence, or undefined when the rule is usable.
 */
export function folderRuleProblem(rule: string): string | undefined {
  const tidy = tidyRule(rule)
  const path = tidy.startsWith(ANY_DEPTH) ? tidy.slice(ANY_DEPTH.length) : tidy
  if (path === '' || path === '**') return `"${rule}" names no folder.`
  if (path.startsWith('/') || /^[a-zA-Z]:/.test(path)) return `"${rule}" must be written relative to the documentation folder.`
  if (path.split('/').some(segment => segment === '' || segment === '.' || segment === '..' || segment === '**')) {
    return `"${rule}" must be a plain folder path, with **/ only at the start.`
  }
  return undefined
}

/**
 * Apply the defaults to a stored section.
 * @param settings - the stored section.
 * @returns the two lists, each rule tidied and empty rules dropped.
 */
export function resolveReviewFolders(settings: ReviewSettings): ReviewFolders {
  const tidy = (rules: readonly string[]): string[] => rules.map(tidyRule).filter(rule => rule !== '')
  return {
    skipFolders: tidy(settings.skipFolders ?? []),
    neverEditFolders: tidy(settings.neverEditFolders ?? DEFAULT_NEVER_EDIT_FOLDERS),
  }
}

/**
 * The first rule that covers one file. A rule covers every file inside its
 * folder; a rule that starts with {@link ANY_DEPTH} covers a folder of that name at any depth. Names compare
 * without regard to case, because the default macOS file system does.
 * @param relativePath - the file's path relative to the documentation folder, `/`-separated.
 * @param rules - the folder rules.
 * @returns the covering rule as written, or undefined when none covers the file.
 */
export function matchingFolderRule(relativePath: string, rules: readonly string[]): string | undefined {
  const folders = relativePath.toLowerCase().split('/').slice(0, -1)
  const covers = (segments: string[], from: number): boolean => segments.every((segment, index) => folders[from + index] === segment)
  for (const rule of rules) {
    const tidy = tidyRule(rule).toLowerCase()
    const anyDepth = tidy.startsWith(ANY_DEPTH)
    const segments = (anyDepth ? tidy.slice(ANY_DEPTH.length) : tidy).split('/')
    const starts = anyDepth ? folders.map((_folder, index) => index) : [0]
    if (starts.some(from => covers(segments, from))) return rule
  }
  return undefined
}

/**
 * The instructions the calendar entry sends at each run.
 * @param folders - the two folder lists.
 * @returns the message: which skill to follow, and the settings for the run.
 */
export function reviewPrompt(folders: ReviewFolders): string {
  const list = (rules: readonly string[]): string => rules.length === 0 ? 'none' : rules.map(rule => `\`${rule}\``).join(', ')
  return [
    `Run the weekly review of this documentation folder. Load the \`${REVIEW_SKILL_NAME}\` skill with the skill tool and follow it exactly.`,
    '',
    'Settings for this run:',
    `- Folders to skip: ${list(folders.skipFolders)}`,
    `- Folders never to edit: ${list(folders.neverEditFolders)}`,
  ].join('\n')
}

/**
 * The schedule the offer proposes.
 * @param timeZone - the host's IANA zone.
 * @returns Monday at 08:00 in that zone, every week.
 */
export function reviewSchedule(timeZone: string): Schedule {
  return { kind: 'weekly', at: REVIEW_TIME, timeZone, days: [REVIEW_DAY] }
}

/**
 * The directory holding the skills this package ships (`skills/<name>/SKILL.md`, one level above both `src/` and `lib/`).
 * @returns the absolute directory path.
 */
export function bundledSkillsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'skills')
}

/** The weekly review as the setup flow shows it. */
export interface ReviewOffer {
  /** The documentation folder the review runs in; absent until one is chosen. */
  folder?: string
  /** The schedule: the accepted entry's own, else the one the offer proposes. */
  schedule: Schedule
  /** Whether the person accepted and the calendar still holds the entry. */
  accepted: boolean
  /** Whether the accepted entry is switched on. */
  enabled: boolean
  /** The folders the review skips. */
  skipFolders: readonly string[]
  /** The folders the review never edits. */
  neverEditFolders: readonly string[]
}

/** The session a tool call runs in, read from the opaque `fs/*` event actor. */
interface ReviewActor {
  agent?: { session?: { id?: unknown } }
}

/**
 * The weekly review's offer and its limits. One instance per setup plugin,
 * held by the plugin body: the route and the documentation-folder write are
 * its only callers, so it is no Cordis service.
 *
 * - {@link offer} reads; nothing is scheduled by reading.
 * - {@link accept} is the only call that creates the calendar entry.
 * - {@link sync} keeps an accepted entry's instructions and workspace in step
 *   with the settings and the documentation folder.
 * - While the entry's chat runs, a `write` or `edit` tool call on a file inside
 *   a never-edit folder is refused before the file is touched.
 */
export class WeeklyReview {
  private scope: SettingsScope<ReviewSettings> | undefined
  /** The running review chats and the folder each runs in, by calendar entry id. */
  private readonly runs = new Map<string, { sessionId: string; folder: string }>()

  /**
   * @param ctx - the plugin context; the settings section registers when a
   * settings provider is composed and detaches with it, and every listener
   * is released with the context.
   */
  constructor(private readonly ctx: Context) {
    ctx.inject(['settings'], (sctx) => {
      const scope = sctx.settings.register(NS, ReviewSettingsSchema, {
        validate: (value) => {
          const { skipFolders, neverEditFolders } = resolveReviewFolders(value)
          const problem = [...skipFolders, ...neverEditFolders].map(folderRuleProblem).find(found => found !== undefined)
          if (problem !== undefined) throw new Error(`idealize-vault-review: ${problem}`)
        },
      })
      this.scope = scope
      sctx.effect(() => scope.watch(() => this.sync()), 'idealize-setup: weekly review settings watch')
      sctx.effect(() => () => {
        this.scope = undefined
      }, 'idealize-setup: weekly review settings detach')
    })
    ctx.on('idealize/cron-run-started', (task, sessionId) => {
      if (task.id === this.section().taskId) this.runs.set(task.id, { sessionId, folder: task.cwd })
    })
    ctx.on('idealize/cron-run', (_run, task) => {
      this.runs.delete(task.id)
    })
    ctx.inject(['fs'], (fsCtx) => {
      // Prepended: the observation policy owns the decision and never calls
      // next(), so a refusal has to come before it.
      fsCtx.on('fs/write-intent', async (target, actor, next) => {
        await this.assertEditable(fsCtx.fs, target, actor)
        return next()
      }, { prepend: true })
      fsCtx.on('fs/edit-intent', async (target, actor, next) => {
        await this.assertEditable(fsCtx.fs, target, actor)
        return next()
      }, { prepend: true })
    })
  }

  /** The current section, `{}` while no settings provider is composed. */
  private section(): ReviewSettings {
    return this.scope?.get() ?? {}
  }

  /**
   * The two folder lists with their defaults applied.
   * @returns the lists the next run's instructions carry.
   */
  folders(): ReviewFolders {
    return resolveReviewFolders(this.section())
  }

  /** The accepted calendar entry, or undefined when none was accepted or it has since been deleted. */
  private async task(): Promise<CronTask | undefined> {
    const taskId = this.section().taskId
    if (taskId === undefined || taskId === '') return undefined
    return (await this.ctx.get('idealizeCron')?.store.tasks())?.find(task => task.id === taskId)
  }

  /**
   * The offer as it stands.
   * @returns the folder, the schedule, whether the person accepted, and the folder lists.
   */
  async offer(): Promise<ReviewOffer> {
    const folder = this.ctx.get('docPolicy')?.folder()
    const task = await this.task()
    return {
      ...folder === undefined ? {} : { folder },
      schedule: task?.schedule ?? reviewSchedule(Intl.DateTimeFormat().resolvedOptions().timeZone),
      accepted: task !== undefined,
      enabled: task?.enabled === true,
      ...this.folders(),
    }
  }

  /**
   * The person accepts the offer: save the weekly entry, switched on, with the
   * documentation folder as its workspace. Accepting again switches an entry
   * the person had turned off back on and keeps the time they gave it.
   * @returns the offer after the write.
   * @throws a plain sentence when no documentation folder is chosen, the calendar is not composed, or the calendar refuses the folder.
   */
  async accept(): Promise<ReviewOffer> {
    const folder = this.ctx.get('docPolicy')?.folder()
    if (folder === undefined) throw new Error('Choose a documentation folder first. The weekly review runs in it.')
    const cron = this.ctx.get('idealizeCron')
    if (cron === undefined) throw new Error('The schedule is not part of this build, so the weekly review cannot be set up.')
    if (this.scope === undefined) throw new Error('idealize-setup: no settings provider is composed, so the weekly review cannot be stored')
    const existing = await this.task()
    const task = await cron.saveTask({
      ...existing,
      name: existing?.name ?? REVIEW_TASK_NAME,
      schedule: existing?.schedule ?? reviewSchedule(Intl.DateTimeFormat().resolvedOptions().timeZone),
      prompt: reviewPrompt(this.folders()),
      cwd: folder,
      enabled: true,
    })
    await this.scope.update({ taskId: task.id })
    return this.offer()
  }

  /**
   * Bring an accepted entry's instructions and workspace in step with the
   * settings and the documentation folder. Does nothing before the person
   * accepts, or when nothing differs. A refusal from the calendar is logged:
   * the entry keeps what it had.
   */
  async sync(): Promise<void> {
    const cron = this.ctx.get('idealizeCron')
    const folder = this.ctx.get('docPolicy')?.folder()
    const existing = await this.task()
    if (cron === undefined || folder === undefined || existing === undefined) return
    const prompt = reviewPrompt(this.folders())
    if (existing.prompt === prompt && existing.cwd === folder) return
    try {
      await cron.saveTask({ ...existing, prompt, cwd: folder })
    } catch (error) {
      this.ctx.logger.warn('idealize-setup: the weekly review entry could not be updated (it keeps its instructions and folder)')
      this.ctx.logger.warn(error)
    }
  }

  /**
   * Refuse a `write` or `edit` from the review's chat on a file inside a
   * never-edit folder. Every other chat, and every file outside the
   * documentation folder, passes: the sandbox confines the review's chat to
   * the folder.
   * @throws a sentence the model reads as the tool's failure.
   */
  private async assertEditable(fs: FileSystem, target: FsTarget, actor: object | undefined): Promise<void> {
    const sessionId = (actor as ReviewActor | undefined)?.agent?.session?.id
    const run = [...this.runs.values()].find(candidate => candidate.sessionId === sessionId)
    if (run === undefined) return
    const folder = await fs.resolve(run.folder)
    if (!fs.contains(folder, target)) return
    const inside = relative(fs.processPath(folder), fs.processPath(target))
    const rule = matchingFolderRule(inside.split(sep).join('/'), this.folders().neverEditFolders)
    if (rule === undefined) return
    throw new Error(`The weekly review may not change files in "${rule}", so ${target.displayPath} was left as it was. `
      + 'Report what you found there under Flagged and carry on.')
  }
}

/**
 * Install the weekly review on a plugin context: its settings section, its
 * listeners and, while a skill registry is composed, the provider that
 * registers the bundled `vault-review` skill.
 * @param ctx - host plugin context.
 * @returns the review the plugin body's route and folder write call.
 */
export function installWeeklyReview(ctx: Context): WeeklyReview {
  const review = new WeeklyReview(ctx)
  ctx.inject(['skills'], (sctx) => {
    sctx.plugin(SkillFileSystem, {
      providerName: BUNDLED_SKILLS_PROVIDER_NAME,
      includeDefaultRoots: false,
      bundledSkillDir: bundledSkillsDir(),
      watch: false,
    })
  })
  return review
}
