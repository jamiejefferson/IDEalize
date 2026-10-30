/**
 * Pausing every agent (feedback 495cec0a, JJ 30 Oct 2026): "a 'pause' button
 * so that all live agent work can get paused safely… when its time to shut the
 * mac down, you can press pause and all active agents save their workings etc
 * ready to be picked up as soon as work is 'un-paused'."
 *
 * JJ's rulings the same day: an agent that is mid-task saves notes, then stops,
 * and Pause waits for each one with Stop now to cut the wait; the control sits
 * at the bottom of the sidebar; quitting while agents work asks whether to
 * pause them first. Later the same day, for terminal agents: "if a terminal
 * agent is in the middle of a run, the pause button needs to interrupt and get
 * the agent to wrap up safely ready to restart when prompted". A chat agent
 * already reads the save line mid-turn (it is spliced into the running turn);
 * a terminal agent mid-run is now stopped first and given {@link wrapUpLine}.
 *
 * The phases: `running` → Pause → `saving` while working agents write their
 * notes → `paused` once every one has stopped (or Stop now) → Resume →
 * `running`. Pressing Pause with nobody working goes straight to `paused`.
 * Anything but `running` holds the schedule and stops notes between chats
 * from waking anyone. The document survives a restart; a restart during
 * `saving` reads as `paused`, because quitting ended every agent's run.
 *
 * This module is the state machine and its words, over a {@link PauseWorld}
 * the host service supplies, so the rules test without a live host.
 * @module @idealize/comm/pause
 */

import { readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** Where every agent stands. */
export type PausePhase = 'running' | 'saving' | 'paused'

/** One paused chat's progress through the pause. */
export type PausedChatState = 'saving' | 'stopped'

/** What a working agent runs in: the chat's own agent, or the CLI in its terminal. */
export type PausedChatKind = 'chat' | 'terminal'

/** One chat whose agent was working when Pause was pressed. */
export interface PausedChat {
  id: string
  kind: PausedChatKind
  /** The chat's agent name or title, as the sidebar names it. */
  label: string
  cwd?: string
  /** The note the agent was asked to write; absent when the project keeps no notes folder. */
  note?: string
  /** A terminal chat's brain, so Resume can reopen its shell on the right CLI. */
  activity?: string
  state: PausedChatState
  /** True once the agent finished its notes; false when Stop now cut it short. */
  saved: boolean
}

/** A carry-on line Resume could not type yet: its terminal chat had no shell open. */
export interface OwedLine {
  id: string
  text: string
}

/** The persisted document. */
export interface PauseDocument {
  phase: PausePhase
  /** When Pause was pressed, ISO-8601. */
  since?: string
  chats: PausedChat[]
  owed: OwedLine[]
}

/** One chat whose agent is working now, as the host finds it. */
export interface WorkingChat {
  id: string
  kind: PausedChatKind
  label: string
  /** The agent's name, for its note's file name. */
  name?: string
  cwd?: string
  activity?: string
}

/** A terminal chat's two pause lines: for an agent at its prompt, and for one the pause interrupts. */
export interface TerminalPauseLines {
  /** The agent was at its prompt. */
  save: string
  /** The agent was in the middle of a run and has just been stopped. */
  wrapUp: string
}

/** What became of a line typed into a terminal (restated from `@idealize/ui-terminal`). */
export type TerminalLineOutcome = 'answered' | 'dropped' | 'gone'

/** A terminal chat Resume could not reach, for the window to open its shell. */
export interface ShellToOpen {
  sessionId: string
  cwd?: string
  activity?: string
}

/** The pause as the sidebar and the quit dialog read it. */
export interface PauseSnapshot {
  phase: PausePhase
  since?: string
  chats: { id: string; label: string; kind: PausedChatKind; state: PausedChatState }[]
  /** Agents still writing their notes. */
  saving: number
  /** Agents working right now; counted only while running, for the quit dialog. */
  working: number
}

/** The host the pause acts on. */
export interface PauseWorld {
  /** Every chat whose agent is working now. */
  working(): Promise<WorkingChat[]>
  /** Tell a working chat's agent to save its notes; settles once it has stopped. */
  saveChat(id: string, text: string): Promise<void>
  /**
   * Type the save line into a terminal chat; settles once answered, or
   * undefined with no shell. An agent in the middle of a run is interrupted
   * first and gets the wrap-up line instead.
   */
  saveTerminal(id: string, lines: TerminalPauseLines, wanted: () => boolean): Promise<TerminalLineOutcome> | undefined
  /** Cancel a chat agent's turn. */
  stopChat(id: string): void
  /** Interrupt a terminal chat's CLI. */
  stopTerminal(id: string): void
  /** Tell a paused chat's agent to carry on, waking a stored chat if need be. */
  carryOnChat(id: string, text: string): Promise<void>
  /** Type the carry-on line into a terminal chat; false when it has no shell open. */
  carryOnTerminal(id: string, text: string): boolean
  /** The project's notes folder, when the documentation folder holds one. */
  notesFolder(cwd: string): Promise<string | undefined>
  /** How many notes wait in a chat's inbox. */
  unread(id: string): number
  /** Run the schedule tasks the pause held. */
  releaseSchedule(): Promise<void>
  /** Wake the chats, other than `skip`, whose inbox filled while paused. */
  releaseMail(skip: ReadonlySet<string>): Promise<void>
  /** Tell the windows the pause changed. */
  announce(): void
  /** Report a failure that must not stop the pause. */
  warn(message: string): void
  now(): Date
}

const RUNNING: PauseDocument = { phase: 'running', chats: [], owed: [] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(record: Record<string, unknown>, key: string): Record<string, string> {
  const value = record[key]
  return typeof value === 'string' && value !== '' ? { [key]: value } : {}
}

/**
 * Read a stored document, dropping what is malformed. A document stored
 * mid-save reads as paused with every chat stopped unsaved: the app quit, and
 * quitting ended every agent's run.
 * @param text - the document's JSON text.
 * @returns the document; unreadable text reads as running.
 */
export function parsePauseDocument(text: string): PauseDocument {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return structuredClone(RUNNING)
  }
  if (!isRecord(raw)) return structuredClone(RUNNING)
  const phase = raw.phase === 'saving' || raw.phase === 'paused' ? raw.phase : 'running'
  const chats: PausedChat[] = (Array.isArray(raw.chats) ? raw.chats : []).flatMap((entry): PausedChat[] => {
    if (!isRecord(entry) || typeof entry.id !== 'string' || (entry.kind !== 'chat' && entry.kind !== 'terminal')) return []
    const stopped = phase === 'saving' || entry.state === 'stopped'
    return [{
      id: entry.id,
      kind: entry.kind,
      label: typeof entry.label === 'string' ? entry.label : entry.id,
      ...optionalString(entry, 'cwd'),
      ...optionalString(entry, 'note'),
      ...optionalString(entry, 'activity'),
      state: stopped ? 'stopped' : 'saving',
      saved: entry.state === 'stopped' && entry.saved === true,
    }]
  })
  const owed: OwedLine[] = (Array.isArray(raw.owed) ? raw.owed : []).flatMap((entry): OwedLine[] =>
    isRecord(entry) && typeof entry.id === 'string' && typeof entry.text === 'string' ? [{ id: entry.id, text: entry.text }] : [])
  return {
    phase: phase === 'saving' ? 'paused' : phase,
    ...typeof raw.since === 'string' && phase !== 'running' ? { since: raw.since } : {},
    chats: phase === 'running' ? [] : chats,
    owed,
  }
}

/**
 * Where the document lives under one harness home.
 * @param dshHome - the harness home directory.
 * @returns the absolute path of `idealize/pause.json` under it.
 */
export function pauseDocumentPath(dshHome: string): string {
  return join(dshHome, 'idealize', 'pause.json')
}

/**
 * Where a project without a notes folder keeps its pause notes: IDEalize's own
 * folder inside the project, which a chat's sandbox lets it write. A file is
 * needed even there, because a Codex or Kimi chat reopens with no conversation
 * after a restart and has only its note to go on (Part A, 30 Oct 2026).
 * @param cwd - the project folder.
 * @returns the folder's absolute path.
 */
export function fallbackNotesFolder(cwd: string): string {
  return join(cwd, '.idealize', 'paused')
}

/**
 * The note one agent writes when paused: its own file beside the project's
 * index, so agents pausing together never write over each other's notes.
 * @param folder - the project's notes folder.
 * @param name - the agent's name, or the chat's label.
 * @param date - the pause's ISO date (`2026-10-30`).
 * @returns the note's absolute path.
 */
export function pauseNotePath(folder: string, name: string, date: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '') || 'agent'
  return join(folder, `${date}-paused-${slug}.md`)
}

