/**
 * The terminal nudge: a note's wake line is typed into a Terminal chat's CLI
 * only at its prompt, and held otherwise until the terminal falls quiet.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ENTER_AFTER_MS, isAgentProgram, programOf, showsChoice, TerminalNudges } from '../src/nudge.ts'
import type { DesktopTerminalLike } from '../src/index.ts'

function fakeTerminal(front: string | undefined, screen = '❯ \r\n  ⏵⏵ bypass permissions on'): DesktopTerminalLike & { typed: string[]; front: string | undefined; screen: string } {
  const terminal = {
    id: 't-1', cols: 80, rows: 24, exit: undefined as { exitCode: number } | undefined,
    typed: [] as string[], front, screen,
    replay() { return terminal.screen },
    write(data: string) { terminal.typed.push(data) },
    resize() {}, subscribe: () => () => {}, close() {},
    ...front === undefined ? {} : { foreground: () => terminal.front },
  }
  return terminal
}

describe('TerminalNudges', () => {
  let busy = false
  let draft = ''
  const reads = { busy: () => busy, draft: () => draft, program: () => 'claude' }
  beforeEach(() => { vi.useFakeTimers(); busy = false; draft = '' })
  afterEach(() => { vi.useRealTimers() })

  it('types the line, then Enter a moment later, when the agent is at its prompt', () => {
    const terminal = fakeTerminal('claude')
    expect(new TerminalNudges(reads).nudge(terminal, 'A note arrived.\nRun `idealize inbox`.')).toBe('typed')
    expect(terminal.typed).toEqual(['A note arrived. Run `idealize inbox`.'])
    vi.advanceTimersByTime(ENTER_AFTER_MS)
    expect(terminal.typed).toEqual(['A note arrived. Run `idealize inbox`.', '\r'])
  })

  it('holds the line while the terminal prints or the person has a line half typed, and types it once quiet', () => {
    const nudges = new TerminalNudges(reads)
    const terminal = fakeTerminal('claude')
    busy = true
    expect(nudges.nudge(terminal, 'note')).toBe('held')
    busy = false
    draft = 'fix the hea'
    nudges.quiet('t-1')
    expect(terminal.typed).toEqual([])
    draft = ''
    nudges.quiet('t-1')
    expect(terminal.typed).toEqual(['note'])
    nudges.quiet('t-1')
    expect(terminal.typed).toEqual(['note'])
  })

  it('never types into a bare shell, a menu on screen, or a desktop shell that cannot name its program', () => {
    const nudges = new TerminalNudges(reads)
    for (const terminal of [
      fakeTerminal('zsh'),
      fakeTerminal('vim'),
      fakeTerminal(undefined),
      fakeTerminal('claude', 'Do you want to proceed?\r\n\u001b[1m❯ 1. Yes\u001b[0m\r\n  2. No'),
    ]) {
      expect(nudges.nudge(terminal, 'note')).toBe('held')
      expect(terminal.typed).toEqual([])
    }
  })

  it('drops a held line the agent no longer needs, and a terminal that closed', () => {
    const nudges = new TerminalNudges(reads)
    const terminal = fakeTerminal('claude')
    let unread = true
    busy = true
    nudges.nudge(terminal, 'note', () => unread)
    busy = false
    unread = false
    nudges.quiet('t-1')
    unread = true
    nudges.quiet('t-1')
    expect(terminal.typed).toEqual([])
    busy = true
    nudges.nudge(terminal, 'again')
    nudges.closed('t-1')
    busy = false
    nudges.quiet('t-1')
    expect(terminal.typed).toEqual([])
  })
})

describe('nudge helpers', () => {
  it('knows a command-line agent by name, by its launch, or by a version-named binary', () => {
    expect(isAgentProgram('2.1.294', 'claude')).toBe(true)
    expect(isAgentProgram('/usr/local/bin/codex', undefined)).toBe(true)
    expect(isAgentProgram('aider', 'aider')).toBe(true)
    expect(isAgentProgram('zsh', 'claude')).toBe(false)
    expect(isAgentProgram('vim', undefined)).toBe(false)
  })

  it('reads the program a launch runs', () => {
    expect(programOf('claude --dangerously-skip-permissions')).toBe('claude')
    expect(programOf('/opt/bin/codex')).toBe('codex')
    expect(programOf('  ')).toBeUndefined()
  })

  it('sees a numbered menu or a yes/no question through escape codes, and not an idle prompt', () => {
    expect(showsChoice('\u001b[36m›\u001b[0m 1. Yes, proceed')).toBe(true)
    expect(showsChoice('Overwrite? (y/n)')).toBe(true)
    expect(showsChoice('❯ \r\n  ? for shortcuts')).toBe(false)
  })
})
