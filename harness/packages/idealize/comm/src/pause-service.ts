/**
 * `ctx.idealizePause` — pausing every agent (feedback 495cec0a) on a live
 * host: {@link PauseController}'s rules over the agents, the Terminal chats'
 * shells, the documentation folder, the schedule and the mailboxes. Every
 * service outside this package is probed by name, so comm takes no new
 * dependency: a composition without terminals, notes or a schedule pauses the
 * chat agents it has.
 * @module @idealize/comm/pause-service
 */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { resolveSessionPreset } from '@deepseek-ai/dsh-agent-presets'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-projection-cache'
import type {} from '@idealize/host-bridge'
import { foldBrain } from '@idealize/spaces'
import { PauseController, PauseFile, pauseDocumentPath } from './pause.ts'
import type { PauseSnapshot, PauseStore, PauseWorld, ShellToOpen, TerminalLineOutcome, TerminalPauseLines, WorkingChat } from './pause.ts'
import type { RosterEntry } from './service.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    idealizePause: IdealizePause
  }
}

/** The Terminal chats' service, as far as a pause uses it (`@idealize/ui-terminal`). */
interface TerminalsLike {
  working?(): string[]
  nudge?(sessionId: string, text: string, wanted?: () => boolean): boolean
  deliver?(
    sessionId: string, text: string, wanted?: () => boolean, options?: { interruptWith?: string },
  ): Promise<TerminalLineOutcome> | undefined
  interrupt?(sessionId: string): boolean
  onOpened?(listener: (sessionId: string) => void): () => void
}

/** The documentation service, as far as a pause uses it (`@idealize/doc-policy`). */
interface DocPolicyLike {
  projectFolder?(projectPath: string): Promise<{ path: string } | undefined>
}

/** The scheduler, as far as a pause uses it (`@idealize/cron`). */
interface CronLike {
  releaseHeld?(): Promise<unknown>
}

/** The API gateway's prompt, which wakes a stored chat composed as it was (`dsh-host-apiproxy`). */
interface ApiProxyLike {
  sessions: {
    prompt(request: {
      rpcId: string
      payload: { sessionId: string; mode: 'queue' | 'steer'; content: { type: 'text'; text: string }[] }
    }): Promise<{ result: { ok: true } | { ok: false; error: { message: string } } }>
  }
}

/**
 * Read a service this package does not declare.
 * @param ctx - the host context.
 * @param name - the service name.
 * @returns the service, or undefined where it is not composed.
 */
function probe(ctx: Context, name: string): unknown {
  return (ctx as unknown as { get(name: string): unknown }).get(name)
}

/**
 * A notice from the pause, in the chat as IDEalize's own words.
 * @param text - what the agent is told.
 * @param summary - the notice's one-word label.
 * @returns the message.
 */
function notice(text: string, summary: 'Pause' | 'Resume') {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: 'idealize-comm', form: 'notice', summary },
  })
}

/** {@link PauseWorld} over a live host. */
export class HostPauseWorld implements PauseWorld {
  /** @param ctx - the host context the pause acts through. */
  constructor(private readonly ctx: Context) {}

  private terminals(): TerminalsLike | undefined {
    return probe(this.ctx, 'idealizeTerminals') as TerminalsLike | undefined
  }

  private live(id: string): Agent | undefined {
    return this.ctx.get('agents')?.roots().find(agent => String(agent.session.header.id) === id)
  }

  /**
   * The brain a Terminal chat's shell launches: the latest it records, else
   * the preset it was created on; a stored chat answers from the projection
   * checkpoint, the way the sidebar does.
   */
  private async brainOf(entry: RosterEntry): Promise<string | undefined> {
    if (entry.live !== undefined) {
      const { header, events } = entry.live.session
      return foldBrain(events) ?? resolveSessionPreset({ header, events })
    }
    const header = (await this.ctx.get('sessionPersistence')?.list())?.find(candidate => String(candidate.id) === entry.id)
    if (header === undefined) return undefined
    const values = this.ctx.get('sessionProjectionCache')?.cachedSnapshot(header)?.values as { brain?: { brain?: string } } | undefined
    return values?.brain?.brain ?? header.agentPreset
  }

  async working(): Promise<WorkingChat[]> {
    const comm = this.ctx.get('idealizeComm')
    if (comm === undefined) return []
    const terminal = new Set(this.terminals()?.working?.() ?? [])
    const chats: WorkingChat[] = []
    for (const entry of await comm.roster()) {
      const inTerminal = terminal.has(entry.id)
      if (!inTerminal && entry.live?.status !== 'running') continue
      const activity = inTerminal ? await this.brainOf(entry) : undefined
      chats.push({
        id: entry.id,
        kind: inTerminal ? 'terminal' : 'chat',
        label: entry.name ?? entry.label,
        ...entry.name === undefined ? {} : { name: entry.name },
        ...entry.cwd === undefined ? {} : { cwd: entry.cwd },
        ...activity === undefined ? {} : { activity },
      })
    }
    return chats
  }