/**
 * What a working agent is told when Pause is pressed.
 * @param note - the note to write, when the project keeps a notes folder.
 * @returns one line, so a terminal agent receives it whole.
 */
export function saveNotesLine(note: string | undefined): string {
  const where = note === undefined ? 'in your reply' : `into ${note}`
  return 'IDEalize is pausing every agent so the person can shut the computer down. '
    + `Stop the current task at the next safe point, write where you got to and the exact next step ${where}, `
    + 'then end your turn and start nothing new.'
}

/**
 * What a terminal agent is told after the pause has interrupted it mid-run.
 * The interrupt can land in the middle of a step, so the agent checks what
 * finished before it writes anything down.
 * @param note - the note to write, when the project keeps a notes folder.
 * @returns one line, so a terminal agent receives it whole.
 */
export function wrapUpLine(note: string | undefined): string {
  const where = note === undefined ? 'in your reply' : `into ${note}`
  return 'IDEalize interrupted you because the person is pausing every agent to shut the computer down. '
    + 'Check whether your last step finished, such as a file write or a command, and note anything left half done. '
    + `Then write where you got to and the exact next step ${where}, end your turn and start nothing new.`
}

/**
 * What a paused agent is told when Resume is pressed. The note leads, because
 * a terminal agent may come back with no conversation at all.
 * @param chat - the paused chat.
 * @param unread - how many notes reached its inbox meanwhile.
 * @returns one line, so a terminal agent receives it whole.
 */
export function carryOnLine(chat: Pick<PausedChat, 'note' | 'saved'>, unread: number): string {
  const resume = chat.note === undefined
    ? chat.saved
      ? 'IDEalize has resumed after a pause. Carry on from the next step your last reply names.'
      : 'IDEalize has resumed after a pause that stopped you mid-task. Carry on with the task you were doing from where it stopped.'
    : chat.saved
      ? `IDEalize has resumed after a pause. Read ${chat.note} and carry on from the next step it names.`
      : `IDEalize has resumed after a pause that stopped you before your notes were finished. Read ${chat.note} if it exists, then carry on with the task you were doing.`
  const inbox = unread > 0
    ? ' Notes reached your inbox while you were paused: run `idealize inbox` (or call `idealize_inbox`) first.'
    : ''
  return `${resume}${inbox}`
}

/** The document on disk: read once at start, written atomically and in order. */
export class PauseFile {
  #chain: Promise<void> = Promise.resolve()

  /** @param path - the document's absolute path. */
  constructor(readonly path: string) {}

  /**
   * Read the stored document; a missing or unreadable file reads as running.
   * Synchronous, so the pause holds from the first moment the host runs.
   * @returns the document.
   */
  load(): PauseDocument {
    try {
      return parsePauseDocument(readFileSync(this.path, 'utf8'))
    } catch {
      return structuredClone(RUNNING)
    }
  }

  /**
   * Queue one write of the document.
   * @param document - the document to store.
   * @returns once this write has landed.
   */
  save(document: PauseDocument): Promise<void> {
    const text = `${JSON.stringify(document, null, 2)}\n`
    this.#chain = this.#chain.then(async () => {
      await mkdir(dirname(this.path), { recursive: true })
      const tmp = `${this.path}.tmp`
      await writeFile(tmp, text)
      await rename(tmp, this.path)
    })
    return this.#chain
  }
}

