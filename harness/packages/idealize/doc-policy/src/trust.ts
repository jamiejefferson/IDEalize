/**
 * The optional trust fields of a note (`NOTE_OPTIONAL_FIELDS` in the pinned
 * ruleset): reading them, checking them, and writing the two IDEalize itself
 * writes. Names and value formats follow the Open Knowledge Format 0.2:
 * `generated: { by, at }`, `verified` as a list of `{ by, at }` (one bare
 * mapping counts as a list of one), `stale_after` as an instant, and
 * `sources` as a list whose entries each name a `resource`.
 *
 * Reading accepts the YAML shapes those fields are written in (a flow
 * mapping on the key's line, a block mapping, a block list of either) and
 * nothing wider. Writing replaces or inserts one field's lines and leaves
 * every other byte of the file as it was.
 */

import type { Finding } from './classify.ts'

/** One `{ by, at }` record: who produced or checked a note, and when. */
export interface TrustEvent {
  /** The actor: `human:<id>`, `process:<id>` or `<producer>/<version>`. */
  by?: string
  /** ISO 8601 date-time with a UTC offset. */
  at?: string
}

/** The trust and listing fields read from one note's frontmatter. */
export interface NoteTrust {
  /** `type`, as the writer wrote it. */
  type?: string
  /** `status`, as the writer wrote it. */
  status?: string
  /** `description`: one sentence on what the note holds. */
  description?: string
  /** `generated`, when the field is present with a value. */
  generated?: TrustEvent
  /** `verified` events, when the field is present with a value. */
  verified?: TrustEvent[]
  /** `stale_after`, as written. */
  staleAfter?: string
  /** `sources` entries, when the field is present with a value. */
  sources?: Array<Record<string, string>>
}

/** One top-level frontmatter entry: its key line and the lines that continue it. */
interface Entry {
  key: string
  /** The value on the key's own line, comment and quotes removed. */
  inline: string
  /** Index of the key line within the frontmatter lines. */
  start: number
  /** Index after the entry's last line. */
  end: number
}

/** A note split around its frontmatter, with offsets for an in-place edit. */
interface Split {
  /** Line ending the frontmatter uses. */
  eol: string
  /** Frontmatter lines, without the `---` fences. */
  lines: string[]
  entries: Entry[]
  /** Offset of the first frontmatter line. */
  bodyStart: number
  /** Offset of the closing `---` fence. */
  closeStart: number
}

const FRONTMATTER_RE = /^(﻿?---[ \t]*(\r?\n))((?:[\s\S]*?\r?\n)?)---[ \t]*(?:\r?\n|$)/
const KEY_RE = /^([A-Za-z_][A-Za-z0-9_]*):[ \t]*(.*)$/
const FLOW_MAPPING_RE = /\{([^}]*)\}/g
const ACTOR_RE = /^(?:human:\S+|process:\S+|[^\s/:]+\/\S+)$/
const INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/

