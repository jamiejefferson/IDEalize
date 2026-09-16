/**
 * @idealize/gen-tools/tools — the three generation tools (`generate_image`,
 * `generate_video`, `generate_audio`): the Consumer role of the generation
 * seam, composed from a media agent preset so only Gallery / Sound Stage
 * sessions carry them (AC-06).
 *
 * Each call routes one task through `ctx.generation`: the media preset's
 * required capabilities filter the catalogue, the stored preset→model choice
 * (the `models` map of the `idealize-activity-pills` settings section) picks
 * the model, and a stored choice absent from the compatible catalogue falls
 * back to the first compatible entry — the stored value stays untouched, the
 * session logs `generation/rerouted`, and the tool result carries the same
 * notice (BRN routing rule). Zero compatible models is the BRN-09 unavailable
 * state: the call fails with the seam's recovery action.
 *
 * Results are committed through `ctx.artefacts` (bytes under the project,
 * durable record, `artefact/created`); a generation failure appends
 * `artefact/failed` carrying the adapter's GenerationError message (MOD-05)
 * and fails the call. `run_in_background: true` runs the generation as
 * `ctx.jobs` work and returns the job id immediately.
 * @module @idealize/gen-tools/tools
 */

import { randomUUID } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Session } from '@deepseek-ai/dsh-session'
import type { JsonValue } from '@deepseek-ai/dsh-session/types'
import type { CallId } from '@deepseek-ai/dsh-llm/brand'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ParameterPropertySpec, ToolDefinition } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-jobs'
import type {} from '@deepseek-ai/dsh-workspace'
import { ArtefactId } from '@idealize/artefacts'
import type { ArtefactRecord } from '@idealize/artefacts'
import { GENERATION_SCHEMA_VERSION, MEDIA_PRESETS, storedMediaModel } from '@idealize/generate'
import type {
  ActivityModelsSectionFace,
  GenArtefact,
  GenAttachment,
  GenCatalogEntry,
  GenerationRequest,
  MediaPresetDefinition,
} from '@idealize/generate'
import type { GenerationReroutedData } from './types.ts'

export type { GenerationReroutedData } from './types.ts'

declare module '@deepseek-ai/dsh-jobs' {
  interface JobKindMap {
    generation: 'generation'
  }
}

/** Cordis plugin name. */
export const name = 'idealize-generation-tools'
/** Required services; settings and jobs stay optional (`ctx.get`). */
export const inject = ['tools', 'generation', 'artefacts', 'workspaceRegistry']

/** Plugin config. */
export interface Config {
  /** Expose `run_in_background` and accept background generations (default true). */
  enableRunInBackground?: boolean
}

/** Runtime schema for {@link Config}. */
export const Config: z<Config> = z.object({
  enableRunInBackground: z.boolean().default(true),
})

/** The activity preset settings section (that plugin owns the schema; the media choices share its `models` map). */
const ACTIVITY_NS = settingsNamespace('idealize-activity-pills')

/** One tool's identity and the prompt-adjacent settings it accepts. */
interface GenerationToolSpec {
  toolName: string
  artefact: GenArtefact
  description: string
  /** Additional model-facing parameters beyond `prompt`, merged into the stored generation settings. */
  extraParameters: Record<string, ParameterPropertySpec>
}

/**
 * How the composer's trailing settings tag maps onto the tool's arguments.
 * The person's message may end with a bracketed tag the composer appended
 * from its settings strip, and the tag's names are the wire names the model's
 * input schema uses, so every pair that is not one of the tool's own
 * parameters travels through `options` unchanged.
 */
const TAG_GUIDE = ' The message may end with a bracketed settings tag such as `[aspect 16:9, duration 8, resolution 1080p, generate_audio false]`: '
  + 'strip it from the prompt, map `aspect X` to `aspect`, `duration N` to `duration_s`, and pass every other `name value` pair as `options.name` under its own name, '
  + 'a numeric value as a number and `true`/`false` as a boolean.'

/** The `options` parameter every generation tool takes: the model's own inputs, passed through by name. */
const OPTIONS_PARAMETER: ParameterPropertySpec = {
  type: 'object',
  additionalProperties: true,
  description: 'Other inputs the model\'s input schema names, for example resolution "1080p", duration 45 or camera_fixed true; passed to the provider under their own names. Values are strings, numbers or booleans.',
}

