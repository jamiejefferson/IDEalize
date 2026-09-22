/**
 * `ctx.idealizeComm` — the command surface's host half. Builds the session
 * roster (live agents plus persisted sessions), answers every wire command,
 * and raises the shell-facing events (mail, notify, focus, reveal) through
 * typed Cordis events and, when composed, the host bridge feed.
 */

import { randomUUID } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { basename, resolve, sep } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { Context, Service } from '@deepseek-ai/cordis'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { Agent, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-title'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@idealize/host-bridge'
// Type-only: the `artefact/created` session event (SessionEventMap merge).
import type {} from '@idealize/artefacts'
import type {} from '@deepseek-ai/dsh-session-projection-cache'
import { foldSpace } from '@idealize/spaces'
import { STUDIO_PROJECT } from '@idealize/studio'
import type { StudioEvent } from '@idealize/studio'
import { resolveTarget } from './resolve.ts'
import type { SessionRecord } from './resolve.ts'
import type { CommStore } from './store.ts'
import { pickName, poolFor } from './names.ts'
import { foldAgentName } from './projection.ts'
import { presetOfRole, ROLE_OPENING, ROLE_TITLES, roleOfPreset } from './roles.ts'
import type { CommConfig } from './config.ts'
import type { CommRole } from './store.ts'
import { chatNameFromTask, TRUNCATION_WARNING, Wire } from './wire.ts'
import type { CommExchange, CommMessage, CommRequest, CommResponse, CommRung, CommSessionInfo, StudioTaskRow } from './wire.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    idealizeComm: IdealizeComm
  }
  interface Events {
    /**
     * A message landed in a session's mailbox; the unread count is the badge.
     * @mode emit
     * @param sessionId - the recipient.
     * @param message - what arrived.
     * @param unread - the recipient's mailbox size after delivery.
     */
    'idealize/comm-mail'(sessionId: string, message: CommMessage, unread: number): void
    /**
     * A chat asked for a system notification (`idealize notify`).
     * @mode emit
     * @param title - the notification title, already carrying the sender's label.
     * @param body - the notification text.
     * @param sound - whether the sender asked for a sound.
     */
    'idealize/comm-notify'(title: string, body: string, sound: boolean): void
    /**
     * A chat asked the shell to bring a session to the front (`idealize focus`).
     * @mode emit
     * @param sessionId - the session to show.
     */
    'idealize/comm-focus'(sessionId: string): void
    /**
     * A chat pointed the person at a file (`idealize reveal`).
     * @mode emit
     * @param path - the absolute, symlink-resolved file path.
     * @param open - whether to open it in the viewer as well as select it.
     * @param sessionId - the session whose project holds the file.
     */
    'idealize/comm-reveal'(path: string, open: boolean, sessionId: string): void
  }
}

/**
 * What an idle coordinator is told when Studio changes while its mailbox was
 * empty; everything later piles up quietly until the inbox drains.
 */
export const WAKE_NOTICE = 'Studio changed while you were idle. Run `idealize inbox` for what happened, `idealize chat` for the group chat, and `idealize studio` for the board.'

/**
 * What an idle agent is told when a note reaches its empty mailbox; later
 * notes pile up quietly until the inbox drains (the coordinator's rule).
 *
 * The notice says to act on the note, not only to read and answer it: a chat
 * told to pause until another had finished read that chat's "I've finished"
 * as information and kept waiting for the person to say so (JJ, 22 Sep 2026).
 */
export const MAIL_NOTICE = 'A note from another agent arrived while you were idle. Run `idealize inbox` to read it, then act on it as you would on the person\'s own words: '
  + 'when it says something you were waiting for has happened, or hands you a next step, carry on with that now without waiting for the person to repeat it. '
  + 'Answer with `idealize send <agent> <text>` when it asks you something or you are blocked.'

/**
 * What an idle agent is told when the person's note, typed in the Studio,
 * reaches its empty mailbox: the answer belongs in the Studio, where the
 * person is reading, so the notice names `idealize post` as the reply.
 */
export const STUDIO_MAIL_NOTICE = 'A note from the person, sent from the Studio, arrived while you were idle. Run `idealize inbox` to read it, then answer in the Studio with `idealize post <text>`, not only here.'

/** The label a Studio-origin note carries in the inbox and on the bridge feed. */
export const STUDIO_SENDER_LABEL = 'Studio'

/** The sender id the Studio chat's posts arrive under (`@idealize/studio` delivers them as the person). */
const STUDIO_SENDER = 'user'

/** The generation tools whose finished turn earns a Studio line when the agent posted none. */
const GENERATION_TOOLS: ReadonlySet<string> = new Set(['generate_image', 'generate_video', 'generate_audio'])

/** The author of the safety-net line; `wakeLine` ignores this author, so the line wakes nobody. */
const SYSTEM_AUTHOR = 'idealize'

/** How a stored artefact's media kind reads in the safety-net line, singular and plural. */
const ARTEFACT_WORDS: Readonly<Record<string, readonly [string, string]>> = {
  image: ['an image', 'images'],
  video: ['a video', 'videos'],
  audio: ['a sound', 'sounds'],
}

/**
 * The artefacts a turn stored, as one clause per media kind in first-seen
 * order: "2 images and a video".
 *
 * The clause used to carry each record's uuid, which is the artefact store's
 * key and means nothing to a reader — a line in the project's group chat read
 * as "generated 3 images (ea340464-9de1-4426-…, …)" and the count vanished
 * behind the ids (JJ, 11 Sep 2026). The ids stay in the artefact records an
 * agent lists; the chat line says what happened.
 * @param records - the stored artefacts, in log order.
 * @returns the clause, never empty for a non-empty list.
 */
export function describeArtefacts(records: readonly { id: string; mediaType: string }[]): string {
  const counts = new Map<string, number>()
  for (const record of records) {
    const kind = record.mediaType.replace(/\/.*$/, '')
    counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }
  return [...counts].map(([kind, count]) => {
    const [one, many] = ARTEFACT_WORDS[kind] ?? ['a file', 'files']
    return count === 1 ? one : `${String(count)} ${many}`
  }).join(' and ')
}

/** The two fields of an artefact record the safety-net line reads. */
type ArtefactSummary = { id: string; mediaType: string }

