// Conformance suite (DOC-09/AC-20): the packaged rules classify and validate
// the approved examples taken from the canonical repository, and reject
// mutated copies that break each rule.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  DECISION_HEADING_RE,
  classifyPath,
  parseFrontmatter,
  projectNoteFor,
  validateDoc,
} from '../src/index.ts'

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/ajjent/${name}`, import.meta.url), 'utf8')

describe('classification of canonical paths', () => {
  it.each([
    ['Projects/acme/_index.md', 'project-index'],
    ['Projects/acme/notes.md', 'project-note'],
    ['Decisions/2026-03-04-use-db-push.md', 'decision'],
    ['Reference/reviews/2026-08-01.md', 'reference'],
    ['People/jane.md', 'person'],
    ['templates/project-index.md', 'template'],
    ['CONVENTIONS.md', 'meta'],
    ['AGENTS.md', 'meta'],
    ['scratch.md', 'unmanaged'],
    ['Archive/old.md', 'unmanaged'],
  ] as const)('%s → %s', (path, kind) => {
    expect(classifyPath(path)).toBe(kind)
  })
})

describe('approved examples validate clean', () => {
  it('the canonical template, instantiated, has zero findings', () => {
    const note = projectNoteFor('acme', '/repo/acme', '2026-08-24')
    expect(validateDoc('Projects/acme/_index.md', 'project-index', note)).toEqual([])
  })

  it('the CONVENTIONS project-index frontmatter example parses and validates', () => {
    const example = fixture('index-frontmatter.md')
    const { fields } = parseFrontmatter(example)
    expect(fields.project).toBe('short-name')
    expect(fields.status).toBe('active')
    expect(fields.repo).toBe('~/code/short-name')
    expect(fields.last_touched).toBe('2026-01-15')
    expect(validateDoc('Projects/short-name/_index.md', 'project-index', example)).toEqual([])
  })

  it('the CONVENTIONS decision example matches the decision heading rule', () => {
    expect(DECISION_HEADING_RE.test(fixture('decision-entry.md'))).toBe(true)
    expect(DECISION_HEADING_RE.test('### recently — we changed the database')).toBe(false)
  })

  it('a canonically named decision file has zero findings', () => {
    expect(validateDoc('Decisions/2026-03-04-use-db-push.md', 'decision', fixture('decision-entry.md'))).toEqual([])
  })
})

describe('mutated examples are rejected by the matching rule', () => {
  const approved = fixture('index-frontmatter.md')
  const rulesOf = (content: string): string[] =>
    validateDoc('Projects/short-name/_index.md', 'project-index', content).map(finding => finding.rule)

  it('a status outside the vocabulary → invalid-status', () => {
    expect(rulesOf(approved.replace(/^status:.*$/m, 'status: ongoing'))).toEqual(['invalid-status'])
  })

  it('a relative date → non-iso-date', () => {
    expect(rulesOf(approved.replace(/^last_touched:.*$/m, 'last_touched: last week'))).toEqual(['non-iso-date'])
  })

  it('a missing required field → index-missing-field', () => {
    expect(rulesOf(approved.replace(/^status:.*$\n/m, ''))).toEqual(['index-missing-field'])
  })

  it('a note without frontmatter → index-missing-frontmatter', () => {
    expect(rulesOf('# bare note\n')).toEqual(['index-missing-frontmatter'])
  })

  it('a wrong type marker → wrong-type (warning)', () => {
    const findings = validateDoc(
      'Projects/short-name/_index.md',
      'project-index',
      approved.replace(/^type:.*$/m, 'type: note'),
    )
    expect(findings.map(finding => finding.rule)).toEqual(['wrong-type'])
    expect(findings[0]!.severity).toBe('warning')
  })

  it('an undated decision file → decision-bad-name', () => {
    expect(validateDoc('Decisions/thoughts.md', 'decision', 'whatever').map(finding => finding.rule))
      .toEqual(['decision-bad-name'])
  })

  it('leaves a Projects entry with no note beneath it unmanaged', () => {
    expect(classifyPath('Projects/acme')).toBe('unmanaged')
  })

  it('checks nothing beyond placement for the kinds that carry no frontmatter schema', () => {
    for (const kind of ['project-note', 'reference', 'person', 'template', 'meta', 'unmanaged'] as const) {
      expect(validateDoc('Reference/anything.md', kind, 'no frontmatter here')).toEqual([])
    }
  })
})
