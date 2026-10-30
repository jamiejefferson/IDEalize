/**
 * The model browser's data, pure: every kind of model (chat, image, video,
 * sound) folded into one row shape, the curated "Good at" vocabulary per
 * kind, who makes each model, its headline price per output, and the
 * search, filters and sort the browser applies. The component
 * (ModelBrowser.tsx) only renders what these functions return.
 * @module @idealize/ui-bar/client/model-browser
 */

import type { BarKey } from './locales.ts'

/** The pane's translate function, which every label passes through. */
export type Translate = (key: BarKey, params?: Record<string, string | number>) => string

/** What a browser chooses: a chat model, or one generating space's model. */
export type BrowserKind = 'chat' | 'image' | 'video' | 'audio'

/** What a model reads. */
export type Takes = 'text' | 'image' | 'file' | 'audio' | 'video'

/** The display order of {@link Takes}. */
export const TAKES_ORDER: readonly Takes[] = ['text', 'image', 'file', 'audio', 'video']

/** How the browser orders the list. */
export type BrowserSort = 'cheapest' | 'newest' | 'name' | 'rated'

/** One fact line of the detail pane: a label and its value, the value in the code font when it is a figure. */
export interface FactLine {
  label: string
  value: string
  figure?: boolean
}

/** A model's price as the list and the detail pane state it. */
export interface BrowserPrice {
  /** The headline figure, formatted with its currency; absent when no price is known. */
  headline?: string
  /** The line under the headline. */
  sub?: string
  /** True when the headline is the per-output figure the column names; false prices sort last. */
  comparable: boolean
  /** The comparable figure, for sorting. */
  sortValue?: number
  /** The raw price lines for the facts table. */
  lines: FactLine[]
  /** Who published the price. */
  from?: string
}

/** One model as the browser lists it. */
export interface BrowserModel {
  /** The value the sheet stores: `provider model`. */
  value: string
  /** The backend (media) or route (chat) id. */
  provider: string
  id: string
  name: string
  maker?: string
  /** The route a chat model is served through, when it is not the maker's own name. */
  route?: string
  takes: Takes[]
  makes: BrowserKind
  /** `YYYY-MM-DD`, when known. */
  released?: string
  description?: string
  thumbnailUrl?: string
  licence?: string
  /** Curated "Good at" labels this model carries, as locale keys in the kind's order. */
  goodAt: BarKey[]
  /** The controls this model offers, as locale keys in the kind's order. */
  controls: BarKey[]
  contextWindow?: number
  price: BrowserPrice
  /** A media model whose example output the browser may fetch on selection. */
  hasExample: boolean
}

/** The media price as `GET /idealize/brains/media` states it on a candidate. */
export interface MediaPrice {
  unitPrice: number
  unit: string
  currency: string
  perOutput?: { amount: number; output: string }
}

/** One media candidate as `GET /idealize/brains/media` lists it. */
export interface MediaCandidateModel {
  id: string
  name: string
  artefact?: string
  inputModalities?: string[]
  requiredInputs?: string[]
  description?: string
  thumbnailUrl?: string
  thumbnailAnimatedUrl?: string
  tags?: string[]
  licence?: string
  released?: string
  maker?: string
  price?: MediaPrice
  /** The controls it offers, as model-facts ids. */
  controls?: string[]
  /** What it is good at, as model-facts ids; absent when it was never labelled. */
  goodAt?: string[]
}

/** One chat model as `GET /idealize/models/details` lists it. */
export interface ChatModelDetail {
  id: string
  name: string
  description?: string
  released?: string
  contextWindow?: number
  inputModalities?: string[]
  tools?: boolean
  reasoning?: boolean
  price?: { input: number; output: number; source: 'user' | 'market' | 'catalogue' }
  /** The controls it offers, as model-facts ids. */
  controls?: string[]
  /** What it is good at, as model-facts ids; absent when it was never labelled. */
  goodAt?: string[]
}

/** One "Good at" label and the provider tags (or chat abilities) that earn it when no label was shipped. */
interface GoodAtRule {
  label: BarKey
  tags: readonly string[]
}

