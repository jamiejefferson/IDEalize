/**
 * The Studio controls on the composer card's tool row, shown while this chat's
 * view ring sits on Image, Video or Sound. The entry shares the chat view's
 * store (the ui-terminal ModeShortcut pattern), so the controls appear and
 * disappear with the view instead of following every chat in the app.
 *
 * The row carries the Image, Video, Sound toggle (JJ, 25 Nov 2026) and one
 * button that names the model and the settings in force. The button opens a
 * panel with the model that kind runs on and one control per setting that
 * model takes: a select for an enum, a number input for a number, a checkbox
 * for a switch. The controls sat on the row itself until 26 Nov 2026, where
 * they ran past the card's edge and were cut off. The model picker is here
 * because the person may change the model at any time inside a chat (JJ, 24
 * Nov 2026); "Auto" leaves the choice to the app. The composer's chat-model
 * seat stays retired on a media view, so the model is still named once.
 *
 * The fields come from `GET /idealize/generate/inputs?space=`, refetched when
 * the view changes and when the Brains pane raises `idealize:brains-changed`
 * after a model change. A space whose model publishes no schema gets the
 * fallback vocabulary in {@link FALLBACK_FIELDS}. Images always adds the
 * image-count control beside the fields.
 *
 * Each choice is written into the draft as one trailing tag (see
 * `settings-tag.ts`): the composer exposes no pre-submit seam, so a control
 * that must reach the model states itself in the message.
 * @module @idealize/ui-gallery/client/GenerationSettings
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type React from 'react'
import type { GenerationField, GenerationInputs, GenerationSelection, GenerationStrip } from './contract.ts'
import { applySettingsTag, GALLERY_COUNTS, readSettingsTag, valueOf } from './settings-tag.ts'
import type { GalleryKey } from './locales.ts'
import css from './GenerationSettings.module.css'

/** The view id of the Images grid, the one space with a count control. */
export const GALLERY_VIEW = 'gallery'

/** The view ids the strip renders on: the three media spaces. */
export const GENERATION_VIEWS = ['gallery', 'motion', 'soundstage'] as const

/** One of {@link GENERATION_VIEWS}. */
export type GenerationView = typeof GENERATION_VIEWS[number]

/**
 * The host route publishing the active model's inputs per space (restated:
 * the client bundle purity gate forbids the value import).
 */
export const INPUTS_ROUTE = '/idealize/generate/inputs'

/** The document event the Brains pane raises after a model change (restated: this package must not import `@idealize/ui-bar`). */
const BRAINS_CHANGED_EVENT = 'idealize:brains-changed'

/**
 * The vocabulary each space offers when its model publishes no schema. A
 * default-less field (Video's duration) starts unset, so the strip shows that
 * the model has been told nothing until the user picks a value.
 */
export const FALLBACK_FIELDS: Readonly<Record<GenerationView, readonly GenerationField[]>> = {
  gallery: [
    { name: 'aspect_ratio', label: 'Aspect', kind: 'enum', values: ['auto', '1:1', '4:3', '3:2', '16:9', '9:16'], default: 'auto' },
  ],
  motion: [
    { name: 'duration', label: 'Duration', kind: 'enum', values: ['5', '8', '10'] },
    { name: 'aspect_ratio', label: 'Aspect', kind: 'enum', values: ['auto', '16:9', '9:16', '1:1'], default: 'auto' },
  ],
  soundstage: [
    { name: 'duration', label: 'Length', kind: 'enum', values: ['auto', '5', '15', '30'], default: 'auto' },
  ],
}

/**
 * The document event the strip raises when a person picks another kind of
 * thing to make. `@idealize/ui-bar` owns the chat's durable view record, so it
 * listens and writes it (restated there: neither package imports the other).
 */
export const STUDIO_KIND_EVENT = 'idealize:studio-kind'

/** What {@link STUDIO_KIND_EVENT} carries: the chat and the view it moves to. */
export interface StudioKindDetail {
  sessionId: string
  space: GenerationView
}

