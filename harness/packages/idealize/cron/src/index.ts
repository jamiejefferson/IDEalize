/**
 * @idealize/cron — durable scheduled agent runs (`ctx.idealizeCron`), the
 * person's one calendar.
 *
 * Tasks (name, schedule, prompt, workspace, optional model) persist in one
 * JSON document under the Harness home. At fire time the service creates an
 * agent in-process — the same recipe as the dsh-headless runner — in the
 * task's workspace, waits for the turn, and records the outcome plus the
 * session id in run history. A task with an empty prompt is a reminder: its
 * fire runs no agent. A task marked `remind` (every prompt-less task is)
 * raises a desktop notification at each fire through the desktop shell's
 * notify face, the same face `@idealize/notify`'s route uses. A one-off (`at`)
 * task fires once, then records `done` and stays listed. One run per task at
 * a time: an overdue fire while one runs is recorded `skipped-busy`. Fires
 * missed while the server was down are recorded `missed` and never replayed
 * (the spec's default); the next live fire re-arms from the wall clock.
 *
 * Two writers share the document: the Schedule pane over the routes below,
 * and every agent through the `calendar_add` / `calendar_list` /
 * `calendar_remove` tools (`./tools.ts`), whose entries run in the calling
 * chat's project. An entry an agent adds starts paused and fires only once the
 * person approves it in the pane (JJ, 9 Oct 2026). Every committed task-list write
 * emits `idealize/cron-changed`, which the host bridge forwards so the pane refetches.
 *
 * HTTP surface (loopback-fenced; mutations demand `x-idealize-auth: 1`),
 * consumed by the Schedule drawer pane in @idealize/ui-bar:
 * - `GET  /idealize/cron/tasks`      — tasks with their next fire times
 * - `POST /idealize/cron/tasks`      — JSON body: create or update a task
 * - `POST /idealize/cron/delete`     — `?id=`
 * - `POST /idealize/cron/toggle`     — `?id=` flips `enabled`
 * - `POST /idealize/cron/approve`    — `?id=` the person approves an agent's entry
 * - `GET  /idealize/cron/runs`       — `?task=` filters
 *
 * Each completed fire also emits `idealize/cron-run` for the host bridge.
 *
 * @module @idealize/cron
 */

import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Context, Service } from '@deepseek-ai/cordis'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { invalidReason, nextFire } from './schedule.ts'
import { CronStore, cronStorePath } from './store.ts'
import type { CronRun, CronTask } from './store.ts'
import { CALENDAR_SECTION, createCalendarTools, ONE_OFF_REMINDERS_WAIT_FOR_APPROVAL } from './tools.ts'
// Type-only: the prompt registry's Context merge (ctx.systemPrompt).
import type {} from '@deepseek-ai/dsh-system-prompt'
// Type-only: the tool registry's Context merge (ctx.tools).
import type {} from '@deepseek-ai/dsh-tools'

export { invalidReason, nextFire, WEEKDAYS, zoneWeekday } from './schedule.ts'
export type { Schedule } from './schedule.ts'
export { CronStore, cronStorePath } from './store.ts'
export type { CronRun, CronTask, RunStatus } from './store.ts'
export { CALENDAR_SECTION, createCalendarTools, describeSchedule, ONE_OFF_REMINDERS_WAIT_FOR_APPROVAL, scheduleOf } from './tools.ts'
export type { CalendarWriter } from './tools.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    idealizeCron: IdealizeCron
  }
  interface Events {
    /**
     * One scheduled run finished (any status); the host bridge forwards it
     * to the shell's notification feed.
     * @mode emit
     * @param run - The recorded run: status, timing, and the session it ran in.
     * @param task - The task definition that fired.
     */
    'idealize/cron-run'(run: CronRun, task: CronTask): void
    /**
     * The task list changed (a task was added, edited, toggled, deleted, or a
     * one-off recorded done); the host bridge forwards it so the Schedule pane
     * refetches. Carries no payload: the pane reads the routes.
     * @mode emit
     */
    'idealize/cron-changed'(): void
  }
}