/**
 * The "Good at" vocabulary per kind, in the order the chips show (JJ, 24 Oct
 * 2026: granular enough to choose between models of one kind). It matches
 * `GOOD_AT_TERMS` in `@idealize/services`, whose shipped labels a row
 * normally carries; the tags here only label a model newer than that table.
 * Chat abilities are named as pseudo-tags (`tools`, `reasoning`, `long-context`).
 */
export const GOOD_AT: Readonly<Record<BrowserKind, readonly GoodAtRule[]>> = {
  image: [
    { label: 'browser.goodAt.photoreal', tags: ['realism', 'photorealism', 'photography', 'photorealistic'] },
    { label: 'browser.goodAt.illustration', tags: ['illustration', 'artistic', 'painting', 'sketch'] },
    { label: 'browser.goodAt.anime', tags: ['anime', 'cartoon', 'manga'] },
    { label: 'browser.goodAt.render3d', tags: ['3d', 'render', 'cgi', 'isometric'] },
    { label: 'browser.goodAt.graphic', tags: ['vector', 'svg', 'vector art', 'text-to-vector', 'logo', 'icon'] },
    { label: 'browser.goodAt.lettering', tags: ['typography', 'text rendering', 'typograph', 'high-quality-text'] },
    { label: 'browser.goodAt.product', tags: ['product photography', 'e-commerce', 'try-on', 'fashion'] },
    { label: 'browser.goodAt.portrait', tags: ['portrait', 'character-consistency', 'personalization', 'face'] },
    { label: 'browser.goodAt.editing', tags: ['editing', 'image-editing', 'image editing', 'edit', 'inpainting', 'outpainting', 'relighting'] },
    { label: 'browser.goodAt.upscale', tags: ['upscaling', 'upscale', 'image-restoration', 'super-resolution'] },
    { label: 'browser.goodAt.cutout', tags: ['background removal', 'background-removal'] },
    { label: 'browser.goodAt.utility', tags: ['utility', 'segmentation', 'depth', 'detection', 'preprocess', 'mask'] },
  ],
  video: [
    { label: 'browser.goodAt.realistic', tags: ['cinematic', 'realism', 'film'] },
    { label: 'browser.goodAt.animation', tags: ['animation', 'stylized', 'stylised', 'anime'] },
    { label: 'browser.goodAt.talking', tags: ['lipsync', 'lip-sync', 'lip sync', 'avatar', 'talking-head', 'talking-avatar'] },
    { label: 'browser.goodAt.product', tags: ['product', 'e-commerce', 'ads'] },
    { label: 'browser.goodAt.effects', tags: ['effects', 'vfx', 'transition', 'transformation'] },
    { label: 'browser.goodAt.sound', tags: ['audio'] },
    { label: 'browser.goodAt.editing', tags: ['video-edit', 'editing', 'v2v'] },
    { label: 'browser.goodAt.upscale', tags: ['upscaling', 'upscale', 'interpolation'] },
  ],
  audio: [
    { label: 'browser.goodAt.music', tags: ['music', 'text-to-music', 'instrumental', 'music generation'] },
    { label: 'browser.goodAt.vocals', tags: ['song', 'songs', 'vocals', 'song generation'] },
    { label: 'browser.goodAt.sfx', tags: ['sfx', 'sound', 'sound-effects', 'sound effects', 'ambience'] },
    { label: 'browser.goodAt.speech', tags: ['tts', 'speech', 'text-to-speech', 'text to speech', 'voice'] },
    { label: 'browser.goodAt.cloning', tags: ['voice cloning', 'voice-cloning'] },
    { label: 'browser.goodAt.dialogue', tags: ['dialogue', 'podcast', 'conversational'] },
    { label: 'browser.goodAt.audioEdit', tags: ['stem separation', 'audio editing', 'enhancement'] },
  ],
  chat: [
    { label: 'browser.goodAt.coding', tags: [] },
    { label: 'browser.goodAt.writing', tags: [] },
    { label: 'browser.goodAt.reasoning', tags: ['reasoning'] },
    { label: 'browser.goodAt.research', tags: ['long-context'] },
    { label: 'browser.goodAt.agents', tags: ['tools'] },
    { label: 'browser.goodAt.quick', tags: [] },
    { label: 'browser.goodAt.translation', tags: [] },
  ],
}

