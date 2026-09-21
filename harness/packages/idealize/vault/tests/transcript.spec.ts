import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { transcriptOf, writeTranscript } from '../src/transcript.ts'
import type { TranscriptInput, TranscriptMessage } from '../src/transcript.ts'

const you = (text: string): TranscriptMessage => ({ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] })
const model = (name: string, content: TranscriptMessage['content']): TranscriptMessage =>
  ({ role: 'assistant', source: { kind: 'model', provider: 'p', model: name }, content })

const chat = (over: Partial<TranscriptInput> = {}): TranscriptInput => ({
  sessionId: 'session-f3633d9a-a616-4e36-93bb-8fdbe9a4c75f', started: '2026-09-21T12:30:00.000Z', project: '/work/site', brain: 'coding',
  messages: [
    you('Write a debounce function'),
    { role: 'user', source: { kind: 'plugin' }, content: [{ type: 'text', text: 'injected context' }] },
    model('gpt-5.6-luna', [{ type: 'reasoning', text: 'thinking' }, { type: 'tool-call', name: 'Bash' }]),
    { role: 'user', source: { kind: 'tool' }, content: [{ type: 'tool-result', text: 'a very long listing' }] },
    model('gpt-5.6-luna', [{ type: 'text', text: 'Here it is.' }]),
    you('Add maxWait'),
    model('gpt-5.5', [{ type: 'text', text: 'Done.' }]),
  ],
  ...over,
})

describe('a chat as Markdown', () => {
  it('keeps the person and each model, in order, and leaves out tool output, injected context and reasoning', () => {
    const text = transcriptOf(chat({ title: 'Debounce' })) ?? ''
    expect(text).toContain('# Debounce')
    expect(text).toContain('models: [gpt-5.6-luna, gpt-5.5]')
    expect(text).toContain('brain: coding')
    expect(text.match(/^## .+$/gm)).toEqual(['## You', '## gpt-5.6-luna', '## You', '## gpt-5.5'])
    expect(text).toContain('*Used Bash.*')
    for (const hidden of ['a very long listing', 'injected context', 'thinking']) expect(text).not.toContain(hidden)
  })

  it('writes nothing until the person has spoken', () => {
    expect(transcriptOf(chat({ messages: [] }))).toBeUndefined()
  })

  it('finds its file again by the chat id, and its name follows the title', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'vault-sessions-'))
    await writeTranscript(folder, chat())
    expect(await readdir(join(folder, 'sessions'))).toEqual(['2026-09-21-chat-a4c75f.md'.replace('a4c75f', 'e9a4c75f')])
    await writeTranscript(folder, chat({ title: 'Debounce Async!' }))
    await writeTranscript(folder, chat({ title: 'Something else' }))
    const files = await readdir(join(folder, 'sessions'))
    expect(files).toEqual(['2026-09-21-something-else-e9a4c75f.md'])
    expect(await readFile(join(folder, 'sessions', files[0] ?? ''), 'utf8')).toContain('# Something else')
  })
})
