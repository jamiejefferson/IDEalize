/**
 * @idealize/studio — the Studio event contract's host half: `ctx.idealizeStudio`
 * over the durable per-project timeline, the deterministic task fold, and the
 * loopback routes the coordination surfaces read and write.
 *
 * HTTP: `GET /idealize/studio/timeline?project=<folder>&since=<seq>` serves a
 * project's events after a cursor; `GET /idealize/studio/state?project=<folder>`
 * serves the folded tasks and per-agent views; `GET /idealize/studio/overview`
 * serves every stored project's state and recent timeline in one read (the
 * Studio spans every project, JJ 3 Sep 2026); `POST /idealize/studio/event`
 * records one event (loopback + `x-idealize-auth: 1`). Reads are loopback-only.
 *
 * The Studio chat (a chat in the `studio` space) posts through the ordinary
 * composer: `agent/pre-step` takes the user's message before any model runs,
 * delivers a leading `@name` to that participant or records the rest as a
 * group post on every project, and rejects the step.
 *
 * @module @idealize/studio
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { resolve } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { foldSpace } from '@idealize/spaces'
import { studioEventInputSchema } from './events.ts'
import type { StudioEvent, StudioEventInput } from './events.ts'
import { foldStudioState } from './fold.ts'
import type { DeliveryState, StudioState } from './fold.ts'
import { StudioStore, studioRootPath } from './store.ts'
import type { StudioAppendResult } from './store.ts'

export { STUDIO_EVENT_KINDS, StudioEventId, StudioTaskId, studioEventInputSchema, studioEventSchema } from './events.ts'
export type { StudioEvent, StudioEventInput, StudioEventKind, StudioEventSource } from './events.ts'
export { foldStudioState } from './fold.ts'
export type { DeliveryState, StudioAgentView, StudioHandoff, StudioState, StudioSynthesis, StudioTask, TaskAttention, TaskExecutionState } from './fold.ts'
export { projectKey, StudioStore, studioRootPath } from './store.ts'
export type { StudioAppendResult } from './store.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    idealizeStudio: IdealizeStudio
  }
  interface Events {
    /**
     * A Studio event committed to its project's timeline; announced after the
     * append is on disk, never for a suppressed duplicate.
     * @mode emit
     * @param event - the recorded event, with its assigned id, seq and time.
     */
    'idealize/studio-event'(event: StudioEvent): void
  }
}

/** Timeline paths. */
export const TIMELINE_PATH = '/idealize/studio/timeline'
/** Folded-state path. */
export const STATE_PATH = '/idealize/studio/state'
/** Event submission path. */
export const EVENT_PATH = '/idealize/studio/event'
/** Addressed-delivery path. */
export const DELIVER_PATH = '/idealize/studio/deliver'
/** Every project's state and recent timeline in one read. */
export const OVERVIEW_PATH = '/idealize/studio/overview'

/** Timeline rows the overview carries per project; older rows stay on disk. */
const OVERVIEW_RECENT = 60

/** One project's slice of the overview. */
export interface StudioOverviewProject {
  /** The resolved project folder. */
  project: string
  /** The newest recorded seq. */
  lastSeq: number
  /** The folded state with runtime presence. */
  state: StudioState & { presence: Record<string, StudioPresence> }
  /** The most recent events, oldest first, at most {@link OVERVIEW_RECENT}. */
  recent: StudioEvent[]
}

/**
 * The task-update subtypes that end a task, and how the group chat says so.
 * A subtype absent here left the task open, and an open task is not news.
 * Exported so every surface that reports an ending (the group chat, the
 * Telegram remote) agrees on which subtypes end a task.
 */
export const ENDING_WORDS: Readonly<Record<string, string | undefined>> = Object.freeze({
  done: 'Finished',
  failed: 'Could not finish',
  cancelled: 'Cancelled',
})

/**
 * The Studio's own timeline key. Every other timeline is keyed by a resolved
 * project folder, which is always absolute, so this bare word can never
 * collide with one. The Studio coordinator's conversation with the user lives
 * here rather than on any project's timeline.
 */
