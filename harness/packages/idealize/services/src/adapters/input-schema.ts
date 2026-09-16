/**
 * A queue endpoint's input schema, pure: read it out of the OpenAPI document
 * fal publishes per endpoint, project the fields a person may choose before
 * generating, coerce a request body to the wire types it names, and parse the
 * literals a 422 offers when no schema is known.
 * @module @idealize/services/adapters/input-schema
 */

import type { GenBooleanField, GenEnumField, GenInputField, GenNumberField } from '@idealize/generate'

/** The wire type of one input property, as far as coercion needs it. */
export type InputPropertyType = 'string' | 'number' | 'integer' | 'boolean' | 'other'

/** One property of an endpoint's input schema. */
export interface InputProperty {
  name: string
  type: InputPropertyType
  /** The string literals the property accepts, when it is an enum. */
  enum?: readonly string[]
  /** The default the endpoint applies when the body omits the property. */
  default?: string | number | boolean
  /** The smallest value a numeric property accepts, when the schema states one. */
  minimum?: number
  /** The largest value a numeric property accepts, when the schema states one. */
  maximum?: number
  required: boolean
}

/** One endpoint's input schema: its properties in the order the service lists them. */
export interface InputSchema {
  properties: readonly InputProperty[]
}

/**
 * Inputs never offered to the person: the prompt and attachment the seam
 * fills itself, and the fields that belong to the provider's plumbing rather
 * than to the piece being made. `num_images` stays out because the composer's
 * Count control owns image count.
 */
export const EXCLUDED_INPUTS: ReadonlySet<string> = new Set([
  'prompt',
  'image_url',
  'negative_prompt',
  'seed',
  'enable_safety_checker',
  'safety_tolerance',
  'sync_mode',
  'output_format',
  'system_prompt',
  'limit_generations',
  'enable_web_search',
  'num_images',
  'num_inference_steps',
  'guidance_scale',
])

/** Labels for the fields whose wire names read badly capitalised. */
const LABELS: Readonly<Record<string, string>> = {
  aspect_ratio: 'Aspect',
  duration: 'Duration',
  resolution: 'Resolution',
  generate_audio: 'Audio',
  camera_fixed: 'Fixed camera',
}

/**
 * The label a field shows: a fixed reading for the common names, otherwise the
 * wire name with underscores as spaces and a capital first letter.
 * @param name - the wire property name.
 * @returns the label.
 */