/** One session's background generations awaiting their Studio line. */
interface PendingBackground {
  session: Session
  records: ArtefactSummary[]
  timer: ReturnType<typeof setTimeout>
}

function summarise(record: { id: string; mediaType: string }): ArtefactSummary {
  return { id: record.id, mediaType: record.mediaType }
}

/**
 * The project the safety net posts to, or undefined for the sessions it
 * ignores: the Studio chat and a chat outside a project.
 */
function postingProject(session: Session): string | undefined {
  if (foldSpace(session.events) === 'studio') return undefined
  const project = session.header.cwd
  return project === undefined || project === '' || project === '/' ? undefined : project
}

/**
 * Whether the turn that started a generation had already ended when its
 * artefact landed. A record's `sourceTask.turnSeq` is that turn's number, so
 * the question is decided by the turn's own `turn/end`, not by whether some
 * later turn is open: a background job can store its outputs while the person
 * is mid-conversation. A record naming no turn (0) is read as a turn still
 * running, which reports nothing.
 */
function sourceTurnEnded(events: readonly SessionEvent[], turn: number, seq: number): boolean {
  if (turn <= 0) return false
  return events.some(event => event.seq < seq && event.type === 'turn/end' && event.data.turn === turn)
}

/** One roster entry with what `list` and the handlers need beyond addressing. */
interface RosterEntry extends SessionRecord {
  running: boolean
  live: Agent | undefined
}

function failure(error: string): CommResponse {
  return { ok: false, error }
}

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .map((block: unknown) => {
      if (typeof block !== 'object' || block === null) return ''
      const record = block as { type?: unknown; text?: unknown }
      return record.type === 'text' && typeof record.text === 'string' ? record.text : ''
    })
    .filter(text => text !== '')
    .join('\n')
}

/**
 * Fold a session log into Q/A exchanges: each person-authored user message
 * opens one, the assistant text that follows (until the next question)
 * answers it.
 * @param events - the session log.
 * @returns exchanges in order, indexed from 1.
 */
export function foldExchanges(events: readonly SessionEvent[]): CommExchange[] {
  const exchanges: CommExchange[] = []
  let current: CommExchange | undefined
  for (const event of events) {
    if (event.type === 'user/message') {
      const message = event.data as { source?: { kind?: unknown }; content?: unknown }
      if (message.source?.kind !== 'user') continue
      const question = textOf(message.content)
      if (question === '') continue
      current = { index: exchanges.length + 1, question }
      exchanges.push(current)
    } else if (event.type === 'assistant/message' && current !== undefined) {
      const answer = textOf((event.data as { message?: { content?: unknown } }).message?.content)
      if (answer === '') continue
      current.answer = current.answer === undefined ? answer : `${current.answer}\n${answer}`
    }
  }
  return exchanges
}

/** The `idealize` command service: agent naming, roles, the roster, and mailbox delivery behind `POST /idealize/comm`. */
export class IdealizeComm extends Service {
  /** The current settings section (preset→role mapping, background post window); the plugin swaps this for the settings source. */
  config: () => CommConfig

  private readonly store: CommStore

  /** Background generations awaiting their one Studio line, keyed by session id. */
  private readonly pendingBackground = new Map<string, PendingBackground>()

  constructor(ctx: Context, options: { store: CommStore; config: () => CommConfig }) {
    super(ctx, 'idealizeComm')
    this.store = options.store
    this.config = options.config
    ctx.effect(() => () => {
      for (const pending of this.pendingBackground.values()) clearTimeout(pending.timer)
      this.pendingBackground.clear()
    }, 'idealize-comm: cancel pending background notes')
  }

  /** The durable state, for listeners the plugin wires around this service. */
  get state(): CommStore {
    return this.store
  }

  /** Name draws in flight, so `session/created` and session start cannot both draw for one session. */
  private readonly naming = new Map<string, Promise<string>>()

  /**
   * Give a session its agent name if it has none: the project's pool is
   * recorded on first use and the draw is logged to the session so the model
   * and the sidebar both learn it.
   * @param session - the session to name.
   * @returns the name, new or existing.
   */
  ensureName(session: Session): Promise<string> {
    const id = String(session.header.id)
    const pending = this.naming.get(id)
    if (pending !== undefined) return pending
    const draw = this.drawName(session, id).finally(() => { this.naming.delete(id) })
    this.naming.set(id, draw)
    return draw
  }

  private async drawName(session: Session, id: string): Promise<string> {
    await this.store.load()
    const existing = this.store.name(id) ?? foldAgentName(session.events)
    if (existing !== undefined) {
      if (this.store.name(id) === undefined) await this.store.setName(id, existing)
      return existing
    }
    const project = session.header.cwd ?? ''
    const pool = poolFor(project, this.store.pools())
    if (this.store.pools()[project] === undefined) await this.store.setPool(project, pool)
    const name = pickName(pool, this.store.takenNames())
    await this.store.setName(id, name)
    try {
      // Ignorable: the comm store is the name's source of truth, so a build
      // without this event's vocabulary still reads the log (envelope contract
      // on SessionEvent.ignorable).
      session.append('idealize/agent-name', { name, pool }, { ignorable: true })
    } catch (error) {
      this.ctx.logger.warn(`idealize-comm: name for ${id} not logged: ${String(error)}`)
    }
    return name
  }

  /**
   * Record a role for a session whose preset carries one and give it the
   * role's task title. No-op for presets outside the mapping.
   * @param session - the session to take the role.
   * @param presetId - the session's preset id, matched against the role mapping.
   * @returns the adopted role, or `undefined` when the preset carries none.
   */
  async adoptRole(session: Session, presetId: string | undefined): Promise<CommRole | undefined> {
    const role = roleOfPreset(presetId, this.config())
    if (role === undefined) return undefined
    await this.store.load()
    const id = String(session.header.id)
    if (this.store.role(id) !== role) await this.store.setRole(id, role)
    const titles = this.ctx.get('sessionTitle')
    if (titles !== undefined && titles.get(session)?.title !== ROLE_TITLES[role]) {
      try {
        titles.rename(session, ROLE_TITLES[role])
      } catch (error) {
        this.ctx.logger.warn(`idealize-comm: role title for ${id} not set: ${String(error)}`)
      }
    }
    return role
  }