export const STUDIO_PROJECT = 'studio'

/** Where a Studio-chat post landed. */
export type StudioChatPost =
  | { kind: 'delivered'; target: string; project: string; delivery: DeliveryState }
  | { kind: 'no-coordinator'; reason: string }
  | { kind: 'unresolved'; token: string; names: string[] }

/**
 * FR-P0-09 in its group-chat form (JJ, 1 Sep): an addressed message invokes
 * exactly one participant, and only deliver invokes — the event route and
 * {@link IdealizeStudio.record} refuse an addressed `message` with this rule
 * so no producer can put an invocation in the timeline that never reached
 * anyone. An unaddressed `message` is a group post: recorded on the timeline
 * for everyone, invoking nobody, through the event route like any other
 * event. The deliver route refuses the unaddressed form with the same rule,
 * so the choice between posting and invoking stays the producer's.
 */
export const MESSAGE_ROUTE_RULE = 'an addressed message goes through POST /idealize/studio/deliver and invokes exactly one participant; an unaddressed message is a group post and goes through POST /idealize/studio/event'

/** Runtime presence: whether a participant's session can take a delivery now. */
export type StudioPresence = 'reachable' | 'unreachable'

/** The author recorded on delivery-state records the service itself appends. */
const SYSTEM_AUTHOR = 'idealize'

const DELIVERY_SUBTYPES = ['delivery-queued', 'delivery-delivered', 'delivery-acknowledged'] as const

/**
 * The mailbox half {@link IdealizeStudio.deliver} rides, when one is
 * composed: structurally `@idealize/comm`'s service, read without a package
 * dependency so comm can consume this package.
 */
interface CommLike {
  handle(request: { command: 'send'; from: string; target: string; body: string }): Promise<{
    ok: boolean
    error?: string | undefined
  }>
  handle(request: { command: 'list' }): Promise<{
    ok: boolean
    sessions?: readonly {
      id: string
      name?: string | undefined
      title: string
      projectPath?: string | undefined
      /** `studio-agent` names the one Studio coordinator; see comm's roles. */
      role?: string | undefined
      /** False for a stored session from an earlier run that no agent holds. */
      live?: boolean | undefined
    }[] | undefined
  }>
  handle(request: { command: 'spawn'; studio: true }): Promise<{
    ok: boolean
    /** The Studio coordinator's session id: running, resumed from storage, or freshly started. */
    info?: string | undefined
    error?: string | undefined
  }>
}

/** The host bridge's feed, read structurally (the bridge is optional here). */
interface BridgeLike {
  buffer: { push(event: { kind: 'notify'; title: string; body: string }): void }
}

/** A participant the Studio chat can address: comm's roster row, as read here. */
interface Participant {
  id: string
  name: string
  title: string
  project: string | undefined
}

/**
 * Resolve a leading `@` address against the roster: the LONGEST name, title
 * or session id that prefixes the text after `@` wins (agent names are
 * two-word pairs, so a single-token parse would truncate most of them), and
 * the message is what follows. Two participants tying on the same longest
 * key is ambiguous and resolves to nothing.
 * @param rest - the text after the leading `@`.
 * @param participants - the roster.
 * @returns the addressed participant and the body, or null.
 */
export function resolveAddress(rest: string, participants: readonly Participant[]): { target: Participant; body: string } | null {
  const lower = rest.toLowerCase()
  let best: { target: Participant; length: number; ties: number } | null = null
  for (const participant of participants) {
    for (const key of [participant.name, participant.title, participant.id]) {
      const candidate = key.toLowerCase()
      if (candidate === '' || !lower.startsWith(candidate)) continue
      const boundary = rest.length === candidate.length || /\s/.test(rest[candidate.length] ?? '')
      if (!boundary) continue
      if (best === null || candidate.length > best.length) {
        best = { target: participant, length: candidate.length, ties: 1 }
      } else if (candidate.length === best.length && participant.id !== best.target.id) {
        best.ties += 1
      }
    }
  }
  if (best === null || best.ties > 1) return null
  return { target: best.target, body: rest.slice(best.length).trim() }
}