function scalar(raw: string): string {
  let value = raw.trim()
  const comment = value.search(/(?:^|\s)#/)
  if (comment !== -1) value = value.slice(0, comment).trim()
  const quoted = /^(["'])(.*)\1$/.exec(value)
  return quoted?.[2] ?? value
}

/** A `key: value` line's two parts; both groups of the pattern always take part in a match. */
function keyValue(text: string): { key: string; value: string } | undefined {
  const match = KEY_RE.exec(text)
  if (match === null) return undefined
  const [, key, value] = match as unknown as [string, string, string]
  return { key, value }
}

/** The text between the braces of each flow mapping in a string. */
function flowMappings(text: string): Array<Record<string, string>> {
  return [...text.matchAll(FLOW_MAPPING_RE)].map((match) => {
    const mapping: Record<string, string> = {}
    for (const part of (match as unknown as [string, string])[1].split(',')) {
      const pair = keyValue(part.trim())
      if (pair !== undefined) mapping[pair.key] = scalar(pair.value)
    }
    return mapping
  })
}

function split(markdown: string): Split | undefined {
  const match = FRONTMATTER_RE.exec(markdown)
  if (match === null) return undefined
  const [, open, eol, block] = match as unknown as [string, string, string, string]
  const lines = block === '' ? [] : block.slice(0, -eol.length).split(eol)
  const entries: Entry[] = []
  for (const [index, line] of lines.entries()) {
    const pair = keyValue(line)
    if (pair !== undefined) {
      entries.push({ key: pair.key, inline: scalarKeepingFlow(pair.value), start: index, end: index + 1 })
      continue
    }
    // A line continues the entry above it while it is indented or a list item.
    const last = entries.at(-1)
    if (last !== undefined && last.end === index && /^(?:[ \t]+\S|-(?:\s|$))/.test(line)) last.end = index + 1
  }
  return { eol, lines, entries, bodyStart: open.length, closeStart: open.length + block.length }
}

/** A key line's value: a flow value keeps its quotes and colons, a plain one is unquoted. */
function scalarKeepingFlow(raw: string): string {
  const value = raw.trim()
  return value.startsWith('{') || value.startsWith('[') ? value : scalar(value)
}

/** Every mapping one entry holds, whichever of the accepted shapes it is written in. */
function mappingsOf(found: Split, entry: Entry): Array<Record<string, string>> {
  if (entry.inline !== '') return flowMappings(entry.inline)
  const mappings: Array<Record<string, string>> = []
  let current: Record<string, string> | undefined
  for (const line of found.lines.slice(entry.start + 1, entry.end)) {
    let text = line.trim()
    if (text.startsWith('-')) {
      current = undefined
      text = text.slice(1).trim()
    }
    const flow = text.startsWith('{') ? flowMappings(text)[0] : undefined
    const pair = flow === undefined ? keyValue(text) : undefined
    if (flow === undefined && pair === undefined) continue
    if (current === undefined) {
      current = {}
      mappings.push(current)
    }
    if (pair === undefined) Object.assign(current, flow)
    else current[pair.key] = scalar(pair.value)
  }
  return mappings
}

function hasValue(entry: Entry): boolean {
  return entry.inline !== '' || entry.end > entry.start + 1
}

function eventOf(mapping: Record<string, string>): TrustEvent {
  return {
    ...mapping.by === undefined ? {} : { by: mapping.by },
    ...mapping.at === undefined ? {} : { at: mapping.at },
  }
}

/**
 * Read the trust and listing fields of one note.
 * @param markdown - complete note text.
 * @returns the fields the note carries; an absent or empty field is left out.
 */
export function readTrust(markdown: string): NoteTrust {
  const found = split(markdown)
  if (found === undefined) return {}
  const trust: NoteTrust = {}
  for (const entry of found.entries) {
    if (!hasValue(entry)) continue
    switch (entry.key) {
      case 'type':
        trust.type = entry.inline
        break
      case 'status':
        trust.status = entry.inline
        break
      case 'description':
        trust.description = entry.inline
        break
      case 'stale_after':
        trust.staleAfter = entry.inline
        break
      case 'generated':
        trust.generated = eventOf(mappingsOf(found, entry)[0] ?? {})
        break
      case 'verified':
        trust.verified = mappingsOf(found, entry).map(eventOf)
        break
      case 'sources':
        trust.sources = mappingsOf(found, entry)
        break
    }
  }
  return trust
}

/**
 * Parse an ISO 8601 date-time that carries a UTC offset.
 * @param value - the text to parse.
 * @returns epoch milliseconds, or `undefined` when the text is another format or no real instant.
 */
export function parseInstant(value: string): number | undefined {
  if (!INSTANT_RE.test(value)) return undefined
  const time = Date.parse(value)
  return Number.isNaN(time) ? undefined : time
}

/**
 * Whether a string names an actor: `human:<id>`, `process:<id>` or `<producer>/<version>`.
 * @param value - the `by` value.
 * @returns true when the value follows the actor convention.
 */
export function isActor(value: string): boolean {
  return ACTOR_RE.test(value)
}

function eventProblem(event: TrustEvent, needsAt: boolean): string | undefined {
  if (event.by === undefined || event.by === '') return 'needs a `by` value'
  if (!isActor(event.by)) return `\`by\` must read human:<id>, process:<id> or <producer>/<version>, got \`${event.by}\``
  if (event.at === undefined || event.at === '') return needsAt ? 'needs an `at` value' : undefined
  if (parseInstant(event.at) === undefined) {
    return `\`at\` must be an ISO 8601 date-time with a UTC offset (2026-01-15T10:30:00Z), got \`${event.at}\``
  }
  return undefined
}

/**
 * Check the trust fields one note carries. Every finding is a warning: the
 * fields are optional, and a note that gets one wrong is still a valid note.
 * @param relPath - vault-relative path, named on each finding.
 * @param markdown - complete note text.
 * @returns one finding per field written in a form tools cannot read.
 */
export function validateTrust(relPath: string, markdown: string): Finding[] {
  const trust = readTrust(markdown)
  const findings: Finding[] = []
  const warn = (rule: string, message: string): void => {
    findings.push({ path: relPath, rule, severity: 'warning', message })
  }
  if (trust.generated !== undefined) {
    const problem = eventProblem(trust.generated, false)
    if (problem !== undefined) warn('invalid-generated', `\`generated\` ${problem}`)
  }
  if (trust.verified !== undefined) {
    const problem = trust.verified.length === 0
      ? 'must be a `{ by, at }` mapping or a list of them'
      : trust.verified.map(event => eventProblem(event, true)).find(found => found !== undefined)
    if (problem !== undefined) warn('invalid-verified', `\`verified\` ${problem}`)
  }
  if (trust.staleAfter !== undefined && parseInstant(trust.staleAfter) === undefined) {
    warn(
      'invalid-stale-after',
      `\`stale_after\` must be an ISO 8601 date-time with a UTC offset (2026-01-15T10:30:00Z), got \`${trust.staleAfter}\``,
    )
  }
  if (trust.sources !== undefined
    && (trust.sources.length === 0 || trust.sources.some(source => source.resource === undefined || source.resource === ''))) {
    warn('invalid-sources', '`sources` must be a list whose entries each carry a `resource`')
  }
  return findings
}

/**
 * Whether a note is past its `stale_after` instant.
 * @param trust - the note's fields.
 * @param now - the instant to compare with, in epoch milliseconds.
 * @returns true when `stale_after` parses and `now` has reached it.
 */
export function isStale(trust: NoteTrust, now: number): boolean {
  const at = trust.staleAfter === undefined ? undefined : parseInstant(trust.staleAfter)
  return at !== undefined && now >= at
}

/** Replace one top-level field's lines, or add them at the foot of the frontmatter; a note with none gains one. */
function setField(markdown: string, key: string, fieldLines: readonly string[]): string {
  const found = split(markdown)
  if (found === undefined) {
    const bom = markdown.startsWith('﻿') ? '﻿' : ''
    const eol = /\r\n/.test(markdown) ? '\r\n' : '\n'
    return `${bom}---${eol}${fieldLines.join(eol)}${eol}---${eol}${markdown.slice(bom.length)}`
  }
  const { eol, lines } = found
  const entry = found.entries.find(candidate => candidate.key === key)
  const next = entry === undefined
    ? [...lines, ...fieldLines]
    : [...lines.slice(0, entry.start), ...fieldLines, ...lines.slice(entry.end)]
  return `${markdown.slice(0, found.bodyStart)}${next.join(eol)}${eol}${markdown.slice(found.closeStart)}`
}

function flow(event: TrustEvent): string {
  const parts = [event.by === undefined ? undefined : `by: ${event.by}`, event.at === undefined ? undefined : `at: ${event.at}`]
  return `{ ${parts.filter(part => part !== undefined).join(', ')} }`
}

/**
 * Record who produced a note's current content, as its `generated` field.
 * @param markdown - complete note text.
 * @param by - the actor that wrote the content.
 * @param at - when it wrote it, as an ISO 8601 date-time with a UTC offset.
 * @returns the note with the field replaced or added and every other byte unchanged.
 */
export function stampGenerated(markdown: string, by: string, at: string): string {
  return setField(markdown, 'generated', [`generated: ${flow({ by, at })}`])
}

/**
 * Add one check to a note's `verified` list. An earlier check by the same
 * actor is replaced, so the list holds each actor's latest check. Every other
 * entry keeps its `by` and `at`, rewritten one per line.
 * @param markdown - complete note text.
 * @param by - the actor that checked the note.
 * @param at - when it checked it, as an ISO 8601 date-time with a UTC offset.
 * @returns the note with the list rewritten and every other byte unchanged.
 */
export function addVerified(markdown: string, by: string, at: string): string {
  const kept = (readTrust(markdown).verified ?? []).filter(event => event.by !== by)
  return setField(markdown, 'verified', ['verified:', ...[...kept, { by, at }].map(event => `  - ${flow(event)}`)])
}