  /**
   * Every addressable session: live agents first, then persisted sessions not currently live.
   * @returns the roster entries in address order.
   */
  /**
   * Every addressable chat. The Studio chat (the `studio` space) is the
   * person's own seat and never lists: it is neither named nor a delivery
   * target.
   * @returns the roster, live chats first.
   */
  async roster(): Promise<RosterEntry[]> {
    await this.store.load()
    const entries = new Map<string, RosterEntry>()
    const titles = this.ctx.get('sessionTitle')
    const agents = this.ctx.get('agents')
    for (const agent of agents?.roots() ?? []) {
      const header = agent.session.header
      if (header.origin === 'subagent' || foldSpace(agent.session.events) === 'studio') continue
      const id = String(header.id)
      const name = this.store.name(id) ?? foldAgentName(agent.session.events)
      entries.set(id, {
        id,
        ...name === undefined ? {} : { name },
        label: titles?.get(agent.session)?.title ?? this.store.title(id) ?? (header.cwd === undefined ? id : basename(header.cwd)),
        ...header.cwd === undefined ? {} : { cwd: header.cwd },
        role: this.store.role(id) ?? 'chat',
        running: agent.status === 'running',
        live: agent,
      })
    }
    const persistence = this.ctx.get('sessionPersistence')
    if (persistence !== undefined) {
      const cache = this.ctx.get('sessionProjectionCache')
      for (const header of await persistence.list()) {
        const id = String(header.id)
        if (header.origin === 'subagent' || entries.has(id)) continue
        // The Studio chat is the person's seat, never a participant: a cold
        // listing reads its space off the projection checkpoint.
        if (cache?.cachedSnapshot(header)?.values.space?.space === 'studio') continue
        const name = this.store.name(id)
        entries.set(id, {
          id,
          ...name === undefined ? {} : { name },
          label: this.store.title(id) ?? (header.cwd === undefined ? id : basename(header.cwd)),
          ...header.cwd === undefined ? {} : { cwd: header.cwd },
          role: this.store.role(id) ?? 'chat',
          running: false,
          live: undefined,
        })
      }
    }
    return [...entries.values()]
  }

  private info(entry: RosterEntry): CommSessionInfo {
    return {
      id: entry.id,
      ...entry.name === undefined ? {} : { name: entry.name },
      title: entry.label,
      ...entry.cwd === undefined ? {} : { projectPath: entry.cwd },
      status: this.store.status(entry.id) ?? (entry.running ? 'working' : 'idle'),
      unread: this.store.unread(entry.id),
      role: entry.role,
      running: entry.running,
      live: entry.live !== undefined,
    }
  }

  private async deliver(dest: RosterEntry, message: CommMessage): Promise<void> {
    await this.store.deliver(dest.id, message)
    const unread = this.store.unread(dest.id)
    this.ctx.emit('idealize/comm-mail', dest.id, message, unread)
    this.ctx.get('idealizeBridge')?.buffer.push({
      kind: 'mail',
      title: `Message → ${dest.label}`,
      body: `${message.fromLabel ?? message.from}: ${message.body}`,
      sessionId: dest.id,
    })
  }

  /**
   * The board's rows, newest first.
   * @param scope - the project folder to keep, or undefined for every project.
   * @returns the board response.
   */
  private board(scope: string | undefined): CommResponse {
    const rows = this.store.rungs()
      .filter(row => scope === undefined || row.projectPath === scope)
      .sort((left, right) => right.updated.localeCompare(left.updated))
    return { ok: true, info: rows.length === 0 ? 'no pieces reported yet' : `${rows.length} piece(s)`, rungs: rows }
  }

