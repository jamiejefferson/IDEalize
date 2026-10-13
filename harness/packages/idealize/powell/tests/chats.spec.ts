// Powell hands a project's work to a chat that is open in IDEalize, never a
// closed one, and lists the projects open in IDEalize for the switcher.
import { describe, expect, it } from 'vitest'
import { chatLines, inProject, openProjects, projectChat, type ChatRow } from '../src/chats.ts'
import { powellContext } from '../src/guide.ts'

const DOCLEAF = '/vault/Projects/DocLeaf'

function chat(id: string, fields: Partial<ChatRow> = {}): ChatRow {
  return { id, label: id, role: 'chat', running: false, open: true, lastActive: 0, cwd: DOCLEAF, ...fields }
}

// The 13 Oct 2026 roster: Barquin D'an is listed first but closed since 8 Oct.
const roster: ChatRow[] = [
  chat('session-powell', { name: 'Powell', role: 'studio-agent', cwd: '/Users/jj', lastActive: 900 }),
  chat('session-barquin', { name: 'Barquin D\'an', open: false, lastActive: 0 }),
  chat('session-saelt', { name: 'Saelt-Marae', lastActive: 500 }),
  chat('session-romba', { name: 'Romba', open: false }),
  chat('session-kit', { name: 'Kit Fisto', cwd: '/dev/idealize', lastActive: 800 }),
]

describe('project chat', () => {
  it('skips closed chats and picks the open one', () => {
    expect(projectChat(roster, [DOCLEAF], 'session-powell')).toEqual({ chat: roster[2], kind: 'open chat' })
  })

  it('prefers the project coordinator over a more recent chat', () => {
    const withCoordinator = [...roster, chat('session-coord', { name: 'Coord', role: 'project-agent', lastActive: 100 })]
    expect(projectChat(withCoordinator, [DOCLEAF])?.chat.id).toBe('session-coord')
  })

  it('picks the most recently active of several open chats', () => {
    const two = [...roster, chat('session-later', { lastActive: 700 })]
    expect(projectChat(two, [DOCLEAF])?.chat.id).toBe('session-later')
  })

  it('finds none when every chat of the project is closed, and says how to start one', () => {
    const closed = roster.map(row => row.cwd === DOCLEAF ? { ...row, open: false } : row)
    expect(projectChat(closed, [DOCLEAF])).toBeUndefined()
    expect(chatLines(undefined, DOCLEAF).join('\n')).toContain(`idealize spawn --coordinator --path "${DOCLEAF}"`)
  })

  it('matches chats in a project subfolder and not in a sibling with the same prefix', () => {
    expect(inProject('/dev/idealize/packages', ['/dev/idealize'])).toBe(true)
    expect(inProject('/dev/idealize-desktop', ['/dev/idealize'])).toBe(false)
    expect(inProject('/dev/idealize/', ['/dev/idealize'])).toBe(true)
  })

  it('names the chat and its send command in the live context', () => {
    const target = projectChat(roster, [DOCLEAF], 'session-powell')
    const text = powellContext({ name: 'DocLeaf', path: DOCLEAF, notes: DOCLEAF, chat: chatLines(target, DOCLEAF) }, {}, [], () => [])
    expect(text).toContain('Project chat: Saelt-Marae (session-saelt)')
    expect(text).toContain('idealize send session-saelt "<request>"')
  })
})

describe('open projects', () => {
  it('lists registered projects with an open chat, the most recently active first', () => {
    const projects = [
      { name: 'DocLeaf', path: DOCLEAF },
      { name: 'IDEalize', path: '/dev/idealize' },
      { name: 'JACQ', path: '/dev/jacq' },
    ]
    expect(openProjects(roster, projects, 'session-powell').map(project => project.name)).toEqual(['IDEalize', 'DocLeaf'])
  })
})
