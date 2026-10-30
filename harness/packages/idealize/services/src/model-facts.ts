/**
 * What the model browser filters on beyond price and inputs: the controls a
 * model offers (read from its own settings) and what it is good at (a fixed
 * vocabulary per kind). Good-at labels come from a classification run once
 * before release by `scripts/build-model-facts.mts`, which reads each model's
 * name, description, tags and cover picture; the result ships as
 * `model-facts.data.ts`, so nobody's key pays for it and the browser works
 * offline. Controls ship the same way and, for a model newer than the
 * shipped table, are read from its input schema once that has been fetched.
 * @module @idealize/services/model-facts
 */

import type { GenModelInfo } from '@idealize/generate'
import { MODEL_FACTS_DATA } from './model-facts.data.ts'

/** The four kinds of model the browser lists. */
export type FactKind = 'chat' | 'image' | 'video' | 'audio'

/** One good-at label: its id and the definition the classifier is given. */
export interface GoodAtTerm {
  id: string
  definition: string
}

/**
 * The good-at vocabulary per kind (JJ, 24 Oct 2026: granular enough to choose
 * between models of one kind). The definitions are what the classifier reads;
 * the browser's locale names each id.
 */
export const GOOD_AT_TERMS: Readonly<Record<FactKind, readonly GoodAtTerm[]>> = {
  image: [
    { id: 'photoreal', definition: 'photographs that pass as real: lighting, skin, materials' },
    { id: 'illustration', definition: 'drawn or painted looks: illustration, concept art, painting, sketch' },
    { id: 'anime', definition: 'anime, manga or cartoon styles' },
    { id: 'render3d', definition: '3D renders, CGI, isometric or clay looks' },
    { id: 'graphic', definition: 'flat graphics: logos, icons, vector art, posters, patterns' },
    { id: 'lettering', definition: 'legible text inside the picture: typography, signs, packaging copy' },
    { id: 'product', definition: 'product shots, packshots, e-commerce and fashion try-on' },
    { id: 'portrait', definition: 'people: portraits, faces, consistent characters, headshots' },
    { id: 'editing', definition: 'changing an existing picture by instruction: add, remove, replace, restyle, relight, extend' },
    { id: 'upscale', definition: 'enlarging, sharpening or restoring a picture' },
    { id: 'cutout', definition: 'removing or replacing the background' },
    { id: 'utility', definition: 'technical helpers that do not make finished pictures: depth, masks, segmentation, detection, captioning, format conversion' },
  ],
  video: [
    { id: 'realistic', definition: 'live-action footage that passes as filmed: cinematic, documentary, natural motion' },
    { id: 'animation', definition: 'animated or stylised video: cartoon, anime, 3D animation, painterly' },
    { id: 'talking', definition: 'people speaking to camera: avatars, talking heads, lip-sync to audio' },
    { id: 'product', definition: 'product and advertising shots' },
    { id: 'effects', definition: 'effects and transformations: VFX, morphs, transitions, templates' },
    { id: 'sound', definition: 'generates synchronised sound or speech with the video' },
    { id: 'editing', definition: 'changing an existing video: restyle, replace, extend, retime' },
    { id: 'upscale', definition: 'enlarging, smoothing or restoring video' },
  ],
  audio: [
    { id: 'music', definition: 'music tracks and instrumentals' },
    { id: 'vocals', definition: 'songs with sung vocals and lyrics' },
    { id: 'sfx', definition: 'sound effects, foley and ambience' },
    { id: 'speech', definition: 'reading text aloud: voiceover, narration, text to speech' },
    { id: 'cloning', definition: 'copying a voice from a short sample' },
    { id: 'dialogue', definition: 'conversations between several voices: podcasts, dialogue' },
    { id: 'audioEdit', definition: 'changing existing audio: separating stems, cleaning, extending, converting' },
  ],
  chat: [
    { id: 'coding', definition: 'writing, reviewing and fixing code; agentic coding' },
    { id: 'writing', definition: 'prose, copy, editing and tone of voice' },
    { id: 'reasoning', definition: 'hard reasoning, maths, science and planning' },
    { id: 'research', definition: 'reading long documents and research across many sources' },
    { id: 'agents', definition: 'reliable tool use over many steps' },
    { id: 'quick', definition: 'fast, cheap replies for simple tasks' },
    { id: 'translation', definition: 'many languages and translation' },
  ],
}

/** One control a model may offer, and the input names (or chat parameters) that mean it. */
interface ControlRule {
  id: string
  /** Input property names that mean this control, matched whole. */
  inputs: RegExp
  /** When given, the property must also accept one of these literals. */
  literal?: RegExp
}

