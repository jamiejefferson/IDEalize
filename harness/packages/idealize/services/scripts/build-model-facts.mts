/**
 * Build `src/model-facts.data.ts`: the controls and good-at labels the model
 * browser filters on, for every model the app lists.
 *
 * - Controls come from each fal model's input schema (read in bulk with
 *   `expand=openapi-3.0`, ten models a page) and from OpenRouter's
 *   `supported_parameters` for chat.
 * - Good-at labels come from one classification per model, by a chat model on
 *   OpenRouter, from its name, description, tags and (for pictures and video)
 *   its cover picture, against the fixed vocabulary in `src/model-facts.ts`.
 *
 * Run before a release, from this package:
 *   OPENROUTER_API_KEY=… FAL_KEY=… node scripts/build-model-facts.mts [--model anthropic/claude-sonnet-5.5] [--cache DIR]
 * Raw catalogue pages and each model's labels are cached in DIR (default
 * `$TMPDIR/idealize-model-facts`), so a rerun only classifies new models.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { getBuiltinModels, getBuiltinProviders } from '@earendil-works/pi-ai/providers/all'
import { parseInputSchema } from '../src/adapters/input-schema.ts'
import { MEDIA_SERVICES } from '../src/media-directory.ts'
import { chatFactKey, controlsFromInputs, GOOD_AT_TERMS } from '../src/model-facts.ts'
import type { FactKind, ShippedFact, ShippedFacts } from '../src/model-facts.ts'

const { values: args } = parseArgs({
  options: {
    model: { type: 'string', default: 'anthropic/claude-sonnet-5.5' },
    cache: { type: 'string', default: join(tmpdir(), 'idealize-model-facts') },
    batch: { type: 'string', default: '12' },
  },
})
const CACHE = args.cache
const BATCH = Number(args.batch)
const KEY = process.env.OPENROUTER_API_KEY ?? ''
if (KEY === '') throw new Error('OPENROUTER_API_KEY is required to classify models')
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'model-facts.data.ts')

/** One model awaiting classification. */
interface Subject {
  key: string
  kind: FactKind
  name: string
  description?: string
  tags?: readonly string[]
  startsFromPicture?: boolean
  picture?: string
}

const sleep = (ms: number): Promise<void> => new Promise(done => setTimeout(done, ms))

/** fal answers keyed catalogue reads with a far higher rate limit than anonymous ones. */
const FAL_KEY = process.env.FAL_KEY ?? ''

/** GET JSON, waiting out 429s with a doubling delay. */
async function getJson(url: string): Promise<unknown> {
  const headers: Record<string, string> = url.startsWith('https://api.fal.ai/') && FAL_KEY !== '' ? { authorization: `Key ${FAL_KEY}` } : {}
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = await fetch(url, { headers })
    if (response.status === 429) {
      await sleep(Number(response.headers.get('retry-after') ?? 0) * 1000 || 1000 * 2 ** attempt)
      continue
    }
    if (!response.ok) throw new Error(`${url} answered ${response.status}`)
    return response.json()
  }
  throw new Error(`${url} stayed rate-limited`)
}

/** Read a cached JSON file, or undefined. */
async function cached<T>(name: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(join(CACHE, name), 'utf8')) as T } catch { return undefined }
}

/** Write a JSON file into the cache. */
async function keep(name: string, value: unknown): Promise<void> {
  await writeFile(join(CACHE, name), JSON.stringify(value))
}

/** One fal catalogue row, as far as this script reads it. */
interface FalRow {
  endpoint_id: string
  metadata?: { display_name?: string; category?: string; description?: string; tags?: string[]; thumbnail_url?: string; status?: string }
  openapi?: unknown
}

/** Every row of one fal category, schemas included, from the cache when present. */
async function falCategory(base: string, category: string): Promise<FalRow[]> {
  const file = `fal-${category}.json`
  const held = await cached<FalRow[]>(file)
  if (held !== undefined) return held
  const rows: FalRow[] = []
  let cursor: string | undefined
  do {
    const url = `${base}/models?category=${category}&limit=10&expand=openapi-3.0${cursor === undefined ? '' : `&cursor=${encodeURIComponent(cursor)}`}`
    const page = await getJson(url) as { models?: FalRow[]; has_more?: boolean; next_cursor?: string }
    rows.push(...page.models ?? [])
    cursor = page.has_more === true ? page.next_cursor : undefined
    process.stdout.write(`\r${category}: ${rows.length}`)
  } while (cursor !== undefined)
  process.stdout.write('\n')
  await keep(file, rows)
  return rows
}