/** The kinds in toggle order, each with its label key. */
export const STUDIO_KINDS: readonly { space: GenerationView; label: GalleryKey }[] = [
  { space: 'gallery', label: 'gallery.kind.image' },
  { space: 'motion', label: 'gallery.kind.video' },
  { space: 'soundstage', label: 'gallery.kind.sound' },
]

/**
 * Whether a ring view id is one the strip renders on.
 * @param view - the ring's active view id, or null before one is chosen.
 * @returns true for the three media spaces.
 */
export function isGenerationView(view: string | null): view is GenerationView {
  return (GENERATION_VIEWS as readonly string[]).includes(view ?? '')
}

/** A finite number or nothing: what a bound or a numeric default may be. */
function isOptionalNumber(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value))
}

/** Wire boundary: one field as the route serialised it, checked by its kind. */
function isField(value: unknown): value is GenerationField {
  if (typeof value !== 'object' || value === null) return false
  const field = value as Record<string, unknown>
  if (typeof field.name !== 'string' || typeof field.label !== 'string') return false
  switch (field.kind) {
    case 'enum':
      return Array.isArray(field.values) && field.values.every(item => typeof item === 'string')
        && (field.default === undefined || typeof field.default === 'string')
    case 'number':
      return typeof field.integer === 'boolean' && isOptionalNumber(field.min) && isOptionalNumber(field.max) && isOptionalNumber(field.default)
    case 'boolean':
      return field.default === undefined || typeof field.default === 'boolean'
    default:
      return false
  }
}

/**
 * Fetch the active model's inputs for one space.
 * @param space - the view id.
 * @returns the fields, or an empty list when the route is absent, refuses, or publishes no schema.
 */
export async function loadInputs(space: GenerationView): Promise<readonly GenerationField[]> {
  try {
    const response = await fetch(`${INPUTS_ROUTE}?space=${space}`)
    if (!response.ok) return []
    const body = await response.json() as Partial<GenerationInputs>
    return Array.isArray(body.fields) ? body.fields.filter(isField) : []
  } catch {
    return []
  }
}

/** The host route listing each kind's models and storing the chosen one (restated: the purity gate forbids the value import). */
export const MEDIA_ROUTE = '/idealize/brains/media'

/** The media preset behind each view (restated from `@idealize/generate`'s `PRESET_BY_SPACE`). */
export const MEDIA_PRESET_BY_VIEW: Readonly<Record<GenerationView, string>> = { gallery: 'images', motion: 'motion', soundstage: 'sound' }

/** One model a kind can run on, as the strip's picker lists it. */
export interface StudioModel {
  backend: string
  model: string
  name: string
  /** What one typical output costs, as the provider publishes it; undefined when it publishes none. */
  price?: string
}

/** One kind's models and the stored choice (null while the app picks). */
export interface StudioModels {
  chosen: { backend: string; model: string } | null
  models: readonly StudioModel[]
}

/** Wire boundary: one catalogue entry as the media route serialised it. */
function toStudioModel(value: unknown): StudioModel | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { backend, model } = value as { backend?: unknown; model?: unknown }
  if (typeof backend !== 'string' || typeof model !== 'object' || model === null) return undefined
  const { id, name, price } = model as { id?: unknown; name?: unknown; price?: unknown }
  if (typeof id !== 'string') return undefined
  const row: StudioModel = { backend, model: id, name: typeof name === 'string' && name !== '' ? name : id }
  if (typeof price === 'object' && price !== null) {
    const { unitPrice, unit, currency, perOutput } = price as {
      unitPrice?: unknown
      unit?: unknown
      currency?: unknown
      perOutput?: { amount?: unknown; output?: unknown }
    }
    if (typeof currency === 'string') {
      if (typeof perOutput?.amount === 'number' && typeof perOutput.output === 'string') {
        row.price = `${String(perOutput.amount)} ${currency} / ${perOutput.output}`
      } else if (typeof unitPrice === 'number' && typeof unit === 'string') {
        row.price = unitPrice === 0 ? '' : `${String(unitPrice)} ${currency} / ${unit}`
      }
    }
  }
  return row
}