  /**
   * Answer one wire request. Never throws for a caller mistake; those come back as `ok: false`.
   * @param request - the command envelope from the wire.
   * @returns the command's response payload.
   */
  async handle(request: CommRequest): Promise<CommResponse> {
    // Two commands read no roster, and building one walks every stored chat:
    // a ping, and a board nobody sent (its scope is the path alone). The bars
    // poll the second every couple of seconds.
    if (request.command === 'ping') return { ok: true, info: 'pong' }
    if (request.command === 'board' && request.from === undefined) return this.board(request.path)
    const roster = await this.roster()
    const me = request.from === undefined ? undefined : roster.find(entry => entry.id === request.from)
    const find = (target: string): { ok: true; session: RosterEntry } | { ok: false; error: string } => {
      const resolution = resolveTarget(target, roster, request.from)
      if (!resolution.ok) return resolution
      const entry = roster.find(candidate => candidate.id === resolution.session.id)
      return entry === undefined ? { ok: false, error: `no session matching '${target}'` } : { ok: true, session: entry }
    }

    switch (request.command) {
      case 'list':
        return { ok: true, sessions: roster.map(entry => this.info(entry)) }

      case 'notify': {
        const title = request.title ?? 'IDEalize'
        const full = me === undefined ? title : `${title} · ${me.label}`
        const body = request.body ?? ''
        this.ctx.emit('idealize/comm-notify', full, body, request.sound === true)
        this.ctx.get('idealizeBridge')?.buffer.push({
          kind: 'notify',
          title: full,
          body,
          ...me === undefined ? {} : { sessionId: me.id },
        })
        return { ok: true }
      }

      case 'send': {
        if (request.target === undefined) return failure('missing target')
        const found = find(request.target)
        if (!found.ok) return failure(found.error)
        const { text, truncated } = Wire.clamp(request.body ?? '')
        // The Studio chat's addressed post arrives as the person; the label
        // and the wake notice say so, since the reply belongs in the Studio.
        const fromStudio = request.from === STUDIO_SENDER
        const message: CommMessage = {
          from: request.from ?? '?',
          ...me !== undefined ? { fromLabel: me.name ?? me.label } : fromStudio ? { fromLabel: STUDIO_SENDER_LABEL } : {},
          body: text,
          timestamp: new Date().toISOString(),
          ...request.piece === undefined ? {} : { piece: request.piece },
          ...request.rung === undefined ? {} : { rung: request.rung },
          ...request.blocker === undefined ? {} : { blocker: request.blocker },
        }
        await this.deliver(found.session, message)
        // A live, idle recipient with nothing else waiting is invoked once, so
        // an agent another agent asks a question of answers instead of the
        // note sitting until the person next talks to it.
        const recipient = found.session.live
        if (recipient !== undefined && found.session.id !== request.from && recipient.status === 'idle' && this.store.unread(found.session.id) === 1) {
          recipient.followup(createUserMessage({
            content: [{ type: 'text', text: fromStudio ? STUDIO_MAIL_NOTICE : MAIL_NOTICE }],
            source: { kind: 'plugin', plugin: 'idealize-comm', form: 'notice', summary: fromStudio ? 'Studio mail' : 'Mail' },
          }))
        }
        return {
          ok: true,
          info: `delivered to ${found.session.label} (${found.session.id})`,
          ...truncated ? { warning: TRUNCATION_WARNING } : {},
        }
      }

      case 'inbox':
      case 'peek': {
        if (me === undefined) return failure('unknown sender session')
        const messages = request.command === 'inbox' ? await this.store.drain(me.id) : this.store.peek(me.id)
        const last = messages.at(-1)
        if (request.command === 'inbox' && last !== undefined) {
          this.ctx.emit('idealize/comm-mail', me.id, last, 0)
        }
        return { ok: true, messages }
      }

      case 'rung': {
        if (me === undefined) return failure('unknown sender session')
        const rawPiece = (request.piece ?? '').trim()
        if (rawPiece === '') return failure('missing piece')
        const piece = Wire.clampNote(rawPiece)
        const rung = Wire.normalise(request.rung ?? '')
        if (!Wire.rungs.includes(rung)) return failure(`unknown rung '${rung}' — one of: ${Wire.rungs.join(', ')}`)
        const blocker = Wire.normalise(request.blocker ?? 'none')
        if (!Wire.blockers.includes(blocker)) return failure(`unknown blocker '${blocker}' — one of: ${Wire.blockers.join(', ')}`)
        const note = request.body === undefined || request.body === '' ? undefined : Wire.clampNote(request.body)
        const state: CommRung = {
          piece,
          rung,
          blocker,
          ...note === undefined || note === '' ? {} : { note },
          session: me.id,
          sessionLabel: me.name ?? me.label,
          ...me.cwd === undefined ? {} : { projectPath: me.cwd },
          updated: new Date().toISOString(),
        }
        await this.store.setRung(me.id, state)
        const line = Wire.statusLine({
          ...me.cwd === undefined ? {} : { project: basename(me.cwd) },
          piece,
          rung,
          blocker,
          session: me.id,
          ...state.note === undefined ? {} : { note: state.note },
        })
        // The ladder's conduit is the group chat (JJ, 1 Sep): the status line
        // posts to the project timeline, visible to everyone and invoking
        // nobody. A chat outside a project records the board alone.
        const studio = this.ctx.get('idealizeStudio')
        if (studio !== undefined && me.cwd !== undefined && me.cwd !== '' && me.cwd !== '/') {
          await studio.record({ project: me.cwd, author: me.id, kind: 'message', body: line })
          return { ok: true, info: `${line}  → group chat` }
        }
        return { ok: true, info: line }
      }

      case 'board':
        return this.board(request.path ?? me?.cwd)

      case 'setStatus': {
        if (me === undefined) return failure('unknown sender session')
        const text = (request.body ?? '').trim()
        await this.store.setStatus(me.id, text === '' ? undefined : text)
        return { ok: true }
      }

      case 'focus': {
        if (request.target === undefined) return failure('no session matching target')
        const found = find(request.target)
        if (!found.ok) return failure(found.error)
        this.ctx.emit('idealize/comm-focus', found.session.id)
        this.ctx.get('idealizeBridge')?.buffer.push({
          kind: 'focus',
          title: `Show ${found.session.label}`,
          body: '',
          sessionId: found.session.id,
        })
        return { ok: true }
      }

      case 'reveal':
        return this.reveal(request, roster, me)

      case 'transcript': {
        const target = request.target ?? request.from
        if (target === undefined) return failure('unknown session')
        const found = find(target)
        if (!found.ok) return failure(found.error)
        const limit = Math.max(1, Math.min(request.limit ?? 10, 50))
        const events = await this.eventsOf(found.session)
        if (events === undefined) return failure(`no transcript available for ${found.session.id}`)
        const exchanges = foldExchanges(events).slice(-limit).map(exchange => ({
          ...exchange,
          ...exchange.answer !== undefined && exchange.answer.length > 4000
            ? { answer: `${exchange.answer.slice(0, 4000)}…` }
            : {},
        }))
        return { ok: true, exchanges }
      }

      case 'spawn':
        return this.spawn(request, me, roster)

      case 'task':
      case 'progress':
      case 'blocked':
      case 'need':
      case 'done':
      case 'post':
      case 'chat':
      case 'studio':
      case 'handoff':
      case 'accept':
      case 'reject':
      case 'decide':
      case 'synthesis':
        return this.studioCommand(request, me, roster, find)
    }
  }