/** One OpenRouter directory row. */
interface RouterRow {
  id: string
  name?: string
  description?: string
  supported_parameters?: string[]
  architecture?: { output_modalities?: string[] }
}

await mkdir(CACHE, { recursive: true })
const media: Record<string, { c?: string[] }> = {}
const subjects: Subject[] = []

const fal = MEDIA_SERVICES.find(service => service.id === 'fal')
for (const entry of fal?.categories ?? []) {
  const kind = entry.artefact as FactKind
  for (const row of await falCategory(fal?.baseUrl ?? '', entry.category)) {
    if (row.metadata?.status !== undefined && row.metadata.status !== 'active') continue
    const schema = parseInputSchema(row.openapi)
    if (schema !== undefined) media[row.endpoint_id] = { c: controlsFromInputs(kind, schema.properties) }
    subjects.push({
      key: row.endpoint_id,
      kind,
      name: row.metadata?.display_name ?? row.endpoint_id,
      ...row.metadata?.description === undefined ? {} : { description: row.metadata.description },
      ...row.metadata?.tags === undefined ? {} : { tags: row.metadata.tags },
      ...entry.requiredInputs?.includes('image') === true ? { startsFromPicture: true } : {},
      ...kind !== 'audio' && row.metadata?.thumbnail_url?.startsWith('https://') === true ? { picture: row.metadata.thumbnail_url } : {},
    })
  }
}

const router = await cached<RouterRow[]>('openrouter.json')
  ?? ((await getJson('https://openrouter.ai/api/v1/models')) as { data: RouterRow[] }).data
await keep('openrouter.json', router)
const chat: Record<string, { c?: string[] }> = {}
for (const row of router) {
  const outputs = row.architecture?.output_modalities ?? ['text']
  if (outputs.includes('image')) {
    subjects.push({ key: row.id, kind: 'image', name: row.name ?? row.id, ...row.description === undefined ? {} : { description: row.description } })
  }
  if (!outputs.includes('text')) continue
  const key = chatFactKey(row.id)
  const params = (row.supported_parameters ?? []).map(name => ({ name }))
  chat[key] = { c: controlsFromInputs('chat', params) }
  if (!subjects.some(subject => subject.kind === 'chat' && subject.key === key)) {
    subjects.push({ key, kind: 'chat', name: row.name ?? row.id, ...row.description === undefined ? {} : { description: row.description } })
  }
}
// Routes other than OpenRouter (subscriptions, first-party APIs) list models
// the directory may not: classify those by name and whatever the catalogue says.
for (const provider of getBuiltinProviders()) {
  for (const model of getBuiltinModels(provider)) {
    const key = chatFactKey(model.id)
    if (subjects.some(subject => subject.kind === 'chat' && subject.key === key)) continue
    chat[key] ??= {}
    subjects.push({ key, kind: 'chat', name: model.name ?? model.id })
  }
}

/** The classification prompt for one kind. */
function systemFor(kind: FactKind): string {
  const terms = GOOD_AT_TERMS[kind].map(term => `- ${term.id}: ${term.definition}`).join('\n')
  return [
    `You label ${kind === 'chat' ? 'language' : kind} AI models so a designer can choose between them.`,
    'For each model, choose every label it is genuinely good at, from this list only:',
    terms,
    'Judge from the name, maker, description, tags and any cover picture. Prefer one to three labels; give none when nothing fits.',
    'Answer with JSON only: {"<key>": ["label", ...], ...} covering every key you were given.',
  ].join('\n')
}