/**
 * The `reference_image` parameter the image and video tools take: an existing
 * picture the generation starts from. An artefact id reaches any image the
 * project has generated, in this chat or another; a path reaches a file the
 * person dropped into the project folder.
 */
const REFERENCE_IMAGE_PARAMETER: ParameterPropertySpec = {
  type: 'string',
  description: 'Optional reference image the generation starts from: an artefact id from a previous generation '
    + '(any chat of this project), or a path under the project such as "Images/2026-09-08_ab12cd34.png". '
    + 'A video model animates it as the first frame; an image model uses it as the source picture.',
}

const TOOL_SPECS: readonly GenerationToolSpec[] = [
  {
    toolName: 'generate_image',
    artefact: 'image',
    description: 'Generate a still image from a text prompt, optionally from a reference image. The result is stored as a project artefact '
      + '(its id stays valid across chats and modes) and the call returns the artefact id, media type, and file path.'
      + TAG_GUIDE + ' A `[N images]` tag maps to `count`.',
    extraParameters: {
      aspect: { type: 'string', description: 'Optional aspect ratio or size hint (for example "1:1", "16:9", "1024x1024"); passed to the provider as a generation setting.' },
      count: { type: 'integer', description: 'Optional number of images to make in one call; passed to the provider as a generation setting.' },
      reference_image: REFERENCE_IMAGE_PARAMETER,
      options: OPTIONS_PARAMETER,
    },
  },
  {
    toolName: 'generate_video',
    artefact: 'video',
    description: 'Generate a video from a text prompt, optionally animating a reference image. The result is stored as a project artefact '
      + '(its id stays valid across chats and modes) and the call returns the artefact id, media type, and file path.'
      + TAG_GUIDE,
    extraParameters: {
      duration_s: { type: 'number', description: 'Optional target duration in seconds; passed to the provider as a generation setting.' },
      reference_image: REFERENCE_IMAGE_PARAMETER,
      options: OPTIONS_PARAMETER,
    },
  },
  {
    toolName: 'generate_audio',
    artefact: 'audio',
    description: 'Generate audio from a text prompt. The result is stored as a project artefact '
      + '(its id stays valid across chats and modes) and the call returns the artefact id, media type, and file path.'
      + TAG_GUIDE,
    extraParameters: {
      duration_s: { type: 'number', description: 'Optional target duration in seconds; passed to the provider as a generation setting.' },
      lyrics: { type: 'string', description: 'Lyrics to sing, for music models that take them; structure tags such as [verse] and [chorus] are allowed. Leave it out for instrumental audio.' },
      options: OPTIONS_PARAMETER,
    },
  },
]

/** Model-facing arguments shared by the three tools (each advertises its own subset). */
interface GenerationToolArgs {
  prompt: string
  aspect?: string
  count?: number
  duration_s?: number
  lyrics?: string
  reference_image?: string
  options?: Record<string, JsonValue>
  run_in_background?: boolean
}

/** The image media types a reference file may carry, by extension. */
const IMAGE_TYPES_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

/**
 * Resolve a `reference_image` argument to the bytes a generation request
 * attaches: an artefact id names a stored image through `ctx.artefacts`; any
 * other value is a path under `projectPath`, and one that resolves outside it
 * is refused rather than read. The model produced the value, so every step
 * is checked.
 * @param ctx - the plugin context carrying `artefacts`.
 * @param toolName - the calling tool, for the refusal.
 * @param reference - the argument as the model sent it.
 * @param projectPath - the project the path form is fenced to.
 * @returns the attachment, base64 encoded.
 * @throws when the id is unknown or not an image, the path leaves the project, the file is missing, or its type is not an image.
 */
