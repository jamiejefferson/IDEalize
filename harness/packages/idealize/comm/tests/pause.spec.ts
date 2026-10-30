// Pausing every agent (feedback 495cec0a): working agents save notes, then
// stop; Stop now cuts the wait; the pause survives a restart; Resume tells
// each paused agent to carry on and releases what the pause held.
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  carryOnLine,
  parsePauseDocument,
  PauseController,
  PauseFile,
  pauseNotePath,
  saveNotesLine,
  wrapUpLine,
} from '../src/pause.ts'
import type { PauseDocument, PauseStore, PauseWorld, TerminalLineOutcome, TerminalPauseLines, WorkingChat } from '../src/pause.ts'

/** Let queued promise work run. */
const flush = async (): Promise<void> => { for (let i = 0; i < 10; i++) await Promise.resolve() }

/** A host with two working agents by default: a chat and a Terminal chat in the same project. */
class FakeWorld implements PauseWorld {
  agents: WorkingChat[] = [
    { id: 'chat-1', kind: 'chat', label: 'Watto', name: 'Watto', cwd: '/Users/jj/AMI' },
    { id: 'term-1', kind: 'terminal', label: 'Lando Calrissian', name: 'Lando Calrissian', cwd: '/Users/jj/AMI', activity: 'coding' },
  ]
  folders = new Map<string, string>([['/Users/jj/AMI', '/vault/Projects/AMI']])
  saves = new Map<string, () => void>()
  terminalSaves = new Map<string, (outcome: TerminalLineOutcome) => void>()
  shells = new Set<string>(['term-1'])
  inbox = new Map<string, number>()
  log: string[] = []
  wanted: (() => boolean) | undefined

  working(): Promise<WorkingChat[]> { return Promise.resolve(this.agents) }
  saveChat(id: string, text: string): Promise<void> {
    this.log.push(`save ${id}: ${text}`)
    return new Promise((resolve) => { this.saves.set(id, resolve) })
  }
  saveTerminal(id: string, lines: TerminalPauseLines, wanted: () => boolean): Promise<TerminalLineOutcome> | undefined {
    if (!this.shells.has(id)) return undefined
    this.log.push(`type ${id}: ${lines.save}`)
    this.log.push(`wrap up ${id}: ${lines.wrapUp}`)
    this.wanted = wanted
    return new Promise((resolve) => { this.terminalSaves.set(id, resolve) })
  }
  stopChat(id: string): void { this.log.push(`cancel ${id}`) }
  stopTerminal(id: string): void { this.log.push(`escape ${id}`) }
  carryOnChat(id: string, text: string): Promise<void> {
    this.log.push(`carry on ${id}: ${text}`)
    return Promise.resolve()
  }
  carryOnTerminal(id: string, text: string): boolean {
    if (!this.shells.has(id)) return false
    this.log.push(`carry on ${id}: ${text}`)
    return true
  }
  notesFolder(cwd: string): Promise<string | undefined> { return Promise.resolve(this.folders.get(cwd)) }
  unread(id: string): number { return this.inbox.get(id) ?? 0 }
  releaseSchedule(): Promise<void> { this.log.push('release schedule'); return Promise.resolve() }
  releaseMail(skip: ReadonlySet<string>): Promise<void> {
    this.log.push(`release mail except ${[...skip].join(',')}`)
    return Promise.resolve()
  }
  announce(): void { this.log.push('announce') }
  warn(message: string): void { this.log.push(`warn ${message}`) }
  now(): Date { return new Date('2026-10-30T14:30:00Z') }
}

/** A store held in memory, read back as a restart would read the file. */
class MemoryStore implements PauseStore {
  text = ''
  load(): PauseDocument { return parsePauseDocument(this.text) }
  save(document: PauseDocument): Promise<void> {
    this.text = JSON.stringify(document)
    return Promise.resolve()
  }
}

const AMI_NOTE = '/vault/Projects/AMI/2026-10-30-paused-watto.md'
const LANDO_NOTE = '/vault/Projects/AMI/2026-10-30-paused-lando-calrissian.md'