/** The desktop shell's notify face, present only when the Electron host offers it. */
export interface CronNotifier {
  notify(notification: { title: string; body: string }): void
}

/** Construction options; production composition passes none. */
export interface IdealizeCronOptions {
  /** Where the task document lives; default `idealize-cron.json` under the resolved harness home. */
  storePath?: string
  /**
   * How a fire reaches the person's screen; probed at each fire because the
   * desktop shell joins the tree after this service. Default: the
   * `desktopActions` service when it offers `notify`.
   */
  notifier?: () => CronNotifier | undefined
}

/**
 * Probe the desktop shell's notify face without injecting it: the service is
 * absent in the browser-only composition.
 * @param ctx - any context in the host tree.
 * @returns the shell's notify face, or undefined when no desktop shell is composed.
 */
export function desktopNotifier(ctx: Context): CronNotifier | undefined {
  const maybe = (ctx as unknown as { get(name: string): unknown }).get('desktopActions')
  return typeof (maybe as CronNotifier | undefined)?.notify === 'function' ? maybe as CronNotifier : undefined
}

/**
 * The notification body for one fire: the wall-clock time in the task's zone
 * (or the host's), e.g. `Tue 8 Sep, 14:00`.
 * @param firedAt - ISO-8601 instant of the fire.
 * @param timeZone - the zone to read it in.
 * @returns the formatted line.
 */
export function fireTimeLine(firedAt: string, timeZone?: string): string {
  return new Date(firedAt).toLocaleString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    ...timeZone === undefined ? {} : { timeZone },
  })
}

/** A task as the HTTP surface reports it. */
export interface TaskView extends CronTask {
  nextFireAt?: string
  running: boolean
}

/** The scheduler: durable tasks, armed timers, and run history behind `ctx.idealizeCron`. */
export class IdealizeCron extends Service {
  /** The durable task list and run history. */
  readonly store: CronStore
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly running = new Set<string>()
  /**
   * Tasks that came due while every agent was paused (feedback 495cec0a). Each
   * runs once on {@link releaseHeld}, however many of its fires the pause
   * covered. Held in memory: a one-off still owed after a restart comes due
   * again as the scheduler re-arms it.
   */
  private readonly owed = new Set<string>()
  private readonly notifier: () => CronNotifier | undefined
  private disposed = false

  constructor(ctx: Context, options: IdealizeCronOptions = {}) {
    super(ctx, 'idealizeCron')
    this.store = new CronStore(options.storePath ?? cronStorePath(resolveDshHome()), () => {
      this.ctx.emit('idealize/cron-changed')
    })
    this.notifier = options.notifier ?? (() => desktopNotifier(this.ctx))
    ctx.effect(() => () => {
      this.disposed = true
      for (const timer of this.timers.values()) clearTimeout(timer)
      this.timers.clear()
    }, 'idealize-cron: clear timers')
    void this.armAll()
  }

  /** Arm (or re-arm) every enabled task from the current wall clock. */
  private async armAll(): Promise<void> {
    for (const task of await this.store.tasks()) this.arm(task)
  }

  /** Arm one task's next fire; disabled tasks just clear their timer. */
  private arm(task: CronTask): void {
    const existing = this.timers.get(task.id)
    if (existing !== undefined) clearTimeout(existing)
    this.timers.delete(task.id)
    if (!task.enabled || task.done !== undefined || this.disposed) return
    const at = nextFire(task.schedule, new Date())
    const delay = Math.max(0, at.getTime() - Date.now())
    // Node timers cap at ~24.8 days; split longer waits.
    const bounded = Math.min(delay, 2_000_000_000)
    const timer = setTimeout(() => {
      if (bounded < delay) {
        this.arm(task)
        return
      }
      this.due(task)
    }, bounded)
    timer.unref()
    this.timers.set(task.id, timer)
  }

