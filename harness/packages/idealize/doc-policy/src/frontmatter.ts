/**
 * Minimal YAML-frontmatter field reader for canonical vault notes. Reads the
 * flat `key: value` fields the ruleset names (no nesting, no multi-line
 * values) and strips inline ` # comment` tails, which the canonical examples
 * carry. Not a YAML parser by design: the frontmatter schema is closed and
 * flat, and a full parser would accept documents the policy does not.
 */

/** Parsed frontmatter of one note. */
export interface Frontmatter {
  /** Whether the note opens with a `---` frontmatter block at all. */
  present: boolean
  /** Flat fields, values trimmed with inline comments removed (may be empty strings). */
  fields: Record<string, string>
}

/**
 * Read the frontmatter fields of one Markdown document.
 * @param markdown - complete note text.
 * @returns the parsed block, or `present: false` when the note has none.
 */
export function parseFrontmatter(markdown: string): Frontmatter {
  const match = /^---\n([\s\S]*?)\n---/.exec(markdown)
  if (match === null) return { present: false, fields: {} }
  const fields: Record<string, string> = {}
  /* v8 ignore next -- the pattern's one group always participates; the guard only types the match read. */
  for (const line of (match[1] ?? '').split('\n')) {
    const field = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line)
    if (field?.[1] === undefined) continue
    /* v8 ignore next -- the pattern's second group always participates; the guard only types the match read. */
    let value = (field[2] ?? '').trim()
    const comment = value.search(/\s#/)
    if (comment !== -1) value = value.slice(0, comment).trim()
    fields[field[1]] = value
  }
  return { present: true, fields }
}
