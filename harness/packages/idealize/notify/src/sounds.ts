/**
 * The chime library: the operating system's own alert sounds, listed once
 * and served by id, so the person can pick a done chime without the package
 * shipping a single new asset (feedback af0917f0).
 *
 * - macOS: `/System/Library/Sounds/*.aiff` (Glass, Ping, Hero, Submarine…).
 *   Chromium cannot decode AIFF, so each is transcoded once with the system's
 *   own `afconvert` into a cache folder under the harness home and served as
 *   WAV; a sound afconvert refuses is left out of the catalogue.
 * - Windows: `%SystemRoot%\Media\Windows *.wav` under 1 MB, the short alerts
 *   (the longer files there are start-up jingles and ringtones).
 * - Linux: `/usr/share/sounds/freedesktop/stereo/*.oga` when the theme is installed.
 *
 * Every id is `system:<name>`, and a sound is served only by looking its id up
 * in the catalogue this module built: no request ever names a path.
 */

import { execFile } from 'node:child_process'
import { access, mkdir, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { BUILT_IN_CHIME, type ChimeSound } from './chime-sounds.ts'

const run = promisify(execFile)

/** Where macOS keeps its alert sounds. */
const MAC_SOUNDS_DIR = '/System/Library/Sounds'
/** Where the freedesktop sound theme keeps its stereo alerts. */
const LINUX_SOUNDS_DIR = '/usr/share/sounds/freedesktop/stereo'
/** The Windows alerts worth listing start with this; the rest are jingles and ringtones. */
const WINDOWS_ALERT_PREFIX = 'Windows '
/** A Windows alert longer than this is a jingle, not a chime. */
const WINDOWS_ALERT_LIMIT_BYTES = 1_000_000

/** What the library reads from the machine; the tests hand in a fake. */
export interface SoundSources {
  platform: NodeJS.Platform
  env: Readonly<Record<string, string | undefined>>
  /** The names in a folder; rejects when the folder is not there. */
  readdir(dir: string): Promise<string[]>
  /** A file's size in bytes. */
  size(path: string): Promise<number>
  exists(path: string): Promise<boolean>
  mkdir(dir: string): Promise<void>
  /** Transcode one AIFF to 16-bit WAV; rejects when the converter refuses. */
  transcode(input: string, output: string): Promise<void>
}

/**
 * The real machine.
 * @returns sources over the file system and `afconvert`.
 */
export function systemSoundSources(): SoundSources {
  return {
    platform: process.platform,
    env: process.env,
    readdir: dir => readdir(dir),
    size: async path => (await stat(path)).size,
    exists: async (path) => {
      try {
        await access(path)
        return true
      } catch {
        return false
      }
    },
    mkdir: async (dir) => { await mkdir(dir, { recursive: true }) },
    transcode: async (input, output) => { await run('afconvert', ['-f', 'WAVE', '-d', 'LEI16', input, output]) },
  }
}

/** One catalogue sound and where it is served from. */
export interface SoundFile {
  path: string
  contentType: string
}

/** The library: the catalogue and the file behind one id. */
export interface SoundLibrary {
  /** The catalogue, the built-in chime first, then the system's sounds by name. */
  list(): Promise<ChimeSound[]>
  /** The file behind one catalogue id, or undefined for anything the catalogue does not hold. */
  file(id: string): Promise<SoundFile | undefined>
}

interface Entry extends ChimeSound, SoundFile {}

/** The names in a folder, or none when the folder is not there. */
async function names(sources: SoundSources, dir: string): Promise<string[]> {
  try {
    return await sources.readdir(dir)
  } catch {
    return []
  }
}

/** The name without its extension. */
function stem(name: string): string {
  return name.replace(/\.[^.]+$/, '')
}

/** `system:<name>`: the id one sound keeps across restarts. */
function idFor(name: string): string {
  return `system:${name}`
}

async function macSounds(sources: SoundSources, cacheDir: string): Promise<Entry[]> {
  const files = (await names(sources, MAC_SOUNDS_DIR)).filter(name => name.endsWith('.aiff'))
  const converted = await Promise.all(files.map(async (name): Promise<Entry | undefined> => {
    const label = stem(name)
    const output = join(cacheDir, `${label}.wav`)
    if (!(await sources.exists(output))) {
      try {
        await sources.mkdir(cacheDir)
        await sources.transcode(join(MAC_SOUNDS_DIR, name), output)
      } catch {
        return undefined
      }
    }
    return { id: idFor(label), label, path: output, contentType: 'audio/wav' }
  }))
  return converted.filter((entry): entry is Entry => entry !== undefined)
}

async function windowsSounds(sources: SoundSources): Promise<Entry[]> {
  const dir = join(sources.env['SystemRoot'] ?? 'C:\\Windows', 'Media')
  const files = (await names(sources, dir)).filter(name => name.startsWith(WINDOWS_ALERT_PREFIX) && name.endsWith('.wav'))
  const sized = await Promise.all(files.map(async (name): Promise<Entry | undefined> => {
    const path = join(dir, name)
    let bytes: number
    try {
      bytes = await sources.size(path)
    } catch {
      return undefined
    }
    if (bytes > WINDOWS_ALERT_LIMIT_BYTES) return undefined
    const label = stem(name).slice(WINDOWS_ALERT_PREFIX.length)
    return { id: idFor(stem(name)), label, path, contentType: 'audio/wav' }
  }))
  return sized.filter((entry): entry is Entry => entry !== undefined)
}

async function linuxSounds(sources: SoundSources): Promise<Entry[]> {
  const files = (await names(sources, LINUX_SOUNDS_DIR)).filter(name => name.endsWith('.oga'))
  return files.map((name) => {
    const plain = stem(name)
    const label = plain.replace(/-/g, ' ').replace(/^./, first => first.toUpperCase())
    return { id: idFor(plain), label, path: join(LINUX_SOUNDS_DIR, name), contentType: 'audio/ogg' }
  })
}

async function collect(sources: SoundSources, cacheDir: string): Promise<Map<string, Entry>> {
  let entries: Entry[]
  switch (sources.platform) {
    case 'darwin':
      entries = await macSounds(sources, cacheDir)
      break
    case 'win32':
      entries = await windowsSounds(sources)
      break
    case 'linux':
      entries = await linuxSounds(sources)
      break
    default:
      entries = []
  }
  entries.sort((a, b) => a.label.localeCompare(b.label))
  return new Map(entries.map(entry => [entry.id, entry]))
}

/**
 * Build the library. The machine is read once, on the first call, and the
 * catalogue then stands for the host's lifetime.
 * @param cacheDir - where transcoded sounds are kept (under the harness home).
 * @param sources - the machine; defaults to the real one.
 * @returns the library.
 */
export function createSoundLibrary(cacheDir: string, sources: SoundSources = systemSoundSources()): SoundLibrary {
  let scanned: Promise<Map<string, Entry>> | undefined
  const scan = (): Promise<Map<string, Entry>> => (scanned ??= collect(sources, cacheDir))
  return {
    list: async () => [BUILT_IN_CHIME, ...[...(await scan()).values()].map(({ id, label }) => ({ id, label }))],
    file: async (id) => {
      const found = (await scan()).get(id)
      return found === undefined ? undefined : { path: found.path, contentType: found.contentType }
    },
  }
}
