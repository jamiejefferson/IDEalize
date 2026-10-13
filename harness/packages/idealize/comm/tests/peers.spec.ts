// A new chat is told which other chats are open in its project, so it checks
// before redoing their work; closed chats, other projects and the Studio
// coordinator stay out.
import { describe, expect, it } from 'vitest'
import { peersNotice, projectOf, type PeerRow } from '../src/peers.ts'

const ROOTS = ['/vault/Projects/DocLeaf', '/dev/idealize', '/dev/idealize-desktop']

function row(id: string, fields: Partial<PeerRow> = {}): PeerRow {
  return { id, name: id, title: 'Chat', projectPath: '/vault/Projects/DocLeaf', role: 'chat', status: 'idle', live: true, ...fields }
}

describe('projectOf', () => {
  it('finds the deepest registered project, and never a sibling sharing a prefix', () => {
    expect(projectOf('/dev/idealize/packages/comm', ROOTS)).toBe('/dev/idealize')
    expect(projectOf('/dev/idealize-desktop/src', ROOTS)).toBe('/dev/idealize-desktop')
    expect(projectOf('/elsewhere', ROOTS)).toBe('/elsewhere')
  })
})

describe('peersNotice', () => {
  it('names the open chats of the same project with their status, coordinator marked', () => {
    const text = peersNotice('me', '/vault/Projects/DocLeaf', [
      row('me'),
      row('Saelt-Marae', { title: 'Build', status: 'working' }),
      row('Barquin', { live: false }),
      row('Kit', { projectPath: '/dev/idealize' }),
      row('Powell', { role: 'studio-agent' }),
      row('Nova', { title: 'DocLeaf', role: 'project-agent', status: 'Reviewing the toolbar' }),
    ], ROOTS)
    expect(text?.split('\n').slice(1)).toEqual([
      '- Saelt-Marae · Build: working',
      '- Nova · DocLeaf (the project coordinator): Reviewing the toolbar',
    ])
    expect(text).toContain('idealize send <name>')
  })

  it('says nothing to a chat alone in its project', () => {
    expect(peersNotice('me', '/dev/idealize', [row('me', { projectPath: '/dev/idealize' }), row('other')], ROOTS)).toBeUndefined()
  })

  it('counts the chats past the first eight', () => {
    const many = Array.from({ length: 11 }, (_, index) => row(`c${String(index)}`))
    expect(peersNotice('me', '/vault/Projects/DocLeaf', many, ROOTS)?.split('\n').at(-1)).toBe('- and 3 more (`idealize list`)')
  })
})
