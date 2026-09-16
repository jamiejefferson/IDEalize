/**
 * Classification and per-document validation against the packaged canonical
 * ruleset (DOC-02/05): map a vault-relative path to its document kind, and
 * check a managed document's frontmatter against the rules derived from the
 * pinned canonical repository.
 */

import { parseFrontmatter } from './frontmatter.ts'
import {
  CANONICAL_ROOT_FILES,
  DECISION_FILE_RE,
  ISO_DATE_RE,
  PROJECT_INDEX_REQUIRED_FIELDS,
  STATUS_VOCABULARY,
} from './policy/ruleset.ts'

/** Document kinds the canonical structure recognizes. */
export type DocKind =
  | 'project-index'
  | 'project-note'
  | 'decision'
  | 'reference'
  | 'person'
  | 'template'
  | 'meta'
  | 'unmanaged'

/** One policy finding from a scan or validation. */
export interface Finding {
  /** Vault-relative path of the offending file or folder. */
  path: string
  /** Stable rule id (e.g. `invalid-status`). */
  rule: string
  /** `error` breaks the canonical structure; `warning` flags drift. */
  severity: 'error' | 'warning'
  /** What is wrong, stated so an agent can propose the edit. */
  message: string
}

/**
 * Classify one vault-relative Markdown path against the canonical structure.
 * @param relPath - path relative to the documentation folder, `/`-separated.
 * @returns the document kind; `unmanaged` when outside the canonical layout.
 */
export function classifyPath(relPath: string): DocKind {
  const segments = relPath.split('/')
  const [head] = segments
  if (segments.length === 1) {
    return (CANONICAL_ROOT_FILES as readonly string[]).includes(relPath) ? 'meta' : 'unmanaged'
  }
  switch (head) {
    case 'Projects':
      if (segments.length === 3 && segments[2] === '_index.md') return 'project-index'
      return segments.length >= 3 ? 'project-note' : 'unmanaged'
    case 'Decisions':
      return 'decision'
    case 'Reference':
      return 'reference'
    case 'People':
      return 'person'
    case 'templates':
      return 'template'
    default:
      return 'unmanaged'
  }
}

/**
 * Validate one managed document against the packaged rules.
 * @param relPath - vault-relative path, `/`-separated.
 * @param kind - the path's classification.
 * @param content - complete document text.
 * @returns findings for every violated rule (empty when conformant).
 */
export function validateDoc(relPath: string, kind: DocKind, content: string): Finding[] {
  switch (kind) {
    case 'project-index':
      return validateProjectIndex(relPath, content)
    case 'decision':
      return validateDecisionFile(relPath)
    // Supporting notes, reference material, people, templates, and root meta
    // files carry no closed frontmatter schema in the canonical ruleset;
    // structural placement (already classified) is their whole check.
    case 'project-note':
    case 'reference':
    case 'person':
    case 'template':
    case 'meta':
    case 'unmanaged':
      return []
  }
}

function validateProjectIndex(relPath: string, content: string): Finding[] {
  const findings: Finding[] = []
  const frontmatter = parseFrontmatter(content)
  if (!frontmatter.present) {
    return [{
      path: relPath,
      rule: 'index-missing-frontmatter',
      severity: 'error',
      message: 'project _index.md has no YAML frontmatter block',
    }]
  }
  for (const field of PROJECT_INDEX_REQUIRED_FIELDS) {
    const value = frontmatter.fields[field]
    if (value === undefined || value === '') {
      findings.push({
        path: relPath,
        rule: 'index-missing-field',
        severity: 'error',
        message: `frontmatter is missing the required \`${field}\` field`,
      })
    }
  }
  const status = frontmatter.fields.status
  if (status !== undefined && status !== '' && !(STATUS_VOCABULARY as readonly string[]).includes(status)) {
    findings.push({
      path: relPath,
      rule: 'invalid-status',
      severity: 'error',
      message: `status \`${status}\` is not one of ${STATUS_VOCABULARY.join(' | ')}`,
    })
  }
  for (const field of ['created', 'last_touched']) {
    const value = frontmatter.fields[field]
    if (value !== undefined && value !== '' && !ISO_DATE_RE.test(value)) {
      findings.push({
        path: relPath,
        rule: 'non-iso-date',
        severity: 'error',
        message: `\`${field}\` must be an absolute ISO date (YYYY-MM-DD), got \`${value}\``,
      })
    }
  }
  const type = frontmatter.fields.type
  if (type !== undefined && type !== '' && type !== 'index') {
    findings.push({
      path: relPath,
      rule: 'wrong-type',
      severity: 'warning',
      message: `a project _index.md carries \`type: index\`, got \`${type}\``,
    })
  }
  return findings
}

function validateDecisionFile(relPath: string): Finding[] {
  /* v8 ignore next -- splitting a non-empty path always yields a last segment; the guard only types the read. */
  const basename = relPath.split('/').at(-1) ?? relPath
  if (DECISION_FILE_RE.test(basename)) return []
  return [{
    path: relPath,
    rule: 'decision-bad-name',
    severity: 'warning',
    message: 'cross-project decision files are named `YYYY-MM-DD-topic.md`',
  }]
}