/**
 * Fetch one kind's models and the stored choice.
 * @param space - the view id.
 * @returns the models in name order, or an empty list when the route is absent or refuses.
 */
export async function loadStudioModels(space: GenerationView): Promise<StudioModels> {
  try {
    const response = await fetch(MEDIA_ROUTE)
    if (!response.ok) return { chosen: null, models: [] }
    const body = await response.json() as { presets?: unknown }
    const presets = Array.isArray(body.presets) ? body.presets as { id?: unknown; model?: unknown; candidates?: unknown }[] : []
    const preset = presets.find(one => one.id === MEDIA_PRESET_BY_VIEW[space])
    if (preset === undefined) return { chosen: null, models: [] }
    const stored = preset.model as { backend?: unknown; model?: unknown } | null | undefined
    const chosen = typeof stored?.backend === 'string' && typeof stored.model === 'string'
      ? { backend: stored.backend, model: stored.model }
      : null
    const models = (Array.isArray(preset.candidates) ? preset.candidates : [])
      .flatMap((entry) => { const row = toStudioModel(entry); return row === undefined ? [] : [row] })
      .sort((a, b) => a.name.localeCompare(b.name))
    return { chosen, models }
  } catch {
    return { chosen: null, models: [] }
  }
}

/**
 * Store one kind's model, or clear it so the app picks.
 * @param space - the view id.
 * @param model - the choice, or null for the app's pick.
 * @returns whether the route accepted it.
 */
export async function storeStudioModel(space: GenerationView, model: { backend: string; model: string } | null): Promise<boolean> {
  try {
    const response = await fetch(MEDIA_ROUTE, {
      method: 'POST',
      headers: { 'x-idealize-auth': '1', 'content-type': 'application/json' },
      body: JSON.stringify({ id: MEDIA_PRESET_BY_VIEW[space], model }),
    })
    return response.ok
  } catch {
    return false
  }
}

/** The panel's width in pixels, restated from the stylesheet so its place can keep it on screen. */
const PANEL_WIDTH = 300

/** How each service is written in the picker; any other backend shows its id. */
const SERVICE_NAMES: Readonly<Record<string, string>> = { openrouter: 'OpenRouter', fal: 'fal' }

/**
 * Split a kind's models by the service that runs them, in first-seen order.
 * A service that lists one name several times keeps the first, because the
 * picker shows names and two identical rows cannot be told apart.
 * @param models - the models in name order.
 * @returns one group per service.
 */
export function groupByService(models: readonly StudioModel[]): { backend: string; models: StudioModel[] }[] {
  const groups: { backend: string; models: StudioModel[] }[] = []
  for (const model of models) {
    let group = groups.find(one => one.backend === model.backend)
    if (group === undefined) {
      group = { backend: model.backend, models: [] }
      groups.push(group)
    }
    if (!group.models.some(one => one.name === model.name)) group.models.push(model)
  }
  return groups
}

/** Bound translate for the `idealize-gallery` namespace. */
type Translate = (key: GalleryKey, params?: Record<string, unknown>) => string

/**
 * The label word for one field: known names read their locale text, so the
 * fallback vocabularies and the common schema fields translate; any other
 * field shows the label the route sent.
 * @param field - the field.
 * @param space - the view id, which decides whether a duration reads Duration or Length.
 * @param t - bound translate.
 * @returns the label.
 */
export function fieldLabel(field: GenerationField, space: GenerationView, t: Translate): string {
  switch (field.name) {
    case 'aspect_ratio': return t('gallery.settings.aspect')
    case 'duration': return space === 'soundstage' ? t('gallery.settings.length') : t('gallery.settings.duration')
    case 'resolution': return t('gallery.settings.resolution')
    default: return field.label
  }
}