/**
 * The controls vocabulary per kind, in the order the chips show. It matches
 * `CONTROL_IDS` in `@idealize/services`, which reads each model's own settings.
 */
export const CONTROLS: Readonly<Record<BrowserKind, readonly BarKey[]>> = {
  image: [
    'browser.control.shape', 'browser.control.seed', 'browser.control.exclude', 'browser.control.reference',
    'browser.control.lora', 'browser.control.presets', 'browser.control.colours', 'browser.control.transparent',
    'browser.control.area', 'browser.control.strength', 'browser.control.fine',
  ],
  video: [
    'browser.control.length', 'browser.control.shape', 'browser.control.seed', 'browser.control.exclude',
    'browser.control.lastFrame', 'browser.control.reference', 'browser.control.camera', 'browser.control.sound',
    'browser.control.lora', 'browser.control.fine',
  ],
  audio: [
    'browser.control.length', 'browser.control.voice', 'browser.control.cloning', 'browser.control.lyrics',
    'browser.control.instrumental', 'browser.control.language', 'browser.control.speed', 'browser.control.seed',
  ],
  chat: [
    'browser.control.tools', 'browser.control.thinking', 'browser.control.json', 'browser.control.web',
    'browser.control.temperature', 'browser.control.seed',
  ],
}

/**
 * Model-facts ids as this kind's locale keys, in the kind's order, unknown ids dropped.
 * @param vocabulary - the kind's keys in display order.
 * @param prefix - the keys' shared prefix.
 * @param ids - the ids a row carries.
 */
function keysOf(vocabulary: readonly BarKey[], prefix: string, ids: readonly string[]): BarKey[] {
  return vocabulary.filter(key => ids.includes(key.slice(prefix.length)))
}

/** The context window from which a chat model counts as good at long documents. */
export const LONG_CONTEXT = 1_000_000

/**
 * Who makes a model, by the maker segment of its endpoint or the start of its
 * id. fal names most endpoints after the model family ("kling-video",
 * "nano-banana-2"), so the families in its live catalogue map to their
 * makers here (the 60 most frequent segments of 1,097 models on 23 Oct 2026,
 * plus chat makers). A prefix matches a whole segment or one followed by a
 * version ("veo3.1", "kandinsky5"), never the start of another word.
 */
