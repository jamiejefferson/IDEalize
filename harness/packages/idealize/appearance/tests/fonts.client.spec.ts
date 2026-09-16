/** Font enumeration: sfnt name-table parsing and the directory scan. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { familiesInFile, familyOfFace, fontDirectories, isFixedPitchFace, listFontFamilies } from '../src/fonts.ts'

interface NameRecord {
  platformId: number
  languageId: number
  nameId: number
  text: string
}

/**
 * Build one sfnt face holding a `name` table (and a `post` table when
 * `fixedPitch` is set); `base` is its position in a collection (table
 * offsets are absolute).
 */
function face(records: NameRecord[], base = 0, fixedPitch?: boolean): Buffer {
  const strings: Buffer[] = []
  const recordTable: Buffer[] = []
  let cursor = 0
  for (const record of records) {
    const encoded = record.platformId === 1 ? Buffer.from(record.text, 'latin1') : Buffer.from(record.text, 'utf16le').swap16()
    const row = Buffer.alloc(12)
    row.writeUInt16BE(record.platformId, 0)
    row.writeUInt16BE(1, 2)
    row.writeUInt16BE(record.languageId, 4)
    row.writeUInt16BE(record.nameId, 6)
    row.writeUInt16BE(encoded.length, 8)
    row.writeUInt16BE(cursor, 10)
    cursor += encoded.length
    strings.push(encoded)
    recordTable.push(row)
  }
  const header = Buffer.alloc(6)
  header.writeUInt16BE(0, 0)
  header.writeUInt16BE(records.length, 2)
  header.writeUInt16BE(6 + records.length * 12, 4)
  const nameTable = Buffer.concat([header, ...recordTable, ...strings])
  const tables: { tag: string; data: Buffer }[] = [{ tag: 'name', data: nameTable }]
  if (fixedPitch !== undefined) {
    const post = Buffer.alloc(32)
    post.writeUInt32BE(fixedPitch ? 1 : 0, 12)
    tables.push({ tag: 'post', data: post })
  }
  const offsetTable = Buffer.alloc(12)
  offsetTable.writeUInt32BE(0x00010000, 0)
  offsetTable.writeUInt16BE(tables.length, 4)
  let at = base + 12 + tables.length * 16
  const directory = tables.map(({ tag, data }) => {
    const row = Buffer.alloc(16)
    row.write(tag, 0, 'latin1')
    row.writeUInt32BE(at, 8)
    row.writeUInt32BE(data.length, 12)
    at += data.length
    return row
  })
  return Buffer.concat([offsetTable, ...directory, ...tables.map(table => table.data)])
}

/** Wrap faces in a TrueType collection. */
function collection(faces: NameRecord[][]): Buffer {
  const header = Buffer.alloc(12 + faces.length * 4)
  header.write('ttcf', 0, 'latin1')
  header.writeUInt32BE(0x00010000, 4)
  header.writeUInt32BE(faces.length, 8)
  const built: Buffer[] = []
  let at = header.length
  faces.forEach((records, i) => {
    header.writeUInt32BE(at, 12 + i * 4)
    const buffer = face(records, at)
    built.push(buffer)
    at += buffer.length
  })
  return Buffer.concat([header, ...built])
}