/** The Studio service: record, read and fold one project's coordination timeline. */
export class IdealizeStudio extends Service {
  private readonly store: StudioStore
  private readonly deliveryExpiryMs: number

  constructor(ctx: Context, options: { store: StudioStore; deliveryExpiryHours?: number }) {
    super(ctx, 'idealizeStudio')
    this.store = options.store
    this.deliveryExpiryMs = (options.deliveryExpiryHours ?? 72) * 3_600_000
  }

  /**
   * Record one event and announce it. A duplicate `messageId` returns the
   * recorded event, writes nothing, and announces nothing.
   * @param input - the validated submission, its project already resolved.
   * @returns the recorded (or already-recorded) event.
   */
  async record(input: StudioEventInput): Promise<StudioAppendResult> {
    // FR-P0-09: recording an ADDRESSED message here would put an invocation
    // in the timeline that never reached anyone; deliver is the one invoking
    // path. An unaddressed message is a group post and records like any event.
    if (input.kind === 'message' && input.target !== undefined) throw new Error(MESSAGE_ROUTE_RULE)
    return this.commit(input)
  }

  /** Append and announce without the message-routing check: deliver's own path. */
  private async commit(input: StudioEventInput): Promise<StudioAppendResult> {
    const result = await this.store.append(input)
    if (!result.duplicate) {
      this.ctx.emit('idealize/studio-event', result.event)
      await this.sayItEnded(result.event)
    }
    return result
  }

  /**
   * Post the group-chat line for a task that has just ended.
   *
   * A `task-update` moves the fold, and the surfaces that read the fold show
   * it — but the group chat reads the timeline as conversation, so a task
   * ending left the chat silent and the person had to open the Studio to find
   * out (JJ, 10 Sep 2026). The line carries the outcome the agent gave and
   * names the task's goal, so the chat reads as the agents reporting in.
   * @param event - the event just appended.
   */
  private async sayItEnded(event: StudioEvent): Promise<void> {
    if (event.kind !== 'task-update') return
    const words = ENDING_WORDS[event.subtype ?? '']
    if (words === undefined) return
    const goal = (await this.state(event.project)).tasks.find(task => task.id === event.taskId)?.goal
    const outcome = (event.body ?? '').trim()
    const body = [`${words}${goal === undefined ? '' : `: ${goal}`}`, outcome].filter(part => part !== '').join(' — ')
    // A message, so every surface reading the timeline as conversation
    // carries it; unaddressed, so it wakes nobody.
    await this.commit({ project: event.project, author: event.author, kind: 'message', body })
  }

  /**
   * A project's events after a cursor, oldest first.
   * @param project - the resolved project folder.
   * @param since - return events with `seq` greater than this; 0 for all.
   * @returns the retained events after the cursor.
   */
  async timeline(project: string, since: number = 0): Promise<StudioEvent[]> {
    await this.store.load(project)
    return this.store.events(project, since)
  }

  /**
   * The folded project state.
   * @param project - the resolved project folder.
   * @returns tasks in creation order plus per-owner work views.
   */
  async state(project: string): Promise<StudioState> {
    await this.store.load(project)
    return foldStudioState(this.store.events(project))
  }

  /**
   * Runtime presence for every participant the folded state names as a task
   * owner. In-process, a participant is reachable exactly while a live root
   * agent runs its session; there is no heartbeat to expire, so the answer is
   * current by construction. Non-session participants (`user`) read as
   * unreachable — the surface decides how to render them.
   * @param state - the folded state whose agents are keyed.
   * @returns presence per participant key.
   */
  presenceOf(state: StudioState): Record<string, StudioPresence> {
    const live = new Set((this.ctx.get('agents')?.roots() ?? []).map(agent => String(agent.session.header.id)))
    const presence: Record<string, StudioPresence> = {}
    for (const key of Object.keys(state.agents)) presence[key] = live.has(key) ? 'reachable' : 'unreachable'
    return presence
  }