/** The option text for one value: `auto` and unset translate, a duration reads in seconds, anything else is shown as sent. */
function optionLabel(field: GenerationField, value: string, t: Translate): string {
  if (value === '') return t('gallery.settings.unset')
  if (value === 'auto') return t('gallery.settings.auto')
  if (field.name === 'duration' && /^\d+$/.test(value)) return t('gallery.settings.seconds', { seconds: value })
  return value
}

/* v8 ignore next 3 -- closed-union backstop; only reached if a field's kind is forged past isField */
function assertNever(value: never): never {
  throw new Error(`unreachable generation field kind: ${String(value)}`)
}

/**
 * Props the strip reads. Restated structurally: the entry carries a foreign
 * plugin's store, which the typed slot overloads cannot describe.
 */
export interface GenerationSettingsProps {
  /** Selector hook over the chat store (the ring's active view lives here). */
  useStore: <T>(selector: (state: { view: string | null }) => T) => T
  /** The chat store's actions; the kind toggle moves the ring through `setView`. */
  actions: { setView: (view: string) => void }
  /** The chat the strip belongs to. */
  sessionId: string
  /** Selector hook over this session's live input machine state. */
  useInput: <T>(selector: (state: { draft: string; locked?: boolean }) => T) => T
  /** The public input action face; the strip's single write path. */
  inputActions: { setDraft: (text: string) => void }
  /** Bound translate for the `idealize-gallery` namespace. */
  t: Translate
}

/**
 * Render the strip for the active media space.
 * @param props - composed slot props.
 * @returns the control row, or null while a non-media view is active.
 */
