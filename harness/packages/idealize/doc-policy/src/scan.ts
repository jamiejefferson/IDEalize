/**
 * Folder scan against the canonical structure (DOC-04/06/07): walk the
 * configured documentation folder, classify and validate every Markdown
 * document, and report structural findings plus the indexable document set.
 * Read-only — no structural moves happen automatically in V1; findings feed
 * agent-proposed edits and the settings surface.
 */

import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { classifyPath, validateDoc } from './classify.ts'
import type { DocKind, Finding } from './classify.ts'
import { CANONICAL_DIRS, CANONICAL_ROOT_FILES, RULESET_VERSION } from './policy/ruleset.ts'

/** One document the scan indexes for retrieval. */
export interface IndexedDoc {
  /** Vault-relative path, `/`-separated. */
  path: string
  /** The path's classification. */
  kind: DocKind
  /** First `# ` heading, or the file name without extension. */
  title: string
  /** Complete document text. */
  text: string
}

/** Complete result of one folder scan. */
export interface ScanResult {
  /** Scan time (ISO). */
  at: string
  /** The applied policy-package version (DOC-07). */
  policyVersion: string
  /** Every structural or per-document violation found. */
  findings: Finding[]
  /** Every managed Markdown document, ready for indexing. */
  docs: IndexedDoc[]
}

interface Entry {
  name: string
  directory: boolean
}

async function entriesOf(path: string): Promise<Entry[]> {
  try {
    const raw = await readdir(path, { withFileTypes: true })
    return raw
      .filter(entry => !entry.name.startsWith('.'))
      .map(entry => ({ name: entry.name, directory: entry.isDirectory() }))
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    return []
  }
}

async function collectMarkdown(folder: string, relDir: string, into: string[]): Promise<void> {
  for (const entry of await entriesOf(join(folder, relDir))) {
    const rel = `${relDir}/${entry.name}`
    if (entry.directory) await collectMarkdown(folder, rel, into)
    else if (entry.name.endsWith('.md')) into.push(rel)
  }
}

/**
 * Fingerprint of everything {@link scanFolder} reads: the root listing, every
 * directory and Markdown file under the canonical directories with its size
 * and modification time, and the local date (the stale-note rule compares
 * `last_touched` with today). Two equal fingerprints mean a scan would return
 * the same findings and documents, so the caller may keep its last result.
 * One `stat` per file replaces reading and indexing every document.
 * @param folder - absolute path of the configured documentation folder.
 * @returns a hex digest; it differs after any add, remove, rename or edit.
 */
export async function fingerprintFolder(folder: string): Promise<string> {
  const hash = createHash('sha256')
  const now = new Date()
  hash.update(`${String(now.getFullYear())}-${String(now.getMonth())}-${String(now.getDate())}\0`)
  const visit = async (relDir: string, recurse: boolean): Promise<void> => {
    for (const entry of await entriesOf(join(folder, relDir))) {
      const rel = relDir === '' ? entry.name : `${relDir}/${entry.name}`
      if (entry.directory) {
        hash.update(`d\0${rel}\0`)
        if (recurse || (CANONICAL_DIRS as readonly string[]).includes(rel)) await visit(rel, true)
        continue
      }
      if (!entry.name.endsWith('.md')) continue
      let stamp = 'gone'
      try {
        const info = await stat(join(folder, rel))
        stamp = `${String(info.size)}\0${String(info.mtimeMs)}`
      /* v8 ignore start -- only a deletion between the listing and the stat lands here. */
      } catch {
        // Listed a moment ago and gone now: the placeholder changes the
        // digest, which is the signal the caller needs.
      }
      /* v8 ignore stop */
      hash.update(`f\0${rel}\0${stamp}\0`)
    }
  }
  await visit('', false)
  return hash.digest('hex')
}

function titleOf(relPath: string, text: string): string {
  const heading = /^# (.+)$/m.exec(text)?.[1]?.trim()
  if (heading !== undefined && heading !== '') return heading
  /* v8 ignore next -- splitting a non-empty path always yields a last segment; the guard only types the read. */
  const basename = relPath.split('/').at(-1) ?? relPath
  return basename.replace(/\.md$/, '')
}

/**
 * Scan one documentation folder against the canonical structure.
 * @param folder - absolute path of the configured documentation folder.
 * @returns findings and the indexable document set, stamped with the policy version.
 */
export async function scanFolder(folder: string): Promise<ScanResult> {
  const findings: Finding[] = []
  const paths: string[] = []
  const root = await entriesOf(folder)

  for (const entry of root) {
    if (entry.directory) {
      if (!(CANONICAL_DIRS as readonly string[]).includes(entry.name)) {
        findings.push({
          path: entry.name,
          rule: 'unknown-root-dir',
          severity: 'warning',
          message: `\`${entry.name}/\` is outside the canonical structure (${CANONICAL_DIRS.join(', ')})`,
        })
      }
      continue
    }
    if (!entry.name.endsWith('.md')) continue
    paths.push(entry.name)
    if (!(CANONICAL_ROOT_FILES as readonly string[]).includes(entry.name)) {
      findings.push({
        path: entry.name,
        rule: 'stray-root-file',
        severity: 'warning',
        message: `\`${entry.name}\` at the vault root is outside the canonical file set`,
      })
    }
  }

  for (const dir of CANONICAL_DIRS) {
    if (!root.some(entry => entry.directory && entry.name === dir)) continue
    await collectMarkdown(folder, dir, paths)
  }

  for (const project of await entriesOf(join(folder, 'Projects'))) {
    if (!project.directory) continue
    const index = join(folder, 'Projects', project.name, '_index.md')
    try {
      await readFile(index, 'utf8')
    } catch {
      findings.push({
        path: `Projects/${project.name}`,
        rule: 'missing-index',
        severity: 'error',
        message: 'project folder has no `_index.md`; the index is the contract',
      })
    }
  }

  const docs: IndexedDoc[] = []
  for (const relPath of paths) {
    let text: string
    try {
      text = await readFile(join(folder, relPath), 'utf8')
    } catch {
      // Listed a moment ago but unreadable now (perms, races): the document
      // simply stays out of this scan's index; the next scan retries.
      /* v8 ignore next -- only a permission flip or deletion between the listing and the read lands here. */
      continue
    }
    const kind = classifyPath(relPath)
    findings.push(...validateDoc(relPath, kind, text))
    docs.push({ path: relPath, kind, title: titleOf(relPath, text), text })
  }

  return {
    at: new Date().toISOString(),
    policyVersion: RULESET_VERSION.id,
    findings,
    docs,
  }
}
