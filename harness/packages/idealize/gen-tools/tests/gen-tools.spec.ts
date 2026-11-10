/**
 * REAL-composition coverage: a test-only cordis.yml booted through the
 * vendored Loader mounts storage, sessions, workspaces, the tool registry,
 * settings, the generation seam, the artefact store, the fixture backend, and
 * the `@idealize/gen-tools/tools` plugin. Assertions observe the durable
 * artefact record, the bytes on disk, the session log (artefact/created,
 * generation/rerouted, artefact/failed), the BRN-09 unavailable path against
 * the shipped OpenRouter catalogue, and the media agent preset seeding. The
 * chat node the client folds from `artefact/created` is proved over the
 * assembled headless run's committed log in
 * `tests/artefact-chat-node.client.spec.ts`.
 */

import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { load } from 'js-yaml'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import z from '@deepseek-ai/schemastery'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import SessionStore from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import SettingsFile from '@deepseek-ai/dsh-settings-file'
import AgentPresets from '@deepseek-ai/dsh-agent-presets'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { CallId } from '@deepseek-ai/dsh-llm/brand'
import type { Session } from '@deepseek-ai/dsh-session'
import GenerationRuntime, { GENERATION_SCHEMA_VERSION, GenerationError, isGenerationError } from '@idealize/generate'
import type { GenerationBackend, GenerationRequest } from '@idealize/generate'
import * as GenFixture from '@idealize/gen-fixture'
import { createImagesBackend } from '@idealize/services'
import ArtefactStore, { ArtefactId } from '@idealize/artefacts'
import * as GenToolsTools from '../src/tools.ts'
import { MEDIA_AGENTS, seedMediaAgents } from '../src/index.ts'

const ACTIVITY_NS = settingsNamespace('idealize-activity-pills')

/** The activity section schema as the tests register it (activity-pills owns the real one). */
const sectionSchema = z.object({
  models: z.dict(z.object({
    provider: z.string().required(),
    model: z.string().required(),
  })).default({}),
})

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** Boot the generation-tools composition through the real Loader over a temp root. */
async function loadComposition(options: { presets?: boolean } = {}): Promise<{ ctx: Context; projectDir: string; presetRoot: string }> {
  root = await mkdtemp(join(tmpdir(), 'idealize-gen-tools-'))
  const projectDir = join(root, 'project')
  const presetRoot = join(root, 'presets')
  await mkdir(projectDir, { recursive: true })
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-storage'",
    "- name: '@deepseek-ai/dsh-storage-json'",
    '  config:',
    `    root: ${JSON.stringify(join(root, 'storage'))}`,
    "- name: '@deepseek-ai/dsh-storage-domain'",
    '  config:',
    '    backend: json',
    "- name: '@deepseek-ai/dsh-session'",
    "- name: '@deepseek-ai/dsh-session-persistence-jsonl'",
    '  config:',
    `    root: ${JSON.stringify(join(root, 'sessions'))}`,
    "- name: '@deepseek-ai/dsh-workspace'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-settings-file'",
    '  config:',
    `    path: ${JSON.stringify(join(root, 'settings.yaml'))}`,
    '    watch: false',
    ...options.presets === true ? [
      "- name: '@deepseek-ai/dsh-agent-presets'",
      '  config:',
      '    default: standard',
      '    includeUserRoot: false',
      '    roots:',
      `      - path: ${JSON.stringify(presetRoot)}`,
    ] : [],
    "- name: '@idealize/generate'",
    "- name: '@idealize/artefacts'",
    "- name: '@idealize/gen-fixture'",
    '  config:',
    '    models:',
    '      - id: fixture-still',
    '        artefact: image',
    '      - id: fixture-tone',
    '        artefact: audio',
    '      - id: fixture-noise',
    '        artefact: audio',
    "- name: '@idealize/gen-tools/tools'",
    '',
  ].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-storage', Storage],
    ['@deepseek-ai/dsh-storage-json', StorageJson],
    ['@deepseek-ai/dsh-storage-domain', StorageDomain],
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-session-persistence-jsonl', JsonlSessionPersistence],
    ['@deepseek-ai/dsh-workspace', WorkspaceRegistry],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-settings-file', SettingsFile],
    ['@deepseek-ai/dsh-agent-presets', AgentPresets],
    ['@idealize/generate', GenerationRuntime],
    ['@idealize/artefacts', ArtefactStore],
    ['@idealize/gen-fixture', GenFixture],
    ['@idealize/gen-tools/tools', GenToolsTools],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  return { ctx: context, projectDir, presetRoot }
}

