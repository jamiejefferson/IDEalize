import { describe, expect, it } from 'vitest'
import {
  extendArchiveManifest,
  parseArchiveManifest,
  renderArchiveManifest,
  validateArchiveArtifacts,
  validateArchiveManifestExtension,
  type ArchiveManifest,
} from './archived-agent-notes.ts'
import { isArchivedAgentNotePath } from './repo-files.ts'

const NOTE = 'process/2026-07-26-example.md'

function fixture(): Map<string, Buffer> {
  return new Map([
    [NOTE, Buffer.from('# Agent Note: Example\n\nStatus: implemented\nArchived: 2026-07-26\n\n## Problem\n\nExample.\n')],
  ])
}

describe('archived Agent Notes', () => {
  it('recognizes archived paths with POSIX and Windows separators', () => {
    expect(isArchivedAgentNotePath('.agents/notes/archived/process/example.md')).toBe(true)
    expect(isArchivedAgentNotePath('.agents\\notes\\archived\\process\\example.md')).toBe(true)
    expect(isArchivedAgentNotePath('.agents/notes/implemented/process/example.md')).toBe(false)
  })

  it('accepts one implemented note with a valid archive header', () => {
    expect(validateArchiveArtifacts(fixture())).toEqual([])
  })

  it('rejects files outside the note layout and invalid archive headers', () => {
    const artifacts = fixture()
    artifacts.set('process/2026-07-26-example.i18n.yaml', Buffer.from('record\n'))
    artifacts.set(NOTE, Buffer.from('# Agent Note: Example\n\nStatus: proposed\nArchived: yesterday\n'))
    const errors = validateArchiveArtifacts(artifacts).join('\n')
    expect(errors).toMatch(/expected \{kind\}\/yyyy-mm-dd-topic\.md/)
    expect(errors).toMatch(/line 3 must be `Status: implemented`/)
    expect(errors).toMatch(/line 4 must be `Archived: YYYY-MM-DD`/)
  })

  it('extends the manifest without permitting a sealed change or removal', () => {
    const artifacts = fixture()
    const empty: ArchiveManifest = { version: 1, files: {} }
    const first = extendArchiveManifest(empty, artifacts)
    expect(first.errors).toEqual([])
    expect(first.added).toEqual([NOTE])

    const sealed: ArchiveManifest = { version: 1, files: first.files }
    const changed = new Map(artifacts)
    changed.set(NOTE, Buffer.from('changed'))
    expect(extendArchiveManifest(sealed, changed).errors).toEqual([
      `${NOTE}: sealed content hash changed`,
    ])
    changed.delete(NOTE)
    expect(extendArchiveManifest(sealed, changed).errors).toContain(
      `${NOTE}: sealed artifact is missing`,
    )
  })

  it('rejects replacing manifest seals alongside changed archive content', () => {
    const artifacts = fixture()
    const initial = extendArchiveManifest({ version: 1, files: {} }, artifacts)
    const baseline: ArchiveManifest = { version: 1, files: initial.files }
    const changedArtifacts = new Map(artifacts)
    changedArtifacts.set(NOTE, Buffer.from('changed'))
    const replacement = extendArchiveManifest({ version: 1, files: {} }, changedArtifacts)
    const current: ArchiveManifest = { version: 1, files: replacement.files }

    expect(extendArchiveManifest(current, changedArtifacts).errors).toEqual([])
    expect(validateArchiveManifestExtension(baseline, current)).toEqual([
      `${NOTE}: sealed manifest hash changed`,
    ])
    const removed: ArchiveManifest = {
      version: 1,
      files: Object.fromEntries(Object.entries(current.files).filter(([candidate]) => candidate !== NOTE)),
    }
    expect(validateArchiveManifestExtension(baseline, removed)).toContain(
      `${NOTE}: sealed manifest entry is missing`,
    )
  })

  it('round-trips the deterministic manifest schema', () => {
    const content = renderArchiveManifest({ 'process/z.md': `sha256:${'a'.repeat(64)}` })
    expect(parseArchiveManifest(content)).toEqual({
      version: 1,
      files: { 'process/z.md': `sha256:${'a'.repeat(64)}` },
    })
  })
})