export function humaniseLabel(name: string): string {
  const fixed = LABELS[name]
  if (fixed !== undefined) return fixed
  const spaced = name.replace(/_+/g, ' ').trim()
  return spaced === '' ? name : spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/** A JSON Schema node as far as this module reads it (wire boundary: untrusted). */
interface SchemaNode {
  type?: unknown
  enum?: unknown
  default?: unknown
  minimum?: unknown
  maximum?: unknown
  anyOf?: unknown
  oneOf?: unknown
}

/** The string literals of an `enum` keyword, or undefined when it is not a non-empty list of strings. */
function stringEnum(node: SchemaNode): readonly string[] | undefined {
  if (!Array.isArray(node.enum) || node.enum.length === 0) return undefined
  return node.enum.every((literal): literal is string => typeof literal === 'string') ? node.enum : undefined
}

/** The property type one schema node states, `other` for anything coercion does not handle. */
function typeOf(node: SchemaNode): InputPropertyType {
  const type: unknown = Array.isArray(node.type) ? (node.type as unknown[]).find(entry => entry !== 'null') : node.type
  if (type === 'string' || type === 'number' || type === 'integer' || type === 'boolean') return type
  if (type === undefined && stringEnum(node) !== undefined) return 'string'
  return 'other'
}

/**
 * Read one property, looking through `anyOf`/`oneOf` wrappers to the first
 * branch that is not `null` (fal wraps optional enums as
 * `anyOf: [{type: 'string', enum: [...]}, {type: 'null'}]`).
 */
function propertyFrom(name: string, raw: unknown, required: boolean): InputProperty {
  const node = (typeof raw === 'object' && raw !== null ? raw : {}) as SchemaNode
  const branches = Array.isArray(node.anyOf) ? node.anyOf : Array.isArray(node.oneOf) ? node.oneOf : []
  const branch = branches
    .filter((entry): entry is SchemaNode => typeof entry === 'object' && entry !== null)
    .find(entry => entry.type !== 'null')
  const typed = branch ?? node
  const literals = stringEnum(typed) ?? stringEnum(node)
  const fallback = node.default
  const property: InputProperty = { name, type: typeOf(typed), required }
  if (literals !== undefined) property.enum = literals
  if (typeof fallback === 'string' || typeof fallback === 'number' || typeof fallback === 'boolean') property.default = fallback
  const minimum = typed.minimum ?? node.minimum
  const maximum = typed.maximum ?? node.maximum
  if (typeof minimum === 'number' && Number.isFinite(minimum)) property.minimum = minimum
  if (typeof maximum === 'number' && Number.isFinite(maximum)) property.maximum = maximum
  return property
}

/**
 * Read an endpoint's input schema out of its OpenAPI document: the first
 * `components.schemas` entry whose key ends in `Input`, its properties in
 * `x-fal-order-properties` order (document order for the rest), and its
 * `required` list.
 * @param document - the parsed OpenAPI JSON (wire boundary: untrusted).
 * @returns the schema, or undefined when the document carries no input schema.
 */
export function parseInputSchema(document: unknown): InputSchema | undefined {
  const schemas = (document as { components?: { schemas?: unknown } } | null)?.components?.schemas
  if (typeof schemas !== 'object' || schemas === null) return undefined
  const key = Object.keys(schemas).find(candidate => candidate.endsWith('Input'))
  if (key === undefined) return undefined
  const input = (schemas as Record<string, unknown>)[key] as {
    properties?: unknown
    required?: unknown
    'x-fal-order-properties'?: unknown
  } | null | undefined
  if (input === null || input === undefined) return undefined
  const properties = input.properties
  if (typeof properties !== 'object' || properties === null) return undefined
  const required = new Set(Array.isArray(input.required) ? input.required.filter((name): name is string => typeof name === 'string') : [])
  const listed = Array.isArray(input['x-fal-order-properties'])
    ? input['x-fal-order-properties'].filter((name): name is string => typeof name === 'string')
    : []
  const names = [...new Set([...listed.filter(name => name in properties), ...Object.keys(properties)])]
  return {
    properties: names.map(name => propertyFrom(name, (properties as Record<string, unknown>)[name], required.has(name))),
  }
}

/**
 * The fields a person may choose before generating: every string enum,
 * numeric property and boolean the schema names outside
 * {@link EXCLUDED_INPUTS}, labelled for display, with the endpoint's default
 * when it states one of the field's own type (an enum default must be among
 * the literals). A plain string property and anything of another type is not
 * a choice and yields no field.
 * @param schema - the endpoint's input schema.
 * @returns the fields in schema order; empty when the schema offers nothing to choose.
 */
export function inputFieldsFrom(schema: InputSchema): GenInputField[] {
  return schema.properties.flatMap((property): GenInputField[] => {
    if (EXCLUDED_INPUTS.has(property.name)) return []
    const label = humaniseLabel(property.name)
    if (property.enum !== undefined) {
      const field: GenEnumField = { name: property.name, label, kind: 'enum', values: property.enum }
      const fallback = property.default === undefined ? undefined : String(property.default)
      if (fallback !== undefined && property.enum.includes(fallback)) field.default = fallback
      return [field]
    }
    if (property.type === 'number' || property.type === 'integer') {
      const field: GenNumberField = { name: property.name, label, kind: 'number', integer: property.type === 'integer' }
      if (property.minimum !== undefined) field.min = property.minimum
      if (property.maximum !== undefined) field.max = property.maximum
      if (typeof property.default === 'number') field.default = property.default
      return [field]
    }
    if (property.type === 'boolean') {
      const field: GenBooleanField = { name: property.name, label, kind: 'boolean' }
      if (typeof property.default === 'boolean') field.default = property.default
      return [field]
    }
    return []
  })
}

/**
 * The literal an enum accepts for a value: the value itself when it is among
 * the literals, its string form when that is (`5` for `"5"`), otherwise the
 * numeric literal nearest to a numeric value (`7.5` reads as `"8"`; a tie
 * takes the larger). Undefined when nothing in the enum fits.
 * @param value - the body value.
 * @param literals - the enum's literals.
 * @returns the literal to send, or undefined.
 */
export function coerceLiteral(value: unknown, literals: readonly string[]): string | undefined {
  if (typeof value === 'string' && literals.includes(value)) return value
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const text = String(value).trim()
  if (literals.includes(text)) return text
  const numeric = Number(text)
  if (text === '' || !Number.isFinite(numeric)) return undefined
  let nearest: { literal: string; distance: number; value: number } | undefined
  for (const literal of literals) {
    const candidate = Number(literal)
    if (literal.trim() === '' || !Number.isFinite(candidate)) continue
    const distance = Math.abs(candidate - numeric)
    if (nearest === undefined || distance < nearest.distance || (distance === nearest.distance && candidate > nearest.value)) {
      nearest = { literal, distance, value: candidate }
    }
  }
  return nearest?.literal
}

/** One body value coerced to one property's wire type; the value itself when nothing applies. */
function coerceValue(value: unknown, property: InputProperty): unknown {
  if (property.enum !== undefined) return coerceLiteral(value, property.enum) ?? value
  if ((property.type === 'number' || property.type === 'integer') && typeof value === 'string') {
    const numeric = Number(value.trim())
    if (value.trim() === '' || !Number.isFinite(numeric)) return value
    return property.type === 'integer' ? Math.round(numeric) : numeric
  }
  if (property.type === 'boolean' && (value === 'true' || value === 'false')) return value === 'true'
  if (property.type === 'string' && typeof value === 'number') return String(value)
  return value
}

/**
 * Coerce a request body to the schema's wire types, field by field: a value
 * for an enum becomes the literal {@link coerceLiteral} picks, a string for a
 * numeric field becomes a number (rounded for integers), `"true"`/`"false"`
 * for a boolean field becomes the boolean, and a number for a plain string
 * field becomes its text. Fields the schema does not name pass through.
 * @param body - the body about to be sent.
 * @param schema - the endpoint's input schema.
 * @returns the coerced body; the same values where nothing applied.
 */
export function coerceBody(body: Readonly<Record<string, unknown>>, schema: InputSchema): Record<string, unknown> {
  const byName = new Map(schema.properties.map(property => [property.name, property]))
  const coerced: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(body)) {
    const property = byName.get(name)
    coerced[name] = property === undefined ? value : coerceValue(value, property)
  }
  return coerced
}