/** Labels for one batch, by key. */
async function classify(kind: FactKind, batch: readonly Subject[], withPictures: boolean): Promise<Record<string, string[]>> {
  const content: unknown[] = []
  for (const subject of batch) {
    content.push({ type: 'text', text: JSON.stringify({
      key: subject.key,
      name: subject.name,
      ...subject.description === undefined ? {} : { description: subject.description.slice(0, 600) },
      ...subject.tags === undefined ? {} : { tags: subject.tags },
      ...subject.startsFromPicture === true ? { startsFrom: 'a picture' } : {},
    }) })
    if (withPictures && subject.picture !== undefined) content.push({ type: 'image_url', image_url: { url: subject.picture } })
  }
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: args.model,
      max_tokens: 4000,
      temperature: 0,
      messages: [{ role: 'system', content: systemFor(kind) }, { role: 'user', content }],
    }),
  })
  if (!response.ok) throw new Error(`classify answered ${response.status}: ${(await response.text()).slice(0, 300)}`)
  const body = await response.json() as { choices?: { message?: { content?: string } }[] }
  const text = body.choices?.[0]?.message?.content ?? ''
  const json = /\{[\s\S]*\}/.exec(text)?.[0]
  if (json === undefined) throw new Error(`classify gave no JSON: ${text.slice(0, 200)}`)
  const allowed = new Set(GOOD_AT_TERMS[kind].map(term => term.id))
  const parsed = JSON.parse(json) as Record<string, unknown>
  const labels: Record<string, string[]> = {}
  for (const subject of batch) {
    const raw = parsed[subject.key]
    labels[subject.key] = Array.isArray(raw) ? raw.filter((one): one is string => typeof one === 'string' && allowed.has(one)) : []
  }
  return labels
}

const labelFile = (kind: FactKind): string => `labels-${kind}.json`
for (const kind of ['image', 'video', 'audio', 'chat'] as const) {
  const known = await cached<Record<string, string[]>>(labelFile(kind)) ?? {}
  const pending = subjects.filter(subject => subject.kind === kind && known[subject.key] === undefined)
  console.log(`${kind}: ${pending.length} to classify, ${Object.keys(known).length} cached`)
  const queue = Array.from({ length: Math.ceil(pending.length / BATCH) }, (_, index) => pending.slice(index * BATCH, (index + 1) * BATCH))
  // Four batches in flight; a batch whose pictures fail to load is retried by text alone.
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let batch = queue.shift(); batch !== undefined; batch = queue.shift()) {
      let labels: Record<string, string[]> | undefined
      for (const withPictures of [true, false, false]) {
        try { labels = await classify(kind, batch, withPictures); break } catch (error) { console.warn(String(error).slice(0, 200)) }
      }
      if (labels === undefined) continue
      Object.assign(known, labels)
      await keep(labelFile(kind), known)
      process.stdout.write(`\r${kind}: ${Object.keys(known).length} labelled`)
    }
  }))
  process.stdout.write('\n')
  for (const [key, labels] of Object.entries(known)) {
    const table = kind === 'chat' ? chat : media
    if (kind !== 'chat' && !subjects.some(subject => subject.kind === kind && subject.key === key)) continue
    table[key] = { ...table[key], ...{ g: labels } }
  }
}

/** A table sorted by key with empty lists dropped, for a stable diff. */
function tidy(table: Record<string, { c?: string[]; g?: string[] }>): Record<string, ShippedFact> {
  return Object.fromEntries(Object.keys(table).sort().map((key) => {
    const entry = table[key] ?? {}
    return [key, { ...entry.c?.length ? { c: entry.c } : {}, ...entry.g?.length ? { g: entry.g } : {} }]
  }))
}

/** A string as the repo's style writes it: single quotes, escaped. */
const quote = (text: string): string => `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

const data: ShippedFacts = { generatedAt: new Date().toISOString().slice(0, 10), media: tidy(media), chat: tidy(chat) }
await writeFile(OUT, [
  '// Generated by scripts/build-model-facts.mts. Do not edit by hand.',
  "import type { ShippedFacts } from './model-facts.ts'",
  '',
  'export const MODEL_FACTS_DATA: ShippedFacts = {',
  `  generatedAt: ${quote(data.generatedAt)},`,
  ...(['media', 'chat'] as const).flatMap(part => [
    `  ${part}: {`,
    ...Object.entries(data[part]).map(([key, entry]) => `    ${quote(key)}: { ${[
      ...entry.c === undefined ? [] : [`c: [${entry.c.map(quote).join(', ')}]`],
      ...entry.g === undefined ? [] : [`g: [${entry.g.map(quote).join(', ')}]`],
    ].join(', ')} },`),
    '  },',
  ]),
  '}',
  '',
].join('\n'))
console.log(`wrote ${Object.keys(data.media).length} media and ${Object.keys(data.chat).length} chat models to ${OUT}`)