  /**
   * Record one addressed message and attempt its delivery into the target's
   * mailbox. One logical message: a repeated `messageId` never records a
   * second message event — a retry re-attempts a still-queued delivery and
   * returns the recorded state once it is delivered or acknowledged.
   * @param input - the validated submission; `target` names the recipient.
   * @returns the message event, whether it already existed, and its delivery state.
   */
  async deliver(
    input: StudioEventInput & { target: string },
  ): Promise<{ event: StudioEvent; duplicate: boolean; delivery: DeliveryState }> {
    const { event, duplicate } = await this.commit(input)
    if (duplicate) {
      const prior = this.store.events(input.project).findLast(candidate =>
        candidate.kind === 'system'
        && candidate.source?.event === event.id
        && (DELIVERY_SUBTYPES as readonly string[]).includes(candidate.subtype ?? ''))
      const state = prior?.subtype?.slice('delivery-'.length) as DeliveryState | undefined
      if (state === 'delivered' || state === 'acknowledged') return { event, duplicate, delivery: state }
    }
    const { delivered, note } = await this.attempt(input.author, input.target, input.body ?? '')
    // First attempts record their outcome; a retry appends only the change
    // to delivered, so a still-queued message cannot grow the timeline.
    if (!duplicate || delivered) {
      await this.deliveryRecord(event, delivered ? 'delivery-delivered' : 'delivery-queued', note)
    }
    return { event, duplicate, delivery: delivered ? 'delivered' : 'queued' }
  }

  /** The composed messaging service, when one is mounted. */
  private comm(): CommLike | undefined {
    const maybe = (this.ctx as unknown as { get(name: string): unknown }).get('idealizeComm')
    return typeof (maybe as CommLike | undefined)?.handle === 'function' ? maybe as CommLike : undefined
  }

  /** One mailbox attempt through the composed messaging service, when there is one. */
  private async attempt(from: string, target: string, body: string): Promise<{ delivered: boolean; note?: string | undefined }> {
    const comm = this.comm()
    if (comm === undefined) return { delivered: false, note: 'no messaging service composed' }
    try {
      const response = await comm.handle({ command: 'send', from, target, body })
      return { delivered: response.ok, ...response.ok ? {} : { note: response.error } }
    } catch (error) {
      return { delivered: false, note: error instanceof Error ? error.message : String(error) }
    }
  }

  /** Append one delivery-state record naming its message event. */
  private async deliveryRecord(message: StudioEvent, subtype: string, note?: string): Promise<void> {
    await this.record({
      project: message.project,
      author: SYSTEM_AUTHOR,
      kind: 'system',
      subtype,
      ...message.target === undefined ? {} : { target: message.target },
      ...message.taskId === undefined ? {} : { taskId: message.taskId },
      ...note === undefined ? {} : { body: note },
      source: { event: message.id },
    })
  }

  /**
   * Every stored project's folded state, presence and recent timeline: the
   * Studio's one read across projects.
   * @returns the projects in path order.
   */
  async overview(): Promise<StudioOverviewProject[]> {
    const projects = (await this.store.storedProjects()).sort()
    const out: StudioOverviewProject[] = []
    for (const project of projects) {
      const state = await this.state(project)
      const events = this.store.events(project)
      out.push({
        project,
        lastSeq: this.store.lastSeq(project),
        state: { ...state, presence: this.presenceOf(state) },
        recent: events.slice(-OVERVIEW_RECENT),
      })
    }
    return out
  }

  /** Every participant comm lists, with the project each works in. */
  private async participants(): Promise<Participant[]> {
    const comm = this.comm()
    if (comm === undefined) return []
    const response = await comm.handle({ command: 'list' })
    return (response.sessions ?? []).map(row => ({
      id: row.id, name: row.name ?? '', title: row.title, project: row.projectPath,
    }))
  }

