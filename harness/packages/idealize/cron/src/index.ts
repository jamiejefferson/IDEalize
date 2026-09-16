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
 * chat's project. Every committed task-list write emits
 * `idealize/cron-changed`, which the host bridge forwards so the pane refetches.
 *
 * HTTP surface (loopback-fenced; mutations demand `x-idealize-auth: 1`),
 * consumed by the Schedule drawer pane in @idealize/ui-bar:
 * - `GET  /idealize/cron/tasks`      — tasks with their next fire times
 * - `POST /idealize/cron/tasks`      — JSON body: create or update a task
 * - `POST /idealize/cron/delete`     — `?id=`
 * - `POST /idealize/cron/toggle`     — `?id=` flips `enabled`
 * - `GET  /idealize/cron/runs`       — `?task=` filters
 *
 * Each completed fire also emits `idealize/cron-run` for the host bridge.
 *
 * @module @idealize/cron
 */

import { randomUUID } from 'node:crypto'
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
import { CALENDAR_SECTION, createCalendarTools } from './tools.ts'
// Type-only: the prompt registry's Context merge (ctx.systemPrompt).
import type {} from '@deepseek-ai/dsh-system-prompt'
// Type-only: the tool registry's Context merge (ctx.tools).
import type {} from '@deepseek-ai/dsh-tools'

export { invalidReason, nextFire, WEEKDAYS, zoneWeekday } from './schedule.ts'
export type { Schedule } from './schedule.ts'
export { CronStore, cronStorePath } from './store.ts'
export type { CronRun, CronTask, RunStatus } from './store.ts'
export { CALENDAR_SECTION, createCalendarTools, describeSchedule, scheduleOf } from './tools.ts'
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
      void this.fire(task.id)
    }, bounded)
    timer.unref()
    this.timers.set(task.id, timer)
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
   * @returns the stored task after defaults are applied.
   */
  async saveTask(input: Partial<CronTask>): Promise<CronTask> {
    const schedule = input.schedule
    if (schedule === undefined) throw new Error('task needs a schedule')
    const reason = invalidReason(schedule)
    if (reason !== undefined) throw new Error(reason)
    const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : ''
    const remind = input.remind === true || prompt === ''
    if (prompt === '' && input.remind !== true) throw new Error('task needs a prompt, or remind set for a reminder that runs nothing')
    if (typeof input.cwd !== 'string' || !input.cwd.startsWith('/')) throw new Error('task needs an absolute cwd')
    if (schedule.kind === 'at' && input.done === undefined && Date.parse(schedule.at) <= Date.now()) {
      throw new Error(`one-off time ${schedule.at} is in the past`)
    }
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
      enabled: input.enabled !== false,
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
   * Flip one task's enabled flag and re-arm it.
   * @param id - The task to toggle.
   * @returns the updated task, or undefined when no task has that id.
   */
  async toggleTask(id: string): Promise<CronTask | undefined> {
    const task = (await this.store.tasks()).find(candidate => candidate.id === id)
    if (task === undefined) return undefined
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
  private async runAgent(task: CronTask): Promise<{ sessionId: string; errorDetail?: string }> {
    // The loader service (cordis-loader) is not a declared dependency; narrow the probe.
    await (this.ctx.get('loader') as { await(): Promise<void> } | undefined)?.await()
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
    await agent.whenIdle()
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
    return { sessionId: String(sessionId), ...errorDetail === undefined ? {} : { errorDetail } }
  }
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
