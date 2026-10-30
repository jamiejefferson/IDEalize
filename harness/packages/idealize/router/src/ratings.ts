/**
 * The person's own ratings of models: stars per kind of work, set on a model's
 * card or from the line a heart brings up, and quiet marks left by picks after
 * a dislike. They stay on this machine and steer only this person's router
 * (JJ, 28 Oct 2026). The kinds of work are the model browser's Good at
 * vocabulary, one list per kind of model, so a rating and a filter chip name
 * the same thing.
 *
 * A model is keyed by what it is, not the route it came through: a chat model
 * by its facts key (OpenRouter's `anthropic/claude-sonnet-5.5` and a direct
 * `claude-sonnet-5-5` are one model), a media model by its endpoint id.
 */

import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chatFactKey, GOOD_AT_TERMS } from '@idealize/services'

import type { TaskType } from './tasks.ts'

export const RATINGS_FILE = 'model-ratings.json'

/** The kinds of model a rating can belong to. */
export type RatingKind = 'chat' | 'image' | 'video' | 'audio'

export const RATING_KINDS: readonly RatingKind[] = ['chat', 'image', 'video', 'audio']

/** The tags a kind of model can be rated for, in the browser's order. */
export const RATING_TAGS: Readonly<Record<RatingKind, readonly string[]>> = {
  chat: GOOD_AT_TERMS.chat.map(term => term.id),
  image: GOOD_AT_TERMS.image.map(term => term.id),
  video: GOOD_AT_TERMS.video.map(term => term.id),
  audio: GOOD_AT_TERMS.audio.map(term => term.id),
}

/**
 * The chat tag a router reading rates. The router tells seven kinds of work
 * apart; the Good at list names six of them and folds maths into reasoning
 * and summarising into reading long documents.
 */
export const TASK_TAG: Readonly<Record<TaskType, string>> = {
  code: 'coding',
  reasoning: 'reasoning',
  math: 'reasoning',
  writing: 'writing',
  summarise: 'research',
  translate: 'translation',
  quick: 'quick',
}

export type Stars = 1 | 2 | 3 | 4 | 5

/** One model's standing for one kind of work. */
export interface TagRating {
  /** Set by the person. */
  stars?: Stars | undefined
  /** Picks after a dislike: up for a kept alternative, down for the answer passed over. */
  marks?: number | undefined
  at: string
}

export interface ModelRatings {
  kind: RatingKind
  /** The name the person saw when they rated it. */
  label?: string | undefined
  tags: Record<string, TagRating>
}

export interface RatingsFile {
  version: 1
  /** By {@link ratingKey}. */
  models: Record<string, ModelRatings>
}

/** A model as a rating names it. */
export interface RatedModel {
  kind: RatingKind
  /** The chat route or the media backend; not part of the key. */
  provider: string
  model: string
}

/**
 * The key a model's ratings are filed under.
 * @param model - the model and its kind.
 * @returns `kind:key`, the key being the chat facts key or the media endpoint id.
 */
export function ratingKey(model: Pick<RatedModel, 'kind' | 'model'>): string {
  return `${model.kind}:${model.kind === 'chat' ? chatFactKey(model.model) : model.model.toLowerCase()}`
}

export const isRatingKind = (value: unknown): value is RatingKind =>
  typeof value === 'string' && (RATING_KINDS as readonly string[]).includes(value)

export const isStars = (value: unknown): value is Stars =>
  value === 1 || value === 2 || value === 3 || value === 4 || value === 5

export const isTag = (kind: RatingKind, tag: unknown): tag is string =>
  typeof tag === 'string' && RATING_TAGS[kind].includes(tag)

const empty = (): RatingsFile => ({ version: 1, models: {} })

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** The usable part of one stored model: its kind, label and every tag with stars or marks. */
function modelFrom(entry: unknown): ModelRatings | undefined {
  if (!isRecord(entry) || !isRatingKind(entry.kind) || !isRecord(entry.tags)) return undefined
  const kind = entry.kind
  const tags: Record<string, TagRating> = {}
  for (const [tag, rating] of Object.entries(entry.tags)) {
    if (!isTag(kind, tag) || !isRecord(rating)) continue
    const stars = isStars(rating.stars) ? rating.stars : undefined
    const marks = typeof rating.marks === 'number' && Number.isFinite(rating.marks) ? rating.marks : undefined
    if (stars === undefined && marks === undefined) continue
    const at = typeof rating.at === 'string' ? rating.at : ''
    tags[tag] = { ...stars === undefined ? {} : { stars }, ...marks === undefined ? {} : { marks }, at }
  }
  if (Object.keys(tags).length === 0) return undefined
  return { kind, ...typeof entry.label === 'string' ? { label: entry.label } : {}, tags }
}

/**
 * The ratings on disk. An absent file is no ratings; a damaged one is set
 * aside as `.damaged` and reads as none, so one bad write never stops routing.
 * @param home - the harness data folder.
 * @returns the ratings.
 */
export async function readRatings(home: string): Promise<RatingsFile> {
  const path = join(home, RATINGS_FILE)
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    // No file yet: nothing has been rated.
    return empty()
  }
  try {
    const parsed: unknown = JSON.parse(text)
    if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.models)) throw new Error('not a ratings file')
    const models: Record<string, ModelRatings> = {}
    for (const [key, entry] of Object.entries(parsed.models)) {
      const usable = modelFrom(entry)
      if (usable !== undefined) models[key] = usable
    }
    return { version: 1, models }
  } catch {
    await rename(path, `${path}.damaged`).catch(() => undefined)
    return empty()
  }
}

