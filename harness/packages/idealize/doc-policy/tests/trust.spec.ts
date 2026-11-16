// The optional trust fields (Open Knowledge Format 0.2 names): reading the
// YAML shapes they are written in, checking them, and writing `generated`
// and `verified` while every other byte of the note stays as it was.
import { describe, expect, it } from 'vitest'
import { addVerified, isActor, isStale, parseInstant, readTrust, stampGenerated, validateDoc, validateTrust } from '../src/index.ts'

const note = (frontmatter: string, body = '# Note\n\nBody text.\n'): string => `---\n${frontmatter}\n---\n${body}`
const rules = (frontmatter: string): string[] => validateTrust('Reference/n.md', note(frontmatter)).map(finding => finding.rule)

describe('readTrust', () => {
  it('reads every field in the forms the conventions example uses', () => {
    const trust = readTrust(note([
      'type: listing',
      'status: shortlist',
      'description: "One sentence on the note."   # shown in lists',
      'generated: { by: idealize/build/model-x, at: 2026-01-15T10:30:00Z }',
      'verified:',
      '  - { by: human:alex, at: 2026-01-16T09:00:00Z }',
      '  - { by: process:nightly, at: 2026-01-17T02:00:00+01:00 }',
      'stale_after: 2026-07-15T00:00:00Z   # expires then',
      'sources:',
      '  - { id: spec, resource: https://example.com/spec#part, title: The spec, second edition }',
    ].join('\n')))
    expect(trust).toEqual({
      type: 'listing',
      status: 'shortlist',
      description: 'One sentence on the note.',
      generated: { by: 'idealize/build/model-x', at: '2026-01-15T10:30:00Z' },
      verified: [
        { by: 'human:alex', at: '2026-01-16T09:00:00Z' },
        { by: 'process:nightly', at: '2026-01-17T02:00:00+01:00' },
      ],
      staleAfter: '2026-07-15T00:00:00Z',
      sources: [{ id: 'spec', resource: 'https://example.com/spec#part', title: 'The spec' }],
    })
  })

  it('reads a bare verified mapping as a list of one, and block mappings and lists', () => {
    expect(readTrust(note('verified: { by: human:alex, at: 2026-01-16T09:00:00Z }')).verified)
      .toEqual([{ by: 'human:alex', at: '2026-01-16T09:00:00Z' }])
    const block = readTrust(note([
      'generated:',
      '  by: \'idealize/build/model-x\'',
      '  at: 2026-01-15T10:30:00Z',
      'verified:',
      '- by: human:alex',
      '  at: 2026-01-16T09:00:00Z',
      '  note without a colon',
      '- by: process:nightly',
      '',
      '# a comment between fields',
      '  an indented line that continues nothing',
      'sources:',
      '  - id: spec',
      '    resource: Reference/spec.md',
      'tags: []',
    ].join('\n')))
    expect(block.generated).toEqual({ by: 'idealize/build/model-x', at: '2026-01-15T10:30:00Z' })
    expect(block.verified).toEqual([{ by: 'human:alex', at: '2026-01-16T09:00:00Z' }, { by: 'process:nightly' }])
    expect(block.sources).toEqual([{ id: 'spec', resource: 'Reference/spec.md' }])
  })

  it('leaves out an absent or empty field, and reads nothing from a note with no frontmatter', () => {
    expect(readTrust(note('project: acme\ngenerated:\nverified:\ndescription:\ntags: []'))).toEqual({})
    expect(readTrust('# Bare note\n\ngenerated: { by: human:alex }\n')).toEqual({})
    expect(readTrust('---\n---\n# Empty frontmatter\n')).toEqual({})
  })

  it('reads a note saved with a byte-order mark and Windows line endings', () => {
    const trust = readTrust('﻿---\r\ntype: note\r\nstale_after: 2026-07-15T00:00:00Z\r\n---\r\n# Note\r\n')
    expect(trust).toEqual({ type: 'note', staleAfter: '2026-07-15T00:00:00Z' })
  })
})

