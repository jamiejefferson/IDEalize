/**
 * The input-schema module, pure: fal's per-endpoint OpenAPI document read into
 * properties, the enum fields a person may choose, body coercion to the wire
 * types, and the literals a 422 offers when no schema was known.
 */
import { describe, expect, it } from 'vitest'
import {
  coerceBody,
  coerceLiteral,
  enumRetryValues,
  EXCLUDED_INPUTS,
  humaniseLabel,
  inputFieldsFrom,
  literalsFromMessage,
  parseInputSchema,
} from '../src/adapters/input-schema.ts'
import { SEEDANCE_DOCUMENT } from './seedance-document.ts'

/** `fal-ai/nano-banana-2`: optional enums wrapped in `anyOf` beside `null`, and the provider's own plumbing fields. */
const NANO_BANANA_DOCUMENT = {
  components: {
    schemas: {
      NanoBanana2Input: {
        required: ['prompt'],
        properties: {
          prompt: { type: 'string' },
          num_images: { type: 'integer', default: 1 },
          aspect_ratio: { default: 'auto', anyOf: [{ enum: ['auto', '1:1', '16:9', '9:16'], type: 'string' }, { type: 'null' }] },
          thinking_level: { default: 'minimal', anyOf: [{ enum: ['minimal', 'high'], type: 'string' }, { type: 'null' }] },
          output_format: { type: 'string', default: 'png', enum: ['png', 'jpeg', 'webp'] },
          safety_tolerance: { type: 'string', enum: ['1', '2', '3'] },
          sync_mode: { type: 'boolean' },
          enable_web_search: { type: 'boolean' },
          limit_generations: { type: 'boolean' },
          system_prompt: { type: 'string' },
          guidance_scale: { type: 'number' },
          num_inference_steps: { type: 'integer' },
          negative_prompt: { type: 'string' },
          image_url: { type: 'string' },
        },
      },
    },
  },
}

/** `minimax/music-3`: a plain-number duration with no enum, so nothing to choose from and nothing to coerce. */
const MUSIC_DOCUMENT = {
  components: {
    schemas: {
      MinimaxMusic3Input: {
        required: ['prompt', 'lyrics'],
        properties: {
          prompt: { type: 'string' },
          lyrics: { type: 'string' },
          duration: { type: 'number', default: 60, minimum: 1, maximum: 300 },
        },
      },
    },
  },
}

describe('parseInputSchema', () => {
  it('reads the *Input schema in x-fal-order-properties order, with types, enums, defaults and the required list', () => {
    const schema = parseInputSchema(SEEDANCE_DOCUMENT)!
    expect(schema.properties.map(property => property.name)).toEqual([
      'prompt', 'aspect_ratio', 'resolution', 'duration', 'camera_fixed', 'seed', 'enable_safety_checker', 'generate_audio',
    ])
    expect(schema.properties.find(property => property.name === 'duration')).toEqual({
      name: 'duration', type: 'string', enum: ['4', '5', '6', '7', '8', '9', '10', '11', '12'], default: '5', required: false,
    })
    expect(schema.properties.find(property => property.name === 'prompt')).toEqual({ name: 'prompt', type: 'string', required: true })
    expect(schema.properties.find(property => property.name === 'camera_fixed')).toEqual({ name: 'camera_fixed', type: 'boolean', default: false, required: false })
    // `anyOf: [integer, null]` reads as the integer branch.
    expect(schema.properties.find(property => property.name === 'seed')).toEqual({ name: 'seed', type: 'integer', required: false })
  })

  it('reads an enum out of an anyOf branch of type string, and the default beside the wrapper', () => {
    const schema = parseInputSchema(NANO_BANANA_DOCUMENT)!
    expect(schema.properties.find(property => property.name === 'aspect_ratio')).toEqual({
      name: 'aspect_ratio', type: 'string', enum: ['auto', '1:1', '16:9', '9:16'], default: 'auto', required: false,
    })
    expect(schema.properties.find(property => property.name === 'thinking_level')?.enum).toEqual(['minimal', 'high'])
    // No order hint: document order.
    expect(schema.properties[0]?.name).toBe('prompt')
    expect(schema.properties[1]?.name).toBe('num_images')
  })

  it('reads a numeric bound out of an anyOf branch, and drops one that is not a finite number', () => {
    const schema = parseInputSchema({ components: { schemas: { XInput: { properties: {
      steps: { anyOf: [{ type: 'integer', minimum: 1, maximum: 50 }, { type: 'null' }], default: 30 },
      scale: { type: 'number', minimum: 'low', maximum: Infinity },
    } } } } })!
    expect(schema.properties).toEqual([
      { name: 'steps', type: 'integer', default: 30, minimum: 1, maximum: 50, required: false },
      { name: 'scale', type: 'number', required: false },
    ])
  })

  it('types a plain-number property as number and leaves it without an enum', () => {
    const schema = parseInputSchema(MUSIC_DOCUMENT)!
    expect(schema.properties.find(property => property.name === 'duration')).toEqual({ name: 'duration', type: 'number', default: 60, minimum: 1, maximum: 300, required: false })
    expect(schema.properties.find(property => property.name === 'lyrics')?.required).toBe(true)
  })

  it('reads an enum with no stated type as a string enum, an unknown type as other, and a type list through its non-null member', () => {
    const schema = parseInputSchema({
      components: {
        schemas: {
          XInput: {
            properties: {
              style: { enum: ['a', 'b'] },
              blob: { type: 'array' },
              mixed: { type: ['null', 'number'] },
              broken: 'not a node',
              odd: { enum: ['a', 3] },
              empty: { enum: [] },
            },
            required: 'not a list',
            'x-fal-order-properties': ['blob', 'missing', 7],
          },
        },
      },
    })!
    expect(schema.properties.map(property => `${property.name}:${property.type}`)).toEqual([
      'blob:other', 'style:string', 'mixed:number', 'broken:other', 'odd:other', 'empty:other',
    ])
    expect(schema.properties.find(property => property.name === 'style')?.enum).toEqual(['a', 'b'])
    expect(schema.properties.find(property => property.name === 'odd')?.enum).toBeUndefined()
  })

  it('looks through a oneOf wrapper the same way, skipping branches that are not nodes', () => {
    const schema = parseInputSchema({
      components: { schemas: { XInput: { properties: { fit: { oneOf: [null, { type: 'null' }, { type: 'string', enum: ['cover', 'contain'] }] } } } } },
    })!
    expect(schema.properties).toEqual([{ name: 'fit', type: 'string', enum: ['cover', 'contain'], required: false }])
  })

  it('answers undefined for a document with no input schema', () => {
    expect(parseInputSchema(null)).toBeUndefined()
    expect(parseInputSchema({ components: {} })).toBeUndefined()
    expect(parseInputSchema({ components: { schemas: { Output: {} } } })).toBeUndefined()
    expect(parseInputSchema({ components: { schemas: { XInput: { type: 'object' } } } })).toBeUndefined()
    expect(parseInputSchema({ components: { schemas: { XInput: null } } })).toBeUndefined()
  })
})