const MAKERS: readonly [string, string][] = [
  // Google
  ['nano-banana', 'Google'], ['imagen', 'Google'], ['veo', 'Google'], ['lyria', 'Google'], ['gemini', 'Google'], ['google', 'Google'],
  // Black Forest Labs
  ['flux', 'Black Forest Labs'], ['blackforestlabs', 'Black Forest Labs'], ['black-forest-labs', 'Black Forest Labs'],
  // Kuaishou
  ['kling', 'Kuaishou'], ['kolors', 'Kuaishou'], ['live-portrait', 'Kuaishou'],
  // ByteDance
  ['bytedance', 'ByteDance'], ['seedream', 'ByteDance'], ['seedance', 'ByteDance'], ['seedvr', 'ByteDance'], ['bagel', 'ByteDance'],
  // Alibaba
  ['wan', 'Alibaba'], ['qwen', 'Alibaba'], ['alibaba', 'Alibaba'], ['z-image', 'Alibaba'],
  // OpenAI
  ['openai', 'OpenAI'], ['sora', 'OpenAI'], ['gpt-image', 'OpenAI'], ['gpt', 'OpenAI'],
  // Stability AI
  ['stable-audio', 'Stability AI'], ['stable-diffusion', 'Stability AI'], ['stable-cascade', 'Stability AI'],
  ['stable-video', 'Stability AI'], ['stability', 'Stability AI'],
  // Lightricks
  ['ltx', 'Lightricks'], ['ltxv', 'Lightricks'], ['lightricks', 'Lightricks'],
  // Tencent, Meta, NVIDIA, Microsoft
  ['hunyuan', 'Tencent'], ['meta', 'Meta'], ['sam', 'Meta'], ['nvidia', 'NVIDIA'], ['sana', 'NVIDIA'], ['cosmos', 'NVIDIA'],
  ['microsoft', 'Microsoft'], ['florence', 'Microsoft'],
  // One-name makers
  ['minimax', 'MiniMax'], ['hailuo', 'MiniMax'], ['bria', 'Bria'], ['ideogram', 'Ideogram'], ['pixverse', 'PixVerse'],
  ['vidu', 'Vidu'], ['recraft', 'Recraft'], ['xai', 'xAI'], ['x-ai', 'xAI'], ['grok', 'xAI'], ['heygen', 'HeyGen'],
  ['kokoro', 'Kokoro'], ['topaz', 'Topaz Labs'], ['rundiffusion', 'RunDiffusion'], ['elevenlabs', 'ElevenLabs'],
  ['luma', 'Luma AI'], ['krea', 'Krea'], ['longcat', 'Meituan'], ['hidream', 'HiDream'], ['ernie', 'Baidu'],
  ['veed', 'VEED'], ['kandinsky', 'Sber AI'], ['mureka', 'Mureka'], ['playground', 'Playground'], ['moonvalley', 'Moonvalley'],
  ['cassetteai', 'CassetteAI'], ['decart', 'Decart'], ['glm', 'Z.ai'], ['z-ai', 'Z.ai'], ['magi', 'Sand AI'],
  ['ace-step', 'ACE Studio'], ['creatify', 'Creatify'], ['argil', 'Argil'], ['zonos', 'Zyphra'], ['fooocus', 'Fooocus'],
  ['patina', 'Patina'], ['phota', 'Phota'], ['sonilo', 'Sonilo'],
  // fal's own utility apps
  ['image-editing', 'fal.ai'], ['image-apps', 'fal.ai'], ['post-processing', 'fal.ai'], ['image-preprocessors', 'fal.ai'],
  ['imageutils', 'fal.ai'], ['ffmpeg-api', 'fal.ai'], ['aura', 'fal.ai'],
  // Chat makers
  ['anthropic', 'Anthropic'], ['claude', 'Anthropic'], ['meta-llama', 'Meta'], ['mistralai', 'Mistral'], ['mistral', 'Mistral'],
  ['deepseek', 'DeepSeek'], ['moonshotai', 'Moonshot AI'], ['kimi', 'Moonshot AI'], ['cohere', 'Cohere'],
]

/** Words a title-cased fallback keeps in their own casing. */
const CASED: Readonly<Record<string, string>> = {
  ai: 'AI', api: 'API', sr: 'SR', ben: 'BEN', birefnet: 'BiRefNet', bitdance: 'BitDance', sdxl: 'SDXL', svd: 'SVD', lcm: 'LCM', tts: 'TTS', vton: 'VTON', lora: 'LoRA',
  elevenlabs: 'ElevenLabs', minimax: 'MiniMax', bytedance: 'ByteDance', openai: 'OpenAI', pixverse: 'PixVerse', heygen: 'HeyGen',
}

/** Whether a segment starts with a maker prefix as a whole word, or with a version after it. */
function startsWord(segment: string, prefix: string): boolean {
  if (!segment.startsWith(prefix)) return false
  const next = segment.charAt(prefix.length)
  return next === '' || !/[a-z]/.test(next)
}

/**
 * A segment no map entry names, as a maker line can show it: a trailing
 * "-api" or "-ai" dropped ("mirage-api", "mirelo-ai"), words title-cased with
 * known casing kept, and a one-letter tail joined by its hyphen ("bernini-r"
 * reads "Bernini-R").
 */
function tidySegment(segment: string): string {
  const stripped = segment.replace(/-(?:api|ai)$/, '') || segment
  const words = stripped.split(/[-_]/).filter(word => word !== '')
  const cased = words.map(word => CASED[word] ?? word.charAt(0).toUpperCase() + word.slice(1))
  return cased.reduce((line, word, index) => (index === 0 ? word : word.length === 1 ? `${line}-${word}` : `${line} ${word}`), '')
}

/**
 * The display name of who makes a model.
 * @param hint - the maker segment the catalogue states, or a chat id's first segment.
 * @param id - the model id, consulted when the hint matches nothing.
 * @returns the company's name, or the hint tidied, or undefined with neither.
 */
export function makerName(hint: string | undefined, id: string): string | undefined {
  for (const candidate of [hint, id.split('/')[0], id]) {
    if (candidate === undefined || candidate === '') continue
    const lower = candidate.toLowerCase()
    const match = MAKERS.find(([prefix]) => startsWord(lower, prefix))
    if (match !== undefined) return match[1]
  }
  if (hint === undefined || hint === '') return undefined
  return tidySegment(hint.toLowerCase())
}

