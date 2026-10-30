import { describe, expect, it } from 'vitest'
import type { GenModelInfo } from '@idealize/generate'
import { chatFactKey, chatFacts, controlsFromInputs, mediaFacts, withModelFacts } from '../src/model-facts.ts'
import type { ShippedFacts } from '../src/model-facts.ts'

const TABLE: ShippedFacts = {
  generatedAt: '2026-10-24',
  media: {
    'fal-ai/flux/dev': { c: ['shape', 'seed', 'lora'], g: ['photoreal'] },
    'fal-ai/unlabelled': { c: ['seed'] },
  },
  chat: { 'claude-sonnet-5-5': { c: ['tools', 'thinking'], g: ['coding', 'writing'] } },
}

const model = (id: string, artefact: GenModelInfo['artefact'] = 'image'): GenModelInfo =>
  ({ id, name: id, artefact, inputModalities: ['text'], outputMediaTypes: [] })

describe('model facts', () => {
  it('reads controls from input names, in the kind\'s order', () => {
    expect(controlsFromInputs('image', [
      { name: 'loras' }, { name: 'prompt' }, { name: 'seed' }, { name: 'image_size' }, { name: 'negative_prompt' },
    ])).toEqual(['shape', 'seed', 'exclude', 'lora'])
    expect(controlsFromInputs('video', [{ name: 'tail_image_url' }, { name: 'generate_audio', type: 'boolean' }, { name: 'duration' }]))
      .toEqual(['length', 'lastFrame', 'sound'])
    expect(controlsFromInputs('chat', [{ name: 'tools' }, { name: 'reasoning' }, { name: 'response_format' }]))
      .toEqual(['tools', 'thinking', 'json'])
  })

  it('counts a transparent background only when the input offers one', () => {
    expect(controlsFromInputs('image', [{ name: 'background', enum: ['auto', 'transparent', 'opaque'] }])).toEqual(['transparent'])
    expect(controlsFromInputs('image', [{ name: 'background', type: 'string' }])).toEqual([])
  })

  it('files one chat model under one key whatever route names it', () => {
    expect(chatFactKey('anthropic/claude-sonnet-5.5')).toBe('claude-sonnet-5-5')
    expect(chatFactKey('anthropic/claude-sonnet-5.5:batch')).toBe('claude-sonnet-5-5')
    expect(chatFactKey('claude-sonnet-5-5-20260101')).toBe('claude-sonnet-5-5')
    expect(chatFactKey('gpt-5.5-latest')).toBe('gpt-5-5')
    expect(chatFacts('claude-sonnet-5-5-20260101', TABLE)).toEqual({ controls: ['tools', 'thinking'], goodAt: ['coding', 'writing'] })
    expect(chatFacts('unknown/model', TABLE)).toEqual({})
    expect(mediaFacts('fal-ai/unlabelled', TABLE)).toEqual({ controls: ['seed'] })
  })

  it('attaches shipped facts, falls back to a known schema for controls, and leaves other kinds alone', () => {
    const [labelled, newer, unknown, text] = withModelFacts(
      [model('fal-ai/flux/dev'), model('fal-ai/newer', 'video'), model('fal-ai/unknown'), model('x/text', 'text' as GenModelInfo['artefact'])],
      id => (id === 'fal-ai/newer' ? [{ name: 'duration' }, { name: 'seed' }] : undefined),
      TABLE,
    )
    expect(labelled).toMatchObject({ controls: ['shape', 'seed', 'lora'], goodAt: ['photoreal'] })
    expect(newer).toMatchObject({ controls: ['length', 'seed'] })
    expect(newer?.goodAt).toBeUndefined()
    expect(unknown?.controls).toBeUndefined()
    expect(text).not.toHaveProperty('controls')
  })
})