describe('parseInstant and isActor', () => {
  it.each([
    ['2026-01-15T10:30:00Z', true],
    ['2026-01-15T10:30:00.250Z', true],
    ['2026-01-15T10:30+01:00', true],
    ['2026-01-15T10:30:00-0500', true],
    ['2026-01-15', false],
    ['2026-01-15T10:30:00', false],
    ['next Tuesday', false],
    ['2026-13-45T99:99:99Z', false],
  ] as const)('%s is an instant with an offset: %s', (value, valid) => {
    expect(parseInstant(value) !== undefined).toBe(valid)
  })

  it.each([
    ['human:alex', true],
    ['process:finance-nightly', true],
    ['idealize/build/claude-model', true],
    ['reference_agent/gemini-2.5-pro', true],
    ['alex', false],
    ['human:', false],
    ['some agent/v1', false],
  ] as const)('%s is an actor: %s', (value, valid) => {
    expect(isActor(value)).toBe(valid)
  })

  it('isStale compares stale_after with the given instant, on or after', () => {
    const at = Date.parse('2026-07-15T00:00:00Z')
    expect(isStale({ staleAfter: '2026-07-15T00:00:00Z' }, at - 1)).toBe(false)
    expect(isStale({ staleAfter: '2026-07-15T00:00:00Z' }, at)).toBe(true)
    expect(isStale({ staleAfter: 'soon' }, at)).toBe(false)
    expect(isStale({}, at)).toBe(false)
  })
})

describe('validateTrust', () => {
  it('raises nothing for a note without the fields, or with well-formed ones', () => {
    expect(rules('project: acme\ntype: note')).toEqual([])
    expect(rules([
      'generated: { by: idealize/build/model-x, at: 2026-01-15T10:30:00Z }',
      'verified: { by: human:alex, at: 2026-01-16T09:00:00Z }',
      'stale_after: 2026-07-15T00:00:00Z',
      'sources:',
      '  - { resource: all support tickets from March }',
    ].join('\n'))).toEqual([])
    // `generated.at` is optional in the format; `by` alone is a complete record.
    expect(rules('generated: { by: human:alex }')).toEqual([])
  })

  it.each([
    ['generated: { at: 2026-01-15T10:30:00Z }', 'invalid-generated', 'needs a `by` value'],
    ['generated: yes', 'invalid-generated', 'needs a `by` value'],
    ['generated: { by: alex, at: 2026-01-15T10:30:00Z }', 'invalid-generated', 'human:<id>, process:<id> or <producer>/<version>'],
    ['generated: { by: human:alex, at: 2026-01-15 }', 'invalid-generated', 'ISO 8601 date-time with a UTC offset'],
    ['verified: checked', 'invalid-verified', 'a `{ by, at }` mapping or a list of them'],
    ['verified:\n  - { by: human:alex }', 'invalid-verified', 'needs an `at` value'],
    ['verified:\n  - { by: human:alex, at: 2026-01-16T09:00:00Z }\n  - { by: human:sam, at: yesterday }', 'invalid-verified', 'got `yesterday`'],
    ['stale_after: 2026-07-15', 'invalid-stale-after', 'got `2026-07-15`'],
    ['stale_after: in six months', 'invalid-stale-after', 'got `in six months`'],
    ['sources: the spec', 'invalid-sources', 'each carry a `resource`'],
    ['sources:\n  - { id: spec, title: The spec }', 'invalid-sources', 'each carry a `resource`'],
  ] as const)('%s → %s', (frontmatter, rule, message) => {
    const findings = validateTrust('Reference/n.md', note(frontmatter))
    expect(findings.map(finding => finding.rule)).toEqual([rule])
    expect(findings[0]).toMatchObject({ path: 'Reference/n.md', severity: 'warning' })
    expect(findings[0]!.message).toContain(message)
  })

  it('a malformed date produces a finding from validateDoc for any kind of note, never a throw', () => {
    const broken = note('project: acme\nstale_after: 31/12/2026\ngenerated: { by: human:alex, at: [oops')
    for (const kind of ['project-note', 'reference', 'person', 'decision', 'unmanaged', 'meta', 'template'] as const) {
      expect(validateDoc('Decisions/2026-03-04-topic.md', kind, broken).map(finding => finding.rule))
        .toEqual(['invalid-generated', 'invalid-stale-after'])
    }
  })
})