export async function resolveReferenceImage(
  ctx: Context, toolName: string, reference: string, projectPath: string,
): Promise<GenAttachment> {
  const record = ctx.artefacts.get(ArtefactId(reference))
  if (record !== undefined) {
    if (!record.mediaType.startsWith('image/')) {
      throw new Error(`${toolName}: reference_image ${reference} is ${record.mediaType}, not an image`)
    }
    const bytes = await readFile(ctx.artefacts.resolve(record.id))
    return { mediaType: record.mediaType, data: bytes.toString('base64') }
  }
  const absolute = resolve(projectPath, reference)
  const escapes = (root: string, candidate: string): boolean => {
    const inside = relative(root, candidate)
    return inside === '' || inside.startsWith('..') || isAbsolute(inside)
  }
  // Judged as the filesystem has it when the file exists, so a project reached
  // through a symlink (macOS's /tmp) admits its own files and a symlink under
  // the project pointing out of it does not; a missing file is judged on the
  // path as written, and the read below reports it.
  let real: string | undefined
  try {
    real = await realpath(absolute)
  } catch {
    // Swallows the missing-file error: `real` stays undefined and readFile below names the failure.
  }
  if (real === undefined ? escapes(projectPath, absolute) : escapes(await realpath(projectPath), real)) {
    throw new Error(`${toolName}: reference_image must be an artefact id or a path inside the project; ${reference} is neither`)
  }
  const mediaType = IMAGE_TYPES_BY_EXTENSION[extname(absolute).toLowerCase()]
  if (mediaType === undefined) {
    throw new Error(`${toolName}: reference_image ${reference} is not a png, jpeg, webp or gif file`)
  }
  let bytes: Buffer
  try {
    bytes = await readFile(real ?? absolute)
  } catch (error) {
    throw new Error(`${toolName}: reference_image ${reference} could not be read: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
  return { mediaType, data: bytes.toString('base64') }
}

/**
 * The `options` a call carries, validated at the model JSON boundary: every
 * value must be a string, number or boolean, since the provider's input
 * fields are scalars and a nested value would be refused far from its cause.
 * @param toolName - the calling tool, for the refusal.
 * @param options - the `options` argument as the model sent it.
 * @returns the scalar options, empty when none were sent.
 * @throws when a value is not a scalar.
 */
export function scalarOptions(toolName: string, options: Record<string, JsonValue> | undefined): Record<string, string | number | boolean> {
  const scalars: Record<string, string | number | boolean> = {}
  for (const [name, value] of Object.entries(options ?? {})) {
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      throw new Error(`${toolName}: options.${name} must be a string, number or boolean`)
    }
    scalars[name] = value
  }
  return scalars
}

/** One stored artefact as the canonical tool value reports it. */
const ARTEFACT_OUTPUT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true, description: 'The artefact id; resolve it later with artefacts_get.' },
    mediaType: { type: 'string', required: true },
    path: { type: 'string', required: true, description: 'Absolute file path of the stored bytes.' },
    relPath: { type: 'string', required: true, description: 'Project-relative storage path.' },
    bytes: { type: 'integer', required: true },
    sha256: { type: 'string', required: true },
  },
} as const

/** The turn a call ran in, read from its own `tool/call` event; 0 when the call was dispatched outside a turn. */
function turnOf(session: Session, callId: CallId): number {
  for (let index = session.events.length - 1; index >= 0; index -= 1) {
    const event = session.events[index]
    if (event?.type === 'tool/call' && event.data.callId === callId) return event.data.turn
  }
  return 0
}

/**
 * Build the three generation tools over the host services.
 * @param ctx - the plugin context carrying `generation`, `artefacts`, `workspaceRegistry`, and optionally `settings` and `jobs`.
 * @param config - background-run gating.
 * @returns the registry-ready tool definitions, one per artefact kind.
 */
export function createGenerationTools(ctx: Context, config: Config = {}): ToolDefinition[] {
  const backgroundEnabled = config.enableRunInBackground ?? true
  return TOOL_SPECS.map((spec) => {
    const preset: MediaPresetDefinition | undefined = MEDIA_PRESETS.find(candidate => candidate.artefactType === spec.artefact)
    if (preset === undefined) {
      throw new Error(`gen-tools: no media preset produces the ${spec.artefact} artefact`)
    }
    return defineTool({
      name: spec.toolName,
      description: spec.description
        + (backgroundEnabled
          ? ' Set `run_in_background: true` for long generations: the call returns a job id immediately; read its outcome with `job_output` and stop it with `job_kill`.'
          : ''),
      parameters: {
        prompt: { type: 'string', required: true, description: 'What to generate.' },
        ...spec.extraParameters,
        ...backgroundEnabled ? {
          run_in_background: { type: 'boolean' as const, description: 'Run in the background and return a job id immediately.' },
        } : {},
      },
      output: {
        schema: {
          oneOf: [
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                kind: { type: 'string', required: true, const: 'background' },
                jobId: { type: 'string', required: true },
              },
            },
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                kind: { type: 'string', required: true, const: 'foreground' },
                provider: { type: 'string', required: true, description: 'The backend that served the generation.' },
                model: { type: 'string', required: true, description: 'The model that served the generation.' },
                artefacts: { type: 'array', required: true, items: ARTEFACT_OUTPUT },
                notice: { type: 'string', description: 'Routing notice when the stored model was unavailable and a compatible one served instead.' },
              },
            },
          ],
        },
        render: (_args, value) => {
          if (value.kind === 'background') {
            return [{ type: 'text', text: `started background generation job ${value.jobId}` }]
          }
          const lines = value.artefacts.map(artefact =>
            `${artefact.mediaType} artefact ${artefact.id} (${String(artefact.bytes)} bytes, ${value.provider}/${value.model}) at ${artefact.path}`)
          if (value.notice !== undefined) lines.unshift(value.notice)
          return [{ type: 'text', text: lines.join('\n') }]
        },
      },
      presentCall: args => ({
        card: 'generic',
        title: `${spec.toolName.replace('_', ' ')}: ${args.prompt.length > 80 ? `${args.prompt.slice(0, 77)}...` : args.prompt}`,
      }),
      async execute(args: GenerationToolArgs, exec) {
        const agent = exec.agent
        if (agent === undefined) throw new Error(`${spec.toolName} requires an agent session`)
        const session = agent.session
        const cwd = session.header.cwd
        if (cwd === undefined || cwd === '') {
          throw new Error(`${spec.toolName}: the session has no working directory to store artefacts in`)
        }

        const candidates: GenCatalogEntry[] = ctx.generation.compatible(preset.requiredCapabilities)
        const [first] = candidates
        if (first === undefined) {
          const availability = ctx.generation.availability(preset.requiredCapabilities)
          const recovery = availability.state === 'unavailable' ? ` ${availability.recovery}` : ''
          throw new Error(`no compatible ${spec.artefact} generation model is available.${recovery}`)
        }

        const face = ctx.get('settings')?.get(ACTIVITY_NS) as ActivityModelsSectionFace | undefined
        const stored = storedMediaModel(face, preset.id)
        const storedEntry = stored === null
          ? undefined
          : candidates.find(entry => entry.backend === stored.backend && entry.model.id === stored.model)
        const entry = storedEntry ?? first
        let notice: string | undefined
        if (stored !== null && storedEntry === undefined) {
          notice = `the stored ${preset.id} model ${stored.backend}/${stored.model} is unavailable; `
            + `this task ran on ${entry.backend}/${entry.model.id}`
          const rerouted: GenerationReroutedData = {
            presetId: preset.id,
            artefact: spec.artefact,
            stored,
            used: { backend: entry.backend, model: entry.model.id },
            reason: 'the stored model is not in the current compatible catalogue',
          }
          session.append('generation/rerouted', rerouted, { ignorable: true })
        }

        const workspace = await ctx.workspaceRegistry.resolveByPath(cwd) ?? await ctx.workspaceRegistry.create(cwd)
        // The model's own inputs first, so a named parameter wins over an
        // `options` entry of the same name.
        const settings: JsonValue = {
          ...scalarOptions(spec.toolName, args.options),
          prompt: args.prompt,
          ...args.aspect === undefined ? {} : { aspect: args.aspect },
          ...args.count === undefined ? {} : { count: args.count },
          ...args.duration_s === undefined ? {} : { duration_s: args.duration_s },
          ...args.lyrics === undefined ? {} : { lyrics: args.lyrics },
        }
        const sourceTask = { turnSeq: turnOf(session, exec.callId), callId: exec.callId, toolName: spec.toolName }
        // The reference travels as an attachment, not a setting: adapters pass
        // settings to the provider by name, and no provider takes a path. The
        // artefact record keeps the reference so the enlarged view can say
        // where a picture came from.
        const reference = args.reference_image === undefined || args.reference_image === ''
          ? undefined
          : await resolveReferenceImage(ctx, spec.toolName, args.reference_image, workspace.path)
        const recorded: JsonValue = reference === undefined ? settings : { ...settings, reference_image: args.reference_image ?? '' }
        const request: GenerationRequest = {
          schemaVersion: GENERATION_SCHEMA_VERSION,
          taskIntent: preset.taskIntent,
          requiredCapabilities: preset.requiredCapabilities,
          model: { backend: entry.backend, model: entry.model.id },
          prompt: args.prompt,
          settings,
          ...reference === undefined ? {} : { attachments: [reference] },
          projectPath: workspace.path,
        }

        const run = async (signal: AbortSignal): Promise<ArtefactRecord[]> => {
          let result
          try {
            result = await ctx.generation.generate(request, undefined, signal)
          } catch (error) {
            // MOD-05: the failure joins the session log with the adapter's cause;
            // the artefact store cannot log it because no bytes ever reached it.
            try {
              session.append('artefact/failed', {
                artefactId: ArtefactId(randomUUID()),
                mediaType: entry.model.outputMediaTypes[0] ?? `${spec.artefact}/*`,
                workspaceId: workspace.id,
                // `ctx.artefacts.create` stamps the session id itself; a
                // failure never reaches the store, so the event carries it.
                sourceTask: { sessionId: session.header.id, ...sourceTask },
                error: error instanceof Error ? error.message : String(error),
              }, { ignorable: true })
            } catch {
              // Swallows the append failing on a disposed session; the rethrow
              // below still reports the generation failure to the caller.
            }
            throw error
          }
          const records: ArtefactRecord[] = []
          for (const output of result.outputs) {
            records.push(await ctx.artefacts.create({
              session,
              mediaType: output.mediaType,
              bytes: Buffer.from(output.data, 'base64'),
              settings: recorded,
              sourceTask,
              provenance: { provider: result.backend, model: result.model, workspaceId: workspace.id },
            }))
          }
          return records
        }

        if (args.run_in_background === true) {
          // Undeclared keys are allowed, so schema omission also needs enforcement.
          if (!backgroundEnabled) {
            throw new Error('run_in_background is disabled for this deployment (enableRunInBackground: false)')
          }
          const jobs = ctx.get('jobs')
          if (jobs === undefined) {
            throw new Error('background jobs unavailable: load @deepseek-ai/dsh-jobs and @deepseek-ai/dsh-tool-jobs')
          }
          const controller = new AbortController()
          const jobId = jobs.start({
            kind: 'generation',
            label: `${spec.toolName}: ${args.prompt}`,
            owner: agent,
            run: () => ({
              cancel: () => {
                controller.abort()
              },
              done: run(controller.signal).then(
                records => ({
                  status: 'completed' as const,
                  detail: `${String(records.length)} artefact(s)`,
                  output: records.map(record =>
                    `${record.mediaType} artefact ${record.id} at ${record.storage.relPath}`).join('\n'),
                }),
                (error: unknown) => ({
                  status: controller.signal.aborted ? 'killed' as const : 'failed' as const,
                  detail: error instanceof Error ? error.message : String(error),
                }),
              ),
            }),
          })
          return { kind: 'background' as const, jobId: String(jobId) }
        }

        const records = await run(exec.signal)
        return {
          kind: 'foreground' as const,
          provider: entry.backend,
          model: entry.model.id,
          artefacts: records.map(record => ({
            id: String(record.id),
            mediaType: record.mediaType,
            path: ctx.artefacts.resolve(record.id),
            relPath: record.storage.relPath,
            bytes: record.storage.bytes,
            sha256: record.storage.sha256,
          })),
          ...notice === undefined ? {} : { notice },
        }
      },
    })
  })
}

/**
 * Register the three generation tools.
 * @param ctx - the plugin context.
 * @param config - background-run gating.
 */
export function apply(ctx: Context, config: Config = {}): void {
  for (const tool of createGenerationTools(ctx, config)) {
    ctx.effect(() => ctx.tools.register(tool), `gen-tools: ${tool.name}`)
  }
}
