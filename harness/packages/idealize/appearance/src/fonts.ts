/**
 * Installed font families for the panel's font pickers (V0
 * `AppSettings.allFontFamilies()` / `monospacedFontFamilies()`, which asked
 * NSFontManager). A browser cannot enumerate the machine's fonts, so the
 * Host reads the family name (OpenType `name` table, id 1) and the
 * fixed-pitch flag (`post` table `isFixedPitch`) out of every font file in
 * the platform font directories. TrueType collections contribute each
 * face's family.
 */

import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { extname, join } from 'node:path'

/**
 * Font directories per platform.
 * @param platform - the OS the directories are for; defaults to the running process's.
 * @param home - the user's home directory, the root of the per-user font folders.
 * @returns absolute directories in scan order; none is checked for existence.
 */
export function fontDirectories(platform: NodeJS.Platform = process.platform, home: string = homedir()): string[] {
  switch (platform) {
    case 'darwin':
      return ['/System/Library/Fonts', '/System/Library/Fonts/Supplemental', '/Library/Fonts', join(home, 'Library/Fonts')]
    case 'win32':
      return [join(process.env.WINDIR ?? 'C:\\Windows', 'Fonts'), join(process.env.LOCALAPPDATA ?? join(home, 'AppData/Local'), 'Microsoft/Windows/Fonts')]
    default:
      return ['/usr/share/fonts', '/usr/local/share/fonts', join(home, '.fonts'), join(home, '.local/share/fonts')]
  }
}

const FONT_EXTENSIONS = new Set(['.ttf', '.otf', '.ttc', '.dfont'])

/** Read a big-endian u16/u32 with bounds checks; undefined past the end. */
function u16(buffer: Buffer, at: number): number | undefined {
  return at + 2 <= buffer.length ? buffer.readUInt16BE(at) : undefined
}
function u32(buffer: Buffer, at: number): number | undefined {
  return at + 4 <= buffer.length ? buffer.readUInt32BE(at) : undefined
}

/** Decode one name record's string by platform (Windows/Unicode are UTF-16BE; Mac Roman is Latin-1). */
function decodeName(buffer: Buffer, platformId: number, start: number, length: number): string | undefined {
  if (start + length > buffer.length || length === 0) return undefined
  const bytes = buffer.subarray(start, start + length)
  if (platformId === 1) return bytes.toString('latin1')
  // UTF-16BE in the file; Node decodes little-endian, so swap each pair.
  const even = bytes.subarray(0, length - (length % 2))
  return Buffer.from(even).swap16().toString('utf16le').replace(/\0+$/, '')
}

/** The absolute offset of the face's table with `tag`, or undefined when absent or truncated. */
function tableOffset(buffer: Buffer, offset: number, tag: string): number | undefined {
  const tableCount = u16(buffer, offset + 4)
  if (tableCount === undefined) return undefined
  for (let i = 0; i < tableCount; i += 1) {
    const record = offset + 12 + i * 16
    if (record + 16 > buffer.length) return undefined
    if (buffer.toString('latin1', record, record + 4) === tag) return u32(buffer, record + 8)
  }
  return undefined
}

/**
 * Whether one sfnt face declares itself fixed-pitch (`post` table
 * `isFixedPitch`, the flag NSFontManager's fixed-pitch trait reads).
 * @param buffer - the font file.
 * @param offset - the face's offset table position.
 * @returns true for a monospaced face; false when the flag is absent or zero.
 */
export function isFixedPitchFace(buffer: Buffer, offset: number): boolean {
  const post = tableOffset(buffer, offset, 'post')
  if (post === undefined) return false
  const flag = u32(buffer, post + 12)
  return flag !== undefined && flag !== 0
}

/**
 * The family name (name id 1, English preferred) of one sfnt face starting at `offset`.
 * @param buffer - the font file.
 * @param offset - the face's offset table position.
 * @returns the family, or undefined when the face has no readable name table.
 */
export function familyOfFace(buffer: Buffer, offset: number): string | undefined {
  const nameOffset = tableOffset(buffer, offset, 'name')
  if (nameOffset === undefined) return undefined
  const count = u16(buffer, nameOffset + 2)
  const stringsAt = u16(buffer, nameOffset + 4)
  if (count === undefined || stringsAt === undefined) return undefined
  let fallback: string | undefined
  for (let i = 0; i < count; i += 1) {
    const record = nameOffset + 6 + i * 12
    const platformId = u16(buffer, record)
    const languageId = u16(buffer, record + 4)
    const nameId = u16(buffer, record + 6)
    const length = u16(buffer, record + 8)
    const start = u16(buffer, record + 10)
    if (platformId === undefined || languageId === undefined || nameId === undefined) return fallback
    if (length === undefined || start === undefined) return fallback
    if (nameId !== 1) continue
    const name = decodeName(buffer, platformId, nameOffset + stringsAt + start, length)
    if (name === undefined || name.trim() === '') continue
    // Windows English (0x409) or Mac English (0) wins; anything else stands in.
    if ((platformId === 3 && languageId === 0x409) || (platformId === 1 && languageId === 0)) return name.trim()
    fallback ??= name.trim()
  }
  return fallback
}

/** The offset-table positions of every face in one font file (one for a plain sfnt, per entry for a collection). */
function faceOffsets(buffer: Buffer): number[] {
  const tag = buffer.toString('latin1', 0, 4)
  if (tag !== 'ttcf') return [0]
  const offsets: number[] = []
  const faces = u32(buffer, 8) ?? 0
  for (let i = 0; i < faces; i += 1) {
    const at = u32(buffer, 12 + i * 4)
    if (at !== undefined) offsets.push(at)
  }
  return offsets
}

/**
 * Every family name in one font file (one per face for a collection).
 * @param buffer - the font file.
 * @returns family names, deduplicated, in face order.
 */
export function familiesInFile(buffer: Buffer): string[] {
  const families: string[] = []
  for (const offset of faceOffsets(buffer)) {
    const family = familyOfFace(buffer, offset)
    if (family !== undefined && !families.includes(family)) families.push(family)
  }
  return families
}

/** The font families a machine offers, with the fixed-pitch subset called out for the terminal picker. */
export interface FontInventory {
  /** Every installed family, sorted. */
  families: string[]
  /** The families with at least one fixed-pitch face, in {@link families} order. */
  monospaced: string[]
}

/**
 * Every installed family across the platform font directories, sorted,
 * hidden system faces (names starting with a dot) left out, fixed-pitch
 * families listed separately.
 * @param directories - directories to scan; defaults to the platform's.
 * @returns the inventory.
 */
export async function listFontFamilies(directories: string[] = fontDirectories()): Promise<FontInventory> {
  const families = new Set<string>()
  const fixed = new Set<string>()
  for (const directory of directories) {
    let entries: string[]
    try {
      entries = await readdir(directory)
    } catch {
      // A directory that does not exist on this machine contributes nothing.
      continue
    }
    for (const entry of entries) {
      if (!FONT_EXTENSIONS.has(extname(entry).toLowerCase())) continue
      try {
        const buffer = await readFile(join(directory, entry))
        for (const offset of faceOffsets(buffer)) {
          const family = familyOfFace(buffer, offset)
          if (family === undefined || family.startsWith('.')) continue
          families.add(family)
          if (isFixedPitchFace(buffer, offset)) fixed.add(family)
        }
      } catch {
        // An unreadable or malformed file is skipped; the picker lists the rest.
      }
    }
  }
  const sorted = [...families].sort((a, b) => a.localeCompare(b))
  return { families: sorted, monospaced: sorted.filter(family => fixed.has(family)) }
}
