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
      .rejects.toThrow('reference_image must be an artefact id or a path inside the project')
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
      generate: () => Promise.reject(new GenerationError('credits exhausted', 'QUOTA')),
    }
    ctx.generation.register(boom)
    ctx.settings.register(ACTIVITY_NS, sectionSchema, {
      base: { models: { images: { provider: 'boom', model: 'boom-img' } } },
    })
    const session = ctx.sessions.create(undefined, { meta: { cwd: projectDir } })

    const failure = await toolNamed(ctx, 'generate_image')
      .execute({ prompt: 'a fish' }, execFor(session))
      .catch((error: unknown) => error)
    expect(isGenerationError(failure) && failure.code).toBe('QUOTA')

    const event = session.events.at(-1)
    expect(event?.type).toBe('artefact/failed')
    expect(event?.ignorable).toBe(true)
    const data = event?.data as { error: string; mediaType: string }
    expect(data.error).toContain('credits exhausted')
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