  /**
   * The Studio task commands: assignments and reports write the project's
   * timeline through `ctx.idealizeStudio`; `studio` reads its folded state.
   * Reports record structured events and invoke nobody — routine status stays
   * off every other model's context until that chat reads the board itself.
   */
  private async studioCommand(
    request: CommRequest,
    me: RosterEntry | undefined,
    roster: readonly RosterEntry[],
    find: (target: string) => { ok: true; session: RosterEntry } | { ok: false; error: string },
  ): Promise<CommResponse> {
    const studio = this.ctx.get('idealizeStudio')
    if (studio === undefined) return failure('the Studio timeline is not composed')
    const label = (id: string): string | undefined => {
      const entry = roster.find(candidate => candidate.id === id)
      return entry === undefined ? undefined : entry.name ?? entry.label
    }

    // The Studio coordinator belongs to no project: its board, posts, decisions
    // and deliveries live on the Studio's own timeline, the one the person's
    // Studio chat reads and the phone relay forwards. Recording them on its
    // working folder (the harness home) put its replies where nothing looked
    // (JJ, 14 Sep 2026).
    const own = (entry: RosterEntry | undefined): string | undefined =>
      entry !== undefined && this.store.role(entry.id) === 'studio-agent' ? STUDIO_PROJECT : entry?.cwd
    if (request.command === 'studio') {
      const project = request.path !== undefined && request.path !== '' ? resolve(request.path) : own(me)
      if (project === undefined || project === '' || project === '/') return failure('this chat isn\'t in a project folder — pass --path')
      const state = await studio.state(project)
      const tasks: StudioTaskRow[] = state.tasks.map((task) => {
        const ownerLabel = label(task.owner)
        const attentionOwnerLabel = task.attentionOwner === undefined ? undefined : label(task.attentionOwner)
        return {
          id: task.id,
          goal: task.goal,
          owner: task.owner,
          ...ownerLabel === undefined ? {} : { ownerLabel },
          state: task.state,
          attention: task.attention,
          ...task.attentionOwner === undefined ? {} : { attentionOwner: task.attentionOwner },
          ...attentionOwnerLabel === undefined ? {} : { attentionOwnerLabel },
          updated: task.updated,
        }
      })
      return {
        ok: true,
        info: tasks.length === 0 ? 'no tasks yet' : `${tasks.length} task(s)`,
        tasks,
        ...state.synthesis === undefined
          ? {}
          : { synthesis: { body: state.synthesis.body, stale: state.synthesis.stale, at: state.synthesis.at } },
      }
    }

    if (me === undefined) return failure('unknown sender session')
    const project = own(me)
    if (project === undefined || project === '' || project === '/') return failure('this chat isn\'t in a project folder')

    if (request.command === 'decide') {
      const text = (request.body ?? '').trim()
      if (text === '') return failure('missing decision text')
      await studio.record({ project, author: me.id, kind: 'decision', subtype: 'accepted', body: text })
      return { ok: true, info: 'decision recorded' }
    }

    if (request.command === 'synthesis') {
      if (this.store.role(me.id) === undefined) return failure('only the coordinator publishes the synthesis')
      const text = (request.body ?? '').trim()
      if (text === '') return failure('missing synthesis text')
      await studio.record({ project, author: me.id, kind: 'synthesis', subtype: 'current', body: text })
      return { ok: true, info: 'synthesis published' }
    }

    if (request.command === 'post') {
      const text = (request.body ?? '').trim()
      if (text === '') return failure('missing post text')
      // A group post: on the timeline for everyone, invoking nobody.
      await studio.record({ project, author: me.id, kind: 'message', body: text })
      return { ok: true, info: 'posted to the group chat' }
    }

    if (request.command === 'chat') {
      const events = await studio.timeline(project)
      const wanted = Math.max(1, Math.min(request.limit ?? 20, 100))
      const lines = events
        .filter(event => event.kind === 'message')
        .slice(-wanted)
        .map((event) => {
          const author = label(event.author) ?? event.author
          const target = event.target === undefined ? '' : ` → ${label(event.target) ?? event.target}`
          return `[${event.at}] ${author}${target}: ${event.body ?? ''}`
        })
      return { ok: true, info: lines.length === 0 ? 'no group-chat messages yet' : lines.join('\n') }
    }

    if (request.command === 'task') {
      const goal = (request.body ?? '').trim()
      if (goal === '') return failure('missing task goal')
      if (request.target === undefined) return failure('missing --to owner')
      const found = find(request.target)
      if (!found.ok) return failure(found.error)
      const taskId = `t-${randomUUID().slice(0, 8)}`
      const { delivery } = await studio.deliver({
        project,
        author: me.id,
        kind: 'assignment',
        subtype: 'new-task',
        target: found.session.id,
        taskId,
        body: goal,
      })
      return { ok: true, info: `${taskId} → ${found.session.name ?? found.session.label} (${delivery})` }
    }

    const taskId = (request.task ?? '').trim()
    if (taskId === '') return failure('missing task id')
    const state = await studio.state(project)
    if (!state.tasks.some(task => task.id === taskId)) {
      return failure(`no task '${taskId}' in this project — run \`idealize studio\``)
    }

    switch (request.command) {
      case 'progress': {
        const note = (request.body ?? '').trim()
        await studio.record({
          project, author: me.id, kind: 'task-update', subtype: 'summary', taskId,
          ...note === '' ? {} : { body: note },
        })
        return { ok: true, info: `${taskId} → working` }
      }
      case 'blocked': {
        const cause = (request.body ?? '').trim()
        if (cause === '') return failure('missing blocker cause')
        let owner: RosterEntry | undefined
        if (request.owner !== undefined) {
          const found = find(request.owner)
          if (!found.ok) return failure(found.error)
          owner = found.session
        }
        await studio.record({
          project, author: me.id, kind: 'task-update', subtype: 'blocked', taskId, body: cause,
          ...owner === undefined ? {} : { target: owner.id },
        })
        return { ok: true, info: `${taskId} → waiting (blocked${owner === undefined ? ', unassigned' : ` on ${owner.name ?? owner.label}`})` }
      }
      case 'need': {
        const question = (request.body ?? '').trim()
        if (question === '') return failure('missing question')
        let target = 'user'
        let targetLabel = 'user'
        if (request.owner !== undefined && request.owner !== 'user') {
          const found = find(request.owner)
          if (!found.ok) return failure(found.error)
          target = found.session.id
          targetLabel = found.session.name ?? found.session.label
        }
        const subtype = request.action === true ? 'needs-action' : 'needs-input'
        await studio.record({ project, author: me.id, kind: 'request', subtype, taskId, target, body: question })
        return { ok: true, info: `${taskId} → waiting (${subtype} → ${targetLabel})` }
      }
      case 'done': {
        const outcome = (request.body ?? '').trim()
        if (outcome === '') return failure('missing outcome — say what was delivered')
        await studio.record({ project, author: me.id, kind: 'task-update', subtype: 'done', taskId, body: outcome })
        return { ok: true, info: `${taskId} → done (awaiting acknowledgement)` }
      }
      case 'handoff': {
        const task = state.tasks.find(candidate => candidate.id === taskId)
        if (task?.owner !== me.id) return failure('only the task\'s owner can offer it')
        if (task.handoff !== undefined) return failure(`already offered to ${label(task.handoff.to) ?? task.handoff.to}`)
        if (request.target === undefined) return failure('missing --to recipient')
        const found = find(request.target)
        if (!found.ok) return failure(found.error)
        if (found.session.id === me.id) return failure('a handoff names another chat')
        const reason = (request.body ?? '').trim()
        const { delivery } = await studio.deliver({
          project, author: me.id, kind: 'handoff', subtype: 'offered', target: found.session.id, taskId,
          ...reason === '' ? {} : { body: reason },
        })
        return { ok: true, info: `${taskId} offered to ${found.session.name ?? found.session.label} (${delivery})` }
      }
      case 'accept':
      case 'reject': {
        const task = state.tasks.find(candidate => candidate.id === taskId)
        const handoff = task?.handoff
        if (handoff === undefined) return failure(`no open handoff on '${taskId}'`)
        if (handoff.to !== me.id) return failure(`that handoff is addressed to ${label(handoff.to) ?? handoff.to}`)
        const reason = (request.body ?? '').trim()
        await studio.record({
          project, author: me.id, kind: 'handoff',
          subtype: request.command === 'accept' ? 'accepted' : 'rejected',
          taskId, source: { event: handoff.event },
          ...reason === '' ? {} : { body: reason },
        })
        return {
          ok: true,
          info: request.command === 'accept'
            ? `${taskId} is yours (was ${label(handoff.from) ?? handoff.from}'s)`
            : `${taskId} declined; ${label(handoff.from) ?? handoff.from} keeps it`,
        }
      }
      default:
        return failure(`unhandled studio command '${request.command}'`)
    }
  }