  /**
   * Whether every agent is paused, read from `@idealize/comm`'s pause service,
   * probed so the scheduler takes no dependency on it.
   * @returns true while a pause holds agent work.
   */
  private held(): boolean {
    const pause = (this.ctx as unknown as { get(name: string): unknown }).get('idealizePause') as { held?: () => boolean } | undefined
    return pause?.held?.() === true
  }

  /**
   * A task's timer fired. A task that runs an agent waits while every agent is
   * paused, and its next fire is armed as usual; a reminder runs no agent, so
   * the person still hears it. The armed copy is current: every edit re-arms.
   * @param task - the task that came due.
   */
  private due(task: CronTask): void {
    if (task.prompt !== '' && this.held()) {
      this.owed.add(task.id)
      if (task.schedule.kind !== 'at') this.arm(task)
      return
    }
    void this.fire(task.id)
  }

  /**
   * Run, once each, the tasks that came due while every agent was paused. The
   * pause service calls this on Resume.
   * @returns the runs recorded.
   */
  async releaseHeld(): Promise<CronRun[]> {
    const owed = [...this.owed]
    this.owed.clear()
    const runs: CronRun[] = []
    for (const taskId of owed) {
      if ((await this.store.tasks()).some(task => task.id === taskId)) runs.push(await this.fire(taskId))
    }
    return runs
  }

  /**
   * Tasks with computed next fires, for the HTTP surface.
   * @returns every stored task with its next fire time and running flag.
   */
  async taskViews(): Promise<TaskView[]> {
    const tasks = await this.store.tasks()
    return tasks.map(task => ({
      ...task,
      ...task.enabled && task.done === undefined ? { nextFireAt: nextFire(task.schedule, new Date()).toISOString() } : {},
      running: this.running.has(task.id),
    }))
  }

  /**
   * Validate + persist one task and re-arm it. A prompt may be empty only
   * for a reminder (`remind` set): the fire then notifies and runs nothing.
   * A one-off whose instant has passed is refused unless the task already
   * recorded `done`, so renaming a fired reminder still saves.
   * @param input - Task fields from the calendar form or a calendar tool; `id` absent creates a new task.
   * @param origin - who is saving: an agent's new entry starts paused until the person approves it,
   *   and the person's own edit of one leaves it waiting.
   * @returns the stored task after defaults are applied.
   */
  async saveTask(input: Partial<CronTask>, origin: 'person' | 'agent' = 'person'): Promise<CronTask> {
    const schedule = input.schedule
    if (schedule === undefined) throw new Error('task needs a schedule')
    const reason = invalidReason(schedule)
    if (reason !== undefined) throw new Error(reason)
    const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : ''
    const remind = input.remind === true || prompt === ''
    if (prompt === '' && input.remind !== true) throw new Error('task needs a prompt, or remind set for a reminder that runs nothing')
    if (typeof input.cwd !== 'string' || !input.cwd.startsWith('/')) throw new Error('task needs an absolute cwd')
    // Anything with a prompt runs a chat, whether or not it also notifies.
    if (prompt !== '') await this.assertTaskFolder(input.cwd)
    if (schedule.kind === 'at' && input.done === undefined && Date.parse(schedule.at) <= Date.now()) {
      throw new Error(`one-off time ${schedule.at} is in the past`)
    }
    const waiting = origin === 'agent'
      ? prompt !== '' || schedule.kind !== 'at' || ONE_OFF_REMINDERS_WAIT_FOR_APPROVAL
      : input.id !== undefined && (await this.store.tasks()).find(task => task.id === input.id)?.awaitingApproval === true
    const task: CronTask = {
      id: input.id ?? randomUUID(),
      name: typeof input.name === 'string' && input.name !== '' ? input.name : 'Scheduled task',
      schedule,
      prompt,
      cwd: input.cwd,
      ...typeof input.provider === 'string' && input.provider !== '' ? { provider: input.provider } : {},
      ...typeof input.model === 'string' && input.model !== '' ? { model: input.model } : {},
      ...remind ? { remind } : {},
      ...typeof input.done === 'string' ? { done: input.done } : {},
      enabled: !waiting && input.enabled !== false,
      ...waiting ? { awaitingApproval: true } : {},
      createdAt: input.createdAt ?? new Date().toISOString(),
    }
    await this.store.upsertTask(task)
    this.arm(task)
    return task
  }

