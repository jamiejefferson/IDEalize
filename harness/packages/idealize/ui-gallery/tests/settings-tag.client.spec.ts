/**
 * The composer settings tag: what the strip writes into the draft, what it
 * reads back, and what it refuses to touch, over the Images, Video and Sound
 * Stage vocabularies and over a schema the route published.
 */

import { describe, expect, it } from 'vitest'
import type { GenerationStrip } from '../src/client/contract.ts'
import { FALLBACK_FIELDS } from '../src/client/GenerationSettings.tsx'
import {
  applySettingsTag, DEFAULT_SELECTION, defaultOf, formatSettingsTag, GALLERY_COUNTS, partName, readSettingsTag, valueOf,
} from '../src/client/settings-tag.ts'

const images: GenerationStrip = { fields: FALLBACK_FIELDS.gallery, counts: GALLERY_COUNTS }
const video: GenerationStrip = { fields: FALLBACK_FIELDS.motion }
const sound: GenerationStrip = { fields: FALLBACK_FIELDS.soundstage }
/** A video model's schema as the route would publish it. */
const seedance: GenerationStrip = {
  fields: [
    { name: 'duration', label: 'Duration', kind: 'enum', values: ['5', '10'] },
    { name: 'resolution', label: 'Resolution', kind: 'enum', values: ['480p', '720p', '1080p'], default: '1080p' },
    { name: 'aspect_ratio', label: 'Aspect', kind: 'enum', values: ['16:9', '9:16', '1:1'], default: '16:9' },
    { name: 'camera_fixed', label: 'Camera fixed', kind: 'boolean', default: false },
    { name: 'generate_audio', label: 'Generate audio', kind: 'boolean', default: true },
  ],
}
/** A music model's schema: a bounded number with a default, and one without. */
const music: GenerationStrip = {
  fields: [
    { name: 'duration', label: 'Duration', kind: 'number', integer: false, min: 1, max: 300, default: 60 },
    { name: 'takes', label: 'Takes', kind: 'number', integer: true },
  ],
}

describe('partName', () => {
  it('spells aspect_ratio as aspect and every other field as itself', () => {
    expect(partName('aspect_ratio')).toBe('aspect')
    expect(partName('duration')).toBe('duration')
    expect(partName('resolution')).toBe('resolution')
  })
})

describe('formatSettingsTag', () => {
  it('writes nothing while every control sits at its default', () => {
    expect(formatSettingsTag(DEFAULT_SELECTION, images)).toBe('')
    expect(formatSettingsTag({ values: { aspect_ratio: 'auto' }, count: 1 }, images)).toBe('')
    expect(formatSettingsTag({ values: { resolution: '1080p', aspect_ratio: '16:9' }, count: 1 }, seedance)).toBe('')
    expect(formatSettingsTag({ values: { camera_fixed: 'false', generate_audio: 'true' }, count: 1 }, seedance)).toBe('')
    expect(formatSettingsTag({ values: { duration: '60', takes: '' }, count: 1 }, music)).toBe('')
  })

  it('writes a switch as true or false and a number as its text', () => {
    expect(formatSettingsTag({ values: { camera_fixed: 'true', generate_audio: 'false' }, count: 1 }, seedance)).toBe('[camera_fixed true, generate_audio false]')
    expect(formatSettingsTag({ values: { duration: '45', takes: '2' }, count: 1 }, music)).toBe('[duration 45, takes 2]')
  })

  it('names only the controls the user changed, in strip order with the count last', () => {
    expect(formatSettingsTag({ values: { aspect_ratio: '16:9' }, count: 1 }, images)).toBe('[aspect 16:9]')
    expect(formatSettingsTag({ values: {}, count: 3 }, images)).toBe('[3 images]')
    expect(formatSettingsTag({ values: { aspect_ratio: '4:3' }, count: 2 }, images)).toBe('[aspect 4:3, 2 images]')
    expect(formatSettingsTag({ values: { aspect_ratio: '9:16', duration: '8' }, count: 1 }, video)).toBe('[duration 8, aspect 9:16]')
    expect(formatSettingsTag({ values: { duration: '15' }, count: 1 }, sound)).toBe('[duration 15]')
    expect(formatSettingsTag({ values: { duration: '5', resolution: '720p' }, count: 1 }, seedance)).toBe('[duration 5, resolution 720p]')
  })

  it('writes no count on a strip without a count control, and drops a value for a field the strip no longer has', () => {
    expect(formatSettingsTag({ values: { duration: '8' }, count: 3 }, video)).toBe('[duration 8]')
    expect(formatSettingsTag({ values: { resolution: '720p' }, count: 1 }, video)).toBe('')
  })
})