/** Trailing phrases fal appends to a family's display names, which the Takes column already states. */
const CATEGORY_SUFFIX = /\s+(?:text|image|video|audio)[\s-]+to[\s-]+(?:image|video|audio|speech|vector)(?:\s+api)?$/i

/**
 * A model's name without the category phrase fal appends to it.
 * @param name - the catalogue's display name.
 * @returns the name as the list shows it.
 */
export function cleanName(name: string): string {
  const cleaned = name.replace(CATEGORY_SUFFIX, '').replace(/\s+API$/, '').trim()
  return cleaned === '' ? name : cleaned
}

/**
 * A price in its currency: cents from a unit up, three significant figures
 * below it, so $0.0125 never reads as $0.01.
 */
export function money(amount: number, currency = 'USD'): string {
  const symbol = currency === 'USD' ? '$' : currency === 'GBP' ? '£' : currency === 'EUR' ? '€' : `${currency} `
  if (amount === 0 || amount >= 1) return `${symbol}${amount.toFixed(2)}`
  const digits = Math.min(6, Math.max(2, 2 - Math.floor(Math.log10(amount))))
  // Trailing zeros past the cents say nothing: $0.04, not $0.0400.
  return `${symbol}${amount.toFixed(digits).replace(/(\.\d\d\d*?)0+$/, '$1')}`
}

/** The unit the price column names, per kind. */
export const PRICE_UNIT: Readonly<Record<BrowserKind, BarKey>> = {
  chat: 'browser.unit.chat',
  image: 'browser.unit.image',
  video: 'browser.unit.video',
  audio: 'browser.unit.audio',
}

/** The per-output figures that answer each kind's price column. */
const COMPARABLE: Readonly<Record<Exclude<BrowserKind, 'chat'>, readonly string[]>> = {
  image: ['image', '1 MP image'],
  video: ['5 s clip'],
  audio: ['minute of audio'],
}

/** A unit as a sentence reads it: `seconds` → `second`. */
function unitWord(unit: string): string {
  return unit.toLowerCase().replace(/^processed\s+/, '').replace(/s$/, '')
}

/**
 * A media model's price as the list and facts table state it.
 * @param price - the candidate's price, when one is known.
 * @param kind - what the model makes.
 * @param from - who published the price.
 * @param t - the pane's translate function.
 * @returns the browser price.
 */
export function mediaPrice(price: MediaPrice | undefined, kind: Exclude<BrowserKind, 'chat'>, from: string, t: Translate): BrowserPrice {
  if (price === undefined) return { comparable: false, lines: [] }
  const per = price.perOutput
  const word = unitWord(price.unit)
  const raw = { label: t('browser.fact.per', { unit: word }), value: money(price.unitPrice, price.currency), figure: true }
  if (per !== undefined && COMPARABLE[kind].includes(per.output)) {
    const headline = money(per.amount, price.currency)
    const sub = per.output === '1 MP image'
      ? t('browser.price.perMegapixel')
      : word === 'image'
        ? undefined
        : word === 'minute' ? t('browser.price.billedPerMinute') : t('browser.price.aUnit', { price: money(price.unitPrice, price.currency), unit: word })
    const lines = per.output === 'image' && word === 'image'
      ? [raw]
      : [raw, { label: t(PRICE_UNIT[kind]), value: headline, figure: true }]
    return { headline, ...sub === undefined ? {} : { sub }, comparable: true, sortValue: per.amount, lines, from }
  }
  return { headline: money(price.unitPrice, price.currency), sub: t('browser.price.per', { unit: word }), comparable: false, lines: [raw], from }
}

/**
 * A chat model's price: writing per 1M tokens as the headline, reading under it.
 * @param price - the effective token price, when one is known.
 * @param providerName - the route's display name, for a price from the shipped catalogue.
 * @param t - the pane's translate function.
 * @returns the browser price.
 */