/** The document store a controller writes through; {@link PauseFile} on a real host. */
export interface PauseStore {
  load(): PauseDocument
  save(document: PauseDocument): Promise<void>
}

/** The pause: one document, three actions, and the reads the windows make. */
export class PauseController {
  #document: PauseDocument
  readonly #listeners = new Set<() => void>()
  #queue: Promise<unknown> = Promise.resolve()

  /**
   * @param world - the host the pause acts on.
   * @param store - where the document persists.
   */
  constructor(private readonly world: PauseWorld, private readonly store: PauseStore) {
    this.#document = store.load()
  }

  /**
   * Whether agent work is held: anything but running.
   * @returns true from Pause until Resume.
   */
  held(): boolean {
    return this.#document.phase !== 'running'
  }

  /**
   * The pause as the windows show it.
   * @returns the phase, the paused chats and the counts.
   */
  async snapshot(): Promise<PauseSnapshot> {
    const { phase, since, chats } = this.#document
    return {
      phase,
      ...since === undefined ? {} : { since },
      chats: chats.map(({ id, label, kind, state }) => ({ id, label, kind, state })),
      saving: chats.filter(chat => chat.state === 'saving').length,
      working: phase === 'running' ? (await this.world.working()).length : 0,
    }
  }

  /**
   * Hear every change of the pause.
   * @param listener - called after each change lands.
   * @returns a function that stops the listening.
   */
  onChange(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  /**
   * Pause every agent: each working one is told to save its notes and stop.
   * Nothing to do while already pausing or paused.
   * @returns the pause after the press.
   */
  pause(): Promise<PauseSnapshot> {
    return this.#serial(async () => {
      if (this.#document.phase !== 'running') return this.snapshot()
      const working = await this.world.working()
      const since = this.world.now().toISOString()
      const date = since.slice(0, 10)
      const chats = await Promise.all(working.map(async (chat): Promise<PausedChat> => {
        const folder = chat.cwd === undefined
          ? undefined
          : await this.world.notesFolder(chat.cwd).catch(() => undefined) ?? fallbackNotesFolder(chat.cwd)
        return {
          id: chat.id,
          kind: chat.kind,
          label: chat.label,
          ...chat.cwd === undefined ? {} : { cwd: chat.cwd },
          ...folder === undefined ? {} : { note: pauseNotePath(folder, chat.name ?? chat.label, date) },
          ...chat.activity === undefined ? {} : { activity: chat.activity },
          state: 'saving',
          saved: false,
        }
      }))
      this.#document = { phase: chats.length === 0 ? 'paused' : 'saving', since, chats, owed: this.#document.owed }
      await this.#changed()
      for (const chat of chats) this.#save(chat)
      return this.snapshot()
    })
  }

