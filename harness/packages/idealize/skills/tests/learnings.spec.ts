// The learnings loop over a real tool registry, prompt assembly, skill
// registry and documentation service: `skill_learning` appends one dated line
// per call and never touches an earlier one, refuses names that would leave
// the learnings folder, writes nothing without a documentation folder, and the
// shipped `fold-learnings` skill is offered with its one-file rule.
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as docPolicy from '@idealize/doc-policy'
import * as skills from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function boot(withFolder = true): Promise<{ ctx: Context; vault: string }> {
  root = await mkdtemp(join(tmpdir(), 'idealize-skill-learnings-'))
  const vault = join(root, 'vault')
  await mkdir(vault, { recursive: true })
  const ctx = new Context()
  context = ctx
  await ctx.plugin(SystemPrompt, { persona: '', includeHarnessIdentity: false, includeRuntimeContext: false })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(docPolicy, withFolder ? { documentationFolder: vault } : {})
  await ctx.docPolicy.scan()
  await ctx.plugin(skills, { unpackFolder: join(root, 'unpack') })
  return { ctx, vault }
}

/** A chat as the tool reads it: a brain, a working directory and the model of its latest request. */
function chat(events: unknown[] = []): never {
  return {
    session: {
      header: { cwd: root, agentPreset: 'design' },
      events: [{ type: 'request/header', data: { header: { config: { provider: 'openrouter', model: 'deepseek/deepseek-v4-flash' } } } }, ...events],
    },
  } as never
}

let calls = 0
async function record(ctx: Context, args: Record<string, unknown>, agent: never = chat()) {
  calls += 1
  return await ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId(`learning-${String(calls)}`),
    name: skills.SKILL_LEARNING_TOOL,
    arguments: args,
    agent,
  })
}

const errorText = (result: { content: readonly unknown[] }): string => JSON.stringify(result.content)
const learningsFile = (vault: string, skill: string): string => join(vault, 'Reference', 'playbook-learnings', `${skill}.md`)