export function chatPrice(price: ChatModelDetail['price'], providerName: string, t: Translate): BrowserPrice {
  if (price === undefined) return { comparable: false, lines: [] }
  const from = price.source === 'user' ? t('browser.price.you') : price.source === 'market' ? 'OpenRouter' : providerName
  return {
    headline: money(price.output),
    sub: t('browser.price.reading', { price: money(price.input) }),
    comparable: true,
    sortValue: price.output,
    lines: [
      { label: t('browser.fact.reading'), value: money(price.input), figure: true },
      { label: t('browser.fact.writing'), value: money(price.output), figure: true },
    ],
    from,
  }
}

/** The "Good at" labels a set of provider tags earns, in the kind's order. */
export function goodAtFor(kind: BrowserKind, tags: readonly string[]): BarKey[] {
  const lower = tags.map(tag => tag.toLowerCase())
  return GOOD_AT[kind].filter(rule => rule.tags.some(tag => lower.includes(tag))).map(rule => rule.label)
}

/**
 * A row's "Good at" labels: the shipped ones when the model was labelled
 * (even when none fit), else the ones its tags earn.
 * @param kind - what the model makes.
 * @param shipped - the model-facts ids the route sent, if any.
 * @param tags - the provider's tags or chat abilities.
 */
export function goodAtOf(kind: BrowserKind, shipped: readonly string[] | undefined, tags: readonly string[]): BarKey[] {
  if (shipped === undefined) return goodAtFor(kind, tags)
  return keysOf(GOOD_AT[kind].map(rule => rule.label), 'browser.goodAt.', shipped)
}

/** A row's controls as locale keys, in the kind's order. */
export function controlsOf(kind: BrowserKind, ids: readonly string[] | undefined): BarKey[] {
  return keysOf(CONTROLS[kind], 'browser.control.', ids ?? [])
}

/** Modalities as {@link Takes}, in display order, unknown ones dropped. */
function takesOf(modalities: readonly string[] | undefined): Takes[] {
  const known = new Set((modalities ?? ['text']).filter((one): one is Takes => (TAKES_ORDER as readonly string[]).includes(one)))
  return TAKES_ORDER.filter(one => known.has(one))
}

/**
 * Fold one media candidate into a browser row.
 * @param backend - the backend id serving it.
 * @param model - the candidate's model.
 * @param kind - what the space makes.
 * @param from - the backend's display name.
 * @param t - the pane's translate function.
 * @returns the row.
 */
export function mediaModel(
  backend: string, model: MediaCandidateModel, kind: Exclude<BrowserKind, 'chat'>, from: string, t: Translate,
): BrowserModel {
  return {
    value: `${backend} ${model.id}`,
    provider: backend,
    id: model.id,
    name: cleanName(model.name),
    ...withDefined('maker', makerName(model.maker, model.id)),
    takes: takesOf(model.inputModalities),
    makes: kind,
    ...withDefined('released', model.released),
    ...withDefined('description', model.description),
    ...withDefined('thumbnailUrl', model.thumbnailUrl),
    ...withDefined('licence', model.licence),
    goodAt: goodAtOf(kind, model.goodAt, model.tags ?? []),
    controls: controlsOf(kind, model.controls),
    price: mediaPrice(model.price, kind, from, t),
    hasExample: kind !== 'image',
  }
}

/**
 * Fold one chat model into a browser row. OpenRouter names its models
 * `Maker: Name`; the maker moves to its own line.
 * @param provider - the route id.
 * @param providerName - the route's display name.
 * @param model - the model as the details route lists it.
 * @param t - the pane's translate function.
 * @param route - the route as the row names it, with any terminal-CLI mark; defaults to its display name.
 * @returns the row.
 */
export function chatModel(
  provider: string, providerName: string, model: ChatModelDetail, t: Translate, route = providerName,
): BrowserModel {
  const split = /^([^:]{2,40}):\s+(.+)$/.exec(model.name)
  const name = split?.[2] ?? model.name
  const abilities = [
    ...model.tools === true ? ['tools'] : [],
    ...model.reasoning === true ? ['reasoning'] : [],
    ...(model.contextWindow ?? 0) >= LONG_CONTEXT ? ['long-context'] : [],
  ]
  const maker = split?.[1] ?? makerName(model.id.includes('/') ? model.id.split('/')[0] : undefined, model.id)
  return {
    value: `${provider} ${model.id}`,
    provider,
    id: model.id,
    name,
    ...withDefined('maker', maker),
    ...withDefined('route', route === maker ? undefined : route),
    takes: takesOf(model.inputModalities),
    makes: 'chat',
    ...withDefined('released', model.released),
    ...withDefined('description', model.description),
    goodAt: goodAtOf('chat', model.goodAt, abilities),
    controls: controlsOf('chat', model.controls ?? [
      ...model.tools === true ? ['tools'] : [],
      ...model.reasoning === true ? ['thinking'] : [],
    ]),
    ...withDefined('contextWindow', model.contextWindow),
    price: chatPrice(model.price, providerName, t),
    hasExample: false,
  }
}