  /**
   * The one Studio coordinator's session id, starting or resuming it when none is running.
   *
   * It is found by its role rather than by a folder: every other coordinator
   * runs one project and is found by that project, and this one runs the
   * Studio, which spans them all.
   * @returns the session id, or undefined when no mailbox half is composed or the start failed.
   */
  private async studioCoordinator(): Promise<string | undefined> {
    const comm = this.comm()
    if (comm === undefined) return undefined
    const listed = await comm.handle({ command: 'list' })
    const running = (listed.sessions ?? []).find(row => row.role === 'studio-agent' && row.live === true)
    if (running !== undefined) return running.id
    // A stored coordinator from an earlier app run is listed but not live;
    // spawn resumes it on its own history (JJ, 14 Sep 2026: "nothing happens
    // when you message in the app").
    const started = await comm.handle({ command: 'spawn', studio: true })
    return started.ok ? started.info : undefined
  }

  /**
   * Post one message from the Studio chat. A leading `@name` delivers to that
   * participant on its own project's timeline. Anything else goes to the one
   * Studio coordinator, on the Studio's own timeline.
   *
   * An untagged post used to be recorded on every project the Studio watches,
   * which put one typed line on every timeline and woke every project's
   * coordinator at once (JJ, 11 Sep 2026: "its literally posting to all the
   * agents! that's not right"). The Studio has an agent of its own now; it
   * reads the line and works through the project coordinators itself.
   * @param text - the user's message.
   * @param messageId - the logical message id (one per send; retries reuse it).
   * @returns where the post landed, the unresolved token with who is present, or why no coordinator took it.
   */
  async postFromChat(text: string, messageId: string): Promise<StudioChatPost> {
    const participants = await this.participants()
    if (text.startsWith('@')) {
      const rest = text.slice(1)
      const resolved = resolveAddress(rest, participants)
      if (resolved === null) {
        return { kind: 'unresolved', token: rest.split(/\s+/)[0] ?? '', names: participants.map(row => row.name).filter(name => name !== '') }
      }
      const project = resolved.target.project ?? resolve('.')
      const { delivery } = await this.deliver({
        project, author: 'user', kind: 'message', body: resolved.body, messageId, target: resolved.target.id,
      })
      return { kind: 'delivered', target: resolved.target.id, project, delivery }
    }
    const coordinator = await this.studioCoordinator()
    if (coordinator === undefined) {
      return { kind: 'no-coordinator', reason: 'the Studio coordinator could not be started' }
    }
    const { delivery } = await this.deliver({
      project: STUDIO_PROJECT, author: 'user', kind: 'message', body: text, messageId, target: coordinator,
    })
    return { kind: 'delivered', target: coordinator, project: STUDIO_PROJECT, delivery }
  }

  /**
   * Re-attempt every queued delivery addressed to one participant, across
   * every stored project — the reconnection hook. A message older than the
   * delivery expiry is recorded `delivery-expired` instead of attempted; an
   * explicit {@link deliver} retry with its messageId can still revive it.
   * @param target - the participant whose session came back.
   * @param now - the clock for the expiry decision (tests pin it).
   * @returns how many deliveries were delivered and how many expired.
   */
  async retryQueued(target: string, now: number = Date.now()): Promise<{ delivered: number; expired: number }> {
    let deliveredCount = 0
    let expiredCount = 0
    for (const project of await this.store.storedProjects()) {
      await this.store.load(project)
      const events = this.store.events(project)
      const { deliveries } = foldStudioState(events)
      for (const [messageEventId, state] of Object.entries(deliveries)) {
        if (state !== 'queued') continue
        const message = events.find(candidate => candidate.id === messageEventId)
        if (message === undefined || message.target !== target) continue
        if (now - Date.parse(message.at) > this.deliveryExpiryMs) {
          const limit = `not delivered within ${Math.round(this.deliveryExpiryMs / 3_600_000)}h`
          await this.deliveryRecord(message, 'delivery-expired', limit)
          expiredCount += 1
          continue
        }
        const { delivered, note } = await this.attempt(message.author, target, message.body ?? '')
        if (delivered) {
          await this.deliveryRecord(message, 'delivery-delivered', note)
          deliveredCount += 1
        }
      }
    }
    return { delivered: deliveredCount, expired: expiredCount }
  }

