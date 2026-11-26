/**
 * `inspect_video`: tell the chat model how long a video is and what happens
 * when. A Studio chat writes the prompt for a soundtrack without ever seeing
 * the clip, so its prompt could name neither the length nor the moment a door
 * opens (JJ, 26 Nov 2026). The tool reads the length and frame size from
 * `ffmpeg`, and, when the chat's model takes pictures, hands it one sheet of
 * frames taken at even steps with the time of each.
 * @module @idealize/gen-tools/inspect-video
 */

import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition, ToolExecution } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-workspace'
import { findFfmpeg, resolveInput, runProgram } from './soundtrack.ts'

/** The tool's name. */
export const INSPECT_TOOL = 'inspect_video'

/** How many frames wide the sheet is. */
const COLUMNS = 4
/** The width of one frame on the sheet, in pixels. */
const FRAME_WIDTH = 320
/** Clips up to this long get 8 frames; longer ones get 12. */
const SHORT_CLIP_S = 10

/** What the tool needs from the computer; tests replace all three. */
export interface InspectDeps {
  /** The absolute path of `ffmpeg`, or undefined when this computer has none. */
  findFfmpeg(): Promise<string | undefined>
  /** What `ffmpeg -i` prints about one file. */
  describe(program: string, file: string, signal: AbortSignal): Promise<string>
  /** Run `ffmpeg` with these arguments; rejects with its last words when it fails. */
  run(program: string, args: readonly string[], signal: AbortSignal): Promise<void>
}

/* v8 ignore start -- runs the real program; the tool's specs inject a reader */
const describeFile: InspectDeps['describe'] = (program, file, signal) => new Promise<string>((done) => {
  // `ffmpeg -i` with no output file exits non-zero after printing what it read, so the exit code is ignored.
  execFile(program, ['-hide_banner', '-i', file], { signal, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 }, (_error, _stdout, stderr) => {
    done(stderr)
  })
})
/* v8 ignore stop */

/** What `ffmpeg` says about one video. */
export interface VideoFacts {
  duration_s: number
  width?: number
  height?: number
  fps?: number
  has_audio: boolean
}

/**
 * Read a video's length, frame size, frame rate and whether it has sound from `ffmpeg -i` output.
 * @param text - what `ffmpeg` printed.
 * @returns the facts, or undefined when the output names no length.
 */
