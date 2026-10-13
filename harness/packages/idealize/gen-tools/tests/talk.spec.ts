// A generating chat has no shell, so it reaches other chats through tools
// that call the comm service as itself: it can fetch a brief, read notes sent
// to it, and reply (feedback 553ae5fb, 13 Oct 2026).
import { describe, expect, it } from 'vitest'
import { createTalkTools, TALK_SECTION } from '../src/talk.ts'

function bench(answers: Record<string, unknown>) {
  const requests: Record<string, unknown>[] = []
  const comm = {
    handle: async (request: Record<string, unknown>) => {
      requests.push(request)
      return answers[request.command as string] ?? { ok: true }
    },
  }
  const ctx = { get: (name: string) => (name === 'idealizeComm' ? comm : undefined) }
  const tools = Object.fromEntries(createTalkTools(ctx as never).map(tool => [tool.name, tool]))
  const exec = { agent: { session: { header: { id: 'session-gallery', cwd: '/work/docleaf' } } } }
  const run = async (name: string, args: Record<string, unknown> = {}) =>
    ((await (tools[name] as unknown as { execute(a: unknown, e: unknown): Promise<{ text: string }> }).execute(args, exec)).text)
  return { requests, run, names: Object.keys(tools) }
}

describe('talk tools', () => {
  it('offers the five commands a generating chat needs, and names them in its prompt', () => {
    const { names } = bench({})
    expect(names).toEqual(['idealize_list', 'idealize_send', 'idealize_inbox', 'idealize_transcript', 'idealize_post'])
    for (const name of names) expect(TALK_SECTION.text).toContain(name)
  })

  it('sends as the calling chat', async () => {
    const { requests, run } = bench({ send: { ok: true, info: 'delivered to Saelt-Marae (session-saelt)' } })
    expect(await run('idealize_send', { to: 'Saelt-Marae', text: 'Please send me the homepage image brief.' })).toBe('delivered to Saelt-Marae (session-saelt)')
    expect(requests[0]).toEqual({ command: 'send', target: 'Saelt-Marae', body: 'Please send me the homepage image brief.', from: 'session-gallery' })
  })

  it('reads its inbox with who each note is from', async () => {
    const { run } = bench({ inbox: { ok: true, messages: [{ from: 'session-saelt', fromLabel: 'Saelt-Marae', body: 'Brief: three hero images, 16:9, warm paper tones.', timestamp: '2026-10-13T14:00:00Z' }] } })
    expect(await run('idealize_inbox')).toBe('From Saelt-Marae (2026-10-13T14:00:00Z):\nBrief: three hero images, 16:9, warm paper tones.')
  })

  it('lists only the chats of its own project, closed ones marked', async () => {
    const { run } = bench({ list: { ok: true, sessions: [
      { id: 's1', name: 'Saelt-Marae', title: 'Build', projectPath: '/work/docleaf', live: true, role: 'chat', status: 'idle' },
      { id: 's2', name: 'Barquin', title: 'DocLeaf', projectPath: '/work/docleaf', live: false, role: 'chat' },
      { id: 's3', name: 'Kit', title: 'Site', projectPath: '/work/idealize', live: true, role: 'chat' },
    ] } })
    expect(await run('idealize_list')).toBe('Saelt-Marae · Build: idle\nBarquin · DocLeaf (closed)')
  })

  it('reads another chat\'s recent work as a brief source', async () => {
    const { requests, run } = bench({ transcript: { ok: true, exchanges: [{ question: 'Write the image brief', answer: 'Three hero images, 16:9.' }] } })
    expect(await run('idealize_transcript', { chat: 'Saelt-Marae' })).toBe('Q: Write the image brief\nA: Three hero images, 16:9.')
    expect(requests[0]).toMatchObject({ command: 'transcript', target: 'Saelt-Marae', limit: 5 })
  })

  it('says so when the service refuses', async () => {
    const { run } = bench({ send: { ok: false, error: 'no session matching \'Nobody\'' } })
    expect(await run('idealize_send', { to: 'Nobody', text: 'hi' })).toBe('no session matching \'Nobody\'')
  })
})