export function GenerationSettings({ useStore, useInput, inputActions, actions, sessionId, t }: GenerationSettingsProps) {
  const view = useStore(state => state.view)
  const draft = useInput(state => state.draft)
  const space = isGenerationView(view) ? view : null
  const [schema, setSchema] = useState<{ space: GenerationView; fields: readonly GenerationField[] } | null>(null)
  // Every setting lives in one panel that opens from the chat box. On the row
  // itself the controls ran past the card's edge and were cut off, so some
  // could not be seen or reached (JJ, 26 Nov 2026: "lets put controls into a
  // dropdown panel so you can see and access them all easily").
  const [open, setOpen] = useState(false)
  const [place, setPlace] = useState<{ bottom: number; left: number }>({ bottom: 0, left: 0 })
  const trigger = useRef<HTMLButtonElement | null>(null)
  const panel = useRef<HTMLDivElement | null>(null)

  // The panel mounts on the document body and opens upward from the trigger:
  // the chat box sits at the foot of the window and clips what hangs inside it.
  useLayoutEffect(() => {
    if (!open) return
    const measure = (): void => {
      const box = trigger.current?.getBoundingClientRect()
      if (box === undefined) return
      setPlace({
        bottom: window.innerHeight - box.top + 8,
        left: Math.max(16, Math.min(box.left, window.innerWidth - PANEL_WIDTH - 16)),
      })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => { window.removeEventListener('resize', measure) }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent): void => {
      if (!(event.target instanceof Node)) return
      if (trigger.current?.contains(event.target) === true || panel.current?.contains(event.target) === true) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setOpen(false)
      trigger.current?.focus()
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    if (space === null) return
    let live = true
    const load = (): void => {
      void loadInputs(space).then((fields) => {
        if (live) setSchema({ space, fields })
      })
    }
    load()
    document.addEventListener(BRAINS_CHANGED_EVENT, load)
    return () => {
      live = false
      document.removeEventListener(BRAINS_CHANGED_EVENT, load)
    }
  }, [space])

  // This kind's models and the one chosen, read with the schema and again
  // after a change, so the picker and the settings beside it stay in step.
  const [catalogue, setCatalogue] = useState<{ space: GenerationView } & StudioModels | null>(null)
  useEffect(() => {
    if (space === null) return
    let live = true
    const load = (): void => {
      void loadStudioModels(space).then((next) => {
        if (live) setCatalogue({ space, ...next })
      })
    }
    load()
    document.addEventListener(BRAINS_CHANGED_EVENT, load)
    return () => {
      live = false
      document.removeEventListener(BRAINS_CHANGED_EVENT, load)
    }
  }, [space])

  const onModel = useCallback((value: string) => {
    if (space === null) return
    const slash = value.indexOf('/')
    const next = value === '' ? null : { backend: value.slice(0, slash), model: value.slice(slash + 1) }
    void storeStudioModel(space, next).then((stored) => {
      if (stored) document.dispatchEvent(new CustomEvent(BRAINS_CHANGED_EVENT))
    })
  }, [space])

  const chosen = catalogue?.chosen ?? null
  const chosenKey = chosen === null ? '' : `${chosen.backend}/${chosen.model}`

  const fields = schema !== null && schema.space === space && schema.fields.length > 0
    ? schema.fields
    : space === null ? [] : FALLBACK_FIELDS[space]
  const strip: GenerationStrip = space === GALLERY_VIEW ? { fields, counts: GALLERY_COUNTS } : { fields }
  const { selection } = readSettingsTag(draft, strip)

  const write = useCallback((next: GenerationSelection) => {
    inputActions.setDraft(applySettingsTag(draft, next, strip))
  }, [draft, inputActions, strip])

  const onField = useCallback((name: string, value: string) => {
    write({ ...selection, values: { ...selection.values, [name]: value } })
  }, [selection, write])

  const onCount = useCallback((event: { target: { value: string } }) => {
    write({ ...selection, count: Number(event.target.value) })
  }, [selection, write])

  const onKind = useCallback((next: GenerationView) => {
    if (next === space) return
    // The record first, so the chat reopens on this kind after a reload; the
    // ring second, which is what the person sees change.
    document.dispatchEvent(new CustomEvent<StudioKindDetail>(STUDIO_KIND_EVENT, { detail: { sessionId, space: next } }))
    actions.setView(next)
  }, [actions, sessionId, space])

  if (space === null) return null

  // What the closed trigger says: the model, then each setting that has a value.
  const chosenName = chosen === null
    ? t('gallery.settings.auto')
    : catalogue?.models.find(one => one.backend === chosen.backend && one.model === chosen.model)?.name ?? chosen.model
  const summary = [
    chosenName,
    ...fields.flatMap((field) => {
      const value = valueOf(field, selection)
      if (value === '') return []
      return [field.kind === 'boolean' ? (value === 'true' ? fieldLabel(field, space, t) : '') : optionLabel(field, value, t)]
    }).filter(part => part !== ''),
    ...strip.counts !== undefined && selection.count > 1 ? [`× ${String(selection.count)}`] : [],
  ].join(' · ')

  /** One control by the field's kind; the label and the data attributes are shared. */
  const control = (field: GenerationField, value: string): React.ReactNode => {
    const label = fieldLabel(field, space, t)
    switch (field.kind) {
      case 'enum': {
        const options = [
          ...field.default === undefined ? [''] : [],
          ...field.values,
          ...value !== '' && !field.values.includes(value) ? [value] : [],
        ]
        return (
          <select
            className={css.select}
            aria-label={label}
            value={value}
            onChange={(event) => { onField(field.name, event.target.value) }}
            data-gen-setting={field.name}
            {...field.name === 'aspect_ratio' ? { 'data-gallery-aspect': '' } : {}}
          >
            {options.map(option => (
              <option key={option} value={option}>{optionLabel(field, option, t)}</option>
            ))}
          </select>
        )
      }
      case 'number':
        // Input and unit share one box, so the unit stays on the field's line.
        return (
          <span className={css.numberBox}>
            <input
              type="number"
              className={css.number}
              aria-label={label}
              value={value}
              inputMode={field.integer ? 'numeric' : 'decimal'}
              step={field.integer ? 1 : 'any'}
              {...field.min === undefined ? {} : { min: field.min }}
              {...field.max === undefined ? {} : { max: field.max }}
              {...field.default === undefined ? {} : { placeholder: String(field.default) }}
              onChange={(event) => { onField(field.name, event.target.value.trim()) }}
              data-gen-setting={field.name}
            />
            {field.name === 'duration' ? <span className={css.unit}>{t('gallery.settings.secondsUnit')}</span> : null}
          </span>
        )
      case 'boolean':
        return (
          <input
            type="checkbox"
            className={css.checkbox}
            aria-label={label}
            checked={value === 'true'}
            onChange={(event) => { onField(field.name, event.target.checked ? 'true' : 'false') }}
            data-gen-setting={field.name}
          />
        )
      /* v8 ignore next -- closed GenerationField kind union */
      default: return assertNever(field)
    }
  }

  return (
    <div
      className={css.row}
      data-gen-settings-space={space}
      {...space === GALLERY_VIEW ? { 'data-gallery-settings': '' } : {}}
    >
      <span className={css.kinds} role="radiogroup" aria-label={t('gallery.kind.label')} data-studio-kinds="">
        {STUDIO_KINDS.map(kind => (
          <button
            key={kind.space}
            type="button"
            role="radio"
            aria-checked={kind.space === space}
            className={kind.space === space ? css.kindOn : css.kind}
            data-studio-kind={kind.space}
            onClick={() => { onKind(kind.space) }}
          >
            {t(kind.label)}
          </button>
        ))}
      </span>
      <button
        ref={trigger}
        type="button"
        className={css.trigger}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`${t('gallery.settings.open')}: ${summary}`}
        title={t('gallery.settings.hint')}
        data-gen-settings-open=""
        onClick={() => { setOpen(current => !current) }}
      >
        <span className={css.summary} data-gen-settings-summary="">{summary}</span>
        <svg className={open ? css.chevronOpen : css.chevron} width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2 6.5 5 3.5l3 3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {/* Mounted while closed too, so a setting keeps its control and its value between openings. */}
      {createPortal(
        <div
          ref={panel}
          className={css.panel}
          style={place}
          role="dialog"
          aria-label={t('gallery.settings.open')}
          hidden={!open}
          data-gen-settings-panel={space}
        >
          {catalogue !== null && catalogue.space === space && catalogue.models.length > 0 && (
            <label className={css.control}>
              <span className={css.label}>{t('gallery.settings.model')}</span>
              <select
                className={css.modelSelect}
                aria-label={t('gallery.settings.model')}
                value={chosenKey}
                onChange={(event) => { onModel(event.target.value) }}
                data-studio-model=""
              >
                <option value="">{t('gallery.settings.auto')}</option>
                {chosenKey !== '' && !catalogue.models.some(one => `${one.backend}/${one.model}` === chosenKey) && (
                  <option value={chosenKey}>{catalogue.chosen?.model}</option>
                )}
                {groupByService(catalogue.models).map(group => (
                  <optgroup key={group.backend} label={SERVICE_NAMES[group.backend] ?? group.backend}>
                    {group.models.map(one => (
                      <option key={`${one.backend}/${one.model}`} value={`${one.backend}/${one.model}`}>
                        {one.price === undefined || one.price === '' ? one.name : `${one.name} · ${one.price}`}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
          )}
          {fields.map(field => (
            <label key={field.name} className={css.control} data-gen-setting-kind={field.kind}>
              <span className={css.label}>{fieldLabel(field, space, t)}</span>
              {control(field, valueOf(field, selection))}
            </label>
          ))}
          {strip.counts === undefined ? null : (
            <label className={css.control}>
              <span className={css.label}>{t('gallery.settings.count')}</span>
              <select className={css.select} aria-label={t('gallery.settings.count')} value={selection.count} onChange={onCount} data-gen-setting="count" data-gallery-count="">
                {strip.counts.map(count => <option key={count} value={count}>{count}</option>)}
              </select>
            </label>
          )}
          <p className={css.hint}>{t('gallery.settings.hint')}</p>
        </div>,
        document.body,
      )}
    </div>
  )
}
