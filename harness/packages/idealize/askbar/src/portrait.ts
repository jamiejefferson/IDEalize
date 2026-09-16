/**
 * Generated kaomoji agent portraits (design spec, decided 1 Sep 2026:
 * Option A). A portrait is rendered from a deterministic seed of project plus
 * agent name, so the same agent shows the same face everywhere and no image
 * asset is ever stored. The seed picks eyes, mouth and bracket shape, each
 * from a small fixed set, plus a pastel fill for the chip behind the face.
 * @module @idealize/askbar/src/portrait
 */

/** Eye pairs; asymmetric pairs stay ordered so a face reads left to right. */
const EYES = [['o', 'o'], ['•', '•'], ['^', '^'], ['-', '-'], ['ò', 'ó'], ['¬', '¬'], ['°', '°'], ['o', 'O']] as const

const MOUTHS = ['_', '.', 'o', '‿', '~'] as const

/** Bracket pairs framing the face. */
const BRACKETS = [['[', ']'], ['(', ')'], ['{', '}'], ['<', '>']] as const

/**
 * Pastel fills with a paired border and ink, matched to the sketches' chip
 * colours. Ink is a dark shade of each hue (JJ, 2 Sep 2026: the faces were
 * not visible enough — bolder and darker), so every face clears 7:1 on its
 * fill.
 */
const FILLS = [
  { fill: '#F1EAFB', border: '#C9AEE8', ink: '#3E1F6B' },
  { fill: '#EAF3EC', border: '#A6CDB2', ink: '#1B4A2C' },
  { fill: '#FDF1E2', border: '#E0BE8C', ink: '#5C3A0E' },
  { fill: '#E9EDF6', border: '#B0BFDD', ink: '#243458' },
  { fill: '#FBEAEA', border: '#E6ABAB', ink: '#611C1C' },
  { fill: '#EAF6F6', border: '#A6D0D0', ink: '#1B4A4A' },
] as const

/** One rendered portrait: the face text and its chip colours. */
export interface Portrait {
  /** The kaomoji face, e.g. `[o_o]`, rendered in a mono font. */
  face: string
  /** Chip background fill. */
  fill: string
  /** Chip border colour. */
  border: string
  /** Face ink colour. */
  ink: string
}

/** FNV-1a over UTF-16 code units: stable across platforms, no dependency. */
function fnv1a(text: string): number {
  let hash = 0x811C9DC5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/**
 * Render the portrait for one agent.
 * @param project - the resolved project folder (part of the seed, so pools that reuse a name across projects still differ).
 * @param name - the agent's name.
 * @returns the deterministic face and chip colours for this agent.
 */
export function portraitOf(project: string, name: string): Portrait {
  const seed = fnv1a(`${project}\n${name}`)
  const pick = <T>(values: readonly T[], slot: number): T => {
    const value = values[Math.floor(seed / slot) % values.length]
    /* v8 ignore next -- the part sets are non-empty module constants; the guard only types the indexed read. */
    if (value === undefined) throw new Error('idealize-askbar: a portrait part set is empty')
    return value
  }
  const eyes = pick(EYES, 1)
  const mouth = pick(MOUTHS, 8)
  const bracket = pick(BRACKETS, 64)
  const palette = pick(FILLS, 256)
  return {
    face: `${bracket[0]}${eyes[0]}${mouth}${eyes[1]}${bracket[1]}`,
    fill: palette.fill,
    border: palette.border,
    ink: palette.ink,
  }
}