/**
 * The controls vocabulary per kind, matched against a model's input property
 * names. The names are fal's as of 24 Oct 2026 (every input of the image,
 * video and audio catalogues, read in bulk); chat matches OpenRouter's
 * `supported_parameters`.
 */
const CONTROL_RULES: Readonly<Record<FactKind, readonly ControlRule[]>> = {
  image: [
    { id: 'shape', inputs: /^(aspect_ratio|image_size|size|width|height|resolution)$/ },
    { id: 'seed', inputs: /^seed$/ },
    { id: 'exclude', inputs: /^negative_prompt$/ },
    { id: 'reference', inputs: /^(reference_image_urls?|image_style_references?|style_reference(_image)?_urls?|style_image_urls?|ip_adapter.*|subject_image_urls?|reference_images?|moodboards?|elements)$/ },
    { id: 'lora', inputs: /^(loras|lora_url|lora_path|lora_weights|lora_scale)$/ },
    { id: 'presets', inputs: /^(style|styles|style_id|style_name|style_preset|style_type)$/ },
    { id: 'colours', inputs: /^(colors|colours|color_palette|colour_palette)$/ },
    { id: 'transparent', inputs: /^(background|transparent_background|output_transparent|transparency)$/, literal: /transparent|^true$/i },
    { id: 'area', inputs: /^(mask_image_url|mask_url|mask)$/ },
    { id: 'strength', inputs: /^(strength|image_strength|creativity)$/ },
    { id: 'fine', inputs: /^(num_inference_steps|guidance_scale|cfg_scale|scheduler)$/ },
  ],
  video: [
    { id: 'length', inputs: /^(duration|num_frames|video_length|seconds)$/ },
    { id: 'shape', inputs: /^(aspect_ratio|resolution|video_size|width|height|size)$/ },
    { id: 'seed', inputs: /^seed$/ },
    { id: 'exclude', inputs: /^negative_prompt$/ },
    { id: 'lastFrame', inputs: /^(end_image_url|tail_image_url|last_frame_image_url|last_image_url|end_frame_url|final_image_url|last_frame_url)$/ },
    { id: 'reference', inputs: /^(reference_image_urls?|reference_images?|elements|subject_reference_image_url|reference_video_urls?|image_urls|ref_image_urls)$/ },
    { id: 'camera', inputs: /^(camera_fixed|camera_control|camera_movement|camera_motion|camera_lora|movement_amplitude|motion_bucket_id)$/ },
    { id: 'sound', inputs: /^(generate_audio|enable_audio|with_audio|audio|generate_sound)$/ },
    { id: 'lora', inputs: /^(loras|lora_url|lora_path|lora_weights|lora_scale)$/ },
    { id: 'fine', inputs: /^(num_inference_steps|guidance_scale|cfg_scale)$/ },
  ],
  audio: [
    { id: 'length', inputs: /^(duration|seconds_total|duration_seconds|length|music_length_ms|duration_ms|total_seconds)$/ },
    { id: 'voice', inputs: /^(voice|voice_id|speaker|speaker_id|voice_name|voices)$/ },
    { id: 'cloning', inputs: /^(reference_audio_urls?|voice_sample_url|ref_audio_url|audio_prompt_url|speaker_audio_url|reference_audio|voice_url|source_audio_url)$/ },
    { id: 'lyrics', inputs: /^(lyrics|lyrics_prompt)$/ },
    { id: 'instrumental', inputs: /^(instrumental|make_instrumental|force_instrumental|is_instrumental)$/ },
    { id: 'language', inputs: /^(language|language_code|language_boost|lang)$/ },
    { id: 'speed', inputs: /^(speed|rate|speaking_rate)$/ },
    { id: 'seed', inputs: /^seed$/ },
  ],
  chat: [
    { id: 'tools', inputs: /^(tools|tool_choice)$/ },
    { id: 'thinking', inputs: /^(reasoning|include_reasoning|reasoning_effort)$/ },
    { id: 'json', inputs: /^(structured_outputs|response_format)$/ },
    { id: 'web', inputs: /^web_search_options$/ },
    { id: 'temperature', inputs: /^temperature$/ },
    { id: 'seed', inputs: /^seed$/ },
  ],
}