describe('familyOfFace', () => {
  it('prefers Windows English, then Mac English, then any family', () => {
    expect(familyOfFace(face([
      { platformId: 3, languageId: 0x40c, nameId: 1, text: 'Français' },
      { platformId: 3, languageId: 0x409, nameId: 1, text: 'Test Sans' },
    ]), 0)).toBe('Test Sans')
    expect(familyOfFace(face([
      { platformId: 1, languageId: 0, nameId: 1, text: 'Mac Sans' },
      { platformId: 3, languageId: 0x40c, nameId: 2, text: 'Regular' },
    ]), 0)).toBe('Mac Sans')
    expect(familyOfFace(face([{ platformId: 3, languageId: 0x40c, nameId: 1, text: 'Autre' }]), 0)).toBe('Autre')
  })

  it('returns undefined without a name table, a family record or past the end', () => {
    expect(familyOfFace(face([{ platformId: 3, languageId: 0x409, nameId: 4, text: 'Full Name' }]), 0)).toBeUndefined()
    expect(familyOfFace(Buffer.from('OTTO'), 0)).toBeUndefined()
    const truncated = face([{ platformId: 3, languageId: 0x409, nameId: 1, text: 'Cut' }])
    expect(familyOfFace(truncated.subarray(0, 40), 0)).toBeUndefined()
    expect(familyOfFace(truncated.subarray(0, 50), 0)).toBeUndefined()
    const empty = face([{ platformId: 3, languageId: 0x409, nameId: 1, text: '' }])
    expect(familyOfFace(empty, 0)).toBeUndefined()
    const other = Buffer.concat([Buffer.alloc(12), Buffer.from('glyf', 'latin1'), Buffer.alloc(12)])
    other.writeUInt16BE(1, 4)
    expect(familyOfFace(other, 0)).toBeUndefined()
    const short = Buffer.alloc(12)
    short.writeUInt16BE(1, 4)
    expect(familyOfFace(short, 0)).toBeUndefined()
    const farName = Buffer.concat([Buffer.alloc(12), Buffer.from('name', 'latin1'), Buffer.alloc(12)])
    farName.writeUInt16BE(1, 4)
    farName.writeUInt32BE(1000, 20)
    expect(familyOfFace(farName, 0)).toBeUndefined()
    const cutRecord = Buffer.concat([farName.subarray(0, 28), Buffer.alloc(6 + 8)])
    cutRecord.writeUInt32BE(28, 20)
    cutRecord.writeUInt16BE(1, 30)
    expect(familyOfFace(cutRecord, 0)).toBeUndefined()
    const cutEarly = Buffer.concat([farName.subarray(0, 28), Buffer.alloc(6 + 4)])
    cutEarly.writeUInt32BE(28, 20)
    cutEarly.writeUInt16BE(1, 30)
    expect(familyOfFace(cutEarly, 0)).toBeUndefined()
  })
})

describe('isFixedPitchFace', () => {
  const alpha: NameRecord[] = [{ platformId: 3, languageId: 0x409, nameId: 1, text: 'Alpha' }]

  it('reads the post table flag and treats an absent or truncated table as proportional', () => {
    expect(isFixedPitchFace(face(alpha, 0, true), 0)).toBe(true)
    expect(isFixedPitchFace(face(alpha, 0, false), 0)).toBe(false)
    expect(isFixedPitchFace(face(alpha), 0)).toBe(false)
    const truncated = face(alpha, 0, true)
    expect(isFixedPitchFace(truncated.subarray(0, truncated.length - 24), 0)).toBe(false)
    expect(isFixedPitchFace(Buffer.from('OTTO'), 0)).toBe(false)
  })
})

describe('familiesInFile', () => {
  it('lists each face of a collection once', () => {
    const a: NameRecord[] = [{ platformId: 3, languageId: 0x409, nameId: 1, text: 'Alpha' }]
    const b: NameRecord[] = [{ platformId: 3, languageId: 0x409, nameId: 1, text: 'Beta' }]
    expect(familiesInFile(collection([a, b, a]))).toEqual(['Alpha', 'Beta'])
    expect(familiesInFile(face(a))).toEqual(['Alpha'])
    expect(familiesInFile(Buffer.from('ttcf'))).toEqual([])
    const headless = Buffer.alloc(12)
    headless.write('ttcf', 0, 'latin1')
    headless.writeUInt32BE(2, 8)
    expect(familiesInFile(headless)).toEqual([])
  })
})

describe('listFontFamilies', () => {
  let dir = ''
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'idealize-fonts-'))
    await writeFile(join(dir, 'b.ttf'), face([{ platformId: 3, languageId: 0x409, nameId: 1, text: 'Zeta' }]))
    await writeFile(join(dir, 'a.otf'), face([{ platformId: 3, languageId: 0x409, nameId: 1, text: 'Alpha' }]))
    await writeFile(join(dir, 'mono.ttf'), face([{ platformId: 3, languageId: 0x409, nameId: 1, text: 'Mono Alpha' }], 0, true))
    await writeFile(join(dir, 'hidden.ttf'), face([{ platformId: 3, languageId: 0x409, nameId: 1, text: '.SFNS' }]))
    await writeFile(join(dir, 'broken.ttc'), Buffer.from('ttcf'))
    await writeFile(join(dir, 'notes.txt'), 'x')
  })
  afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

  it('sorts the families, calls out the fixed-pitch subset, and skips hidden faces, non-font files and missing directories', async () => {
    expect(await listFontFamilies([dir, join(dir, 'missing')])).toEqual({
      families: ['Alpha', 'Mono Alpha', 'Zeta'],
      monospaced: ['Mono Alpha'],
    })
  })

  it('names the platform directories', () => {
    expect(fontDirectories('darwin', '/Users/x')).toContain('/Users/x/Library/Fonts')
    expect(fontDirectories('win32', 'C:\\Users\\x').some(path => path.endsWith('Fonts'))).toBe(true)
    expect(fontDirectories('linux', '/home/x')).toContain('/home/x/.fonts')
  })
})