describe('stampGenerated', () => {
  const by = 'idealize/build/model-x'
  const at = '2026-11-16T10:00:00Z'
  const line = `generated: { by: ${by}, at: ${at} }`

  it('adds the field at the foot of the frontmatter and keeps every other byte', () => {
    const original = note('project: acme\ntags: [a, b]   # two tags', '# Note\n\n---\n\nA rule above, and trailing spaces  \n')
    expect(stampGenerated(original, by, at)).toBe(original.replace('\n---\n# Note', `\n${line}\n---\n# Note`))
  })

  it('replaces an earlier stamp in place, whether one line or a block', () => {
    const flow = note('project: acme\ngenerated: { by: human:alex, at: 2026-01-01T00:00:00Z }\ntags: []')
    expect(stampGenerated(flow, by, at)).toBe(note(`project: acme\n${line}\ntags: []`))
    const block = note('generated:\n  by: human:alex\n  at: 2026-01-01T00:00:00Z\ntags: []')
    expect(stampGenerated(block, by, at)).toBe(note(`${line}\ntags: []`))
    expect(stampGenerated(stampGenerated(flow, by, at), by, at)).toBe(stampGenerated(flow, by, at))
  })

  it('gives a note with no frontmatter one, and fills an empty one', () => {
    expect(stampGenerated('# Bare\n\nText.\n', by, at)).toBe(`---\n${line}\n---\n# Bare\n\nText.\n`)
    expect(stampGenerated('', by, at)).toBe(`---\n${line}\n---\n`)
    expect(stampGenerated('---\n---\n# Empty\n', by, at)).toBe(`---\n${line}\n---\n# Empty\n`)
  })

  it('keeps a byte-order mark and Windows line endings', () => {
    expect(stampGenerated('﻿---\r\ntype: note\r\n---\r\n# Note\r\n', by, at))
      .toBe(`﻿---\r\ntype: note\r\n${line}\r\n---\r\n# Note\r\n`)
    expect(stampGenerated('﻿# Bare\r\nText.\r\n', by, at)).toBe(`﻿---\r\n${line}\r\n---\r\n# Bare\r\nText.\r\n`)
  })

  it('reads back as a valid record', () => {
    const stamped = stampGenerated(note('project: acme'), by, at)
    expect(readTrust(stamped).generated).toEqual({ by, at })
    expect(validateTrust('n.md', stamped)).toEqual([])
  })
})

describe('addVerified', () => {
  const at = '2026-11-16T10:00:00Z'

  it('starts the list on a note that has none, with or without frontmatter', () => {
    expect(addVerified(note('project: acme'), 'human:user', at))
      .toBe(note(`project: acme\nverified:\n  - { by: human:user, at: ${at} }`))
    expect(addVerified('# Bare\n', 'human:user', at)).toBe(`---\nverified:\n  - { by: human:user, at: ${at} }\n---\n# Bare\n`)
  })

  it('keeps other checks, turns a bare mapping into a list, and replaces the same actor\'s earlier check', () => {
    const bare = note('verified: { by: process:nightly, at: 2026-01-17T02:00:00Z }\ntags: []')
    const once = addVerified(bare, 'human:user', '2026-06-01T00:00:00Z')
    expect(once).toBe(note('verified:\n  - { by: process:nightly, at: 2026-01-17T02:00:00Z }\n  - { by: human:user, at: 2026-06-01T00:00:00Z }\ntags: []'))
    const twice = addVerified(once, 'human:user', at)
    expect(twice).toBe(note(`verified:\n  - { by: process:nightly, at: 2026-01-17T02:00:00Z }\n  - { by: human:user, at: ${at} }\ntags: []`))
    expect(validateTrust('n.md', twice)).toEqual([])
  })

  it('keeps an entry that lacks a field as far as it was written', () => {
    const partial = note('verified:\n  - by: human:sam\n  - at: 2026-01-01T00:00:00Z')
    expect(addVerified(partial, 'human:user', at))
      .toBe(note(`verified:\n  - { by: human:sam }\n  - { at: 2026-01-01T00:00:00Z }\n  - { by: human:user, at: ${at} }`))
  })
})
