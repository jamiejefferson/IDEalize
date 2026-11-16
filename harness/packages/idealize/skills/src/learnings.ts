/**
 * Skill learnings: what agents learn about a skill while using it.
 *
 * A learning is one dated line an agent appends to
 * `Reference/playbook-learnings/<skill>.md` inside the user's documentation
 * folder, through the `skill_learning` tool. Nothing here rewrites a line once
 * it is written: a model that rewrites a whole context each round erodes its
 * detail, while small itemised additions keep it (JJ approved the append-only
 * rule and the folder on 16 Nov 2026). The `fold-learnings` skill this package
 * ships turns a file of learnings into a proposed revision for the person to
 * review.
 * @module @idealize/skills/learnings
 */

import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { resolveSessionPreset, type PresetBearingSession } from '@deepseek-ai/dsh-agent-presets'
import { isSkillName } from '@deepseek-ai/dsh-skill'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type {} from '@idealize/doc-policy'
import { foldBrain } from '@idealize/spaces'

/** The model-facing tool that records one learning. */
export const SKILL_LEARNING_TOOL = 'skill_learning'

/** The folder of learnings files, as path segments under the documentation folder. */
export const LEARNINGS_FOLDER = ['Reference', 'playbook-learnings'] as const

/** The longest learning the tool accepts, in characters, after whitespace is collapsed. */
export const LEARNING_MAX_LENGTH = 500

/** Section name of the standing prompt line. */
export const LEARNINGS_SECTION_NAME = 'idealize:skill-learnings'

/** Order of the standing prompt line: straight after `idealize:documentation` (122). */
export const LEARNINGS_SECTION_ORDER = 123

/** The standing prompt line, verbatim. */
export const LEARNINGS_GUIDANCE = 'When a step in a skill you loaded proves wrong, missing or out of date, complete the task the correct way, '
  + `then call the ${SKILL_LEARNING_TOOL} tool once with the skill's name and one sentence that says what the step said and what was true instead. `
  + 'Record only what you observed in this chat. Never edit a skill\'s own files to correct it.'

/** The provider name the skills this package ships register under. */
export const BUILT_IN_SKILLS_PROVIDER_NAME = 'idealize-built-in-skills'

/**
 * The directory of skills this package ships (`skills/<name>/SKILL.md`, one level above both `src/` and `lib/`).
 * @returns the absolute directory path.
 */
export function builtInSkillsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'skills')
}

/** One learning to record. */
export interface LearningInput {
  /** The documentation folder. */
  readonly folder: string
  /** The skill the learning is about; must be a valid skill name. */
  readonly skill: string
  /** The brain (agent preset id) of the chat that learned it. */
  readonly brain: string
  /** The model that learned it. */
  readonly model: string
  /** The learning, already one line. */
  readonly text: string
  /** The moment of recording; the line carries its local calendar date. */
  readonly now: Date
}

/** Where a learning went. */
export interface LearningRecord {
  /** The learnings file, relative to the documentation folder, with `/` separators. */
  readonly path: string
  /** The line appended, without its line ending. */
  readonly line: string
}

/** A date's local calendar day as `YYYY-MM-DD`. */
function localDay(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * Append one learning to its skill's file, creating the file with `type: log`
 * frontmatter when it is missing. The only write to an existing file is an
 * append: a file whose last line has no line ending gains one first, so the
 * new line never joins an earlier one.
 * @param input - the folder, the skill, who learned it, the text and the moment.
 * @returns the file and the line written.
 * @throws when `input.skill` is not a valid skill name, which keeps the file inside the learnings folder.
 */
export async function appendLearning(input: LearningInput): Promise<LearningRecord> {
  if (!isSkillName(input.skill)) throw new Error(`invalid skill name "${input.skill}"`)
  const day = localDay(input.now)
  const file = join(input.folder, ...LEARNINGS_FOLDER, `${input.skill}.md`)
  const line = `- ${day} (${input.brain}/${input.model}): ${input.text}`
  await mkdir(dirname(file), { recursive: true })
  const header = [
    '---',
    'type: log',
    `created: ${day}`,
    `description: What agents learned while using the ${input.skill} skill, one dated line each. IDEalize appends to this file.`,
    '---',
    `# Learnings: ${input.skill}`,
    '',
    '',
  ].join('\n')
  // `wx` creates the file or fails with EEXIST, so two chats recording a first
  // learning at once cannot both write the header.
  await writeFile(file, header, { flag: 'wx' }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error
  })
  const existing = await readFile(file, 'utf8')
  await appendFile(file, `${existing.endsWith('\n') ? '' : '\n'}${line}\n`)
  return { path: [...LEARNINGS_FOLDER, `${input.skill}.md`].join('/'), line }
}

