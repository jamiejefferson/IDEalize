import { describe, expect, it } from 'vitest'
import { routerNoteText } from '../src/client/RouterNote.tsx'

const t = ((key: string, params?: Record<string, string>) => `${key}:${params?.to ?? ''}`) as Parameters<typeof routerNoteText>[1]
const from = { provider: 'deepseek-official', model: 'flash', label: 'Flash' }
const to = { provider: 'anthropic', model: 'haiku', label: 'Haiku' }

describe('the line a chat shows for a router event', () => {
  it('says the chat is on the model the person took from an offer, and to send again', () => {
    const { headline } = routerNoteText({ outcome: 'switched', at: '', from, to, via: 'offer' }, t)
    expect(headline).toBe('router.note.accepted:Haiku')
  })

  it('names the switch and the return for every other event', () => {
    expect(routerNoteText({ outcome: 'switched', at: '', from, to }, t).headline).toBe('router.note.switched:Haiku')
    expect(routerNoteText({ outcome: 'reset', at: '', from: to, to: from }, t).headline).toBe('router.note.back:Flash')
  })
})