export function videoFacts(text: string): VideoFacts | undefined {
  const length = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(text)
  if (length === null) return undefined
  const duration = Number(length[1]) * 3600 + Number(length[2]) * 60 + Number(length[3])
  const picture = /Stream #.*Video:.*/.exec(text)?.[0] ?? ''
  const size = /,\s*(\d{2,5})x(\d{2,5})[\s,[]/.exec(picture)
  const rate = /([\d.]+)\s*fps/.exec(picture)
  return {
    duration_s: Math.round(duration * 100) / 100,
    ...size === null ? {} : { width: Number(size[1]), height: Number(size[2]) },
    ...rate === null ? {} : { fps: Number(rate[1]) },
    has_audio: /Stream #.*Audio:/.test(text),
  }
}

/**
 * The times the sheet's frames are taken at: even steps from the start.
 * @param duration - the video's length in seconds.
 * @returns each frame's time in seconds, in sheet order.
 */
export function frameTimes(duration: number): number[] {
  const count = duration <= SHORT_CLIP_S ? 8 : 12
  return Array.from({ length: count }, (_, index) => Math.round(index * duration / count * 10) / 10)
}

/**
 * The `ffmpeg` arguments that write one sheet of frames.
 * @param video - the video file.
 * @param duration - its length in seconds.
 * @param output - where the sheet is written.
 * @returns the argument list.
 */
export function sheetArguments(video: string, duration: number, output: string): string[] {
  const count = frameTimes(duration).length
  return [
    '-y', '-hide_banner', '-loglevel', 'error', '-i', video,
    '-vf', `fps=${String(count)}/${String(duration)},scale=${String(FRAME_WIDTH)}:-2,tile=${String(COLUMNS)}x${String(count / COLUMNS)}`,
    '-frames:v', '1', '-q:v', '4', output,
  ]
}

/** The picture the sheet is stored as, as the attachment service returns it. */
interface SheetImage {
  attachmentId: string
  mediaType: string
  bytes: number
  width: number
  height: number
}

/** The tool's canonical result. */
interface InspectValue extends VideoFacts {
  /** The times of the sheet's frames, left to right then top to bottom; absent when no sheet was made. */
  frame_times_s?: number[]
  sheet?: SheetImage
  /** Why no sheet came back, when none did. */
  note?: string
}

/** The services the sheet needs; each may be absent. */
interface AttachmentsFace {
  saveImage(input: { data: Uint8Array; mediaType: 'image/jpeg'; name: string }): Promise<SheetImage>
}
interface LlmFace {
  resolveModelInfo(provider: string, model: string, signal: AbortSignal): Promise<{ inputModalities?: readonly string[] }>
}

/**
 * Whether the chat's own model takes pictures. Unknown counts as no: a
 * picture on a route that cannot carry it breaks the chat's next request.
 */
async function seesPictures(ctx: Context, exec: ToolExecution): Promise<boolean> {
  const routed = exec.agent?.session.requestHeader()?.config
  const provider = routed?.provider ?? exec.agent?.options.provider
  const model = routed?.model ?? exec.agent?.options.model
  const llm = (ctx as unknown as { get(service: string): unknown }).get('llm') as LlmFace | undefined
  if (provider === undefined || model === undefined || llm === undefined) return false
  try {
    return (await llm.resolveModelInfo(provider, model, exec.signal)).inputModalities?.includes('image') === true
  } catch {
    return false
  }
}

/**
 * What the model reads: the facts in a line, then the sheet with the time of each frame.
 * @param value - the tool's result.
 * @returns the content blocks.
 */
function inspectContent(value: InspectValue): ContentBlock[] {
  const size = value.width === undefined || value.height === undefined ? '' : `, ${String(value.width)}x${String(value.height)} px`
  const rate = value.fps === undefined ? '' : `, ${String(value.fps)} frames a second`
  const facts = `The video is ${String(value.duration_s)} s long${size}${rate}, ${value.has_audio ? 'with' : 'with no'} sound of its own.`
  if (value.sheet === undefined || value.frame_times_s === undefined) {
    return [{ type: 'text', text: `${facts} ${value.note ?? ''}`.trim() }]
  }
  const times = value.frame_times_s.map(time => `${String(time)} s`).join(', ')
  return [
    { type: 'text', text: `${facts} The picture shows ${String(value.frame_times_s.length)} frames, left to right then top to bottom, taken at about ${times}.` },
    { type: 'image', attachment: value.sheet as never },
  ]
}

/**
 * Build the tool over the host services.
 * @param ctx - the plugin context carrying `artefacts` and `workspaceRegistry`.
 * @param deps - how `ffmpeg` is found and run; the defaults use this computer.
 * @returns the registry-ready tool definition.
 */
export function createInspectVideoTool(
  ctx: Context, deps: InspectDeps = { findFfmpeg: () => findFfmpeg(), describe: describeFile, run: runProgram },
): ToolDefinition {
  return defineTool({
    name: INSPECT_TOOL,
    description: 'Look at a video this project holds: its overall length, frame size, and a sheet of frames with the time of each, so you know what happens when. '
      + 'Call it before writing a prompt for music or sound effects that go with the video, and before describing a video you have not seen. It costs nothing and changes nothing.',
    parameters: {
      video: { type: 'string', required: true, description: 'The video: an artefact id from a previous generation, or a path under the project such as "Video/2026-11-26_1164f590.mp4".' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          duration_s: { type: 'number', required: true, description: 'The video\'s overall length in seconds.' },
          width: { type: 'integer' },
          height: { type: 'integer' },
          fps: { type: 'number' },
          has_audio: { type: 'boolean', required: true },
          frame_times_s: { type: 'array', items: { type: 'number' } },
          sheet: {
            type: 'object',
            additionalProperties: false,
            properties: {
              attachmentId: { type: 'string', required: true },
              mediaType: { type: 'string', required: true },
              bytes: { type: 'integer', required: true },
              width: { type: 'integer', required: true },
              height: { type: 'integer', required: true },
            },
          },
          note: { type: 'string' },
        },
      },
      render: (_args, value) => inspectContent(value),
    },
    isConcurrencySafe: () => true,
    presentCall: () => ({ card: 'generic', title: 'inspect video' }),
    async execute(args: { video: string }, exec): Promise<InspectValue> {
      const session = exec.agent?.session
      if (session === undefined) throw new Error(`${INSPECT_TOOL} requires an agent session`)
      const cwd = session.header.cwd
      if (cwd === undefined || cwd === '') throw new Error(`${INSPECT_TOOL}: the session has no working directory`)
      const workspace = await ctx.workspaceRegistry.resolveByPath(cwd) ?? await ctx.workspaceRegistry.create(cwd)
      const video = await resolveInput(ctx, 'video', args.video, workspace.path, INSPECT_TOOL)
      const program = await deps.findFfmpeg()
      if (program === undefined) {
        throw new Error(`${INSPECT_TOOL}: reading a video needs the ffmpeg program, and this computer has none. `
          + 'Ask the person how long the video is and what happens when, or to install ffmpeg (for example `brew install ffmpeg`).')
      }
      const facts = videoFacts(await deps.describe(program, video, exec.signal))
      if (facts === undefined || facts.duration_s <= 0) throw new Error(`${INSPECT_TOOL}: ffmpeg could not read the length of ${args.video}`)

      const attachments = (ctx as unknown as { get(service: string): unknown }).get('attachments') as AttachmentsFace | undefined
      if (attachments === undefined || !await seesPictures(ctx, exec)) {
        const note = 'This chat\'s model does not take pictures, so no frames are shown; ask the person what happens when if the timing matters.'
        return { ...facts, note }
      }
      const folder = await mkdtemp(join(tmpdir(), 'idealize-inspect-'))
      try {
        const output = join(folder, 'sheet.jpg')
        await deps.run(program, sheetArguments(video, facts.duration_s, output), exec.signal)
        const saved = await attachments.saveImage({ data: await readFile(output), mediaType: 'image/jpeg', name: 'video-frames.jpg' })
        return {
          ...facts,
          frame_times_s: frameTimes(facts.duration_s),
          sheet: {
            attachmentId: saved.attachmentId, mediaType: saved.mediaType, bytes: saved.bytes, width: saved.width, height: saved.height,
          },
        }
      } catch (error) {
        // The length is the part a soundtrack cannot do without; a sheet that fails still returns it.
        return { ...facts, note: `The frames could not be read (${error instanceof Error ? error.message : String(error)}).` }
      } finally {
        await rm(folder, { recursive: true, force: true })
      }
    },
  })
}