  private async eventsOf(entry: RosterEntry): Promise<readonly SessionEvent[] | undefined> {
    if (entry.live !== undefined) return entry.live.session.events
    const persistence = this.ctx.get('sessionPersistence')
    if (persistence === undefined) return undefined
    try {
      return (await persistence.inspect(SessionId(entry.id))).events
    } catch {
      return undefined
    }
  }

  private async reveal(request: CommRequest, roster: readonly RosterEntry[], me: RosterEntry | undefined): Promise<CommResponse> {
    const raw = request.target
    if (raw === undefined || raw === '') return failure('missing path')
    let path: string
    try {
      path = await realpath(resolve(raw))
    } catch {
      return failure(`no such file: ${resolve(raw)}`)
    }
    const owners: RosterEntry[] = []
    for (const entry of roster) {
      if (entry.cwd === undefined) continue
      let root: string
      try {
        root = await realpath(entry.cwd)
      } catch {
        continue
      }
      if (path === root || path.startsWith(`${root}${sep}`)) owners.push(entry)
    }
    const owner = owners.find(entry => entry.id === me?.id) ?? owners[0]
    if (owner === undefined) return failure(`${path} isn't inside any folder open in IDEalize`)
    const open = request.open === true
    this.ctx.emit('idealize/comm-reveal', path, open, owner.id)
    this.ctx.get('idealizeBridge')?.buffer.push({
      kind: 'reveal',
      title: `Look at ${basename(path)}`,
      body: path,
      sessionId: owner.id,
    })
    return { ok: true, info: `revealed ${basename(path)} in ${owner.label}` }
  }

  /**
   * The one-line mailbox note a Studio event earns, or undefined for the
   * events that must not invoke anyone (FR-P0-15: routine status changes the
   * fold and wakes nobody).
   * @param event - the committed Studio event.
   * @returns the note, or undefined when the event is not a wake trigger.
   */
  private wakeLine(event: StudioEvent): string | undefined {
    if (event.author === 'idealize') return undefined
    const body = event.body === undefined || event.body === '' ? '' : `: ${event.body}`
    if (event.kind === 'task-update' && event.subtype === 'blocked' && event.target === undefined) {
      return `unowned blocker on ${event.taskId ?? '?'}${body}`
    }
    if (event.kind === 'task-update' && event.subtype === 'done') return `${event.taskId ?? '?'} reported done${body}`
    if (event.kind === 'decision') return `decision recorded${body}`
    if (event.kind === 'delivery') return `delivery linked on ${event.taskId ?? '?'}${body}`
    if (event.kind === 'handoff' && event.subtype === 'accepted') return `${event.taskId ?? '?'} changed hands (accepted by ${event.author})`
    // A group post is addressed to everyone, so the coordinator hears about
    // it (JJ, 2 Sep); an addressed message reached its own recipient instead.
    if (event.kind === 'message' && event.target === undefined) return `group post from ${event.author}${body}`
    return undefined
  }

  /**
   * Wake the project's coordinator for a qualifying Studio event: a mailbox
   * note always, plus one model invocation when the coordinator is live,
   * idle, and had an empty mailbox — so a burst invokes it once and the rest
   * waits in the inbox. The event's own author is never woken.
   * @param event - the committed Studio event.
   */
  async wakeCoordinator(event: StudioEvent): Promise<void> {
    const line = this.wakeLine(event)
    if (line === undefined) return
    const roster = await this.roster()
    const coordinator = roster.find(entry => entry.role === 'project-agent' && entry.cwd === event.project)
    if (coordinator === undefined || coordinator.id === event.author) return
    await this.deliver(coordinator, {
      from: 'studio',
      fromLabel: 'Studio',
      body: `[studio] ${line}`,
      timestamp: new Date().toISOString(),
    })
    if (coordinator.live !== undefined && coordinator.live.status === 'idle' && this.store.unread(coordinator.id) === 1) {
      coordinator.live.followup(createUserMessage({
        content: [{ type: 'text', text: WAKE_NOTICE }],
        source: { kind: 'plugin', plugin: 'idealize-comm', form: 'notice', summary: 'Studio wake' },
      }))
    }
  }

