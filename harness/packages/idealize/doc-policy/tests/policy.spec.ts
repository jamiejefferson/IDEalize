import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CANONICAL_DIRS,
  CANONICAL_ROOT_FILES,
  CONVENTIONS_SOURCE,
  PROJECT_INDEX_OPTIONAL_FIELDS,
  PROJECT_INDEX_REQUIRED_FIELDS,
  PROJECT_INDEX_TEMPLATE,
  RULESET_VERSION,
  STALE_ACTIVE_DAYS,
  STATUS_VOCABULARY,
} from '../src/index.ts'

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/ajjent/${name}`, import.meta.url), 'utf8')

describe('the packaged ruleset pin', () => {
  it('pins the canonical repository at the agreed revision', () => {
    expect(RULESET_VERSION.sha).toBe('9f7cfe992a0fc20a36425fd502a22873cbcf4e3c')
    expect(RULESET_VERSION.date).toBe('2026-08-12')
    expect(RULESET_VERSION.id).toBe('ajjent-vault@9f7cfe9 (2026-08-12)')
  })

  it('embeds the pinned CONVENTIONS.md verbatim', () => {
    expect(CONVENTIONS_SOURCE).toBe(fixture('CONVENTIONS.md'))
  })

  it('embeds the pinned project-index template verbatim', () => {
    expect(PROJECT_INDEX_TEMPLATE).toBe(fixture('project-index-template.md'))
  })
})

describe('the derived structure and rules', () => {
  it('carries the canonical directory set', () => {
    expect([...CANONICAL_DIRS].sort()).toEqual(['Decisions', 'People', 'Projects', 'Reference', 'templates'])
  })

  it('recognizes the canonical root files', () => {
    expect([...CANONICAL_ROOT_FILES]).toEqual(['AGENTS.md', 'CLAUDE.md', 'CONVENTIONS.md', 'LICENSE', 'README.md'])
  })

  it('derives the project-index frontmatter schema from the template', () => {
    expect([...PROJECT_INDEX_REQUIRED_FIELDS]).toEqual(['project', 'status', 'type', 'created', 'last_touched'])
    expect([...PROJECT_INDEX_OPTIONAL_FIELDS]).toEqual(['repo', 'live', 'tags'])
  })

  it('derives the closed status vocabulary', () => {
    expect([...STATUS_VOCABULARY]).toEqual(['active', 'draft', 'parked', 'blocked', 'done', 'archived'])
  })

  it('derives the stale-active threshold', () => {
    expect(STALE_ACTIVE_DAYS).toBe(30)
  })
})