/**
 * Who a chat's learning is attributed to: the brain its log records (else the
 * preset it runs on) and the model of its latest request.
 * @param session - the calling chat's header and event log; `undefined` for a call outside a chat.
 * @returns the brain and model labels, `unknown` where the log names none, with whitespace and brackets
 *   replaced so the line keeps its format.
 */
export function learningAuthor(session: PresetBearingSession | undefined): { brain: string; model: string } {
  const label = (value: string | undefined): string => {
    const cleaned = (value ?? '').replaceAll(/[\s()]+/g, '-')
    return cleaned === '' ? 'unknown' : cleaned
  }
  if (session === undefined) return { brain: label(undefined), model: label(undefined) }
  const request = session.events.findLast(event => event.type === 'request/header')
  return {
    brain: label(foldBrain(session.events) ?? resolveSessionPreset(session)),
    model: label(request?.type === 'request/header' ? request.data.header.config.model : undefined),
  }
}

/**
 * The `skill_learning` tool. It records a learning only for a skill the
 * calling chat is offered, and only appends; with no documentation folder set
 * it says so and writes nothing.
 * @param ctx - a context carrying `docPolicy` and `skills`.
 * @param now - the clock; tests pass a fixed one.
 * @returns the tool definition to register.
 */
export function skillLearningTool(ctx: Context, now: () => Date = () => new Date()): ToolDefinition {
  return defineTool({
    name: SKILL_LEARNING_TOOL,
    description:
      'Record one thing you learned about a skill while using it: a step that proved wrong, missing or out of date. '
      + 'The learning is appended as one dated line to that skill\'s learnings file in the user\'s documentation folder, '
      + 'where the user reviews it before the skill changes. This tool only adds a line; it never changes the skill or an earlier learning.',
    parameters: {
      skill: {
        type: 'string',
        required: true,
        description: 'The exact name of the skill the learning is about, as the available skills list gives it.',
      },
      learning: {
        type: 'string',
        required: true,
        description: `One sentence, at most ${String(LEARNING_MAX_LENGTH)} characters: what the skill's step said and what was true instead.`,
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          recorded: { type: 'boolean', required: true, description: 'Whether the learning was written.' },
          path: { type: 'string', description: 'The learnings file, relative to the documentation folder.' },
          line: { type: 'string', description: 'The line that was appended.' },
          note: { type: 'string', description: 'Present when nothing was written, with the reason.' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.recorded
          ? `Recorded in ${String(value.path)}:\n${String(value.line)}`
          : String(value.note),
      }],
    },
    async execute(args, exec) {
      if (!isSkillName(args.skill)) throw new Error(`invalid skill name "${args.skill}"`)
      const text = args.learning.replaceAll(/\s+/g, ' ').trim()
      if (text === '') throw new Error('a learning needs one sentence of text')
      if (text.length > LEARNING_MAX_LENGTH) {
        throw new Error(`a learning is one line of at most ${String(LEARNING_MAX_LENGTH)} characters; this one has ${String(text.length)}`)
      }
      const session = exec.agent?.session
      const offered = await ctx.skills.list({ cwd: session?.header.cwd, signal: exec.signal, scope: exec.agent })
      if (!offered.some(skill => skill.name === args.skill)) {
        throw new Error(`skill "${args.skill}" is not one of the skills available in this chat`)
      }
      const folder = ctx.docPolicy.folder()
      if (folder === undefined) {
        return { recorded: false, note: 'No documentation folder is set, so the learning was not recorded. Tell the user what you learned instead.' }
      }
      return { recorded: true, ...await appendLearning({ folder, skill: args.skill, ...learningAuthor(session), text, now: now() }) }
    },
    presentCall: args => ({ card: 'generic', title: `Record a learning about ${args.skill}`, kind: 'other', rawInput: args.learning }),
  })
}