  /**
   * The safety net under the prompt's posting rule: when a turn that called a
   * generation tool ends and the agent posted nothing to the Studio during it,
   * one `idealize`-authored `message` on the project's timeline says who
   * generated what, with the artefact ids, and links the agent's chat through
   * `source.thread`. Nothing is recorded for a turn with no generation call,
   * a generation that stored no artefact (its failure is in the agent's own
   * chat), a chat outside a project, the Studio chat, or a turn in which the
   * agent posted itself (any `message` it authored, a `rung` line included).
   * The system author keeps the coordinator asleep: the line reports an act
   * and asks nobody to do anything. An artefact stored after the turn ended
   * (a `run_in_background` generation) takes the {@link noteBackgroundArtefact} path.
   * @param session - the session whose turn ended; its log is read up to that turn's end.
   * @param turn - the ended turn's number.
   * @returns the recorded line, or undefined when nothing was recorded.
   */
  async reportFinishedTurn(session: Session, turn: number): Promise<string | undefined> {
    const events = session.events
    const project = postingProject(session)
    if (project === undefined) return undefined
    const start = events.find(event => event.type === 'turn/start' && event.data.turn === turn)
    if (start === undefined) return undefined
    let generated = false
    const records: ArtefactSummary[] = []
    for (const event of events) {
      if (event.seq <= start.seq) continue
      if (event.type === 'turn/end' && event.data.turn === turn) break
      if (event.type === 'tool/call' && GENERATION_TOOLS.has(event.data.name)) generated = true
      else if (event.type === 'artefact/created') records.push(summarise(event.data.record))
    }
    if (!generated || records.length === 0) return undefined
    const studio = this.ctx.get('idealizeStudio')
    if (studio === undefined) return undefined
    const id = String(session.header.id)
    const posted = (await studio.timeline(project)).some(event =>
      event.kind === 'message' && event.author === id && Date.parse(event.at) >= start.time)
    if (posted) return undefined
    return this.postSystemLine(session, project, name => `${name} generated ${describeArtefacts(records)}`)
  }

  /**
   * The safety net's second path: a generation tool run with
   * `run_in_background` stores its artefacts after the turn that started it
   * has ended, where {@link reportFinishedTurn} never sees them. An
   * `artefact/created` event whose record names a generation tool as its
   * source, and whose own turn (`sourceTask.turnSeq`) has already ended,
   * joins the session's pending batch; the batch's window
   * (`backgroundPostDelayMs`) restarts on every arrival, and when it closes
   * one `idealize`-authored `message` reports the batch. An artefact whose
   * own turn is still running (every foreground generation), a chat outside a
   * project, and the Studio chat are ignored.
   * Disposing the plugin, or the session ({@link forgetSession}), drops a
   * pending batch unposted.
   * @param session - the session whose log gained the event; its log decides whether a turn is open.
   * @param event - the `artefact/created` event as appended.
   */
  noteBackgroundArtefact(session: Session, event: SessionEvent<'artefact/created'>): void {
    const record = event.data.record
    if (!GENERATION_TOOLS.has(record.sourceTask.toolName)) return
    if (!sourceTurnEnded(session.events, record.sourceTask.turnSeq, event.seq)) return
    if (postingProject(session) === undefined) return
    const id = String(session.header.id)
    const pending = this.pendingBackground.get(id)
    if (pending !== undefined) clearTimeout(pending.timer)
    const records = pending?.records ?? []
    records.push(summarise(record))
    const timer = setTimeout(() => {
      this.pendingBackground.delete(id)
      this.postBackgroundBatch(session, records).catch((error: unknown) => {
        this.ctx.logger.warn(`idealize-comm: background note failed: ${String(error)}`)
      })
    }, this.config().backgroundPostDelayMs)
    timer.unref()
    this.pendingBackground.set(id, { session, records, timer })
  }

  /**
   * Drop a session's pending background batch: the session is gone, so its
   * line would name a chat the Studio row cannot open.
   * @param session - the disposed session.
   */
  forgetSession(session: Session): void {
    const id = String(session.header.id)
    const pending = this.pendingBackground.get(id)
    if (pending === undefined) return
    clearTimeout(pending.timer)
    this.pendingBackground.delete(id)
  }

  /**
   * Post the closed batch. The project is re-read at post time in case the
   * session's log changed while the window was open.
   * @returns the recorded line, or undefined when the Studio is not composed or the session no longer posts.
   */
  private async postBackgroundBatch(session: Session, records: readonly ArtefactSummary[]): Promise<string | undefined> {
    const project = postingProject(session)
    if (project === undefined) return undefined
    return this.postSystemLine(session, project, name => `${name} finished generating ${describeArtefacts(records)} in the background`)
  }

  /**
   * Record one system-authored line on the project's timeline, naming the
   * agent from the store, else the log, else the session id, and linking the
   * chat through `source.thread`.
   * @returns the recorded body, or undefined when no Studio service is composed.
   */
  private async postSystemLine(session: Session, project: string, compose: (name: string) => string): Promise<string | undefined> {
    const studio = this.ctx.get('idealizeStudio')
    if (studio === undefined) return undefined
    const id = String(session.header.id)
    await this.store.load()
    const body = compose(this.store.name(id) ?? foldAgentName(session.events) ?? id)
    await studio.record({ project, author: SYSTEM_AUTHOR, kind: 'message', body, source: { thread: id } })
    return body
  }

  /**
   * Start a new chat in a project with an opening brief. The child opens in
   * the background (no focus event), so the caller keeps the person's
   * attention; its task title is the caller's `--name`, else one read off the
   * brief. `--coordinator` starts the role chat on its Activity Agent
   * instead, or answers the existing one's id (one coordinator per project).
   */
  /**
   * What a role's chat is composed from: the agent registry, the role's
   * Activity Agent preset (when presets are composed) and the model, the
   * default selection unless the request names one. Shared by a fresh spawn
   * and a resume so the two never drift.
   */
  private async composition(role: CommRole | undefined, model: string | undefined): Promise<
    | { ok: true; agents: Context['agents']; presets: Context['agentPresets'] | undefined; presetId: string | undefined; selection: { provider: string; model: string } }
    | { ok: false; failure: CommResponse }
  > {
    // Late-mounted plugins settle before the child composes, as the cron runner does.
    const loader = this.ctx.get('loader') as unknown as { await?: () => Promise<void> } | undefined
    await loader?.await?.()
    const agents = this.ctx.get('agents')
    const defaultModel = this.ctx.get('agentDefaultModel')
    if (agents === undefined || defaultModel === undefined) {
      return { ok: false, failure: failure('agent services unavailable (tree still composing or tearing down)') }
    }
    const fallback = defaultModel.currentSelection()
    const selection = { provider: fallback.provider, model: model ?? fallback.model }
    const presets = this.ctx.get('agentPresets')
    let presetId: string | undefined
    if (presets !== undefined) {
      const wanted = role === undefined ? undefined : presetOfRole(role, this.config())
      try {
        presetId = (await presets.resolve(wanted)).id
      } catch (error) {
        return { ok: false, failure: failure(`the ${role === undefined ? 'default' : ROLE_TITLES[role]} Activity Agent is unavailable: ${error instanceof Error ? error.message : String(error)}`) }
      }
    }
    return { ok: true, agents, presets, presetId, selection }
  }

