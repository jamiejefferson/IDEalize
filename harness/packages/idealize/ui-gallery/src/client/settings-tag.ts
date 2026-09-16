/**
 * The generation-settings tag the composer strip keeps at the end of the
 * draft.
 *
 * The composer has no pre-submit seam a plugin can occupy, so a control that
 * must reach the model states itself in the message the user sends. The strip
 * therefore maintains one trailing tag, `[aspect 16:9, duration 8, 3 images]`,
 * which the model reads alongside the prompt and turns into generation tool
 * arguments. A field at its default writes no part and a strip with every
 * field at its default writes no tag, so a user who never touches the strip
 * never sees one, and the tag stays ordinary editable text the user can delete.
 *
 * Grammar: `[part, part, …]`, where a part is `<name> <value>` for a field
 * (the name is the model's input name, except `aspect_ratio` writes `aspect`;
 * the value is one token without commas or spaces: an enum literal, a number
 * such as `45`, or `true`/`false` for a switch) or `<N> images` for the image
 * count. Parts appear in strip order, count last. A trailing bracket carrying
 * any part the current strip does not know is the user's own text and is left
 * alone.
 * @module @idealize/ui-gallery/client/settings-tag
 */

import type { GenerationField, GenerationSelection, GenerationStrip } from './contract.ts'

/** How many images one prompt may ask for, in menu order. */
export const GALLERY_COUNTS: readonly number[] = [1, 2, 3, 4]

/** Every field at its default and one image: the draft carries no tag. */
export const DEFAULT_SELECTION: GenerationSelection = { values: {}, count: 1 }

/** A trailing bracketed run at the very end of the draft, tag or not. */
const TRAILING_BRACKET = /[ \t]*\[([^[\]]*)\][ \t]*$/

const FIELD_PART = /^([A-Za-z_]+) ([^\s,]+)$/
const COUNT_PART = /^(\d{1,2}) images$/

/**
 * The tag part name a field writes.
 * @param name - the model's input name.
 * @returns `aspect` for `aspect_ratio`, otherwise the name itself.
 */
export function partName(name: string): string {
  return name === 'aspect_ratio' ? 'aspect' : name
}

/**
 * A field's default as the tag would write it: the enum literal, the number's
 * text, `true`/`false` for a switch.
 * @param field - the field.
 * @returns the token, or undefined when the model states no default.
 */
export function defaultOf(field: GenerationField): string | undefined {
  return field.default === undefined ? undefined : String(field.default)
}

/**
 * The value the strip shows for one field.
 * @param field - the field.
 * @param selection - the current selection.
 * @returns the chosen value, else the field's default token, else the empty string (unset).
 */
export function valueOf(field: GenerationField, selection: GenerationSelection): string {
  return selection.values[field.name] ?? defaultOf(field) ?? ''
}

/**
 * Read the selection the draft's trailing tag states.
 * @param draft - the current composer draft.
 * @param strip - the fields and count menu the strip currently renders.
 * @returns the selection, and the draft with the tag removed. A trailing
 * bracket the strip did not write is left in the body untouched.
 */
export function readSettingsTag(
  draft: string,
  strip: GenerationStrip,
): { selection: GenerationSelection; body: string } {
  const match = TRAILING_BRACKET.exec(draft)
  if (match === null) return { selection: DEFAULT_SELECTION, body: draft }
  const parts = (match[1] ?? '').split(',').map(part => part.trim()).filter(part => part !== '')
  const values: Record<string, string> = {}
  let count: number | undefined
  for (const part of parts) {
    const countMatch = COUNT_PART.exec(part)
    if (countMatch !== null && strip.counts?.includes(Number(countMatch[1])) === true) {
      count = Number(countMatch[1])
      continue
    }
    const fieldMatch = FIELD_PART.exec(part)
    if (fieldMatch !== null) {
      const [, name = '', value = ''] = fieldMatch
      const field = strip.fields.find(candidate => partName(candidate.name) === name)
      if (field !== undefined) {
        values[field.name] = value
        continue
      }
    }
    // Anything else means the brackets are the user's own text, not this tag.
    return { selection: DEFAULT_SELECTION, body: draft }
  }
  if (Object.keys(values).length === 0 && count === undefined) return { selection: DEFAULT_SELECTION, body: draft }
  return {
    selection: { values, count: count ?? 1 },
    body: draft.slice(0, match.index),
  }
}

/**
 * Render one selection as its tag text.
 * @param selection - the chosen values and count.
 * @param strip - the fields and count menu the strip currently renders; a value for a field outside the strip is dropped.
 * @returns the tag, or an empty string when every part sits at its default.
 */
export function formatSettingsTag(selection: GenerationSelection, strip: GenerationStrip): string {
  const parts: string[] = []
  for (const field of strip.fields) {
    const value = selection.values[field.name]
    if (value === undefined || value === '' || value === defaultOf(field)) continue
    parts.push(`${partName(field.name)} ${value}`)
  }
  if (strip.counts !== undefined && selection.count > 1) parts.push(`${String(selection.count)} images`)
  return parts.length === 0 ? '' : `[${parts.join(', ')}]`
}

/**
 * Replace the draft's settings tag with the one the strip now states.
 * @param draft - the current composer draft.
 * @param selection - the chosen values and count.
 * @param strip - the fields and count menu the strip currently renders.
 * @returns the next draft. An empty tag over an empty body yields an empty
 * draft, so clearing every control on an untyped message leaves nothing behind.
 */
export function applySettingsTag(draft: string, selection: GenerationSelection, strip: GenerationStrip): string {
  const { body } = readSettingsTag(draft, strip)
  const tag = formatSettingsTag(selection, strip)
  const trimmed = body.replace(/[ \t]+$/, '')
  if (tag === '') return trimmed
  return trimmed === '' ? tag : `${trimmed} ${tag}`
}
