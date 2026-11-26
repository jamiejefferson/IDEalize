/**
 * `add_soundtrack`: put a sound onto a video the project already holds, as a
 * new video artefact. A Studio chat composes no shell, so before this tool it
 * could make a clip and a sound and had no way to join them: JJ's first try
 * (26 Nov 2026) ended with the agent asking another chat to do it and telling
 * the person the work was under way, while that chat waited for a go-ahead.
 *
 * The join runs through the `ffmpeg` program on this computer. The video
 * stream is copied untouched, the sound replaces the clip's own audio, and the
 * result is as long as the video: a shorter sound ends in silence and a longer
 * one is cut. Neither input is changed.
 * @module @idealize/gen-tools/soundtrack
 */

import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { access, mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, extname, isAbsolute, join, relative, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { JsonValue } from '@deepseek-ai/dsh-session/types'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-workspace'
import { ArtefactId } from '@idealize/artefacts'

/** The tool's name; `@idealize/ui-gallery` and `@idealize/comm` restate it to show the result as a Studio row. */
export const SOUNDTRACK_TOOL = 'add_soundtrack'

/** The longest a join may run before it is stopped, in milliseconds. */
const JOIN_TIMEOUT_MS = 120_000

/** Folders searched after `PATH`: a packaged app starts without the shell's additions. */
const EXTRA_FOLDERS: readonly string[] = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']

/** The file types each input may be, by extension. */
const VIDEO_EXTENSIONS: ReadonlySet<string> = new Set(['.mp4', '.mov', '.m4v', '.webm'])
const AUDIO_EXTENSIONS: ReadonlySet<string> = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'])

/** What the tool needs from the computer; tests replace both. */
export interface SoundtrackDeps {
  /** The absolute path of `ffmpeg`, or undefined when this computer has none. */
  findFfmpeg(): Promise<string | undefined>
  /** Run `ffmpeg` with these arguments; rejects with its last words when it fails. */
  run(program: string, args: readonly string[], signal: AbortSignal): Promise<void>
}

/**
 * Find `ffmpeg`: the copy the app ships, which the desktop shell names in
 * `IDEALIZE_FFMPEG`, and failing that one on `PATH` or in the folders a
 * package manager installs to.
 * @param env - the environment read for the shipped copy and for `PATH`.
 * @returns the program's path, or undefined.
 */
export async function findFfmpeg(env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  const shipped = (env['IDEALIZE_FFMPEG'] ?? '').trim()
  if (shipped !== '') {
    try {
      await access(shipped)
      return shipped
    } catch {
      // The shipped copy is gone; one installed on this computer still serves.
    }
  }
  const folders = [...(env['PATH'] ?? '').split(delimiter).filter(folder => folder !== ''), ...EXTRA_FOLDERS]
  for (const folder of new Set(folders)) {
    const candidate = join(folder, 'ffmpeg')
    try {
      await access(candidate)
      return candidate
    } catch {
      // Not in this folder; the next one is tried.
    }
  }
  return undefined
}

/* v8 ignore start -- runs the real program; the tool's specs inject a runner */
export const runProgram: SoundtrackDeps['run'] = (program, args, signal) => new Promise<void>((done, fail) => {
  execFile(program, [...args], { signal, timeout: JOIN_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 }, (error, _stdout, stderr) => {
    if (error === null) {
      done()
      return
    }
    const lastWords = stderr.trim().split('\n').slice(-3).join(' ')
    fail(new Error(lastWords === '' ? error.message : lastWords))
  })
})
/* v8 ignore stop */

/**
 * The `ffmpeg` arguments for one join: the video's picture copied as it is,
 * the sound as the only audio, padded with silence or cut to the video's length.
 * @param video - the video file.
 * @param audio - the sound file.
 * @param offsetSeconds - how long into the video the sound starts.
 * @param output - where the joined file is written.
 * @returns the argument list.
 */
export function joinArguments(video: string, audio: string, offsetSeconds: number, output: string): string[] {
  return [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', video,
    ...offsetSeconds > 0 ? ['-itsoffset', String(offsetSeconds)] : [],
    '-i', audio,
    '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'copy', '-c:a', 'aac', '-af', 'apad', '-shortest',
    '-movflags', '+faststart',
    output,
  ]
}

/**
 * Resolve one input to a file on disk: an artefact id names a stored result
 * through `ctx.artefacts`; any other value is a path under the project, and
 * one that resolves outside it is refused. The model produced the value, so
 * every step is checked.
 */
export async function resolveInput(
  ctx: Context, name: 'video' | 'audio', reference: string, projectPath: string, tool: string = SOUNDTRACK_TOOL,
): Promise<string> {
  const record = ctx.artefacts.get(ArtefactId(reference))
  if (record !== undefined) {
    if (!record.mediaType.startsWith(`${name}/`)) {
      throw new Error(`${tool}: ${name} ${reference} is ${record.mediaType}, not ${name === 'video' ? 'a video' : 'a sound'}`)
    }
    return ctx.artefacts.resolve(record.id)
  }
  const absolute = resolve(projectPath, reference)
  const escapes = (root: string, candidate: string): boolean => {
    const inside = relative(root, candidate)
    return inside === '' || inside.startsWith('..') || isAbsolute(inside)
  }
  let real: string
  try {
    real = await realpath(absolute)
  } catch {
    throw new Error(`${tool}: ${name} ${reference} is not an artefact id or a file in the project`)
  }
  if (escapes(await realpath(projectPath), real)) {
    throw new Error(`${tool}: ${name} must be an artefact id or a path inside the project; ${reference} is neither`)
  }
  const allowed = name === 'video' ? VIDEO_EXTENSIONS : AUDIO_EXTENSIONS
  if (!allowed.has(extname(real).toLowerCase())) {
    throw new Error(`${tool}: ${name} ${reference} is not ${name === 'video' ? 'a video' : 'a sound'} file`)
  }
  return real
}

/** Model-facing arguments. */
interface SoundtrackArgs {
  prompt: string
  video: string
  audio: string
  start_offset_s?: number
}

/**
 * Build the tool over the host services.
 * @param ctx - the plugin context carrying `artefacts` and `workspaceRegistry`.
 * @param deps - how `ffmpeg` is found and run; the defaults use this computer.
 * @returns the registry-ready tool definition.
 */
export function createSoundtrackTool(
  ctx: Context, deps: SoundtrackDeps = { findFfmpeg: () => findFfmpeg(), run: runProgram },
): ToolDefinition {
  return defineTool({
    name: SOUNDTRACK_TOOL,
    description: 'Put a sound onto a video this project holds, replacing the video\'s own audio, and store the result as a new video artefact. '
      + 'The picture is not re-encoded and neither input is changed. The result is as long as the video: a shorter sound ends in silence, a longer one is cut. '
      + 'Use it whenever the person asks to add, replace or change a video\'s soundtrack, music or sound effects.',
    parameters: {
      prompt: { type: 'string', required: true, description: 'One short line saying what this is, for example "Bunny dance with the new soundtrack". Shown beside the result.' },
      video: { type: 'string', required: true, description: 'The video: an artefact id from a previous generation, or a path under the project such as "Video/2026-11-26_1164f590.mp4".' },
      audio: { type: 'string', required: true, description: 'The sound: an artefact id from a previous generation, or a path under the project such as "Sounds/2026-11-26_9f0a86a2.wav".' },
      start_offset_s: { type: 'number', description: 'Optional seconds into the video at which the sound starts; 0 when left out.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true, description: 'The new video\'s artefact id.' },
          mediaType: { type: 'string', required: true },
          path: { type: 'string', required: true, description: 'Absolute file path of the stored bytes.' },
          relPath: { type: 'string', required: true, description: 'Project-relative storage path.' },
          bytes: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `${value.mediaType} artefact ${value.id} (${String(value.bytes)} bytes) at ${value.path}` }],
    },
    presentCall: args => ({ card: 'generic', title: `add soundtrack: ${args.prompt.length > 80 ? `${args.prompt.slice(0, 77)}...` : args.prompt}` }),
    async execute(args: SoundtrackArgs, exec) {
      const session = exec.agent?.session
      if (session === undefined) throw new Error(`${SOUNDTRACK_TOOL} requires an agent session`)
      const cwd = session.header.cwd
      if (cwd === undefined || cwd === '') throw new Error(`${SOUNDTRACK_TOOL}: the session has no working directory to store artefacts in`)
      const offset = args.start_offset_s ?? 0
      if (!Number.isFinite(offset) || offset < 0) throw new Error(`${SOUNDTRACK_TOOL}: start_offset_s must be 0 or more`)

      const workspace = await ctx.workspaceRegistry.resolveByPath(cwd) ?? await ctx.workspaceRegistry.create(cwd)
      const video = await resolveInput(ctx, 'video', args.video, workspace.path)
      const audio = await resolveInput(ctx, 'audio', args.audio, workspace.path)
      const program = await deps.findFfmpeg()
      if (program === undefined) {
        throw new Error(`${SOUNDTRACK_TOOL}: joining a video and a sound needs the ffmpeg program, and this computer has none. `
          + 'Tell the person both files are ready and that installing ffmpeg (for example `brew install ffmpeg`) lets Studio join them.')
      }

      let turn = 0
      for (let index = session.events.length - 1; index >= 0; index -= 1) {
        const event = session.events[index]
        if (event?.type === 'tool/call' && event.data.callId === exec.callId) {
          turn = event.data.turn
          break
        }
      }
      const sourceTask = { turnSeq: turn, callId: exec.callId, toolName: SOUNDTRACK_TOOL }
      const settings: JsonValue = {
        prompt: args.prompt, video: args.video, audio: args.audio, ...offset > 0 ? { start_offset_s: offset } : {},
      }
      const folder = await mkdtemp(join(tmpdir(), 'idealize-soundtrack-'))
      const output = join(folder, 'joined.mp4')
      try {
        let bytes: Buffer
        try {
          await deps.run(program, joinArguments(video, audio, offset, output), exec.signal)
          bytes = await readFile(output)
        } catch (error) {
          const cause = error instanceof Error ? error.message : String(error)
          // The failure joins the session log so the Studio row shows the cause.
          try {
            session.append('artefact/failed', {
              artefactId: ArtefactId(randomUUID()),
              mediaType: 'video/mp4',
              workspaceId: workspace.id,
              sourceTask: { sessionId: session.header.id, ...sourceTask },
              error: `The video and the sound could not be joined: ${cause}`,
            }, { ignorable: true })
          } catch {
            // Swallows the append failing on a disposed session; the rethrow below still reports the failure.
          }
          throw new Error(`${SOUNDTRACK_TOOL}: the video and the sound could not be joined: ${cause}`, { cause: error })
        }
        const record = await ctx.artefacts.create({
          session,
          mediaType: 'video/mp4',
          bytes,
          settings,
          sourceTask,
          provenance: { provider: 'local', model: 'ffmpeg', workspaceId: workspace.id },
        })
        return {
          id: String(record.id),
          mediaType: record.mediaType,
          path: ctx.artefacts.resolve(record.id),
          relPath: record.storage.relPath,
          bytes: record.storage.bytes,
        }
      } finally {
        await rm(folder, { recursive: true, force: true })
      }
    },
  })
}

/** The prompt section every Studio chat carries: what it can do itself, and what it must never claim. */
export const STUDIO_SECTION = {
  name: 'idealize:studio-work',
  order: 122,
  text: 'You do this chat\'s work yourself, with your own tools. '
    + 'Join a video and a sound with `add_soundtrack`; it is how you add, replace or change a soundtrack. '
    + 'Before you write the prompt for music or sound effects that go with a video, call `inspect_video` on that video. '
    + 'Then state the video\'s overall length in the prompt, set `duration_s` to that length, '
    + 'and give the time in seconds of each moment the sound should mark, for example "0 to 2 s: doors lift; 5 s: headlamps switch on; 8 s: end". '
    + 'Other chats in the project do not make media for this chat: do not ask them whether they have your task, and do not hand your work to them. '
    + 'When a request needs something your tools cannot do, say so plainly and name what is missing. '
    + 'Never tell the person that work is under way unless one of your own tool calls is running it.',
} as const
