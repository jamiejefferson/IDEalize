import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CANONICAL_DIRS,
  CANONICAL_ROOT_FILES,
  CONVENTIONS_SOURCE,
  NOTE_OPTIONAL_FIELDS,
  PROJECT_INDEX_OPTIONAL_FIELDS,
  PROJECT_INDEX_REQUIRED_FIELDS,
  PROJECT_INDEX_TEMPLATE,
  RULESET_VERSION,
  STALE_ACTIVE_DAYS,
  agentsText,
  conventionsText,
  STATUS_VOCABULARY,
} from '../src/index.ts'

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/ajjent/${name}`, import.meta.url), 'utf8')

describe('the packaged ruleset pin', () => {
  it('pins the canonical repository at the agreed revision', () => {
    expect(RULESET_VERSION.sha).toBe('1d868f4e55ab70053e6b124948d2eb3c45cc3be1')
    expect(RULESET_VERSION.date).toBe('2026-11-16')
    expect(RULESET_VERSION.id).toBe('ajjent-vault@1d868f4 (2026-11-16)')
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
    expect([...PROJECT_INDEX_OPTIONAL_FIELDS]).toEqual(['description', 'repo', 'live', 'tags'])
  })

  it('derives the optional fields any note may carry from the conventions example', () => {
    expect([...NOTE_OPTIONAL_FIELDS]).toEqual(['description', 'generated', 'verified', 'stale_after', 'sources'])
  })

  it('names log.md as the session log and links the template to it', () => {
    expect(CONVENTIONS_SOURCE).toContain('Each project keeps its session log in `log.md`, beside `_index.md`.')
    expect(PROJECT_INDEX_TEMPLATE).toContain('[log.md](log.md)')
    expect(PROJECT_INDEX_TEMPLATE).not.toContain('## Session log')
  })

  it('derives the closed status vocabulary', () => {
    expect([...STATUS_VOCABULARY]).toEqual(['active', 'draft', 'parked', 'blocked', 'done', 'archived'])
  })

  it('derives the stale-active threshold', () => {
    expect(STALE_ACTIVE_DAYS).toBe(30)
  })
})

describe('the conventions text agents are handed', () => {
  // JJ's ruling of 16 Nov 2026, worded the same in the canonical repository and in her own vault.
  const LAST_TOUCHED_RULE = 'IDEalize writes `last_touched` on project notes that carry `repo:`, from commit evidence. '
    + 'On vault-only projects (no `repo:`), the session that did the work sets it at session close, and the weekly review may set it.'

  it('fits the 2,000 characters the session-start notice keeps, so no rule is clipped', () => {
    expect(conventionsText().length).toBeLessThanOrEqual(2_000)
  })

  it('names one writer for last_touched and log.md as the session log', () => {
    const text = conventionsText()
    expect(text).toContain(LAST_TOUCHED_RULE)
    expect(CONVENTIONS_SOURCE).toContain(LAST_TOUCHED_RULE)
    expect(text).toContain('The session log is `log.md` beside `_index.md`.')
    expect(text).toContain('Optional on any note: `description`, `generated`, `verified`, `stale_after`, `sources`.')
    expect(text).toContain('(plus optional `description`, `repo`, `live`, `tags`)')
    expect(text).not.toContain('## Session log')
    expect(agentsText()).toContain(LAST_TOUCHED_RULE)
  })
})