  /**
   * Disarm and remove one task; its run history stays.
   * @param id - The task to delete.
   * @returns whether a task with that id existed.
   */
  async deleteTask(id: string): Promise<boolean> {
    const existing = this.timers.get(id)
    if (existing !== undefined) clearTimeout(existing)
    this.timers.delete(id)
    return this.store.deleteTask(id)
  }

  /**
   * The person approves an agent's entry: it arms from here on, and needs no
   * further approval. The route is the app's alone (the launch gate keeps a
   * chat's key off it), so no agent can approve its own entry.
   * @param id - The task to approve.
   * @returns the armed task (unchanged when it was not waiting), or undefined when no task has that id.
   * @throws when a one-off's time has passed or its folder is no longer a project.
   */
  async approveTask(id: string): Promise<CronTask | undefined> {
    const task = (await this.store.tasks()).find(candidate => candidate.id === id)
    if (task === undefined || task.awaitingApproval !== true) return task
    if (task.schedule.kind === 'at' && Date.parse(task.schedule.at) <= Date.now()) {
      throw new Error('This entry\'s time has passed. Change the time, then approve it.')
    }
    if (task.prompt !== '') await this.assertTaskFolder(task.cwd)
    const { awaitingApproval: _approved, ...rest } = task
    const next: CronTask = { ...rest, enabled: true }
    await this.store.upsertTask(next)
    this.arm(next)
    return next
  }

  /**
   * Flip one task's enabled flag and re-arm it. Turning on an entry that is
   * waiting for approval is the person approving it.
   * @param id - The task to toggle.
   * @returns the updated task, or undefined when no task has that id.
   */
  async toggleTask(id: string): Promise<CronTask | undefined> {
    const task = (await this.store.tasks()).find(candidate => candidate.id === id)
    if (task === undefined) return undefined
    if (task.awaitingApproval === true) return this.approveTask(id)
    const next = { ...task, enabled: !task.enabled }
    await this.store.upsertTask(next)
    this.arm(next)
    return next
  }

  /**
   * Run one task now (used by fires; callable for a manual "run now"). A
   * reminder (empty prompt) runs no agent; a `remind` task raises the desktop
   * notification (title = task name, body = the time) beside whatever ran. A
   * one-off records `done` before its run is announced, so the pane's refetch
   * already shows it fired.
   * @param taskId - The task to run.
   * @returns the recorded run, `skipped-busy` when the task is already running.
   */
  async fire(taskId: string): Promise<CronRun> {
    const task = (await this.store.tasks()).find(candidate => candidate.id === taskId)
    if (task === undefined) throw new Error(`unknown cron task ${taskId}`)
    if (task.awaitingApproval === true) throw new Error(`${task.name} is waiting for the person to approve it`)
    const firedAt = new Date().toISOString()
    if (this.running.has(task.id)) {
      const run: CronRun = { taskId: task.id, firedAt, status: 'skipped-busy' }
      await this.store.recordRun(run)
      this.arm(task)
      return run
    }
    this.running.add(task.id)
    const started = Date.now()
    if (task.remind === true || task.prompt === '') this.notify(task, firedAt)
    let run: CronRun
    try {
      const { sessionId, errorDetail } = task.prompt === ''
        ? { sessionId: undefined, errorDetail: undefined }
        : await this.runAgent(task)
      run = {
        taskId: task.id,
        firedAt,
        status: errorDetail === undefined ? 'ok' : 'error',
        ...sessionId === undefined ? { detail: 'reminder' } : { sessionId },
        durationMs: Date.now() - started,
        ...errorDetail === undefined ? {} : { detail: errorDetail },
      }
    } catch (error) {
      run = {
        taskId: task.id,
        firedAt,
        status: 'error',
        durationMs: Date.now() - started,
        detail: error instanceof Error ? error.message : String(error),
      }
    } finally {
      this.running.delete(task.id)
    }
    await this.store.recordRun(run)
    const settled = task.schedule.kind === 'at' ? { ...task, done: firedAt } : task
    if (settled !== task) await this.store.upsertTask(settled)
    this.ctx.emit('idealize/cron-run', run, settled)
    this.arm(settled)
    return run
  }

