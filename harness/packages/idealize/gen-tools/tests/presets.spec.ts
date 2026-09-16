/**
 * The media agent table and the rule a brain confined to generating spaces
 * follows: which composition it gets, what its default persona says, and how a
 * composition is recognised as generation-only.
 */

import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { SPACES } from '@idealize/spaces'
import {
  buildMediaComposition, GENERATION_ONLY_PLUGINS, generatesOnly, isGenerationOnlyComposition, MEDIA_AGENT_IDS, MEDIA_AGENTS,
  mediaAgentsBySpace, mediaCompositionFor, mediaPersona,
} from '../src/presets.ts'

/** A shipped-style composition: persona, shell, filesystem, with a `!!js` row the loader dialect must survive. */
const STANDARD = `
- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    text: You are a coding agent.
- id: tool-bash
  name: '@deepseek-ai/dsh-tool-bash'
  disabled: !!js process.platform === 'win32'
- id: tool-fs
  name: '@deepseek-ai/dsh-tool-fs'
`

function rows(text: string): { name: string; config?: { text?: string } }[] {
  return load(text, { schema: entryListSchema }) as { name: string; config?: { text?: string } }[]
}

function personaOf(text: string): string | undefined {
  return rows(text).find(row => row.name === '@deepseek-ai/dsh-persona')?.config?.text
}

describe('the media agent table', () => {
  it('declares Gallery, Sound Stage and Video in roster order, one per generating space', () => {
    expect(MEDIA_AGENT_IDS).toEqual(['gallery', 'soundstage', 'video'])
    expect(MEDIA_AGENTS.map(agent => [agent.id, agent.space, agent.order])).toEqual([
      ['gallery', 'gallery', -44],
      ['soundstage', 'soundstage', -43],
      ['video', 'motion', -42],
    ])
    const video = MEDIA_AGENTS[2]
    expect(video?.name).toBe('Video')
    expect(video?.description).toBe('Creates video from prompts; every result lands in the project\'s Video grid as an artefact.')
    expect(video?.persona).toBe(
      'You are the IDEalize Video agent powered by the {{model}} model. Your working directory is {{cwd}}. '
      + 'You create video from the user\'s prompts with the generate_video tool; every result is stored as a project artefact and appears in the Video grid. '
      + 'Report each artefact id when you finish, and describe what was generated. '
      + 'Explain engineering plainly and without jargon; your user directs the work and learns from how you narrate it.',
    )
  })

  it('names each agent\'s tool in its duty, and assembles the persona from name and duty', () => {
    for (const agent of MEDIA_AGENTS) {
      expect(agent.duty).toMatch(/generate_(image|audio|video) tool/)
      expect(agent.persona).toBe(mediaPersona(agent.name, [agent.duty]))
      expect(agent.persona.startsWith(`You are the IDEalize ${agent.name} agent powered by the {{model}} model.`)).toBe(true)
    }
  })

  it('agrees with the space table: every generating space names a media agent that names it back', () => {
    const bySpace = mediaAgentsBySpace()
    expect([...bySpace.keys()]).toEqual(['gallery', 'soundstage', 'motion'])
    for (const space of SPACES.filter(row => row.composition === 'media')) {
      expect(bySpace.get(space.id)?.id).toBe(space.agentPreset)
    }
  })
})

describe('mediaCompositionFor', () => {
  it('composes the generation toolset only for a brain in one generating space, with a default persona from its name', () => {
    const text = mediaCompositionFor(['gallery'], 'Retro', '')
    expect(text).toBeDefined()
    expect(rows(text ?? '').map(row => row.name)).toEqual([
      '@deepseek-ai/dsh-persona',
      '@idealize/gen-tools/tools',
      '@deepseek-ai/dsh-tool-jobs',
    ])
    expect(personaOf(text ?? '')).toBe(
      'You are the IDEalize Retro agent powered by the {{model}} model. Your working directory is {{cwd}}. '
      + 'You create still images from the user\'s prompts with the generate_image tool; every result is stored as a project artefact and appears in the gallery. '
      + 'Report each artefact id when you finish, and describe what was generated. '
      + 'Explain engineering plainly and without jargon; your user directs the work and learns from how you narrate it.',
    )
  })

  it('joins the duties of several generating spaces in table order', () => {
    const persona = personaOf(mediaCompositionFor(['motion', 'gallery'], 'Mixed', '') ?? '') ?? ''
    const image = persona.indexOf('generate_image')
    const video = persona.indexOf('generate_video')
    expect(image).toBeGreaterThan(-1)
    expect(video).toBeGreaterThan(image)
    expect(persona).not.toContain('generate_audio')
  })

  it('keeps written instructions as the persona', () => {
    const text = mediaCompositionFor(['soundstage'], 'Foley', 'Only footsteps and doors.')
    expect(personaOf(text ?? '')).toBe('Only footsteps and doors.')
  })

  it('answers undefined for a brain that also works in Chat or Terminal, and for one in no space', () => {
    expect(mediaCompositionFor(['gallery', 'chat'], 'Both', '')).toBeUndefined()
    expect(mediaCompositionFor(['terminal'], 'Shell', '')).toBeUndefined()
    expect(mediaCompositionFor([], 'Role', '')).toBeUndefined()
    expect(generatesOnly(['gallery', 'soundstage', 'motion'])).toBe(true)
    expect(generatesOnly(['gallery', 'chat'])).toBe(false)
  })

  it('renders the same text buildMediaComposition seeds for a media agent', () => {
    for (const agent of MEDIA_AGENTS) {
      expect(mediaCompositionFor([agent.space], agent.name, '')).toBe(buildMediaComposition(agent))
    }
  })
})

describe('isGenerationOnlyComposition', () => {
  it('is true for the seeded Gallery text and for the composition mediaCompositionFor renders', () => {
    expect(isGenerationOnlyComposition(buildMediaComposition(MEDIA_AGENTS[0]!))).toBe(true)
    expect(isGenerationOnlyComposition(mediaCompositionFor(['motion'], 'Clip', 'Short clips.') ?? '')).toBe(true)
  })

  it('accepts the per-project instructions reader beside the toolset', () => {
    expect(GENERATION_ONLY_PLUGINS.has('@deepseek-ai/dsh-agent-instructions')).toBe(true)
    expect(isGenerationOnlyComposition([
      "- name: '@deepseek-ai/dsh-persona'",
      "- name: '@idealize/gen-tools/tools'",
      "- name: '@deepseek-ai/dsh-agent-instructions'",
      '',
    ].join('\n'))).toBe(true)
  })

  it('is false for a standard composition, for one without the tools row, and for text that is not a row list', () => {
    expect(isGenerationOnlyComposition(STANDARD)).toBe(false)
    expect(isGenerationOnlyComposition("- name: '@deepseek-ai/dsh-persona'\n")).toBe(false)
    expect(isGenerationOnlyComposition('name: nope\n')).toBe(false)
    expect(isGenerationOnlyComposition('- name: [unclosed\n')).toBe(false)
    // A list carrying a bare scalar row names no plugin at all.
    expect(isGenerationOnlyComposition('- just a string\n')).toBe(false)
  })
})