  /**
   * Cut the wait: interrupt every agent still writing its notes. Its chat is
   * kept, and Resume tells it to carry on from where it stopped.
   * @returns the pause after the press.
   */
  stopNow(): Promise<PauseSnapshot> {
    return this.#serial(async () => {
      await this.#stopAll()
      return this.snapshot()
    })
  }

  /**
   * Resume every paused agent and release what the pause held. A terminal
   * chat with no shell open is owed its line, typed when its shell opens, and
   * named in the result so the window can open it.
   * @returns the pause after the press, and the shells the window should open.
   */
  resume(): Promise<PauseSnapshot & { open: ShellToOpen[] }> {
    return this.#serial(async () => {
      if (this.#document.phase === 'running') return { ...await this.snapshot(), open: [] }
      await this.#stopAll()
      const paused = this.#document.chats
      const owed = [...this.#document.owed]
      const open: ShellToOpen[] = []
      for (const chat of paused) {
        const text = carryOnLine(chat, this.world.unread(chat.id))
        if (chat.kind === 'chat') {
          await this.world.carryOnChat(chat.id, text).catch((error: unknown) => {
            this.world.warn(`a paused chat was not resumed: ${String(error)}`)
          })
          continue
        }
        if (this.world.carryOnTerminal(chat.id, text)) continue
        owed.push({ id: chat.id, text })
        open.push({
          sessionId: chat.id,
          ...chat.cwd === undefined ? {} : { cwd: chat.cwd },
          ...chat.activity === undefined ? {} : { activity: chat.activity },
        })
      }
      this.#document = { phase: 'running', chats: [], owed }
      await this.#changed()
      await this.world.releaseSchedule().catch((error: unknown) => {
        this.world.warn(`held schedule tasks did not run: ${String(error)}`)
      })
      await this.world.releaseMail(new Set(paused.map(chat => chat.id))).catch((error: unknown) => {
        this.world.warn(`held notes did not wake their chats: ${String(error)}`)
      })
      return { ...await this.snapshot(), open }
    })
  }

  /**
   * A chat's terminal opened: type the line Resume owes it, if any.
   * @param sessionId - the chat whose shell opened.
   */
  opened(sessionId: string): void {
    void this.#serial(async () => {
      const line = this.#document.owed.find(entry => entry.id === sessionId)
      if (line === undefined || !this.world.carryOnTerminal(sessionId, line.text)) return
      this.#document = { ...this.#document, owed: this.#document.owed.filter(entry => entry !== line) }
      await this.#changed()
    })
  }

  /**
   * Tell one paused chat to save its notes, and mark it stopped when it has.
   * A terminal line that was dropped, or whose shell closed, stops the chat
   * unsaved, so Resume does not point it at a note it never wrote.
   */
  #save(chat: PausedChat): void {
    const text = saveNotesLine(chat.note)
    const lines: TerminalPauseLines = { save: text, wrapUp: wrapUpLine(chat.note) }
    const done: Promise<boolean> = chat.kind === 'chat'
      ? this.world.saveChat(chat.id, text).then(() => true)
      : (this.world.saveTerminal(chat.id, lines, () => this.#savingNow(chat.id)) ?? Promise.resolve('gone')).then(outcome => outcome === 'answered')
    void done
      .catch((error: unknown) => {
        this.world.warn(`a paused agent did not confirm its notes: ${String(error)}`)
        return false
      })
      .then(saved => this.#serial(() => this.#stopped(chat.id, saved)))
  }

  /** Whether a chat is still due to write its notes. */
  #savingNow(id: string): boolean {
    return this.#document.phase === 'saving' && this.#document.chats.some(chat => chat.id === id && chat.state === 'saving')
  }

  /** One chat finished its notes; the last one to finish completes the pause. */
  async #stopped(id: string, saved: boolean): Promise<void> {
    if (!this.#savingNow(id)) return
    const chats = this.#document.chats.map(chat => chat.id === id ? { ...chat, state: 'stopped' as const, saved } : chat)
    this.#document = { ...this.#document, chats, phase: chats.every(chat => chat.state === 'stopped') ? 'paused' : 'saving' }
    await this.#changed()
  }

  /** Interrupt every chat still saving and settle the pause as paused. */
  async #stopAll(): Promise<void> {
    if (this.#document.phase !== 'saving') return
    for (const chat of this.#document.chats) {
      if (chat.state !== 'saving') continue
      if (chat.kind === 'chat') this.world.stopChat(chat.id)
      else this.world.stopTerminal(chat.id)
    }
    const chats = this.#document.chats.map(chat => chat.state === 'saving' ? { ...chat, state: 'stopped' as const } : chat)
    this.#document = { ...this.#document, chats, phase: 'paused' }
    await this.#changed()
  }

  /** Persist, then tell the windows and the listeners. */
  async #changed(): Promise<void> {
    await this.store.save(this.#document).catch((error: unknown) => {
      this.world.warn(`the pause was not saved: ${String(error)}`)
    })
    this.world.announce()
    for (const listener of [...this.#listeners]) listener()
  }

  /** Run one action after the ones before it, so presses never interleave. */
  #serial<T>(action: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(action, action)
    this.#queue = run.catch(() => {})
    return run
  }
}
