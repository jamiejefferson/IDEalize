/**
 * Full-text retrieval index over the scanned documentation folder (DOC-04):
 * an in-memory SQLite FTS5 table rebuilt on every scan. Derived, disposable
 * data — nothing here persists, so there is no schema versioning or file
 * management; the authoritative content stays on disk in the user's folder.
 * MATCH input follows the session-query-sqlite posture: caller text is quoted
 * as one phrase so FTS5 query syntax stays inert data.
 */

import type { DatabaseSync } from 'node:sqlite'
import type { IndexedDoc } from './scan.ts'

/** Collision-free markers FTS5 `highlight()` inserts around matches. */
const MARK_START = '﷐'
const MARK_END = '﷑'

/** Maximum snippet length in characters. */
const SNIPPET_CHARS = 200

/** One `docs_search` hit. */
export interface DocsSearchHit {
  /** Vault-relative path of the matching document. */
  path: string
  /** The document's canonical kind. */
  kind: string
  /** Document title. */
  title: string
  /** Whitespace-normalized excerpt around the first match. */
  snippet: string
}

/** Strip NUL and reserved marker characters before text enters FTS5. */
function sanitize(text: string): string {
  return text
    .replaceAll('\0', '�')
    .replaceAll(MARK_START, '�')
    .replaceAll(MARK_END, '�')
}

/** Quote caller text as one FTS5 phrase so query syntax remains inert data. */
function quotePhrase(query: string): string {
  return `"${query.replaceAll('"', '""')}"`
}

/** Whitespace-normalized excerpt of at most {@link SNIPPET_CHARS} characters, centered on the first match. */
function makeSnippet(marked: string): string {
  const characters: string[] = []
  let matchStart = 0
  let seen = false
  for (const character of marked) {
    if (character === MARK_START) {
      if (!seen) {
        matchStart = characters.length
        seen = true
      }
      continue
    }
    if (character === MARK_END) continue
    if (/\s/u.test(character)) {
      if (characters.length > 0 && characters.at(-1) !== ' ') characters.push(' ')
    } else {
      characters.push(character)
    }
  }
  if (characters.at(-1) === ' ') characters.pop()
  if (characters.length <= SNIPPET_CHARS) return characters.join('')
  const start = Math.max(0, Math.min(matchStart - Math.floor(SNIPPET_CHARS / 3), characters.length - SNIPPET_CHARS))
  const end = start + SNIPPET_CHARS
  return `${start > 0 ? '…' : ''}${characters.slice(start, end).join('')}${end < characters.length ? '…' : ''}`
}

/** The in-memory FTS5 docs index. One instance per docPolicy service. */
export class DocsIndex {
  private db: DatabaseSync | undefined
  private opening: Promise<DatabaseSync> | undefined
  private closed = false

  private async ensure(): Promise<DatabaseSync> {
    if (this.closed) throw new Error('docs index is closed')
    this.opening ??= (async () => {
      const { DatabaseSync } = await import('node:sqlite')
      const db = new DatabaseSync(':memory:')
      db.exec(`
        CREATE VIRTUAL TABLE docs USING fts5(
          text,
          path UNINDEXED,
          kind UNINDEXED,
          title UNINDEXED,
          tokenize = 'unicode61'
        )
      `)
      this.db = db
      return db
    })()
    return this.opening
  }

  /**
   * Replace the whole corpus with one scan's document set.
   * @param docs - the scan's indexable documents.
   */
  async replaceAll(docs: readonly IndexedDoc[]): Promise<void> {
    const db = await this.ensure()
    db.exec('BEGIN')
    try {
      db.exec('DELETE FROM docs')
      const insert = db.prepare('INSERT INTO docs (text, path, kind, title) VALUES (?, ?, ?, ?)')
      for (const doc of docs) {
        insert.run(sanitize(doc.text), doc.path, doc.kind, sanitize(doc.title))
      }
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  /**
   * Current corpus size.
   * @returns the number of indexed documents.
   */
  async count(): Promise<number> {
    const db = await this.ensure()
    const row = db.prepare('SELECT count(*) AS n FROM docs').get() as { n: number }
    return row.n
  }

  /**
   * Phrase-match the corpus.
   * @param query - caller text; treated as one literal phrase.
   * @param limit - maximum hits.
   * @returns best-first hits with snippets.
   */
  async search(query: string, limit: number): Promise<DocsSearchHit[]> {
    const normalized = sanitize(query.trim().replace(/\s+/gu, ' '))
    if (normalized === '') return []
    const db = await this.ensure()
    const rows = db.prepare(`
      SELECT path, kind, title, highlight(docs, 0, ?, ?) AS marked
      FROM docs
      WHERE docs MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(MARK_START, MARK_END, quotePhrase(normalized), limit) as unknown as Array<{
      path: string
      kind: string
      title: string
      marked: string
    }>
    return rows.map(row => ({
      path: row.path,
      kind: row.kind,
      title: row.title,
      snippet: makeSnippet(row.marked),
    }))
  }

  /** Release the in-memory database. Idempotent. */
  close(): void {
    this.closed = true
    this.db?.close()
    this.db = undefined
  }
}