describe('the pause', () => {
  it('goes straight to paused when nobody is working, and Resume releases what it held', async () => {
    const world = new FakeWorld()
    world.agents = []
    const pause = new PauseController(world, new MemoryStore())
    expect(pause.held()).toBe(false)
    expect(await pause.pause()).toMatchObject({ phase: 'paused', chats: [], saving: 0 })
    expect(pause.held()).toBe(true)
    expect(await pause.resume()).toMatchObject({ phase: 'running', open: [] })
    expect(pause.held()).toBe(false)
    expect(world.log).toEqual(['announce', 'announce', 'release schedule', 'release mail except '])
  })

  it('tells each working agent to save its notes in its own file, and is paused once every one has stopped', async () => {
    const world = new FakeWorld()
    const changes: string[] = []
    const pause = new PauseController(world, new MemoryStore())
    pause.onChange(() => { changes.push('change') })
    const pressed = await pause.pause()
    expect(pressed).toMatchObject({ phase: 'saving', saving: 2, since: '2026-10-30T14:30:00.000Z' })
    expect(pressed.chats.map(chat => [chat.label, chat.state])).toEqual([['Watto', 'saving'], ['Lando Calrissian', 'saving']])
    expect(pause.held()).toBe(true)
    expect(world.log).toContain(`save chat-1: ${saveNotesLine(AMI_NOTE)}`)
    expect(world.log).toContain(`type term-1: ${saveNotesLine(LANDO_NOTE)}`)
    // A terminal agent the pause interrupts mid-run gets the wrap-up line instead.
    expect(world.log).toContain(`wrap up term-1: ${wrapUpLine(LANDO_NOTE)}`)
    // Pressing again while saving changes nothing.
    expect((await pause.pause()).phase).toBe('saving')

    world.saves.get('chat-1')!()
    await flush()
    expect(await pause.snapshot()).toMatchObject({ phase: 'saving', saving: 1 })
    // The terminal line is wanted only while its chat is still saving.
    expect(world.wanted?.()).toBe(true)
    world.terminalSaves.get('term-1')!('answered')
    await flush()
    expect(await pause.snapshot()).toMatchObject({ phase: 'paused', saving: 0 })
    expect(world.wanted?.()).toBe(false)
    expect(changes).toHaveLength(3)

    world.inbox.set('term-1', 2)
    const resumed = await pause.resume()
    expect(resumed).toMatchObject({ phase: 'running', open: [], chats: [] })
    expect(world.log).toContain(`carry on chat-1: ${carryOnLine({ note: AMI_NOTE, saved: true }, 0)}`)
    expect(world.log).toContain(`carry on term-1: ${carryOnLine({ note: LANDO_NOTE, saved: true }, 2)}`)
    expect(world.log.slice(-2)).toEqual(['release schedule', 'release mail except chat-1,term-1'])
  })

  it('Stop now interrupts whoever is still saving, and Resume tells them their notes may be unfinished', async () => {
    const world = new FakeWorld()
    const pause = new PauseController(world, new MemoryStore())
    await pause.pause()
    world.saves.get('chat-1')!()
    await flush()
    expect(await pause.stopNow()).toMatchObject({ phase: 'paused', saving: 0 })
    expect(world.log).toContain('escape term-1')
    expect(world.log).not.toContain('cancel chat-1')
    // The interrupted line's late answer changes nothing.
    world.terminalSaves.get('term-1')!('dropped')
    await flush()
    await pause.resume()
    expect(world.log).toContain(`carry on chat-1: ${carryOnLine({ note: AMI_NOTE, saved: true }, 0)}`)
    expect(world.log).toContain(`carry on term-1: ${carryOnLine({ note: LANDO_NOTE, saved: false }, 0)}`)
  })

  it('reads a pause stored mid-save as paused after a restart, and owes a closed terminal its line until its shell opens', async () => {
    const store = new MemoryStore()
    const before = new FakeWorld()
    await new PauseController(before, store).pause()

    // The app restarted: no shell is open, and the agents' runs ended with it.
    const world = new FakeWorld()
    world.shells.clear()
    const pause = new PauseController(world, store)
    expect(pause.held()).toBe(true)
    expect(await pause.snapshot()).toMatchObject({ phase: 'paused', saving: 0, working: 0 })
    const resumed = await pause.resume()
    expect(resumed.open).toEqual([{ sessionId: 'term-1', cwd: '/Users/jj/AMI', activity: 'coding' }])
    expect(world.log).toContain(`carry on chat-1: ${carryOnLine({ note: AMI_NOTE, saved: false }, 0)}`)
    expect(world.log.some(line => line.startsWith('carry on term-1'))).toBe(false)

    // A shell that is not the owed chat's changes nothing; the owed chat's opens and gets its line once.
    world.shells.add('term-1')
    pause.opened('other')
    pause.opened('term-1')
    pause.opened('term-1')
    await flush()
    expect(world.log.filter(line => line.startsWith('carry on term-1'))).toEqual([
      `carry on term-1: ${carryOnLine({ note: LANDO_NOTE, saved: false }, 0)}`,
    ])
    expect(parsePauseDocument(store.text).owed).toEqual([])
  })

  it('keeps notes in the project\'s own IDEalize folder when the project has no notes folder', async () => {
    const world = new FakeWorld()
    world.folders.clear()
    world.agents = [{ id: 'term-2', kind: 'terminal', label: 'Bossk', name: 'Bossk', cwd: '/Users/jj/Indy', activity: 'design' }]
    world.shells.add('term-2')
    await new PauseController(world, new MemoryStore()).pause()
    expect(world.log).toContain(`type term-2: ${saveNotesLine('/Users/jj/Indy/.idealize/paused/2026-10-30-paused-bossk.md')}`)
  })
})