  /** Raise the fire's desktop notification when a shell is present; a missing shell drops it silently. */
  private notify(task: CronTask, firedAt: string): void {
    const zone = task.schedule.kind === 'daily' || task.schedule.kind === 'weekly' ? task.schedule.timeZone : undefined
    try {
      this.notifier()?.notify({ title: task.name, body: fireTimeLine(firedAt, zone) })
    } catch (error) {
      this.ctx.logger.warn(`idealize-cron: notification failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** The dsh-headless recipe, in-process, in the task's workspace. */
  /**
   * A scheduled run is an unattended chat rooted in the task's folder, and a
   * chat may write anywhere under its root; a task in the home folder or above
   * it could rewrite shell profiles while nobody watches (security audit,
   * 9 Oct 2026). A task that runs a chat runs in a project the person has
   * opened or in the app's own folder (Studio and Powell tasks); a reminder
   * runs nothing and may name any folder.
   * @param cwd - the task's absolute folder.
   */
  private async assertTaskFolder(cwd: string): Promise<void> {
    const registry = (this.ctx as unknown as { get(name: string): unknown }).get('workspaceRegistry') as {
      list(): readonly { path: string }[]
    } | undefined
    // A composition without projects (a bare test host) has nothing to fence against.
    if (registry === undefined) return
    // A folder that is not there yet is judged by its spelling; the run itself
    // fails on it later.
    const canonical = await realpath(cwd).catch(() => resolve(cwd))
    const inside = (root: string): boolean => canonical === root || canonical.startsWith(root + sep)
    const roots = [...registry.list().map(workspace => workspace.path), resolveDshHome()]
    if (!roots.some(inside)) throw new Error(`task folder '${cwd}' is not a project the person has opened`)
  }

  /**
   * List a run's chat under the project that owns its folder, as a chat the
   * person starts would be. A run outside every project, or a registry that
   * refuses, leaves the chat where it is: the run itself never fails on it.
   */
  private async fileUnderProject(sessionId: SessionId, cwd: string): Promise<void> {
    // The workspace registry is not a declared dependency; narrow the probe.
    const registry = (this.ctx as unknown as { get(name: string): unknown }).get('workspaceRegistry') as {
      resolveByPath(path: string): Promise<{ attachSession(id: SessionId): Promise<void> } | undefined>
    } | undefined
    try {
      await (await registry?.resolveByPath(cwd))?.attachSession(sessionId)
    } catch (error) {
      this.ctx.logger.warn(`idealize-cron: ${String(sessionId)} could not join its project: ${String(error)}`)
    }
  }

  private async runAgent(task: CronTask): Promise<{ sessionId: string; errorDetail?: string }> {
    // The loader service (cordis-loader) is not a declared dependency; narrow the probe.
    await (this.ctx.get('loader') as { await(): Promise<void> } | undefined)?.await()
    // Checked again here: a task stored before the fence covered `remind`, or
    // whose project has since closed, must not run a chat where it points.
    await this.assertTaskFolder(task.cwd)
    const agents = this.ctx.get('agents')
    const defaultModel = this.ctx.get('agentDefaultModel')
    const sessions = this.ctx.get('sessions')
    if (agents === undefined || defaultModel === undefined || sessions === undefined) {
      throw new Error('agent services unavailable (tree still composing or tearing down)')
    }
    const fallback = defaultModel.currentSelection()
    const selection = {
      provider: task.provider ?? fallback.provider,
      model: task.model ?? fallback.model,
    }
    const sessionId = SessionId(`session-${randomUUID()}`)
    const { agent } = await agents.create({
      sessionId,
      meta: { cwd: task.cwd },
      agentOptions: { provider: selection.provider, model: selection.model },
      setup: (agentCtx) => {
        const selected: ModelSelectionRef = { current: selection, assembled: undefined }
        installModelSelection(agentCtx, selected)
      },
    })
    await this.fileUnderProject(sessionId, task.cwd)
    await agent.whenIdle()
    // Nobody watches a scheduled chat, and the person may have ticked Full access
    // for the chats they run themselves (JJ, 4 Nov 2026). Read by shape: the method
    // is new, and an older presets package without it must still load.
    const permissions = (this.ctx as unknown as { get(name: string): unknown }).get('permissionPresets') as {
      confineStartedChat?(session: typeof agent.session, options: { unattended: boolean }): boolean
    } | undefined
    if (permissions !== undefined && permissions.confineStartedChat === undefined) {
      this.ctx.logger.warn('idealize-cron: this build\'s permission presets cannot confine a scheduled chat')
    }
    if (permissions?.confineStartedChat?.(agent.session, { unattended: true }) === true) {
      agent.inject(createUserMessage({
        content: [{ type: 'text', text: SCHEDULED_CHAT_NOTICE }],
        source: { kind: 'plugin', plugin: 'idealize-cron', form: 'notice', summary: 'Scheduled chat' },
      }))
    }
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: task.prompt }],
      source: { kind: 'user' },
    }))
    await agent.whenIdle()
    await sessions.flush(agent.session)
    let errorDetail: string | undefined
    for (const event of agent.session.events) {
      if (event.type === 'turn/end' && event.data.reason.kind === 'error') {
        errorDetail = `${event.data.reason.error.code}: ${event.data.reason.error.message}`
      }
    }
    // Said here as well as by the model, because the person should not have to
    // open every chat, and a model can leave out what it could not do.
    const blocked = blockedActionOf(agent.session.events)
    if (blocked !== undefined) {
      try {
        this.notifier()?.notify({ title: task.name, body: blocked })
      } catch (error) {
        this.ctx.logger.warn(`idealize-cron: notification failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    const detail = errorDetail ?? blocked
    return { sessionId: String(sessionId), ...detail === undefined ? {} : { errorDetail: detail } }
  }
}

/**
 * What a scheduled chat knows before its instructions. It reaches the model as a
 * plugin notice, so the chat can say in its own words what it could not do.
 */
export const SCHEDULED_CHAT_NOTICE = 'This chat runs on a schedule and nobody is watching it. You can change files only inside its project folder, '
  + 'and you cannot ask for permission, so anything that needs permission is refused at once. '
  + 'If something you were asked to do is refused, carry on with what you can, then say in plain words what you could not change and why.'

/** The start of the line the sandbox adds to a tool result when it denies a file (restates `sandboxDenialMarker`). */
const SANDBOX_DENIAL = '[sandbox: file access denied under'

/**
 * What a scheduled chat was stopped from doing, read from its log. A refused file
 * access says so in the tool result, and a refused action leaves its audit pair.
 * @param events - the finished run's session events.
 * @returns the sentence for the run's detail and the notification, or undefined when nothing was stopped.
 */
export function blockedActionOf(events: readonly { type: string; data?: unknown }[]): string | undefined {
  let refused = false
  for (const event of events) {
    if (event.type === 'tool/result' && JSON.stringify(event.data ?? null).includes(SANDBOX_DENIAL)) {
      return 'This scheduled chat tried to change a file outside its project, '
        + 'and scheduled chats can only change files inside their project folder. '
        + 'Open the chat to see what it tried.'
    }
    if (event.type === 'approval/decided' && (event.data as { outcome?: unknown } | undefined)?.outcome !== 'allowed-once') refused = true
  }
  return refused
    ? 'This scheduled chat tried something that needs your permission, and scheduled chats cannot ask for it. Open the chat to see what it tried.'
    : undefined
}

/** Loopback + custom-header fence, same posture as the provider pack's. */
function refuse(req: IncomingMessage, res: ServerResponse, mutating: boolean): boolean {
  const hostname = (req.headers.host ?? '').replace(/:\d+$/, '')
  if (hostname !== '127.0.0.1' && hostname !== 'localhost' && hostname !== '[::1]') {
    res.writeHead(403, { 'content-type': 'text/plain' }).end('loopback only')
    return true
  }
  if (mutating && req.headers['x-idealize-auth'] !== '1') {
    res.writeHead(403, { 'content-type': 'text/plain' }).end('missing x-idealize-auth header')
    return true
  }
  return false
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

export function apply(ctx: Context): void {
  ctx.plugin(IdealizeCron)
  // Every agent gets the calendar tools and one sentence saying they are the
  // person's calendar (JJ, 8 Sep 2026: a reminder set from chat neither
  // showed in the pane nor fired).
  ctx.inject(['idealizeCron', 'tools'], (toolCtx) => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    for (const tool of createCalendarTools(toolCtx.idealizeCron, zone)) {
      toolCtx.effect(() => toolCtx.tools.register(tool), `idealize-cron: ${tool.name}`)
    }
  })
  ctx.inject(['systemPrompt'], (promptCtx) => {
    promptCtx.effect(() => promptCtx.systemPrompt.section(CALENDAR_SECTION), 'idealize-cron: prompt section')
  })
  ctx.inject(['idealizeCron', 'webServer'], (webCtx) => {
    const cron = webCtx.idealizeCron
    const register = (
      path: string,
      mutating: boolean,
      handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>,
    ): void => {
      webCtx.effect(
        () => webCtx.webServer.register({
          kind: 'exact',
          path,
          handler: async (req, res) => {
            if (refuse(req, res, mutating)) return
            try {
              await handler(req, res)
            } catch (error) {
              /* v8 ignore next -- every rejection these handlers raise is an Error; the cast only types a thrown non-Error. */
              sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
            }
          },
        }),
        `idealize-cron: ${path}`,
      )
    }
    register('/idealize/cron/tasks', false, async (req, res) => {
      if (req.method === 'POST') {
        if (req.headers['x-idealize-auth'] !== '1') {
          res.writeHead(403, { 'content-type': 'text/plain' }).end('missing x-idealize-auth header')
          return
        }
        const task = await cron.saveTask(JSON.parse(await readBody(req)) as Partial<CronTask>)
        sendJson(res, 200, task)
        return
      }
      sendJson(res, 200, await cron.taskViews())
    })
    register('/idealize/cron/delete', true, async (req, res) => {
      const id = new URL(req.url ?? '/', 'http://localhost').searchParams.get('id') ?? ''
      sendJson(res, 200, { deleted: await cron.deleteTask(id) })
    })
    register('/idealize/cron/toggle', true, async (req, res) => {
      const id = new URL(req.url ?? '/', 'http://localhost').searchParams.get('id') ?? ''
      const task = await cron.toggleTask(id)
      sendJson(res, task === undefined ? 404 : 200, task ?? { error: 'unknown task' })
    })
    register('/idealize/cron/approve', true, async (req, res) => {
      const id = new URL(req.url ?? '/', 'http://localhost').searchParams.get('id') ?? ''
      const task = await cron.approveTask(id)
      sendJson(res, task === undefined ? 404 : 200, task ?? { error: 'unknown task' })
    })
    register('/idealize/cron/run-now', true, async (req, res) => {
      const id = new URL(req.url ?? '/', 'http://localhost').searchParams.get('id') ?? ''
      sendJson(res, 200, await cron.fire(id))
    })
    register('/idealize/cron/runs', false, async (req, res) => {
      const task = new URL(req.url ?? '/', 'http://localhost').searchParams.get('task') ?? undefined
      sendJson(res, 200, await cron.store.runs(task))
    })
  })
}
