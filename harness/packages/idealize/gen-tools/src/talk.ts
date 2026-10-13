/**
 * The `idealize` commands as tools, for the generating chats (Images, Sounds,
 * Video). Every other chat reaches its peers through the `idealize` command in
 * its shell; a generating chat composes no shell (AC-06), so it could neither
 * fetch a brief from another chat nor read the note another chat sent it,
 * and the wake notice told it to run a command it did not have (feedback
 * 553ae5fb, 13 Oct 2026). These tools call the same `ctx.idealizeComm`
 * service the shell command reaches, as the calling chat, and give it no
 * file, shell or web access.
 * @module @idealize/gen-tools/talk
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

/** The parts of `@idealize/comm`'s wire this reads, structurally. */
interface CommLike {
  handle(request: {
    command: string
    from: string
    target?: string
    body?: string
    limit?: number
  }): Promise<{
    ok: boolean
    error?: string
    info?: string
    warning?: string
    sessions?: { id: string; name?: string; title: string; projectPath?: string; status?: string; live: boolean; role: string }[]
    messages?: { fromLabel?: string; from: string; body: string; timestamp: string }[]
    exchanges?: { question?: string; answer?: string }[]
  }>
}

/** The prompt section a generating chat carries alongside the tools. */
export const TALK_SECTION = {
  name: 'idealize:talk',
  order: 121,
  text: 'You have no shell, so the `idealize` commands described above are tools for you: '
    + '`idealize_list` (the chats in this project), `idealize_send` (a note to a chat, which wakes it), '
    + '`idealize_inbox` (read and clear notes sent to you), `idealize_transcript` (a chat\'s recent questions and answers) '
    + 'and `idealize_post` (one line to the project\'s Studio timeline). '
    + 'When you need a brief, ask the chat that holds it with `idealize_send`, then read its answer with `idealize_inbox`, '
    + 'or read its recent work with `idealize_transcript`. When a note arrives, read it with `idealize_inbox` and act on it.',
} as const

function text(value: string): { text: string } {
  return { text: value }
}

/**
 * Build the five tools over the comm service.
 * @param ctx - the agent's context; `idealizeComm` is read per call, so a late-composed service still answers.
 * @returns the tool definitions.
 */
export function createTalkTools(ctx: Context): ToolDefinition[] {
  const call = async (
    exec: { agent?: { session: { header: { id: unknown; cwd?: string } } } },
    request: { command: string; target?: string; body?: string; limit?: number },
  ): Promise<{ response?: Awaited<ReturnType<CommLike['handle']>>; error?: string; cwd?: string }> => {
    const comm = (ctx as unknown as { get(name: string): unknown }).get('idealizeComm') as CommLike | undefined
    const session = exec.agent?.session
    if (comm === undefined || session === undefined) return { error: 'Messaging other chats is not available right now.' }
    const response = await comm.handle({ ...request, from: String(session.header.id) })
    if (!response.ok) return { error: response.error ?? `${request.command} failed` }
    return { response, ...session.header.cwd === undefined ? {} : { cwd: session.header.cwd } }
  }

  return [
    defineTool({
      name: 'idealize_list',
      description: 'List the other chats in this project: each one\'s name, what it is for, and whether it is open.',
      parameters: {},
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } },
        render: (_args, value) => [{ type: 'text', text: value.text }],
      },
      execute: async (_args, exec) => {
        const { response, error, cwd } = await call(exec, { command: 'list' })
        if (error !== undefined) return text(error)
        const here = (path: string | undefined): boolean => cwd === undefined || path === undefined
          || path === cwd || path.startsWith(`${cwd}/`) || cwd.startsWith(`${path}/`)
        const rows = (response?.sessions ?? []).filter(row => here(row.projectPath))
        if (rows.length === 0) return text('No other chats in this project.')
        return text(rows.map(row => `${row.name ?? row.id} · ${row.title}${row.live ? '' : ' (closed)'}${row.status === undefined ? '' : `: ${row.status}`}`).join('\n'))
      },
      presentCall: args => ({ card: 'generic', title: 'Chats', kind: 'other', rawInput: args }),
    }),
    defineTool({
      name: 'idealize_send',
      description: 'Send a note to another chat by its name; it wakes the chat if it is idle. Use it to ask for a brief or to hand over finished work. At most 800 characters.',
      parameters: {
        to: { type: 'string', required: true, description: 'The chat\'s name, as idealize_list shows it.' },
        text: { type: 'string', required: true, description: 'The note.' },
      },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } },
        render: (_args, value) => [{ type: 'text', text: value.text }],
      },
      execute: async (args, exec) => {
        const { response, error } = await call(exec, { command: 'send', target: args.to, body: args.text })
        if (error !== undefined) return text(error)
        return text([response?.info ?? 'Sent.', response?.warning].filter(Boolean).join(' '))
      },
      presentCall: args => ({ card: 'generic', title: `Note to ${args.to}`, kind: 'other', rawInput: args }),
    }),
    defineTool({
      name: 'idealize_inbox',
      description: 'Read and clear the notes other chats have sent you.',
      parameters: {},
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } },
        render: (_args, value) => [{ type: 'text', text: value.text }],
      },
      execute: async (_args, exec) => {
        const { response, error } = await call(exec, { command: 'inbox' })
        if (error !== undefined) return text(error)
        const messages = response?.messages ?? []
        if (messages.length === 0) return text('No notes waiting.')
        return text(messages.map(message => `From ${message.fromLabel ?? message.from} (${message.timestamp}):\n${message.body}`).join('\n\n'))
      },
      presentCall: args => ({ card: 'generic', title: 'Inbox', kind: 'other', rawInput: args }),
    }),
    defineTool({
      name: 'idealize_transcript',
      description: 'Read another chat\'s recent questions and answers, for example to pick up a brief it wrote.',
      parameters: {
        chat: { type: 'string', required: true, description: 'The chat\'s name.' },
        last: { type: 'number', description: 'How many exchanges, newest last (default 5, at most 50).' },
      },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } },
        render: (_args, value) => [{ type: 'text', text: value.text }],
      },
      execute: async (args, exec) => {
        const { response, error } = await call(exec, { command: 'transcript', target: args.chat, limit: args.last ?? 5 })
        if (error !== undefined) return text(error)
        const exchanges = response?.exchanges ?? []
        if (exchanges.length === 0) return text('That chat has no questions and answers yet.')
        return text(exchanges.map(exchange => `Q: ${exchange.question ?? ''}\nA: ${exchange.answer ?? ''}`).join('\n\n'))
      },
      presentCall: args => ({ card: 'generic', title: `Read ${args.chat}`, kind: 'other', rawInput: args }),
    }),
    defineTool({
      name: 'idealize_post',
      description: 'Post one line to the project\'s Studio timeline, which everyone reads and nobody is woken by. Say what you made and where it is.',
      parameters: {
        text: { type: 'string', required: true, description: 'The line.' },
      },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } },
        render: (_args, value) => [{ type: 'text', text: value.text }],
      },
      execute: async (args, exec) => {
        const { response, error } = await call(exec, { command: 'post', body: args.text })
        if (error !== undefined) return text(error)
        return text(response?.info ?? 'Posted.')
      },
      presentCall: args => ({ card: 'generic', title: 'Studio post', kind: 'other', rawInput: args }),
    }),
  ]
}
