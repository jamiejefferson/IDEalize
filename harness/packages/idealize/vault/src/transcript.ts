/**
 * A chat as a Markdown file in the project's documentation folder: what the
 * person said and what each model answered, in order, in a form any model or
 * any person can read. It is the conversation's copy outside the app. The
 * app's own log stays the source the app reads; this file is rewritten whole
 * from it on each save, so it is never more than one save behind and never
 * merged by hand.
 *
 * Tool output and file contents are left out: they are the bulk of a working
 * chat and would bury the conversation. A tool call keeps one line.
 */

import { mkdir, readdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const SESSIONS_DIR = 'sessions'
/** A chat with no title yet is filed under this word and renamed once the title arrives. */
const UNTITLED = 'chat'

/** One content block, as far as the transcript reads it. */
interface Block { type: string; text?: string; name?: string }

/** One message of the chat's derived history, as far as the transcript reads it. */
export interface TranscriptMessage {
  role: 'user' | 'assistant'
  content: readonly Block[]
  source: { kind: string; provider?: string; model?: string }
}

export interface TranscriptInput {
  sessionId: string
  title?: string | undefined
  /** ISO time the chat began. */
  started: string
  project: string
  brain?: string | undefined
  messages: readonly TranscriptMessage[]
}

const textOf = (content: readonly Block[]): string =>
  content.map(block => (block.type === 'text' ? block.text ?? '' : '')).join('\n').trim()

/**
 * The chat as Markdown.
 * @param input - the chat's identity and its derived messages.
 * @returns the file's text, or undefined while the person has said nothing.
 */
export function transcriptOf(input: TranscriptInput): string | undefined {
  const spoken = input.messages.filter(message => message.role === 'user' && message.source.kind === 'user' && textOf(message.content) !== '')
  if (spoken.length === 0) return undefined
  const models: string[] = []
  const body: string[] = []
  let answering: string | undefined
  for (const message of input.messages) {
    if (message.role === 'user') {
      // Context a plugin injected and tool results are not the person's words.
      if (message.source.kind !== 'user') continue
      const said = textOf(message.content)
      if (said !== '') body.push(`## You\n\n${said}\n`)
      answering = undefined
      continue
    }
    const model = message.source.model ?? 'model'
    if (!models.includes(model)) models.push(model)
    const said = textOf(message.content)
    const tools = message.content.filter(block => block.type === 'tool-call').map(block => block.name ?? 'tool')
    if (said === '' && tools.length === 0) continue
    // One heading per answer: a reply that runs over several steps reads as one.
    if (answering !== model) body.push(`## ${model}\n`)
    answering = model
    if (said !== '') body.push(`${said}\n`)
    if (tools.length > 0) body.push(`*Used ${tools.join(', ')}.*\n`)
  }
  const front = [
    '---',
    'type: session',
    `session: ${input.sessionId}`,
    `started: ${input.started}`,
    `project: ${JSON.stringify(input.project)}`,
    ...input.brain === undefined ? [] : [`brain: ${input.brain}`],
    `models: [${models.join(', ')}]`,
    '---',
  ]
  const note = 'Written by IDEalize from the chat\'s own log and rewritten on each save, so edits here do not last. '
    + 'Tool output and file contents are left out.'
  return `${front.join('\n')}\n# ${input.title ?? 'Untitled chat'}\n\n${note}\n\n${body.join('\n')}`
}

const slug = (title: string | undefined): string =>
  (title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || UNTITLED

/**
 * Write one chat's file. The name carries the date, the title and the end of
 * the chat's id. The id finds the file again, so the name follows the title:
 * the app titles a chat from its first words and again once a model names it,
 * and the file a person looks for is the one named as the sidebar names it.
 * @param projectFolder - the project's folder in the documentation.
 * @param input - the chat.
 * @returns the path written, or undefined when there was nothing to write.
 */
export async function writeTranscript(projectFolder: string, input: TranscriptInput): Promise<string | undefined> {
  const text = transcriptOf(input)
  if (text === undefined) return undefined
  const dir = join(projectFolder, SESSIONS_DIR)
  await mkdir(dir, { recursive: true })
  const tail = `-${input.sessionId.replace(/[^a-zA-Z0-9]/g, '').slice(-8)}.md`
  const existing = (await readdir(dir)).find(name => name.endsWith(tail))
  const wanted = `${input.started.slice(0, 10)}-${slug(input.title)}${tail}`
  let name = existing ?? wanted
  if (existing !== undefined && existing !== wanted && slug(input.title) !== UNTITLED) {
    await rename(join(dir, existing), join(dir, wanted))
    name = wanted
  }
  await writeFile(join(dir, name), text, 'utf8')
  return join(dir, name)
}
