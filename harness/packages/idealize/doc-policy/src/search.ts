/**
 * Full-text retrieval index over the scanned documentation folder (DOC-04):
 * an in-memory SQLite FTS5 table rebuilt on every scan. Derived, disposable
 * data — nothing here persists, so there is no schema versioning or file
 * management; the authoritative content stays on disk in the user's folder.
 * MATCH input follows the session-query-sqlite posture: caller text is always
 * quoted, as one phrase or word by word, so FTS5 query syntax stays inert data.
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
  /** The note's frontmatter `type`, when it carries one. */
  type?: string
  /** The note's frontmatter `status`, when it carries one. */
  status?: string
  /** The note's frontmatter `description`, when it carries one. */
  description?: string
  /** Present and true when the note is past its `stale_after`. */
  stale?: boolean
}

/** Statuses that mark a note as no longer current; hits carrying one rank below the rest. */
const RETIRED_STATUSES = ['deprecated', 'archived'] as const

interface Row {
  path: string
  kind: string
  title: string
  marked: string
  type: string
  status: string
  description: string
  stale: number
}

/** Strip NUL and reserved marker characters before text enters FTS5. */
function sanitize(text: string): string {
  return text
    .replaceAll('\0', '�')
    .replaceAll(MARK_START, '�')
    .replaceAll(MARK_END, '�')
}

/**
 * How a query's words are matched: `phrase` finds the words together in the
 * order given, `all` finds notes holding every word in any order, `any` finds
 * notes holding at least one.
 */
export type DocsMatch = 'phrase' | 'all' | 'any'

/** Every match mode, in the order the tool schema lists them. */
export const DOCS_MATCH_MODES: readonly DocsMatch[] = ['phrase', 'all', 'any']

/** Quote caller text as one FTS5 phrase so query syntax remains inert data. */
function quotePhrase(query: string): string {
  return `"${query.replaceAll('"', '""')}"`
}

/**
 * The FTS5 MATCH expression for a whitespace-normalized query. In `all` and
 * `any` each word is quoted on its own and the quoted words are joined with
 * the operator, so an operator, a quote or a `*` the caller typed is searched
 * for as text. A word with no letter or digit holds nothing FTS5 indexes and
 * is left out; a query made only of such words is matched as a phrase.
 */
function matchExpression(normalized: string, match: DocsMatch): string {
  const words = match === 'phrase' ? [] : [...new Set(normalized.split(' ').filter(word => /[\p{L}\p{N}]/u.test(word)))]
  if (words.length === 0) return quotePhrase(normalized)
  return words.map(quotePhrase).join(match === 'all' ? ' AND ' : ' OR ')
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
          type UNINDEXED,
          status UNINDEXED,
          description UNINDEXED,
          stale_at UNINDEXED,
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
      const insert = db.prepare(
        'INSERT INTO docs (text, path, kind, title, type, status, description, stale_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      for (const doc of docs) {
        insert.run(
          sanitize(doc.text), doc.path, doc.kind, sanitize(doc.title),
          sanitize(doc.type ?? ''), sanitize(doc.status ?? ''), sanitize(doc.description ?? ''),
          doc.staleAt === undefined ? '' : String(doc.staleAt),
        )
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
   * Search the corpus. Notes whose status is `deprecated` or
   * `archived`, and notes past their `stale_after`, rank below every other
   * hit; within each group the best match comes first.
   * @param query - caller text; never read as FTS5 syntax.
   * @param limit - maximum hits.
   * @param options - how to match and when.
   * @param options.match - `phrase` (the default), `all` or `any`.
   * @param options.now - the instant `stale_after` is compared with, in epoch milliseconds.
   * @returns best-first hits with snippets.
   */
  async search(query: string, limit: number, options: { match?: DocsMatch; now?: number } = {}): Promise<DocsSearchHit[]> {
    const { match = 'phrase', now = Date.now() } = options
    const normalized = sanitize(query.trim().replace(/\s+/gu, ' '))
    if (normalized === '') return []
    const db = await this.ensure()
    const rows = db.prepare(`
      SELECT path, kind, title, type, status, description, highlight(docs, 0, ?, ?) AS marked,
        (stale_at <> '' AND CAST(stale_at AS INTEGER) <= ?) AS stale
      FROM docs
      WHERE docs MATCH ?
      ORDER BY (stale OR lower(status) IN (${RETIRED_STATUSES.map(status => `'${status}'`).join(', ')})), rank
      LIMIT ?
    `).all(MARK_START, MARK_END, now, matchExpression(normalized, match), limit) as unknown as Row[]
    return rows.map(row => ({
      path: row.path,
      kind: row.kind,
      title: row.title,
      snippet: makeSnippet(row.marked),
      ...row.type === '' ? {} : { type: row.type },
      ...row.status === '' ? {} : { status: row.status },
      ...row.description === '' ? {} : { description: row.description },
      ...row.stale === 1 ? { stale: true } : {},
    }))
  }

  /** Release the in-memory database. Idempotent. */
  close(): void {
    this.closed = true
    this.db?.close()
    this.db = undefined
  }
}