describe('the skill_learning tool', () => {
  it('appends one dated line per learning and never changes an earlier line', async () => {
    const { ctx, vault } = await boot()

    const first = await record(ctx, { skill: 'fold-learnings', learning: '  Step 3 names a base directory,\n  but the tool result calls it a resource base.  ' })
    expect(first.isError).toBe(false)
    const file = learningsFile(vault, 'fold-learnings')
    const afterFirst = await readFile(file, 'utf8')
    const day = /^created: (\d{4}-\d{2}-\d{2})$/m.exec(afterFirst)?.[1]
    expect(afterFirst).toBe([
      '---',
      'type: log',
      `created: ${String(day)}`,
      'description: What agents learned while using the fold-learnings skill, one dated line each. IDEalize appends to this file.',
      '---',
      '# Learnings: fold-learnings',
      '',
      `- ${String(day)} (design/deepseek/deepseek-v4-flash): Step 3 names a base directory, but the tool result calls it a resource base.`,
      '',
    ].join('\n'))
    expect(first.value).toEqual({
      recorded: true,
      path: 'Reference/playbook-learnings/fold-learnings.md',
      line: `- ${String(day)} (design/deepseek/deepseek-v4-flash): Step 3 names a base directory, but the tool result calls it a resource base.`,
    })
    expect(JSON.stringify(first.content)).toContain('Recorded in Reference/playbook-learnings/fold-learnings.md')

    // A second learning, from a chat whose log records a later brain.
    const second = await record(
      ctx,
      { skill: 'fold-learnings', learning: 'The proposal needs the date of the newest learning.' },
      chat([{ type: 'idealize/brain', data: { brain: 'coding' } }]),
    )
    expect(second.isError).toBe(false)
    const afterSecond = await readFile(file, 'utf8')
    expect(afterSecond.startsWith(afterFirst)).toBe(true)
    expect(afterSecond.slice(afterFirst.length))
      .toBe(`- ${String(day)} (coding/deepseek/deepseek-v4-flash): The proposal needs the date of the newest learning.\n`)
    expect(afterSecond.split('\n').filter(line => line.startsWith('- '))).toHaveLength(2)
    expect(await readdir(join(vault, 'Reference', 'playbook-learnings'))).toEqual(['fold-learnings.md'])
  })

  it('refuses a name that would leave the learnings folder, an unknown skill, and text that is empty or too long', async () => {
    const { ctx, vault } = await boot()

    for (const skill of ['../escape', 'nested/name', '/etc/passwd', 'Release Notes', '']) {
      const result = await record(ctx, { skill, learning: 'A step was wrong.' })
      expect(result.isError).toBe(true)
      expect(errorText(result)).toContain('invalid skill name')
    }
    const unknown = await record(ctx, { skill: 'never-installed', learning: 'A step was wrong.' })
    expect(errorText(unknown)).toContain('skill \\"never-installed\\" is not one of the skills available in this chat')
    const empty = await record(ctx, { skill: 'fold-learnings', learning: ' \n ' })
    expect(errorText(empty)).toContain('a learning needs one sentence of text')
    const long = await record(ctx, { skill: 'fold-learnings', learning: 'x'.repeat(skills.LEARNING_MAX_LENGTH + 1) })
    expect(errorText(long)).toContain('at most 500 characters; this one has 501')

    // Nothing was written, inside the folder or beside it.
    await expect(readdir(join(vault, 'Reference', 'playbook-learnings'))).rejects.toThrow()
    expect((await readdir(join(vault, 'Reference'))).filter(name => name.includes('escape'))).toEqual([])
    await expect(skills.appendLearning({
      folder: vault, skill: '../escape', brain: 'design', model: 'm', text: 'x', now: new Date(2026, 10, 16),
    })).rejects.toThrow('invalid skill name "../escape"')
    expect((await readdir(join(vault, 'Reference'))).filter(name => name.includes('escape'))).toEqual([])
  })

  it('says so and writes nothing when no documentation folder is set', async () => {
    const { ctx, vault } = await boot(false)
    const result = await record(ctx, { skill: 'fold-learnings', learning: 'A step was wrong.' }, undefined as never)
    expect(result.isError).toBe(false)
    expect(result.value).toEqual({
      recorded: false,
      note: 'No documentation folder is set, so the learning was not recorded. Tell the user what you learned instead.',
    })
    expect(JSON.stringify(result.content)).toContain('No documentation folder is set')
    expect(await readdir(vault)).toEqual([])
  })

  it('reaches the model as one tool schema and one standing prompt line, and both go with the plugin', async () => {
    const { ctx } = await boot()
    const schema = ctx.tools.schemas().find(tool => tool.name === skills.SKILL_LEARNING_TOOL)
    expect(schema).toEqual({
      name: 'skill_learning',
      description: 'Record one thing you learned about a skill while using it: a step that proved wrong, missing or out of date. '
        + 'The learning is appended as one dated line to that skill\'s learnings file in the user\'s documentation folder, '
        + 'where the user reviews it before the skill changes. This tool only adds a line; it never changes the skill or an earlier learning.',
      parameters: {
        type: 'object',
        required: ['skill', 'learning'],
        properties: {
          skill: { type: 'string', description: 'The exact name of the skill the learning is about, as the available skills list gives it.' },
          learning: { type: 'string', description: 'One sentence, at most 500 characters: what the skill\'s step said and what was true instead.' },
        },
      },
    })

    expect(ctx.tools.get(skills.SKILL_LEARNING_TOOL)?.presentCall?.({ skill: 'release-notes', learning: 'Step 2 is out of date.' }))
      .toEqual({ card: 'generic', title: 'Record a learning about release-notes', kind: 'other', rawInput: 'Step 2 is out of date.' })

    const assembled = await ctx.systemPrompt.assemble({})
    // The line sits straight after the documentation rule it builds on.
    const names = assembled.sections.map(section => section.name)
    expect(names.indexOf(skills.LEARNINGS_SECTION_NAME)).toBe(names.indexOf(docPolicy.DOCUMENTATION_SECTION_NAME) + 1)
    expect(skills.LEARNINGS_SECTION_ORDER).toBe(docPolicy.DOCUMENTATION_SECTION_ORDER + 1)
    expect(renderPrompt(assembled)).toContain(
      'When a step in a skill you loaded proves wrong, missing or out of date, complete the task the correct way, '
      + 'then call the skill_learning tool once with the skill\'s name and one sentence that says what the step said and what was true instead. '
      + 'Record only what you observed in this chat. Never edit a skill\'s own files to correct it.',
    )
  })
})