/** The control ids per kind, in the order the browser shows them. */
export const CONTROL_IDS: Readonly<Record<FactKind, readonly string[]>> = {
  image: CONTROL_RULES.image.map(rule => rule.id),
  video: CONTROL_RULES.video.map(rule => rule.id),
  audio: CONTROL_RULES.audio.map(rule => rule.id),
  chat: CONTROL_RULES.chat.map(rule => rule.id),
}

/** One input as far as control matching reads it. */
export interface ControlInput {
  name: string
  enum?: readonly string[]
  type?: string
}

/**
 * The controls a model offers, from its input properties (or a chat model's
 * supported parameters), in the kind's order.
 * @param kind - what the model makes.
 * @param inputs - the model's input properties.
 * @returns control ids.
 */
export function controlsFromInputs(kind: FactKind, inputs: readonly ControlInput[]): string[] {
  return CONTROL_RULES[kind]
    .filter(rule => inputs.some(input => rule.inputs.test(input.name) && (rule.literal === undefined
      || input.type === 'boolean'
      || (input.enum ?? []).some(literal => rule.literal?.test(literal) === true))))
    .map(rule => rule.id)
}

/**
 * The key a chat model's facts are filed under, so one model reached through
 * different routes (OpenRouter's `anthropic/claude-sonnet-4.5`, the
 * subscription's `claude-sonnet-4-5-20250929`) finds one entry: the last path
 * segment, lower-cased, without a variant suffix, a date or `-latest`, dots as
 * dashes.
 * @param id - the route's model id.
 * @returns the key.
 */
export function chatFactKey(id: string): string {
  const last = id.toLowerCase().split('/').at(-1) ?? ''
  return last
    .replace(/:.*$/, '')
    .replace(/\./g, '-')
    .replace(/-(\d{8}|\d{4}-\d{2}-\d{2}|latest)$/, '')
}

/** What the browser knows of one model beyond its catalogue row. */
export interface ModelFacts {
  controls?: readonly string[]
  goodAt?: readonly string[]
}

/** One shipped entry: `c` the controls, `g` the good-at labels. */
export interface ShippedFact {
  c?: readonly string[]
  g?: readonly string[]
}

/** The shipped table's shape. */
export interface ShippedFacts {
  generatedAt: string
  media: Readonly<Record<string, ShippedFact>>
  chat: Readonly<Record<string, ShippedFact>>
}

/** The facts as a row carries them, absent fields left out. */
function factsOf(entry: ShippedFact | undefined): ModelFacts {
  return {
    ...entry?.c === undefined ? {} : { controls: entry.c },
    ...entry?.g === undefined ? {} : { goodAt: entry.g },
  }
}

/**
 * The shipped facts for one media model.
 * @param id - the endpoint id.
 * @param table - the table to read; defaults to the shipped one.
 * @returns its controls and good-at labels, each absent when unknown.
 */
export function mediaFacts(id: string, table: ShippedFacts = MODEL_FACTS_DATA): ModelFacts {
  return factsOf(table.media[id])
}

/**
 * The shipped facts for one chat model, by {@link chatFactKey}.
 * @param id - the route's model id.
 * @param table - the table to read; defaults to the shipped one.
 * @returns its controls and good-at labels, each absent when unknown.
 */
export function chatFacts(id: string, table: ShippedFacts = MODEL_FACTS_DATA): ModelFacts {
  return factsOf(table.chat[chatFactKey(id)])
}

/** The kinds of media model the shipped table covers. */
const MEDIA_KINDS: ReadonlySet<string> = new Set(['image', 'video', 'audio'])

/**
 * Media models with their shipped facts attached. A model newer than the
 * shipped table gets its controls from its input schema when one has been
 * read, and no good-at labels, so the browser falls back to its tags.
 * @param models - the catalogue as the adapter holds it.
 * @param inputsOf - the input properties already known for one model, if any.
 * @param table - the table to read; defaults to the shipped one.
 * @returns new rows; the input is not changed.
 */
export function withModelFacts(
  models: readonly GenModelInfo[],
  inputsOf?: (id: string) => readonly ControlInput[] | undefined,
  table: ShippedFacts = MODEL_FACTS_DATA,
): GenModelInfo[] {
  return models.map((model) => {
    if (!MEDIA_KINDS.has(model.artefact)) return model
    const facts = mediaFacts(model.id, table)
    const inputs = facts.controls === undefined ? inputsOf?.(model.id) : undefined
    const controls = facts.controls ?? (inputs === undefined ? undefined : controlsFromInputs(model.artefact, inputs))
    return {
      ...model,
      ...controls === undefined ? {} : { controls },
      ...facts.goodAt === undefined ? {} : { goodAt: facts.goodAt },
    }
  })
}