/** `{ [key]: value }` when the value is defined, else nothing, for spreading into a row. */
function withDefined<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V }
}

/**
 * The person's ratings as `GET /idealize/router/ratings` lists them: by
 * rating key, each tag's stars. Quiet marks travel too and are never shown
 * (JJ, 28 Oct 2026).
 */
export type RatingMap = Readonly<Record<string, { tags: Readonly<Record<string, { stars?: number }>> }>>

/**
 * A chat model's facts key, as `chatFactKey` in `@idealize/services` makes
 * it: the last path segment, lower case, without a variant, a date or
 * `latest`, dots as dashes. Copied because the browser bundle cannot import
 * the host's services.
 * @param id - the model id as its route lists it.
 */
export function chatKeyOf(id: string): string {
  return (id.toLowerCase().split('/').at(-1) ?? '')
    .replace(/:.*$/, '')
    .replace(/\./g, '-')
    .replace(/-(\d{8}|\d{4}-\d{2}-\d{2}|latest)$/, '')
}

/** The key the router files a model's ratings under. */
export function ratingKeyOf(kind: BrowserKind, id: string): string {
  return `${kind}:${kind === 'chat' ? chatKeyOf(id) : id.toLowerCase()}`
}

/** A model's stars by tag, unstarred tags left out. */
export function starsOf(ratings: RatingMap | undefined, model: Pick<BrowserModel, 'makes' | 'id'>): Record<string, number> {
  const tags = ratings?.[ratingKeyOf(model.makes, model.id)]?.tags ?? {}
  return Object.fromEntries(Object.entries(tags).flatMap(([tag, rating]) => (rating.stars === undefined ? [] : [[tag, rating.stars]])))
}

/** The tags a kind of model can be rated for: its Good at vocabulary, in order. */
export function ratingTags(kind: BrowserKind): string[] {
  return GOOD_AT[kind].map(rule => rule.label.slice('browser.goodAt.'.length))
}

/** The locale key naming a rating tag: the Good at label of the same id. */
export const tagKey = (tag: string): BarKey => `browser.goodAt.${tag}` as BarKey

/**
 * A list row's rating line, the two best-rated tags first: `★ 5 coding · 3 writing`.
 * @param stars - the row's stars by tag.
 * @param t - the pane's translate function.
 * @returns the line, or undefined for an unrated model.
 */
export function ratingSummary(stars: Readonly<Record<string, number>>, t: Translate): string | undefined {
  const top = Object.entries(stars).sort((a, b) => b[1] - a[1]).slice(0, 2)
  if (top.length === 0) return undefined
  return `★ ${top.map(([tag, count]) => `${String(count)} ${t(tagKey(tag)).toLowerCase()}`).join(' · ')}`
}

/** The browser's filters, as its controls stand. */
export interface BrowserFilters {
  query: string
  takes: readonly Takes[]
  goodAt: readonly BarKey[]
  controls: readonly BarKey[]
  clientOnly: boolean
}

/**
 * The models the filters leave: the query matches name, maker, id or
 * description; every chosen Takes chip must be among what a model reads;
 * every chosen Good at label must be earned; every chosen control must be
 * offered; and with Client work only on, a
 * model must state a commercial licence.
 * @param models - the full catalogue.
 * @param filters - the controls.
 * @returns the matching models, in the given order.
 */