/** Build the tool set over the booted composition and pick one tool by name. */
function toolNamed(ctx: Context, name: string, config: GenToolsTools.Config = {}): ToolDefinition {
  const tool = GenToolsTools.createGenerationTools(ctx, config).find(candidate => candidate.name === name)
  if (tool === undefined) throw new Error(`tool ${name} was not created`)
  return tool
}

/** A tool execution context bound to a session (the loop normally supplies it). */
function execFor(session: Session, callId = 'call-1'): never {
  return {
    agent: { session },
    callId: CallId(callId),
    signal: new AbortController().signal,
  } as never
}

interface ForegroundValue {
  kind: string
  provider: string
  model: string
  notice?: string
  artefacts: { id: string; mediaType: string; path: string; relPath: string; bytes: number; sha256: string }[]
}

describe('@idealize/gen-tools composition', () => {
  it('refuses a call over the caps, and holds a generation nobody typed until the person answers', async () => {
    const { ctx, projectDir } = await loadComposition()
    const session = ctx.sessions.create(undefined, { meta: { cwd: projectDir } })
    const tool = toolNamed(ctx, 'generate_image')
    await expect(tool.execute({ prompt: 'a fish', count: 1000 }, execFor(session))).rejects.toThrow(/at most 8/)

    GenToolsTools.forgetPaidConfirmation()
    const asked: { reason?: string }[] = []
    ;(ctx as unknown as { provide(name: string, value: unknown): void }).provide('approval', {
      request: (request: { reason?: string }) => {
        asked.push(request)
        return Promise.resolve(asked.length === 1 ? 'rejected' : 'allowed-once')
      },
    })
    await expect(tool.execute({ prompt: 'a fish' }, execFor(session))).rejects.toThrow(/did not allow/)
    expect((await tool.execute({ prompt: 'a fish' }, execFor(session)) as ForegroundValue).artefacts).toHaveLength(1)
    await tool.execute({ prompt: 'a fish' }, execFor(session))
    expect(asked).toHaveLength(2)
    expect(asked[0]?.reason).toContain('fixture-still')
    GenToolsTools.forgetPaidConfirmation()
  })

  it('generate_image commits an artefact: durable record, bytes on disk, artefact/created', async () => {
    const { ctx, projectDir } = await loadComposition()
    const session = ctx.sessions.create(undefined, { meta: { cwd: projectDir } })
    const tool = toolNamed(ctx, 'generate_image')

    const value = await tool.execute({ prompt: 'a fish', aspect: '1:1' }, execFor(session)) as ForegroundValue
    expect(value.kind).toBe('foreground')
    expect(value.provider).toBe('fixture')
    expect(value.model).toBe('fixture-still')
    expect(value.notice).toBeUndefined()
    expect(value.artefacts).toHaveLength(1)
    const [artefact] = value.artefacts
    if (artefact === undefined) throw new Error('no artefact reported')
    expect(artefact.mediaType).toBe('image/png')

    const record = ctx.artefacts.get(ArtefactId(artefact.id))
    expect(record).toBeDefined()
    expect(record?.settings).toEqual({ prompt: 'a fish', aspect: '1:1' })
    expect(record?.sourceTask.toolName).toBe('generate_image')
    expect(String(record?.sourceTask.callId)).toBe('call-1')

    const stored = await readFile(artefact.path)
    expect(stored.byteLength).toBe(artefact.bytes)
    expect(createHash('sha256').update(stored).digest('hex')).toBe(artefact.sha256)
    expect(artefact.relPath).toMatch(/^Images\/\d{4}-\d{2}-\d{2}_[0-9a-f]{8}\.png$/)

    const event = session.events.find(candidate => candidate.type === 'artefact/created')
    expect(event?.ignorable).toBe(true)
    if (event?.type !== 'artefact/created') throw new Error('no artefact/created event')

    // Model-visible ⟺ logged: the whole record travels in the event, so the
    // chat node the client folds from it (proved over this same assembled log
    // in tests/artefact-chat-node.client.spec.ts) needs nothing else.
    expect(event.data.record).toEqual(record)
  })

  it('routes around an unavailable stored model and honours a compatible one', async () => {
    const { ctx, projectDir } = await loadComposition()
    ctx.settings.register(ACTIVITY_NS, sectionSchema, {
      base: {
        models: {
          images: { provider: 'fixture', model: 'gone-model' },
          sound: { provider: 'fixture', model: 'fixture-noise' },
        },
      },
    })
    const session = ctx.sessions.create(undefined, { meta: { cwd: projectDir } })

    // Stored image model is not in the catalogue: first compatible + notice.
    const image = await toolNamed(ctx, 'generate_image')
      .execute({ prompt: 'a fish' }, execFor(session, 'call-img')) as ForegroundValue
    expect(image.model).toBe('fixture-still')
    expect(image.notice).toContain('gone-model')
    expect(image.notice).toContain('fixture/fixture-still')
    const rerouted = session.events.find(candidate => candidate.type === 'generation/rerouted')
    expect(rerouted?.ignorable).toBe(true)
    expect(rerouted?.data).toMatchObject({
      presetId: 'images',
      stored: { backend: 'fixture', model: 'gone-model' },
      used: { backend: 'fixture', model: 'fixture-still' },
    })

    // Stored audio model is compatible: honoured, no notice, no reroute event.
    const audio = await toolNamed(ctx, 'generate_audio')
      .execute({ prompt: 'a hum' }, execFor(session, 'call-audio')) as ForegroundValue
    expect(audio.model).toBe('fixture-noise')
    expect(audio.notice).toBeUndefined()
    const audioReroutes = session.events.filter(candidate =>
      candidate.type === 'generation/rerouted' && (candidate.data as { presetId: string }).presetId === 'sound')
    expect(audioReroutes).toHaveLength(0)
  })

  it('passes over a model that starts from a picture when the call carries none, and swaps one chosen for it', async () => {
    const { ctx, projectDir } = await loadComposition()
    const seen: string[] = []
    const backend = (id: string, model: string, requiredInputs?: readonly ('image')[]): GenerationBackend => ({
      id,
      describe: () => [],
      models: () => [{
        id: model, name: model === 'animate' ? 'Animate' : model, artefact: 'video', inputModalities: ['text', 'image'], outputMediaTypes: ['video/mp4'],
        ...requiredInputs === undefined ? {} : { requiredInputs },
      }],
      generate: (request) => {
        seen.push(`${id}/${request.model.model}:${String(request.attachments?.length ?? 0)}`)
        return Promise.resolve({
          schemaVersion: GENERATION_SCHEMA_VERSION, backend: id, model, artefact: 'video',
          outputs: [{ mediaType: 'video/mp4', data: Buffer.from('MP4').toString('base64') }], timestamp: 1,
        })
      },
    })
    // The picture-only model registers first, so it heads the catalogue.
    ctx.generation.register(backend('pic', 'animate', ['image']))
    ctx.generation.register(backend('txt', 'clip'))
    const session = ctx.sessions.create(undefined, { meta: { cwd: projectDir } })
    const video = toolNamed(ctx, 'generate_video')

    // No reference: the first model that runs on a prompt alone serves.
    const plain = await video.execute({ prompt: 'a kite' }, execFor(session, 'call-plain')) as ForegroundValue
    expect(plain.model).toBe('clip')

    // With a reference, the picture-only model is runnable and heads the list.
    const still = await toolNamed(ctx, 'generate_image').execute({ prompt: 'a kite' }, execFor(session, 'call-still')) as ForegroundValue
    const moved = await video.execute({ prompt: 'it flies', reference_image: still.artefacts[0]!.id }, execFor(session, 'call-moved')) as ForegroundValue
    expect(moved.model).toBe('animate')

    // Chosen under Brains but called without a picture: swapped, and the card says why.
    ctx.settings.register(ACTIVITY_NS, sectionSchema, { base: { models: { motion: { provider: 'pic', model: 'animate' } } } })
    const swapped = await video.execute({ prompt: 'a kite' }, execFor(session, 'call-swapped')) as ForegroundValue
    expect(swapped.model).toBe('clip')
    expect(swapped.notice).toBe('Animate needs a starting picture, and this has none. Changed to clip, which starts from a prompt.')
    const moved2 = session.events.filter(event => event.type === 'generation/rerouted').at(-1)?.data as { callId?: string; reason?: string }
    expect(moved2.callId).toBe('call-swapped')
    expect(seen).toEqual(['txt/clip:0', 'pic/animate:1', 'txt/clip:0'])
  })

  it('hands a refused task to the next model and stays silent about nothing', async () => {
    const { ctx, projectDir } = await loadComposition()
    const backend = (id: string, fails?: string): GenerationBackend => ({
      id,
      describe: () => [],
      models: () => [{ id: `${id}-model`, name: id, artefact: 'video', inputModalities: ['text'], outputMediaTypes: ['video/mp4'] }],
      generate: () => fails !== undefined
        ? Promise.reject(new GenerationError('refused (422): resolution', fails as never, { status: 422 }))
        : Promise.resolve({
          schemaVersion: GENERATION_SCHEMA_VERSION, backend: id, model: `${id}-model`, artefact: 'video',
          outputs: [{ mediaType: 'video/mp4', data: Buffer.from('MP4').toString('base64') }], timestamp: 1,
        }),
    })
    ctx.generation.register(backend('first', 'INVALID_REQUEST'))
    ctx.generation.register(backend('second'))
    const session = ctx.sessions.create(undefined, { meta: { cwd: projectDir } })
    const done = await toolNamed(ctx, 'generate_video').execute({ prompt: 'a kite' }, execFor(session, 'call-moves')) as ForegroundValue
    expect(done.provider).toBe('second')
    expect(done.notice).toBe('first cannot take this request. Changed to second.')
    expect(session.events.some(event => event.type === 'artefact/failed')).toBe(false)
  })

  it('leaves a timeout on its model, because the provider may have charged for it', async () => {
    const { ctx, projectDir } = await loadComposition()
    const calls: string[] = []
    const backend = (id: string): GenerationBackend => ({
      id,
      describe: () => [],
      models: () => [{ id: `${id}-model`, name: id, artefact: 'video', inputModalities: ['text'], outputMediaTypes: ['video/mp4'] }],
      generate: () => {
        calls.push(id)
        return Promise.reject(new GenerationError('took too long', 'TIMEOUT'))
      },
    })
    ctx.generation.register(backend('first'))
    ctx.generation.register(backend('second'))
    const session = ctx.sessions.create(undefined, { meta: { cwd: projectDir } })
    await expect(toolNamed(ctx, 'generate_video').execute({ prompt: 'a kite' }, execFor(session, 'call-slow'))).rejects.toThrow('took too long')
    expect(calls).toEqual(['first'])
  })

  it('generate_audio advertises lyrics and carries them into the generation settings', async () => {
    const { ctx, projectDir } = await loadComposition()
    const tool = toolNamed(ctx, 'generate_audio')
    const parameters = tool.parameters as { properties: Record<string, { type: string; description: string }>; required?: string[] }
    expect(parameters.properties['lyrics']).toEqual({
      type: 'string',
      description: 'Lyrics to sing, for music models that take them; structure tags such as [verse] and [chorus] are allowed. Leave it out for instrumental audio.',
    })
    expect(parameters.required ?? []).not.toContain('lyrics')
    expect(Object.keys(parameters.properties)).toEqual(['prompt', 'duration_s', 'lyrics', 'options', 'run_in_background'])

    const session = ctx.sessions.create(undefined, { meta: { cwd: projectDir } })
    const value = await tool.execute({ prompt: 'a sea shanty', lyrics: '[verse] salt on the wind' }, execFor(session)) as ForegroundValue
    const [artefact] = value.artefacts
    if (artefact === undefined) throw new Error('no artefact reported')
    expect(ctx.artefacts.get(ArtefactId(artefact.id))?.settings).toEqual({ prompt: 'a sea shanty', lyrics: '[verse] salt on the wind' })

    // Left out, the setting is absent rather than empty, so the adapter's default can apply.
    const plain = await tool.execute({ prompt: 'a hum' }, execFor(session, 'call-2')) as ForegroundValue
    const [hum] = plain.artefacts
    if (hum === undefined) throw new Error('no artefact reported')
    expect(ctx.artefacts.get(ArtefactId(hum.id))?.settings).toEqual({ prompt: 'a hum' })
  })

  it('every tool takes options by the model\'s own input names and carries them into the settings under a named parameter', async () => {
    const { ctx, projectDir } = await loadComposition()
    const session = ctx.sessions.create(undefined, { meta: { cwd: projectDir } })
    for (const name of ['generate_image', 'generate_video', 'generate_audio']) {
      const tool = toolNamed(ctx, name)
      const parameters = tool.parameters as {
        properties: Record<string, { type: string; additionalProperties?: boolean; description: string }>
      }
      expect(parameters.properties['options']).toMatchObject({ type: 'object', additionalProperties: true })
      expect(parameters.properties['options']!.description).toContain('resolution "1080p"')
      expect(tool.description).toContain('[aspect 16:9, duration 8, resolution 1080p, generate_audio false]')
      expect(tool.description).toContain('a numeric value as a number and `true`/`false` as a boolean')
      expect(tool.description).toContain('`options.name`')
    }
    const image = toolNamed(ctx, 'generate_image')
    expect(image.description).toContain('`[N images]` tag maps to `count`')
    expect((image.parameters as { properties: Record<string, { type: string }> }).properties['count']).toMatchObject({ type: 'integer' })
    expect(toolNamed(ctx, 'generate_video').description).not.toContain('[N images]')

    const value = await image.execute(
      { prompt: 'a fish', aspect: '16:9', count: 2, options: { resolution: '1080p', duration: 8, camera_fixed: true, aspect: 'ignored' } },
      execFor(session),
    ) as ForegroundValue
    const [artefact] = value.artefacts
    if (artefact === undefined) throw new Error('no artefact reported')
    expect(ctx.artefacts.get(ArtefactId(artefact.id))?.settings).toEqual({
      prompt: 'a fish', aspect: '16:9', count: 2, resolution: '1080p', duration: 8, camera_fixed: true,
    })

    // A nested option is refused at the model boundary, before any generation.
    await expect(image.execute({ prompt: 'a fish', options: { size: { w: 1 } } }, execFor(session, 'call-bad')))
      .rejects.toThrow('generate_image: options.size must be a string, number or boolean')
    expect(GenToolsTools.scalarOptions('generate_video', undefined)).toEqual({})
  })

  it('attaches a reference image by artefact id or project path, refusing a path outside the project', async () => {
    const { ctx, projectDir } = await loadComposition()
    const seen: GenerationRequest[] = []
    const capture: GenerationBackend = {
      id: 'capture',
      describe: () => [],
      models: () => [{
        id: 'capture-clip', name: 'capture-clip', artefact: 'video', inputModalities: ['text', 'image'], outputMediaTypes: ['video/mp4'],
      }],
      generate: (request) => {
        seen.push(request)
        return Promise.resolve({
          schemaVersion: GENERATION_SCHEMA_VERSION, backend: 'capture', model: 'capture-clip', artefact: 'video',
          outputs: [{ mediaType: 'video/mp4', data: Buffer.from('MP4').toString('base64') }], timestamp: 1,
        })
      },
    }
    ctx.generation.register(capture)
    const session = ctx.sessions.create(undefined, { meta: { cwd: projectDir } })
    const video = toolNamed(ctx, 'generate_video')
    const parameters = video.parameters as { properties: Record<string, { type: string; description: string }> }
    expect(parameters.properties['reference_image']?.description).toContain('an artefact id from a previous generation')
    expect(parameters.properties['reference_image']?.description).toContain('a path under the project')
    expect((toolNamed(ctx, 'generate_image').parameters as { properties: Record<string, unknown> }).properties['reference_image']).toBeDefined()
    expect((toolNamed(ctx, 'generate_audio').parameters as { properties: Record<string, unknown> }).properties['reference_image']).toBeUndefined()

    // An image another chat made: its id resolves through the artefact store.
    const still = await toolNamed(ctx, 'generate_image').execute({ prompt: 'a fish' }, execFor(session, 'call-still')) as ForegroundValue
    const stillId = still.artefacts[0]!.id
    const stillBytes = await readFile(still.artefacts[0]!.path)
    const byId = await video.execute({ prompt: 'the fish swims', reference_image: stillId }, execFor(session, 'call-by-id')) as ForegroundValue
    expect(seen).toHaveLength(1)
    expect(seen[0]!.attachments).toEqual([{ mediaType: 'image/png', data: stillBytes.toString('base64') }])
    // The provider sees no reference setting; the record keeps it.
    expect(seen[0]!.settings).toEqual({ prompt: 'the fish swims' })
    expect(ctx.artefacts.get(ArtefactId(byId.artefacts[0]!.id))?.settings).toEqual({ prompt: 'the fish swims', reference_image: stillId })

    // A file dropped into the project, by its relative path.
    await mkdir(join(projectDir, 'Images'), { recursive: true })
    await writeFile(join(projectDir, 'Images', 'sketch.JPG'), Buffer.from('JPEGBYTES'))
    await video.execute({ prompt: 'the sketch moves', reference_image: 'Images/sketch.JPG' }, execFor(session, 'call-by-path'))
    expect(seen[1]!.attachments).toEqual([{ mediaType: 'image/jpeg', data: Buffer.from('JPEGBYTES').toString('base64') }])
    // Or its absolute path, still inside the project.
    await video.execute({ prompt: 'again', reference_image: join(projectDir, 'Images', 'sketch.JPG') }, execFor(session, 'call-by-abs'))
    expect(seen[2]!.attachments?.[0]?.mediaType).toBe('image/jpeg')
    // An empty reference is no reference.
    await video.execute({ prompt: 'plain', reference_image: '' }, execFor(session, 'call-empty'))
    expect(seen[3]!.attachments).toBeUndefined()

    // Refused before any generation: a path leaving the project, a missing file, a non-image, a non-image artefact.
    await expect(video.execute({ prompt: 'x', reference_image: '../outside.png' }, execFor(session, 'call-out')))
      .rejects.toThrow('reference_image must be "attached", an artefact id or a path inside the project')
    await expect(video.execute({ prompt: 'x', reference_image: '/etc/hosts.png' }, execFor(session, 'call-abs-out')))
      .rejects.toThrow('inside the project')
    await expect(video.execute({ prompt: 'x', reference_image: '.' }, execFor(session, 'call-dot')))
      .rejects.toThrow('inside the project')
    await expect(video.execute({ prompt: 'x', reference_image: 'Images/missing.png' }, execFor(session, 'call-missing')))
      .rejects.toThrow('could not be read')
    await expect(video.execute({ prompt: 'x', reference_image: 'Images/notes.txt' }, execFor(session, 'call-txt')))
      .rejects.toThrow('is not a png, jpeg, webp or gif file')
    const sound = await toolNamed(ctx, 'generate_audio').execute({ prompt: 'a hum' }, execFor(session, 'call-hum')) as ForegroundValue
    await expect(video.execute({ prompt: 'x', reference_image: sound.artefacts[0]!.id }, execFor(session, 'call-audio-ref')))
      .rejects.toThrow('not an image')
    expect(seen).toHaveLength(4)
  })

  it('reads a picture the person attached in the chat when the reference says "attached"', async () => {
    const { ctx, projectDir } = await loadComposition()
    const seen: GenerationRequest[] = []
    ctx.generation.register({
      id: 'capture',
      describe: () => [],
      models: () => [{ id: 'capture-clip', name: 'capture-clip', artefact: 'video', inputModalities: ['text', 'image'], outputMediaTypes: ['video/mp4'] }],
      generate: (request) => {
        seen.push(request)
        return Promise.resolve({
          schemaVersion: GENERATION_SCHEMA_VERSION, backend: 'capture', model: 'capture-clip', artefact: 'video',
          outputs: [{ mediaType: 'video/mp4', data: Buffer.from('MP4').toString('base64') }], timestamp: 1,
        })
      },
    })
    const stored = new Map([['att-1', 'FIRST'], ['att-2', 'SECOND']])
    ;(ctx as unknown as { provide(name: string, value: unknown): void }).provide('attachments', {
      readImage: (ref: { attachmentId: string; mediaType: string }) =>
        Promise.resolve({ ref, data: new Uint8Array(Buffer.from(stored.get(ref.attachmentId) ?? '')) }),
    })
    const session = ctx.sessions.create(undefined, { meta: { cwd: projectDir } })
    const video = toolNamed(ctx, 'generate_video')
    expect((video.parameters as { properties: Record<string, { description: string }> }).properties['reference_image']?.description)
      .toContain('"attached" for the picture the person attached')

    // Nothing attached yet: refused, and the words say so.
    await expect(video.execute({ prompt: 'x', reference_image: 'attached' }, execFor(session, 'call-none')))
      .rejects.toThrow('nobody has attached one in this chat')

    const picture = (id: string): unknown => ({ type: 'image', attachment: { attachmentId: id, mediaType: 'image/jpeg', bytes: 5, width: 1, height: 1 } })
    session.append('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'animate these' }, picture('att-1'), picture('att-2')] } as never, { surfaceOp: 'append' })
    await video.execute({ prompt: 'it moves', reference_image: 'attached' }, execFor(session, 'call-first'))
    expect(seen[0]!.attachments).toEqual([{ mediaType: 'image/jpeg', data: Buffer.from('FIRST').toString('base64') }])
    await video.execute({ prompt: 'it moves', reference_image: 'attached:2' }, execFor(session, 'call-second'))
    expect(seen[1]!.attachments).toEqual([{ mediaType: 'image/jpeg', data: Buffer.from('SECOND').toString('base64') }])
    await expect(video.execute({ prompt: 'x', reference_image: 'attached:3' }, execFor(session, 'call-third')))
      .rejects.toThrow('asks for picture 3, and the latest message with pictures has 2')
  })

  it('moves a picture call off a model that cannot take one, and skips a service with no key', async () => {
    const { ctx, projectDir } = await loadComposition()
    const seen: string[] = []
    const backend = (id: string, model: string, inputs: readonly ('text' | 'image')[], keyed = true): GenerationBackend => ({
      id,
      describe: () => [{ artefact: 'video', availability: keyed ? 'available' : 'no-credential' }] as never,
      ...keyed ? {} : { credential: { label: id } as never },
      models: () => [{ id: model, name: model, artefact: 'video', inputModalities: inputs, outputMediaTypes: ['video/mp4'] }],
      generate: (request) => {
        seen.push(`${id}/${request.model.model}:${String(request.attachments?.length ?? 0)}`)
        return Promise.resolve({
          schemaVersion: GENERATION_SCHEMA_VERSION, backend: id, model, artefact: 'video',
          outputs: [{ mediaType: 'video/mp4', data: Buffer.from('MP4').toString('base64') }], timestamp: 1,
        })
      },
    })
    // A service with no key heads the catalogue; it must never be tried while a connected one can do the work.
    ctx.generation.register(backend('nokey', 'locked', ['text', 'image'], false))
    ctx.generation.register(backend('txt', 'prompt-only', ['text']))
    ctx.generation.register(backend('pic', 'animator', ['text', 'image']))
    ctx.settings.register(ACTIVITY_NS, sectionSchema, { base: { models: { motion: { provider: 'txt', model: 'prompt-only' } } } })
    const session = ctx.sessions.create(undefined, { meta: { cwd: projectDir } })
    const still = await toolNamed(ctx, 'generate_image').execute({ prompt: 'a kite' }, execFor(session, 'call-still')) as ForegroundValue
    const video = toolNamed(ctx, 'generate_video')

    const plain = await video.execute({ prompt: 'a kite' }, execFor(session, 'call-plain')) as ForegroundValue
    expect(plain.model).toBe('prompt-only')
    const moved = await video.execute({ prompt: 'it flies', reference_image: still.artefacts[0]!.id }, execFor(session, 'call-moved')) as ForegroundValue
    expect(moved.model).toBe('animator')
    expect(moved.notice).toBe('prompt-only can\'t start from a picture. Changed to animator, which can.')
    expect(seen).toEqual(['txt/prompt-only:0', 'pic/animator:1'])
  })

  it('generate_video surfaces the BRN-09 unavailable state against the real images adapter', async () => {
    const { ctx, projectDir } = await loadComposition()
    // The real adapter with no cached catalogue and no live refresh: it holds
    // only the image shapes the vendored provider library carries, so it
    // offers no video model.
    ctx.generation.register(createImagesBackend({
      id: 'openrouter',
      name: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      timeoutMs: 1000,
      resolveApiKey: () => Promise.resolve(undefined),
      fetchImpl: () => {
        throw new Error('the BRN-09 test must not touch the network')
      },
    }))
    const session = ctx.sessions.create(undefined, { meta: { cwd: projectDir } })

    const failure = await toolNamed(ctx, 'generate_video')
      .execute({ prompt: 'a pan across a desk' }, execFor(session))
      .catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toContain('no compatible video generation model is available')
    expect((failure as Error).message).toContain('video')
  })

  it('appends artefact/failed carrying the adapter GenerationError when a generation fails', async () => {
    const { ctx, projectDir } = await loadComposition()
    const boom: GenerationBackend = {
      id: 'boom',
      describe: () => [],
      models: () => [{
        id: 'boom-img', name: 'boom-img', artefact: 'image', inputModalities: ['text'], outputMediaTypes: ['image/png'],
      }],
      generate: () => Promise.reject(new GenerationError('took too long', 'TIMEOUT')),
    }
    ctx.generation.register(boom)
    ctx.settings.register(ACTIVITY_NS, sectionSchema, {
      base: { models: { images: { provider: 'boom', model: 'boom-img' } } },
    })
    const session = ctx.sessions.create(undefined, { meta: { cwd: projectDir } })

    const failure = await toolNamed(ctx, 'generate_image')
      .execute({ prompt: 'a fish' }, execFor(session))
      .catch((error: unknown) => error)
    expect(isGenerationError(failure) && failure.code).toBe('TIMEOUT')

    const event = session.events.at(-1)
    expect(event?.type).toBe('artefact/failed')
    expect(event?.ignorable).toBe(true)
    const data = event?.data as { error: string; mediaType: string }
    expect(data.error).toContain('took too long')
    expect(data.mediaType).toBe('image/png')
    expect(ctx.artefacts.list()).toHaveLength(0)
  })

  it('gates background runs on the job service and the deployment switch', async () => {
    const { ctx, projectDir } = await loadComposition()
    const session = ctx.sessions.create(undefined, { meta: { cwd: projectDir } })

    // No ctx.jobs in this composition: the background branch fails loud.
    await expect(toolNamed(ctx, 'generate_image')
      .execute({ prompt: 'a fish', run_in_background: true }, execFor(session)))
      .rejects.toThrow('background jobs unavailable')

    // Disabled by config: refused before the job service is even consulted.
    await expect(toolNamed(ctx, 'generate_image', { enableRunInBackground: false })
      .execute({ prompt: 'a fish', run_in_background: true }, execFor(session)))
      .rejects.toThrow('run_in_background is disabled')
  })

  it('seeds the Gallery, Sound Stage and Video presets with only the generation toolset', async () => {
    const { ctx, presetRoot } = await loadComposition({ presets: true })
    await seedMediaAgents(ctx, presetRoot)

    expect(MEDIA_AGENTS.map(agent => agent.id)).toEqual(['gallery', 'soundstage', 'video'])
    for (const agent of MEDIA_AGENTS) {
      const composition = load(await readFile(join(presetRoot, agent.id, 'agent.cordis.yml'), 'utf8')) as { name: string }[]
      expect(composition.map(row => row.name)).toEqual([
        '@deepseek-ai/dsh-persona',
        '@idealize/gen-tools/tools',
        '@deepseek-ai/dsh-tool-jobs',
      ])
      const metadata = await readFile(join(presetRoot, agent.id, 'preset.yml'), 'utf8')
      expect(metadata).toContain(agent.name)
    }
  })

  it('never overwrites a root that already holds a media agent', async () => {
    const { ctx, presetRoot } = await loadComposition({ presets: true })
    const galleryDir = join(presetRoot, 'gallery')
    await mkdir(galleryDir, { recursive: true })
    const sentinel = "- id: persona\n  name: '@deepseek-ai/dsh-persona'\n"
    await writeFile(join(galleryDir, 'agent.cordis.yml'), sentinel)

    await seedMediaAgents(ctx, presetRoot)
    expect(await readFile(join(galleryDir, 'agent.cordis.yml'), 'utf8')).toBe(sentinel)
    await expect(stat(join(presetRoot, 'soundstage'))).rejects.toThrow()
    await expect(stat(join(presetRoot, 'video'))).rejects.toThrow()
  })
})