  /**
   * The newest recorded seq, for cursors and the announce invariant.
   * Synchronous over what is loaded: 0 for a project never read or written.
   * @param project - the resolved project folder.
   * @returns the last event's seq, 0 for an empty or unloaded timeline.
   */
  lastSeq(project: string): number {
    return this.store.lastSeq(project)
  }
}

export const name = 'idealize-studio'

/** Deployment tunables. */
export interface StudioConfig {
  /** How long a queued delivery stays retryable on reconnection before it is recorded expired. */
  deliveryExpiryHours?: number
}

/** Runtime schema for {@link StudioConfig}. */
export const Config: z<StudioConfig> = z.object({
  deliveryExpiryHours: z.number().default(72),
})

// TODO extract one owner for the loopback fence trio (spaces, comm, activity-pills, studio all copy it).
/* jscpd:ignore-start */
/** Loopback fence plus the mutating-request header, matching the other IDEalize routes. */
function refuse(req: IncomingMessage, res: ServerResponse, mutating = false): boolean {
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
/* jscpd:ignore-end */

/**
 * Parse one POST submission: method, fence, JSON and schema. Ends the
 * response and returns undefined on any refusal.
 * @param req - the incoming request.
 * @param res - the response a refusal is written to.
 * @returns the validated input with its project resolved, or undefined.
 */
async function readSubmission(req: IncomingMessage, res: ServerResponse): Promise<StudioEventInput | undefined> {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'content-type': 'text/plain', allow: 'POST' }).end('POST only')
    return undefined
  }
  if (refuse(req, res, true)) return undefined
  let raw: unknown
  try {
    raw = JSON.parse(await readBody(req))
  } catch {
    sendJson(res, 400, { ok: false, error: 'body is not JSON' })
    return undefined
  }
  const parsed = studioEventInputSchema.safeParse(raw)
  if (!parsed.success) {
    sendJson(res, 400, { ok: false, error: parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ') })
    return undefined
  }
  return { ...parsed.data, project: resolve(parsed.data.project) }
}

/** The `project` query value, resolved; undefined ends the response with a 400. */
function projectOf(req: IncomingMessage, res: ServerResponse): string | undefined {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const project = url.searchParams.get('project')
  if (project === null || project === '') {
    sendJson(res, 400, { ok: false, error: 'missing project' })
    return undefined
  }
  return resolve(project)
}

export function apply(ctx: Context, config: StudioConfig = {}): void {
  const store = new StudioStore(studioRootPath(resolveDshHome()))
  const expiry = config.deliveryExpiryHours
  ctx.plugin(IdealizeStudio, { store, ...expiry === undefined ? {} : { deliveryExpiryHours: expiry } })

  // Reconnection drains the queue: a session coming back re-attempts every
  // queued delivery addressed to it, under the expiry policy.
  ctx.inject(['idealizeStudio'], (studioCtx) => {
    studioCtx.on('agent/session-start', ({ agent }) => {
      studioCtx.idealizeStudio.retryQueued(String(agent.session.header.id)).catch((error: unknown) => {
        studioCtx.logger.warn(`idealize-studio: reconnection retry failed: ${String(error)}`)
      })
    })
  })

  // The Studio chat's composer is the ordinary one (JJ, 3 Sep 2026): the
  // message is taken here before any model runs, posted, and the step
  // rejected, so a Studio chat never spends a model call.
  ctx.inject(['idealizeStudio'], (studioCtx) => {
    studioCtx.on('agent/pre-step', async ({ agent, messages }, next): Promise<PreStepDecision> => {
      if (messages.length === 0 || foldSpace(agent.session.events) !== 'studio') return next()
      // The person's own words only: plugins inject context messages into the
      // same step (comm's name notice), and those are not posts.
      const text = messages
        .filter(message => message.source.kind === 'user')
        .flatMap(message => message.content)
        .map(block => (block.type === 'text' ? block.text : ''))
        .join('\n')
        .trim()
      if (text !== '') {
        try {
          const landed = await studioCtx.idealizeStudio.postFromChat(text, `sm-${crypto.randomUUID()}`)
          // Either failure leaves the message on no timeline, so say so where
          // the user is looking rather than only in the log.
          const trouble = landed.kind === 'unresolved'
            ? `Nobody called "@${landed.token}" is present. Present: ${landed.names.join(', ') || 'no one'}.`
            : landed.kind === 'no-coordinator'
              ? `Your message was not posted: ${landed.reason}.`
              : undefined
          if (trouble !== undefined) {
            const bridge = (studioCtx as unknown as { get(name: string): BridgeLike | undefined }).get('idealizeBridge')
            bridge?.buffer.push({ kind: 'notify', title: 'Studio', body: trouble })
            studioCtx.logger.warn(`idealize-studio: ${trouble}`)
          }
        } catch (error) {
          studioCtx.logger.warn(`idealize-studio: the Studio chat's post failed: ${String(error)}`)
        }
      }
      return { kind: 'reject' }
    })
  })

  ctx.inject(['idealizeStudio', 'webServer'], (webCtx) => {
    const studio = webCtx.idealizeStudio

    webCtx.effect(
      () => webCtx.webServer.register({
        kind: 'exact',
        path: OVERVIEW_PATH,
        handler: async (req, res) => {
          if (refuse(req, res)) return
          sendJson(res, 200, { projects: await studio.overview() })
        },
      }),
      'idealize-studio: GET /idealize/studio/overview',
    )

    webCtx.effect(
      () => webCtx.webServer.register({
        kind: 'exact',
        path: TIMELINE_PATH,
        handler: async (req, res) => {
          if (refuse(req, res)) return
          const project = projectOf(req, res)
          if (project === undefined) return
          const url = new URL(req.url ?? '/', 'http://127.0.0.1')
          const since = Number(url.searchParams.get('since') ?? '0')
          const cursor = Number.isSafeInteger(since) && since > 0 ? since : 0
          const events = await studio.timeline(project, cursor)
          sendJson(res, 200, { events, lastSeq: studio.lastSeq(project) })
        },
      }),
      'idealize-studio: GET /idealize/studio/timeline',
    )

    webCtx.effect(
      () => webCtx.webServer.register({
        kind: 'exact',
        path: STATE_PATH,
        handler: async (req, res) => {
          if (refuse(req, res)) return
          const project = projectOf(req, res)
          if (project === undefined) return
          const state = await studio.state(project)
          sendJson(res, 200, { ...state, presence: studio.presenceOf(state) })
        },
      }),
      'idealize-studio: GET /idealize/studio/state',
    )

    webCtx.effect(
      () => webCtx.webServer.register({
        kind: 'exact',
        path: EVENT_PATH,
        handler: async (req, res) => {
          const input = await readSubmission(req, res)
          if (input === undefined) return
          if (input.kind === 'message' && input.target !== undefined) {
            sendJson(res, 400, { ok: false, error: MESSAGE_ROUTE_RULE })
            return
          }
          try {
            const { event, duplicate } = await studio.record(input)
            sendJson(res, 200, { ok: true, event, duplicate })
          } catch (error) {
            sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
          }
        },
      }),
      'idealize-studio: POST /idealize/studio/event',
    )

    webCtx.effect(
      () => webCtx.webServer.register({
        kind: 'exact',
        path: DELIVER_PATH,
        handler: async (req, res) => {
          const input = await readSubmission(req, res)
          if (input === undefined) return
          if (input.target === undefined) {
            // Group-chat routing: deliver only invokes. An unaddressed
            // message is a group post and belongs on the event route; the
            // refusal keeps the choice between posting and invoking explicit.
            sendJson(res, 400, { ok: false, error: MESSAGE_ROUTE_RULE })
            return
          }
          try {
            sendJson(res, 200, { ok: true, ...await studio.deliver({ ...input, target: input.target }) })
          } catch (error) {
            sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
          }
        },
      }),
      'idealize-studio: POST /idealize/studio/deliver',
    )
  })
}