describe('the pause document and its words', () => {
  it('reads garbage as running and drops malformed chats', () => {
    expect(parsePauseDocument('not json')).toEqual({ phase: 'running', chats: [], owed: [] })
    expect(parsePauseDocument('[]')).toEqual({ phase: 'running', chats: [], owed: [] })
    expect(parsePauseDocument(JSON.stringify({
      phase: 'paused',
      since: '2026-10-30T14:30:00.000Z',
      chats: [{ id: 'a', kind: 'chat', label: 'A', state: 'stopped', saved: true }, { id: 'b', kind: 'robot' }, 'c'],
      owed: [{ id: 'a', text: 'carry on' }, { id: 'b' }],
    }))).toEqual({
      phase: 'paused',
      since: '2026-10-30T14:30:00.000Z',
      chats: [{ id: 'a', kind: 'chat', label: 'A', state: 'stopped', saved: true }],
      owed: [{ id: 'a', text: 'carry on' }],
    })
  })

  it('names one note per agent and per day', () => {
    expect(pauseNotePath('/vault/Projects/AMI', 'Lando Calrissian', '2026-10-30')).toBe(LANDO_NOTE)
    expect(pauseNotePath('/vault', '???', '2026-10-30')).toBe('/vault/2026-10-30-paused-agent.md')
  })

  it('tells an interrupted terminal agent to check its last step before it writes its notes', () => {
    expect(wrapUpLine(LANDO_NOTE)).toBe('IDEalize interrupted you because the person is pausing every agent to shut the computer down. '
      + 'Check whether your last step finished, such as a file write or a command, and note anything left half done. '
      + `Then write where you got to and the exact next step into ${LANDO_NOTE}, end your turn and start nothing new.`)
    expect(wrapUpLine(undefined)).toContain('the exact next step in your reply')
  })

  it('asks a chat with no project for its notes in its reply, and points it back there', () => {
    expect(saveNotesLine(undefined)).toContain('write where you got to and the exact next step in your reply')
    expect(carryOnLine({ saved: true }, 0)).toBe('IDEalize has resumed after a pause. Carry on from the next step your last reply names.')
    expect(carryOnLine({ saved: false }, 1)).toContain('run `idealize inbox`')
  })

  it('writes the document to disk and reads it back', async () => {
    const root = await mkdtemp(join(tmpdir(), 'idealize-pause-'))
    try {
      const file = new PauseFile(join(root, 'idealize', 'pause.json'))
      expect(file.load()).toEqual({ phase: 'running', chats: [], owed: [] })
      const document: PauseDocument = { phase: 'paused', since: '2026-10-30T14:30:00.000Z', chats: [], owed: [] }
      await file.save(document)
      expect(file.load()).toEqual(document)
      expect(JSON.parse(await readFile(file.path, 'utf8'))).toEqual(document)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('the host pause world, toward a Terminal chat', () => {
  it('hands the terminal both lines, so an agent mid-run is interrupted and wraps up', async () => {
    const { Context } = await import('@deepseek-ai/cordis')
    const { HostPauseWorld } = await import('../src/pause-service.ts')
    const ctx = new Context()
    const calls: unknown[][] = []
    ;(ctx as unknown as { provide(name: string, value: unknown): void }).provide('idealizeTerminals', {
      deliver: (...args: unknown[]) => { calls.push(args); return Promise.resolve('answered') },
    })
    const world = new HostPauseWorld(ctx)
    const wanted = (): boolean => true
    expect(await world.saveTerminal('term-1', { save: 'save line', wrapUp: 'wrap-up line' }, wanted)).toBe('answered')
    expect(calls).toEqual([['term-1', 'save line', wanted, { interruptWith: 'wrap-up line' }]])
  })
})