  async saveChat(id: string, text: string): Promise<void> {
    const agent = this.live(id)
    if (agent === undefined) return
    agent.steer(notice(text, 'Pause'))
    await agent.whenIdle()
  }

  saveTerminal(id: string, lines: TerminalPauseLines, wanted: () => boolean): Promise<TerminalLineOutcome> | undefined {
    return this.terminals()?.deliver?.(id, lines.save, wanted, { interruptWith: lines.wrapUp })
  }

  stopChat(id: string): void {
    this.live(id)?.cancel({ kind: 'user' })
  }

  stopTerminal(id: string): void {
    this.terminals()?.interrupt?.(id)
  }

  async carryOnChat(id: string, text: string): Promise<void> {
    const agent = this.live(id)
    if (agent !== undefined) {
      // The person already picked this chat up themselves.
      if (agent.status === 'running') return
      agent.followup(notice(text, 'Resume'))
      return
    }
    // A chat stored since the pause (the app restarted) wakes through the
    // gateway's prompt, which composes it as it ran.
    const api = probe(this.ctx, 'apiProxy') as ApiProxyLike | undefined
    if (api === undefined) throw new Error(`no gateway to wake ${id}`)
    const { result } = await api.sessions.prompt({
      rpcId: `idealize-pause-${randomUUID()}`,
      payload: { sessionId: id, mode: 'queue', content: [{ type: 'text', text }] },
    })
    if (!result.ok) throw new Error(result.error.message)
  }

  carryOnTerminal(id: string, text: string): boolean {
    return this.terminals()?.nudge?.(id, text) === true
  }

  async notesFolder(cwd: string): Promise<string | undefined> {
    return (await (probe(this.ctx, 'docPolicy') as DocPolicyLike | undefined)?.projectFolder?.(cwd))?.path
  }

  unread(id: string): number {
    return this.ctx.get('idealizeComm')?.state.unread(id) ?? 0
  }

  async releaseSchedule(): Promise<void> {
    await (probe(this.ctx, 'idealizeCron') as CronLike | undefined)?.releaseHeld?.()
  }

  async releaseMail(skip: ReadonlySet<string>): Promise<void> {
    await this.ctx.get('idealizeComm')?.releaseHeldMail(skip)
  }

  announce(): void {
    this.ctx.get('idealizeBridge')?.buffer.push({ kind: 'pause-changed', title: 'Pause changed', body: '' })
  }

  warn(message: string): void {
    this.ctx.logger.warn(`idealize-pause: ${message}`)
  }

  now(): Date {
    return new Date()
  }
}

/** Options a test passes to swap the host for fakes. */
export interface IdealizePauseOptions {
  world?: PauseWorld
  store?: PauseStore
}

/** The pause as a host service: the sidebar's routes and the desktop's quit dialog both use it. */
export class IdealizePause extends Service {
  private readonly controller: PauseController

  constructor(ctx: Context, options: IdealizePauseOptions = {}) {
    super(ctx, 'idealizePause')
    this.controller = new PauseController(
      options.world ?? new HostPauseWorld(ctx),
      options.store ?? new PauseFile(pauseDocumentPath(resolveDshHome())),
    )
    // A Terminal chat whose shell was closed when Resume was pressed gets its
    // line once the shell opens.
    ;(ctx as unknown as { inject(deps: string[], callback: (scoped: Context) => void): void }).inject(['idealizeTerminals'], (scoped) => {
      const terminals = probe(scoped, 'idealizeTerminals') as TerminalsLike | undefined
      scoped.effect(() => terminals?.onOpened?.((sessionId) => { this.controller.opened(sessionId) }) ?? (() => {}), 'idealize-pause: terminal opens')
    })
  }

  /** @returns true from Pause until Resume: schedule runs and note wakes wait. */
  held(): boolean {
    return this.controller.held()
  }

  /** @returns the pause as the windows show it. */
  snapshot(): Promise<PauseSnapshot> {
    return this.controller.snapshot()
  }

  /** @returns the pause after every working agent was told to save its notes. */
  pause(): Promise<PauseSnapshot> {
    return this.controller.pause()
  }

  /** @returns the pause after every agent still saving was interrupted. */
  stopNow(): Promise<PauseSnapshot> {
    return this.controller.stopNow()
  }

  /** @returns the pause after every paused agent was told to carry on, and the shells to open. */
  resume(): Promise<PauseSnapshot & { open: ShellToOpen[] }> {
    return this.controller.resume()
  }

  /**
   * @param listener - called after each change of the pause.
   * @returns a function that stops the listening.
   */
  onChange(listener: () => void): () => void {
    return this.controller.onChange(listener)
  }
}