export function filterModels(models: readonly BrowserModel[], filters: BrowserFilters): BrowserModel[] {
  const words = filters.query.trim().toLowerCase().split(/\s+/).filter(word => word !== '')
  return models.filter((model) => {
    if (filters.clientOnly && model.licence !== 'commercial') return false
    if (!filters.takes.every(one => model.takes.includes(one))) return false
    if (!filters.goodAt.every(label => model.goodAt.includes(label))) return false
    if (!filters.controls.every(control => model.controls.includes(control))) return false
    if (words.length === 0) return true
    const haystack = `${model.name} ${model.maker ?? ''} ${model.route ?? ''} ${model.id} ${model.description ?? ''}`.toLowerCase()
    return words.every(word => haystack.includes(word))
  })
}

/**
 * Order models for the list. Cheapest puts comparable prices first, low to
 * high, then prices in other units, then models without one; newest puts
 * dated models first; your ratings puts starred models first, best first;
 * ties fall back to the name.
 * @param models - the models to order.
 * @param sort - the chosen order.
 * @param ratings - the person's ratings, for the rated order.
 * @returns a new array.
 */
export function sortModels(models: readonly BrowserModel[], sort: BrowserSort, ratings?: RatingMap): BrowserModel[] {
  if (sort === 'rated') {
    // Rated models first, best rating first; the rest keep the cheapest order.
    const best = (model: BrowserModel): number => Math.max(0, ...Object.values(starsOf(ratings, model)))
    const cheapest = sortModels(models, 'cheapest')
    return cheapest.map((model, index) => ({ model, index, best: best(model) }))
      .sort((a, b) => b.best - a.best || a.index - b.index)
      .map(entry => entry.model)
  }
  const byName = (left: BrowserModel, right: BrowserModel): number =>
    left.name.localeCompare(right.name, undefined, { sensitivity: 'base', numeric: true })
  const rank = (model: BrowserModel): number => (model.price.comparable ? 0 : model.price.headline === undefined ? 2 : 1)
  return [...models].sort((left, right) => {
    if (sort === 'cheapest') {
      const ranked = rank(left) - rank(right)
      if (ranked !== 0) return ranked
      const cost = (left.price.sortValue ?? 0) - (right.price.sortValue ?? 0)
      return cost !== 0 ? cost : byName(left, right)
    }
    if (sort === 'newest') {
      if (left.released !== right.released) {
        if (left.released === undefined) return 1
        if (right.released === undefined) return -1
        return right.released.localeCompare(left.released)
      }
      return byName(left, right)
    }
    return byName(left, right)
  })
}

/** The Takes chips a catalogue offers: every kind of input some model reads, in display order. */
export function takesOffered(models: readonly BrowserModel[]): Takes[] {
  const seen = new Set(models.flatMap(model => model.takes))
  return TAKES_ORDER.filter(one => seen.has(one))
}

/** The Good at chips a catalogue offers: every label some model carries, in the kind's order. */
export function goodAtOffered(kind: BrowserKind, models: readonly BrowserModel[]): BarKey[] {
  const seen = new Set(models.flatMap(model => model.goodAt))
  return GOOD_AT[kind].map(rule => rule.label).filter(label => seen.has(label))
}

/** The Controls chips a catalogue offers: every control some model has, in the kind's order. */
export function controlsOffered(kind: BrowserKind, models: readonly BrowserModel[]): BarKey[] {
  const seen = new Set(models.flatMap(model => model.controls))
  return CONTROLS[kind].filter(control => seen.has(control))
}

/** Whether the catalogue carries licence data, so the Client work only switch means something. */
export function hasLicences(models: readonly BrowserModel[]): boolean {
  return models.some(model => model.licence !== undefined)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Who makes a model and where it is served, as the list's second line states them. */
export function byline(model: BrowserModel): string {
  // A route named after the maker ("OpenAI (ChatGPT)" for OpenAI) says both at once.
  if (model.route === undefined) return model.maker ?? ''
  if (model.maker === undefined || model.route.startsWith(model.maker)) return model.route
  return `${model.maker} · ${model.route}`
}

/** `YYYY-MM-DD` as `Mon YYYY`, or undefined for anything else. */
export function monthYear(date: string | undefined): string | undefined {
  const match = date === undefined ? null : /^(\d{4})-(\d{2})/.exec(date)
  const [, year, number] = match ?? []
  const month = MONTHS[Number(number) - 1]
  return month === undefined || year === undefined ? undefined : `${month} ${year}`
}