describe('appendLearning', () => {
  it('starts a new line after a file the person left without a line ending, and writes one header under a race', async () => {
    root = await mkdtemp(join(tmpdir(), 'idealize-skill-learnings-'))
    const now = new Date(2026, 10, 16, 23, 59)
    const file = learningsFile(root, 'release-notes')
    await mkdir(join(root, 'Reference', 'playbook-learnings'), { recursive: true })
    await writeFile(file, '---\ntype: log\n---\n- 2026-11-01 (design/m): An earlier learning.')
    expect(await skills.appendLearning({ folder: root, skill: 'release-notes', brain: 'design', model: 'm', text: 'A later one.', now }))
      .toEqual({ path: 'Reference/playbook-learnings/release-notes.md', line: '- 2026-11-16 (design/m): A later one.' })
    expect(await readFile(file, 'utf8'))
      .toBe('---\ntype: log\n---\n- 2026-11-01 (design/m): An earlier learning.\n- 2026-11-16 (design/m): A later one.\n')

    await Promise.all(['one', 'two', 'three'].map(text => skills.appendLearning({
      folder: root!, skill: 'triage', brain: 'design', model: 'm', text, now,
    })))
    const raced = await readFile(learningsFile(root, 'triage'), 'utf8')
    expect(raced.match(/^type: log$/gm)).toHaveLength(1)
    expect(raced.split('\n').filter(line => line.startsWith('- 2026-11-16 (design/m): ')).map(line => line.slice(-5).trim().split(' ').pop()).sort())
      .toEqual(['one', 'three', 'two'])
  })
})

describe('appendLearning on a folder it cannot write to', () => {
  it('reports the failure and leaves the folder as it was', async () => {
    root = await mkdtemp(join(tmpdir(), 'idealize-skill-learnings-'))
    const folder = join(root, 'Reference', 'playbook-learnings')
    await mkdir(folder, { recursive: true })
    await chmod(folder, 0o555)
    try {
      await expect(skills.appendLearning({
        folder: root, skill: 'release-notes', brain: 'design', model: 'm', text: 'A step was wrong.', now: new Date(2026, 10, 16),
      })).rejects.toThrow(/EACCES|EPERM/)
      expect(await readdir(folder)).toEqual([])
    } finally {
      await chmod(folder, 0o755)
    }
  })
})

describe('learningAuthor', () => {
  const header = { cwd: '/work', agentPreset: 'design' }
  const request = (model: string) => ({ type: 'request/header', data: { header: { config: { provider: 'p', model } } } })

  it('names the logged brain before the preset, the latest request\'s model, and unknown where the log names none', () => {
    expect(skills.learningAuthor(undefined)).toEqual({ brain: 'unknown', model: 'unknown' })
    expect(skills.learningAuthor({ header: { cwd: '/work' }, events: [] } as never)).toEqual({ brain: 'unknown', model: 'unknown' })
    expect(skills.learningAuthor({ header, events: [request('first'), request('second')] } as never))
      .toEqual({ brain: 'design', model: 'second' })
    expect(skills.learningAuthor({
      header, events: [request('model (preview)'), { type: 'idealize/brain', data: { brain: 'field notes' } }],
    } as never)).toEqual({ brain: 'field-notes', model: 'model-preview-' })
  })
})

describe('the fold-learnings skill', () => {
  it('ships with the plugin and names the proposal file as the only file it writes', async () => {
    const { ctx } = await boot()
    const listed = (await ctx.skills.list()).find(skill => skill.name === 'fold-learnings')
    expect(listed).toMatchObject({ provider: skills.BUILT_IN_SKILLS_PROVIDER_NAME, source: 'bundled' })
    expect(listed?.description).toContain('save the draft as <skill>.proposed.md beside the learnings file')

    const body = (await ctx.skills.get('fold-learnings'))?.content ?? ''
    expect(body).toContain('You write exactly one file: `Reference/playbook-learnings/<skill>.proposed.md`')
    expect(body).toContain('Never edit, move or delete the learnings file `<skill>.md`.')
    expect(body).toContain('Never edit the skill\'s own files')
    expect(body).toContain('Never create any other file')
    // Every instruction to write names the proposal file.
    const writes = body.split('\n').filter(line => /\bwrite\b.*`Reference\//i.test(line))
    expect(writes.length).toBeGreaterThan(0)
    for (const line of writes) expect(line).toContain('<skill>.proposed.md')
  })

  it('stops being offered, with the tool and the prompt line, when the plugin is disposed', async () => {
    root = await mkdtemp(join(tmpdir(), 'idealize-skill-learnings-'))
    const ctx = new Context()
    context = ctx
    await ctx.plugin(SystemPrompt, { persona: '', includeHarnessIdentity: false, includeRuntimeContext: false })
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(docPolicy, {})
    const fiber = await ctx.plugin(skills, { unpackFolder: join(root, 'unpack') })
    expect((await ctx.skills.list()).map(skill => skill.name)).toEqual(['fold-learnings'])
    expect(ctx.tools.schemas().map(tool => tool.name)).toContain('skill_learning')

    await fiber.dispose()
    expect(await ctx.skills.list()).toEqual([])
    expect(ctx.tools.schemas().map(tool => tool.name)).not.toContain('skill_learning')
    expect((await ctx.systemPrompt.assemble({})).sections.map(section => section.name)).not.toContain(skills.LEARNINGS_SECTION_NAME)
  })
})