  /**
   * Resume a stored role chat on its own persisted history, composed as a
   * fresh one would be, and wake it once when its mailbox already holds
   * mail: `send` invokes only a live recipient with exactly one unread note,
   * so a backlog left from an earlier run would otherwise wait for the
   * person's next note and then still not be read.
   * @param existing - the stored roster entry (not live).
   * @param role - the role it carries.
   * @param model - the model the request names, if any.
   * @returns the resumed session's id, or why it could not be resumed.
   */
  private async revive(existing: RosterEntry, role: CommRole, model: string | undefined): Promise<CommResponse> {
    const composed = await this.composition(role, model)
    if (!composed.ok) return composed.failure
    const { agents, presets, presetId, selection } = composed
    let agent: Agent
    try {
      agent = (await agents.resume({
        resumeSessionId: SessionId(existing.id),
        agentOptions: { provider: selection.provider, model: selection.model },
        setup: async (agentCtx) => {
          const selected: ModelSelectionRef = { current: selection, assembled: undefined }
          installModelSelection(agentCtx, selected)
          if (presets !== undefined && presetId !== undefined) await presets.mount(agentCtx, presetId)
        },
      })).agent
    } catch (error) {
      return failure(error instanceof Error ? error.message : String(error))
    }
    if (this.store.unread(existing.id) > 0 && agent.status === 'idle') {
      const fromStudio = this.store.peek(existing.id).some(message => message.from === STUDIO_SENDER)
      agent.followup(createUserMessage({
        content: [{ type: 'text', text: fromStudio ? STUDIO_MAIL_NOTICE : MAIL_NOTICE }],
        source: { kind: 'plugin', plugin: 'idealize-comm', form: 'notice', summary: fromStudio ? 'Studio mail' : 'Mail' },
      }))
    }
    return { ok: true, info: existing.id }
  }

  private async spawn(request: CommRequest, me: RosterEntry | undefined, roster: readonly RosterEntry[]): Promise<CommResponse> {
    // The Studio coordinator belongs to no project: it is found by its role
    // alone, there is one, and it runs in the harness home because the Studio's
    // own records live there and it owns no project's files.
    const studio = request.studio === true
    const project = studio
      ? resolveDshHome()
      : request.path !== undefined && request.path !== '' ? resolve(request.path) : me?.cwd
    if (project === undefined) return failure('no project folder to spawn in — pass a path')
    let canonical: string
    try {
      canonical = await realpath(project)
      if (!(await stat(canonical)).isDirectory()) throw new Error('not a directory')
    } catch {
      return failure(`'${project}' isn't a real project folder to spawn a chat in`)
    }
    const role: CommRole | undefined = studio
      ? 'studio-agent'
      : request.coordinator === true ? 'project-agent' : undefined
    if (role !== undefined) {
      const existing = roster.find(entry => role === 'studio-agent'
        ? entry.role === role
        : entry.role === role && entry.cwd === canonical)
      if (existing?.live !== undefined) return { ok: true, info: existing.id }
      // A stored coordinator outlives the app run that started it. Answering
      // its id alone left every later note in a mailbox nothing read: the
      // Studio posted to it after a restart and nobody replied (JJ, 14 Sep
      // 2026: "nothing happens when you message in the app"). It is resumed
      // on its own history, and woken once when mail is already waiting.
      if (existing !== undefined) {
        const revived = await this.revive(existing, role, request.model)
        if (revived.ok) return revived
        this.ctx.logger.warn(`idealize-comm: ${existing.id} could not be resumed (${revived.error ?? 'unknown'}); starting a fresh ${ROLE_TITLES[role]}`)
      }
    }
    const brief = (request.body ?? '').trim() || (role === undefined ? '' : ROLE_OPENING[role])
    const composed = await this.composition(role, request.model)
    if (!composed.ok) return composed.failure
    const { agents, presets, presetId, selection } = composed
    const sessionId = SessionId(`session-${randomUUID()}`)
    let agent: Agent
    try {
      agent = (await agents.create({
        sessionId,
        meta: { cwd: canonical, ...presetId === undefined ? {} : { agentPreset: presetId } },
        agentOptions: { provider: selection.provider, model: selection.model },
        setup: async (agentCtx) => {
          const selected: ModelSelectionRef = { current: selection, assembled: undefined }
          installModelSelection(agentCtx, selected)
          if (presets !== undefined && presetId !== undefined) await presets.mount(agentCtx, presetId)
        },
      })).agent
    } catch (error) {
      return failure(`couldn't start a chat: ${error instanceof Error ? error.message : String(error)}`)
    }
    const workspaces = studio ? undefined : this.ctx.get('workspaceRegistry')
    if (workspaces !== undefined) {
      try {
        const workspace = workspaces.list().find(candidate => candidate.path === canonical) ?? await workspaces.create(canonical)
        await workspace.attachSession(sessionId)
      } catch (error) {
        this.ctx.logger.warn(`idealize-comm: spawned ${String(sessionId)} but could not attach it to a project: ${String(error)}`)
      }
    }
    const title = role !== undefined
      ? ROLE_TITLES[role]
      : (request.name === undefined ? undefined : chatNameFromTask(request.name))
        ?? (brief === '' ? undefined : chatNameFromTask(brief))
    if (title !== undefined) {
      await this.store.setTitle(String(sessionId), title)
      try {
        this.ctx.get('sessionTitle')?.rename(agent.session, title)
      } catch (error) {
        this.ctx.logger.warn(`idealize-comm: title for ${String(sessionId)} not set: ${String(error)}`)
      }
    }
    if (role !== undefined) await this.store.setRole(String(sessionId), role)
    if (brief !== '') {
      agent.followup(createUserMessage({
        content: [{ type: 'text', text: brief }],
        source: { kind: 'user' },
      }))
    }
    return { ok: true, info: String(sessionId) }
  }
}