describe('readSettingsTag', () => {
  it('reads back what it wrote and separates the tag from the message', () => {
    expect(readSettingsTag('a paper boat [aspect 16:9, 2 images]', images))
      .toEqual({ selection: { values: { aspect_ratio: '16:9' }, count: 2 }, body: 'a paper boat' })
    expect(readSettingsTag('a slow pan [duration 5, resolution 720p]', seedance))
      .toEqual({ selection: { values: { duration: '5', resolution: '720p' }, count: 1 }, body: 'a slow pan' })
    expect(readSettingsTag('rain [duration 30]', sound))
      .toEqual({ selection: { values: { duration: '30' }, count: 1 }, body: 'rain' })
  })

  it('round-trips every vocabulary', () => {
    for (const [strip, selection] of [
      [images, { values: { aspect_ratio: '3:2' }, count: 4 }],
      [video, { values: { duration: '10', aspect_ratio: '1:1' }, count: 1 }],
      [sound, { values: { duration: '5' }, count: 1 }],
      [seedance, { values: { duration: '10', resolution: '480p', aspect_ratio: '9:16', camera_fixed: 'true' }, count: 1 }],
      [music, { values: { duration: '45', takes: '3' }, count: 1 }],
    ] as const) {
      const draft = applySettingsTag('the prompt', selection, strip)
      expect(readSettingsTag(draft, strip)).toEqual({ selection, body: 'the prompt' })
    }
  })

  it('reports the defaults for a draft carrying no tag', () => {
    expect(readSettingsTag('a paper boat', images)).toEqual({ selection: DEFAULT_SELECTION, body: 'a paper boat' })
  })

  it('leaves the user\'s own trailing brackets alone', () => {
    const draft = 'render the diagram [see the brief]'
    expect(readSettingsTag(draft, images)).toEqual({ selection: DEFAULT_SELECTION, body: draft })
    const mixed = 'a boat [aspect 16:9, and a duck]'
    expect(readSettingsTag(mixed, images)).toEqual({ selection: DEFAULT_SELECTION, body: mixed })
  })

  it('treats a part the current strip does not know as the user\'s text', () => {
    // A count on a video composer, a resolution on the fallback Video strip.
    const counted = 'a slow pan [duration 8, 3 images]'
    expect(readSettingsTag(counted, video)).toEqual({ selection: DEFAULT_SELECTION, body: counted })
    const foreign = 'a slow pan [resolution 720p]'
    expect(readSettingsTag(foreign, video)).toEqual({ selection: DEFAULT_SELECTION, body: foreign })
  })
})

describe('defaultOf', () => {
  it('spells the default as the tag writes it, whatever its type', () => {
    expect(defaultOf(seedance.fields[1]!)).toBe('1080p')
    expect(defaultOf(seedance.fields[3]!)).toBe('false')
    expect(defaultOf(music.fields[0]!)).toBe('60')
    expect(defaultOf(seedance.fields[0]!)).toBeUndefined()
    expect(defaultOf(music.fields[1]!)).toBeUndefined()
  })
})

describe('valueOf', () => {
  it('shows the chosen value, else the default, else unset', () => {
    const duration = seedance.fields[0]!
    const resolution = seedance.fields[1]!
    expect(valueOf(duration, DEFAULT_SELECTION)).toBe('')
    expect(valueOf(resolution, DEFAULT_SELECTION)).toBe('1080p')
    expect(valueOf(resolution, { values: { resolution: '480p' }, count: 1 })).toBe('480p')
  })
})

describe('applySettingsTag', () => {
  it('appends one tag to a plain draft', () => {
    expect(applySettingsTag('a paper boat', { values: { aspect_ratio: '16:9' }, count: 1 }, images)).toBe('a paper boat [aspect 16:9]')
  })

  it('replaces the existing tag instead of stacking a second one', () => {
    const once = applySettingsTag('a paper boat', { values: { aspect_ratio: '16:9' }, count: 1 }, images)
    const twice = applySettingsTag(once, { values: { aspect_ratio: '1:1' }, count: 4 }, images)
    expect(twice).toBe('a paper boat [aspect 1:1, 4 images]')
  })

  it('removes the tag when every control returns to its default', () => {
    const tagged = applySettingsTag('a paper boat', { values: { aspect_ratio: '9:16' }, count: 2 }, images)
    expect(applySettingsTag(tagged, { values: { aspect_ratio: 'auto' }, count: 1 }, images)).toBe('a paper boat')
  })

  it('leaves an untyped message empty when the choice is cleared', () => {
    const tagged = applySettingsTag('', { values: { aspect_ratio: '3:2' }, count: 1 }, images)
    expect(tagged).toBe('[aspect 3:2]')
    expect(applySettingsTag(tagged, DEFAULT_SELECTION, images)).toBe('')
  })
})