/** Writes queue behind each other, so two quick taps never interleave. */
let writing: Promise<unknown> = Promise.resolve()

/**
 * Change the ratings on disk: read, change, write through a temporary file.
 * @param home - the harness data folder.
 * @param change - edits the file in place.
 * @returns the ratings as written.
 */
export function updateRatings(home: string, change: (file: RatingsFile) => void): Promise<RatingsFile> {
  const run = writing.then(async () => {
    const file = await readRatings(home)
    change(file)
    const path = join(home, RATINGS_FILE)
    await writeFile(`${path}.tmp`, JSON.stringify(file, null, 2), 'utf8')
    await rename(`${path}.tmp`, path)
    return file
  })
  writing = run.catch(() => undefined)
  return run
}

function entryOf(file: RatingsFile, model: RatedModel, label?: string): ModelRatings {
  const key = ratingKey(model)
  const entry = file.models[key] ?? { kind: model.kind, tags: {} }
  if (label !== undefined && label !== '') entry.label = label
  file.models[key] = entry
  return entry
}

const without = <T>(record: Record<string, T>, drop: string): Record<string, T> =>
  Object.fromEntries(Object.entries(record).filter(([key]) => key !== drop))

function prune(file: RatingsFile, model: RatedModel, tag: string): void {
  const key = ratingKey(model)
  const entry = file.models[key]
  if (entry === undefined) return
  const rating = entry.tags[tag]
  if (rating !== undefined && rating.stars === undefined && (rating.marks ?? 0) === 0) entry.tags = without(entry.tags, tag)
  if (Object.keys(entry.tags).length === 0) file.models = without(file.models, key)
}

/**
 * Set or clear one star rating. The tag's quiet marks are kept and count
 * again once the stars are cleared; while stars stand, they outweigh the marks.
 * @param file - the ratings, changed in place.
 * @param model - the model.
 * @param tag - the kind of work.
 * @param stars - the rating, or undefined to clear it.
 * @param at - when.
 * @param label - the model's display name.
 */
export function setStars(file: RatingsFile, model: RatedModel, tag: string, stars: Stars | undefined, at: string, label?: string): void {
  const entry = entryOf(file, model, label)
  const marks = entry.tags[tag]?.marks
  entry.tags[tag] = { ...stars === undefined ? {} : { stars }, ...marks === undefined ? {} : { marks }, at }
  prune(file, model, tag)
}

/** Quiet marks stop counting past this many either way. */
export const MAX_MARKS = 3

/**
 * Leave one quiet mark. A tag the person has starred keeps its stars; the
 * mark is still kept, but {@link standing} reads stars first.
 * @param file - the ratings, changed in place.
 * @param model - the model.
 * @param tag - the kind of work.
 * @param delta - +1 for a kept alternative, -1 for the answer passed over.
 * @param at - when.
 * @param label - the model's display name.
 */
export function addMark(file: RatingsFile, model: RatedModel, tag: string, delta: 1 | -1, at: string, label?: string): void {
  const entry = entryOf(file, model, label)
  const rating = entry.tags[tag] ?? { at }
  const marks = Math.max(-MAX_MARKS, Math.min(MAX_MARKS, (rating.marks ?? 0) + delta))
  entry.tags[tag] = { ...rating, marks, at }
  prune(file, model, tag)
}

/** What one model's rating for one tag does to its score. */
export interface Standing {
  /** Added to the weighted total the router compares, -0.1 to +0.2. */
  bonus: number
  /** One star: never picked for this kind of work again. */
  barred: boolean
  /** The person starred it for this tag. */
  starred: boolean
  stars?: Stars | undefined
}

/**
 * Star weights, on the scale of the weighted totals the router compares. Close
 * rivals sit within about 0.05 of each other there (28 Oct 2026, the shipped
 * table under even priorities), and a switch must gain 0.15 on the balanced
 * setting. Five stars add 0.2, so a 5-star model wins against a close rival on
 * its rating, which is the strong nudge JJ ruled for; a cautious setting (0.3)
 * still asks it to be strong in its own right. A quiet mark is a tenth of that.
 */
export const STAR_BONUS: Readonly<Record<Stars, number>> = { 1: 0, 2: -0.1, 3: 0, 4: 0.08, 5: 0.2 }
export const MARK_BONUS = 0.02

const NONE: Standing = { bonus: 0, barred: false, starred: false }

/**
 * A model's standing for one tag.
 * @param file - the ratings.
 * @param model - the model.
 * @param tag - the kind of work.
 * @returns the bonus it earns, and whether it is barred.
 */
export function standing(file: RatingsFile, model: Pick<RatedModel, 'kind' | 'model'>, tag: string): Standing {
  const rating = file.models[ratingKey(model)]?.tags[tag]
  if (rating === undefined) return NONE
  if (rating.stars !== undefined) {
    return { bonus: STAR_BONUS[rating.stars], barred: rating.stars === 1, starred: true, stars: rating.stars }
  }
  const marks = Math.max(-MAX_MARKS, Math.min(MAX_MARKS, rating.marks ?? 0))
  return { bonus: marks * MARK_BONUS, barred: false, starred: false }
}

/** One model's ratings for the card: every tag it has stars or marks for. */
export function ratingsOf(file: RatingsFile, model: Pick<RatedModel, 'kind' | 'model'>): Record<string, TagRating> {
  return { ...file.models[ratingKey(model)]?.tags }
}