describe('inputFieldsFrom', () => {
  it('offers every string enum outside the exclusions, labelled, with the default when it is among the literals', () => {
    expect(inputFieldsFrom(parseInputSchema(SEEDANCE_DOCUMENT)!)).toEqual([
      { name: 'aspect_ratio', label: 'Aspect', kind: 'enum', values: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16', 'auto'], default: '16:9' },
      { name: 'resolution', label: 'Resolution', kind: 'enum', values: ['480p', '720p', '1080p'], default: '720p' },
      { name: 'duration', label: 'Duration', kind: 'enum', values: ['4', '5', '6', '7', '8', '9', '10', '11', '12'], default: '5' },
      { name: 'camera_fixed', label: 'Fixed camera', kind: 'boolean', default: false },
      { name: 'generate_audio', label: 'Audio', kind: 'boolean', default: true },
    ])
  })

  it('offers a numeric property as a number field with the bounds and default the schema states', () => {
    expect(inputFieldsFrom(parseInputSchema(MUSIC_DOCUMENT)!)).toEqual([
      { name: 'duration', label: 'Duration', kind: 'number', integer: false, min: 1, max: 300, default: 60 },
    ])
    expect(inputFieldsFrom({ properties: [
      { name: 'frames', type: 'integer', required: false },
      { name: 'loop', type: 'boolean', required: false },
      { name: 'temperature', type: 'number', default: 'warm', required: false },
    ] })).toEqual([
      { name: 'frames', label: 'Frames', kind: 'number', integer: true },
      { name: 'loop', label: 'Loop', kind: 'boolean' },
      { name: 'temperature', label: 'Temperature', kind: 'number', integer: false },
    ])
  })

  it('keeps the model-facing enums and drops the provider plumbing', () => {
    expect(inputFieldsFrom(parseInputSchema(NANO_BANANA_DOCUMENT)!)).toEqual([
      { name: 'aspect_ratio', label: 'Aspect', kind: 'enum', values: ['auto', '1:1', '16:9', '9:16'], default: 'auto' },
      { name: 'thinking_level', label: 'Thinking level', kind: 'enum', values: ['minimal', 'high'], default: 'minimal' },
    ])
    for (const name of ['num_images', 'output_format', 'safety_tolerance', 'sync_mode', 'system_prompt', 'guidance_scale', 'seed', 'prompt', 'image_url', 'negative_prompt']) {
      expect(EXCLUDED_INPUTS.has(name)).toBe(true)
    }
  })

  it('yields nothing for a plain string or an unknown type, and omits an enum default outside the literals', () => {
    expect(inputFieldsFrom({ properties: [{ name: 'style', type: 'string', required: false }, { name: 'mask', type: 'other', required: false }] })).toEqual([])
    expect(inputFieldsFrom({ properties: [{ name: 'fps', type: 'string', enum: ['24', '30'], default: '60', required: false }] }))
      .toEqual([{ name: 'fps', label: 'Fps', kind: 'enum', values: ['24', '30'] }])
  })

  it('humanises labels: the fixed names, then capitalised words', () => {
    expect(humaniseLabel('generate_audio')).toBe('Audio')
    expect(humaniseLabel('camera_fixed')).toBe('Fixed camera')
    expect(humaniseLabel('aspect_ratio')).toBe('Aspect')
    expect(humaniseLabel('duration')).toBe('Duration')
    expect(humaniseLabel('resolution')).toBe('Resolution')
    expect(humaniseLabel('thinking_level')).toBe('Thinking level')
    expect(humaniseLabel('fps')).toBe('Fps')
    expect(humaniseLabel('_')).toBe('_')
  })
})

describe('coerceLiteral', () => {
  const durations = ['4', '5', '6', '7', '8', '9', '10', '11', '12']

  it('keeps a fitting string, stringifies a number the enum names, and rounds to the nearest numeric literal', () => {
    expect(coerceLiteral('5', durations)).toBe('5')
    expect(coerceLiteral(5, durations)).toBe('5')
    expect(coerceLiteral(' 5 ', durations)).toBe('5')
    expect(coerceLiteral(7.5, durations)).toBe('8')
    expect(coerceLiteral(7.4, durations)).toBe('7')
    expect(coerceLiteral(30, durations)).toBe('12')
    expect(coerceLiteral('1', durations)).toBe('4')
  })

  it('answers undefined when nothing in the enum fits', () => {
    expect(coerceLiteral('wide', ['16:9', '9:16'])).toBeUndefined()
    expect(coerceLiteral(5, ['16:9', '9:16'])).toBeUndefined()
    expect(coerceLiteral(true, durations)).toBeUndefined()
    expect(coerceLiteral('', durations)).toBeUndefined()
    expect(coerceLiteral(Number.NaN, durations)).toBeUndefined()
  })
})

describe('coerceBody', () => {
  it('coerces each named field to its wire type and passes unnamed fields through', () => {
    const schema = parseInputSchema(SEEDANCE_DOCUMENT)!
    expect(coerceBody({
      prompt: 'a kite',
      duration: 5,
      resolution: '1080p',
      aspect_ratio: 'wide',
      camera_fixed: 'true',
      seed: '42',
      unknown: 'x',
    }, schema)).toEqual({
      prompt: 'a kite',
      duration: '5',
      resolution: '1080p',
      aspect_ratio: 'wide',
      camera_fixed: true,
      seed: 42,
      unknown: 'x',
    })
  })

  it('turns a string into a number for a numeric field and leaves a number alone', () => {
    const schema = parseInputSchema(MUSIC_DOCUMENT)!
    expect(coerceBody({ duration: '90' }, schema)).toEqual({ duration: 90 })
    expect(coerceBody({ duration: 60 }, schema)).toEqual({ duration: 60 })
    expect(coerceBody({ duration: 'long' }, schema)).toEqual({ duration: 'long' })
    expect(coerceBody({ duration: ' ' }, schema)).toEqual({ duration: ' ' })
    expect(coerceBody({ lyrics: 7 }, schema)).toEqual({ lyrics: '7' })
  })

  it('rounds a string for an integer field and leaves booleans and other types as sent', () => {
    const schema = { properties: [
      { name: 'steps', type: 'integer' as const, required: false },
      { name: 'fixed', type: 'boolean' as const, required: false },
      { name: 'blob', type: 'other' as const, required: false },
    ] }
    expect(coerceBody({ steps: '2.6', fixed: 'false', blob: [1] }, schema)).toEqual({ steps: 3, fixed: false, blob: [1] })
    expect(coerceBody({ fixed: 'yes' }, schema)).toEqual({ fixed: 'yes' })
  })
})

describe('the 422 fallback', () => {
  it('reads the quoted literals out of fal\'s message', () => {
    expect(literalsFromMessage("Input should be '4', '5', '6', '7', '8', '9', '10', '11' or '12'")).toEqual(['4', '5', '6', '7', '8', '9', '10', '11', '12'])
    expect(literalsFromMessage("Input should be '16:9' or '9:16'")).toEqual(['16:9', '9:16'])
    expect(literalsFromMessage('Field required')).toEqual([])
    expect(literalsFromMessage('Input should be a valid string')).toEqual([])
  })

  it('names the coerced literal for each refused field the body carries, and nothing when nothing can change', () => {
    const entries = [
      { field: 'duration', msg: "Input should be '4', '5' or '6'" },
      { field: 'aspect_ratio', msg: "Input should be '16:9' or '9:16'" },
      { field: 'resolution', msg: "Input should be '480p' or '720p'" },
      { field: 'absent', msg: "Input should be 'a' or 'b'" },
      { field: '', msg: "Input should be 'a' or 'b'" },
      { field: 'seed', msg: 'Input should be a valid integer' },
    ]
    expect(enumRetryValues(entries, { duration: 5, aspect_ratio: 'wide', resolution: '720p', seed: 'x' })).toEqual({ duration: '5' })
    expect(enumRetryValues(entries, { duration: '5', resolution: '720p' })).toBeUndefined()
    expect(enumRetryValues([], { duration: 5 })).toBeUndefined()
  })
})