/** The `msg` fal's validation layer gives a value outside a literal enum, with the literals quoted. */
const INPUT_SHOULD_BE = /^Input should be (.+)$/

/**
 * The literals a 422 message offers: every single-quoted token of
 * `Input should be '4', '5' or '6'`.
 * @param msg - one validation entry's message.
 * @returns the literals, empty when the message is not that refusal.
 */
export function literalsFromMessage(msg: string): string[] {
  const offered = INPUT_SHOULD_BE.exec(msg.trim())?.[1]
  if (offered === undefined) return []
  return [...offered.matchAll(/'((?:[^'\\]|\\.)*)'/g)]
    .map(quoted => quoted[1])
    .filter(literal => literal !== undefined)
}

/**
 * The body fields a 422 refused for being outside a literal enum, with the
 * literal each should carry instead: used when no schema is known before the
 * first enqueue. A field whose value already fits, one absent from the body,
 * and one whose literals cannot be coerced to are left out.
 * @param entries - the 422's validation entries, each a field path and message.
 * @param body - the body that was sent.
 * @returns the fields to replace, or undefined when nothing can be replaced.
 */
export function enumRetryValues(
  entries: readonly { field: string; msg: string }[],
  body: Readonly<Record<string, unknown>>,
): Record<string, string> | undefined {
  const replacements: Record<string, string> = {}
  for (const entry of entries) {
    if (entry.field === '' || !(entry.field in body)) continue
    const literals = literalsFromMessage(entry.msg)
    if (literals.length === 0) continue
    const literal = coerceLiteral(body[entry.field], literals)
    if (literal !== undefined && literal !== body[entry.field]) replacements[entry.field] = literal
  }
  return Object.keys(replacements).length === 0 ? undefined : replacements
}
