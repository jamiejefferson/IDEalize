import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'
import { afterEach, describe, expect, it } from 'vitest'
import {
  PACK_TEMPLATES,
  buildPcBuildPack,
  exportCommittedSource,
  type PcBuildPackOptions,
} from '../scripts/make-pc-build-pack.ts'

const desktopRoot = fileURLToPath(new URL('..', import.meta.url))
const workspaceRoot = resolve(desktopRoot, '..')
const temps: string[] = []

function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pc-build-pack-spec-'))
  temps.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A fake committed tree holding exactly what the pack gate requires. */
function writeFakeSource(stageDir: string, omit: string[] = []): void {
  const files: Record<string, string> = {
    'package.json': '{"name":"fake","version":"9.9.9"}\n',
    'yarn.lock': '# fake\n',
    '.yarnrc.yml': 'enableScripts: false\n',
    'dsh-plugin-desktop/package.json': '{"name":"dsh-plugin-desktop","version":"9.9.9"}\n',
    'dsh-plugin-desktop/scripts/package-win.ts': '// fake\n',
    'vendor/freellmapi/server.mjs': '// fake\n',
    'vendor/idealize/fake-1.0.0.tgz': 'tgz',
  }
  for (const [path, text] of Object.entries(files)) {
    if (omit.includes(path)) continue
    const target = join(stageDir, 'source', path)
    mkdirSync(join(target, '..'), { recursive: true })
    writeFileSync(target, text)
  }
}

function options(root: string, logs: string[], overrides: Partial<PcBuildPackOptions> = {}): PcBuildPackOptions {
  return {
    workspaceRoot,
    desktopRoot,
    templatesDir: join(desktopRoot, 'pc-build-pack'),
    outputDir: join(root, 'out'),
    stageDir: join(root, 'stage'),
    gitHead: () => 'abcdef1234567890abcdef1234567890abcdef12',
    gitDirty: () => [],
    exportSource: stageDir => writeFakeSource(stageDir),
    now: () => new Date('2026-09-17T08:00:00.000Z'),
    log: message => logs.push(message),
    ...overrides,
  }
}

describe('PC build pack assembly', () => {
  it('zips the templates, the manifest, and the exported source under one versioned folder', () => {
    const root = temp()
    const logs: string[] = []
    const { version } = JSON.parse(readFileSync(join(desktopRoot, 'package.json'), 'utf8')) as { version: string }

    const result = buildPcBuildPack(options(root, logs))

    expect(result).toEqual({
      zipPath: join(root, 'out', `IDEalize-PC-build-pack-${version}-abcdef1234.zip`),
      folderName: `IDEalize-PC-build-pack-${version}`,
      commit: 'abcdef1234567890abcdef1234567890abcdef12',
      version,
    })
    const entries = new Set(new AdmZip(result.zipPath).getEntries().map(entry => entry.entryName))
    for (const name of [...PACK_TEMPLATES, 'PACK.json', 'source/yarn.lock', 'source/vendor/idealize/fake-1.0.0.tgz']) {
      expect(entries.has(`${result.folderName}/${name}`), name).toBe(true)
    }
    const manifest = JSON.parse(
      new AdmZip(result.zipPath).readAsText(`${result.folderName}/PACK.json`),
    ) as Record<string, unknown>
    expect(manifest).toMatchObject({
      version,
      productName: 'IDEalize V1',
      commit: 'abcdef1234567890abcdef1234567890abcdef12',
      builtAt: '2026-09-17T08:00:00.000Z',
      sourceExcludes: ['.idealize'],
      expectedOutputs: [
        `IDEalize-${version}-x64-Setup.exe`,
        'IDEalize-V1-Setup.exe',
        `IDEalize-${version}-x64-Portable.zip`,
        'SHA256SUMS-windows.txt',
        'build-log.txt',
      ],
    })
    expect(logs).toEqual([`PC build pack written: ${result.zipPath}`])
  })

  it('writes the Windows-facing templates with CRLF line endings', () => {
    const root = temp()
    const result = buildPcBuildPack(options(root, []))
    const zip = new AdmZip(result.zipPath)
    for (const name of PACK_TEMPLATES) {
      const text = zip.readAsText(`${result.folderName}/${name}`)
      expect(text, name).toContain('\r\n')
      expect(text.replace(/\r\n/gu, ''), name).not.toContain('\n')
    }
  })

  it('warns about working-tree changes and packs the commit anyway', () => {
    const root = temp()
    const logs: string[] = []
    buildPcBuildPack(options(root, logs, { gitDirty: () => [' M install.sh'] }))
    expect(logs[0]).toBe('Warning: 1 working-tree change(s) are not in the pack; it carries commit abcdef1234 exactly.')
  })

  it.each([
    ['yarn.lock', 'pack source is missing yarn.lock'],
    ['vendor/freellmapi/server.mjs', 'pack source is missing vendor/freellmapi/server.mjs'],
  ])('refuses a source export without %s', (omitted, message) => {
    const root = temp()
    expect(() =>
      buildPcBuildPack(options(root, [], { exportSource: stageDir => writeFakeSource(stageDir, [omitted]) })),
    ).toThrow(message)
  })

  it('refuses a source export that still carries the proof screenshots', () => {
    const root = temp()
    expect(() =>
      buildPcBuildPack(
        options(root, [], {
          exportSource: (stageDir) => {
            writeFakeSource(stageDir)
            mkdirSync(join(stageDir, 'source', '.idealize', 'proof'), { recursive: true })
            writeFileSync(join(stageDir, 'source', '.idealize', 'proof', 'x.png'), 'png')
          },
        }),
      ),
    ).toThrow('pack source must not carry .idealize')
  })

  it('exports the real commit with the vendor tarballs and without .idealize', () => {
    const stageDir = temp()
    exportCommittedSource(workspaceRoot, stageDir)
    expect(readFileSync(join(stageDir, 'source', 'yarn.lock'), 'utf8')).toContain('vendor/idealize/')
    expect(() => readFileSync(join(stageDir, 'source', 'vendor', 'freellmapi', 'server.mjs'))).not.toThrow()
    expect(() => readFileSync(join(stageDir, 'source', '.idealize', 'project-board.md'))).toThrow()
    expect(() => readFileSync(join(stageDir, 'source.tar'))).toThrow()
  })
})
