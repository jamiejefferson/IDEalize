/**
 * The generation settings strip: one compact control per setting the active
 * space's model takes (a select for an enum, a number input for a number, a
 * checkbox for a switch), on the composer card's tool row (beside the plus and
 * the mode chips), shown while this chat's view ring sits on Images, Video or
 * the Sound Stage. The entry shares the chat view's store (the ui-terminal
 * ModeShortcut pattern), so the strip appears and disappears with the view
 * instead of following every chat in the app.
 *
 * The strip carries the creation variables and nothing else. It names no
 * model: the space's generation model belongs to its brain and is chosen in
 * the Brains pane, and a picker here stated it a second time beside the
 * composer's own chat-model seat, which in a media space drives only the tool
 * (JJ, 13 Sep 2026: "the model is defined by the brain and therefore doesn't
 * need to be shown. its also shown twice - one of them being wrong"). The
 * sheet retires the chat-model seat on a media view for the same reason.
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

/** How far an element's content runs past its box. */
function overflowOf(element: Element): number {
  return Math.max(0, element.scrollWidth - element.clientWidth)
}

/**
 * Whether the tool row the strip sits in has less room than its content asks
 * for. The row's leading boxes shrink (`min-width: 0`) while its trailing half
 * does not, so on a narrow window the mode chip's box shrank under its text and
 * the chip overlapped the strip's labels (walk of 7 Sep 2026, 1280px); the row
 * itself never overflows, its siblings do. The strip then stacks each label
 * above its control in small type, which costs no width; a switch keeps its
 * word beside the box.
 *
 * The row is the nearest ancestor with a width: the slot renderer wraps the
 * strip in a box of none, and while the card is not laid out yet every
 * ancestor reads zero, so the row is resolved on every measurement, and the
 * strip watches its own size to measure again once it has one. `needed`
 * remembers the row width the labelled strip asked for (the row plus every
 * sibling's overflow), so the labels return only once the row has grown back to
 * it: measuring the compact strip alone would flip the labels on and off.
 * @param row - the strip's root element, null while a non-media view is active.
 * @param space - the active media view, null while the strip renders nothing; a
 * change re-runs the measurement, since the root element comes and goes with it.
 * @returns the compact flag, false until a measurement says otherwise.
 */
function useCompact(row: React.RefObject<HTMLDivElement | null>, space: GenerationView | null): boolean {
  const [compact, setCompact] = useState(false)
  const needed = useRef(0)
  useLayoutEffect(() => {
    const strip = row.current
    if (space === null || strip === null || typeof ResizeObserver === 'undefined') return
    const observed = new Set<Element>()
    const measure = (): void => {
      let box = strip.parentElement
      while (box !== null && box.clientWidth === 0) box = box.parentElement
      if (box === null || box === document.documentElement) return
      const siblings = [...box.children].filter(child => !child.contains(strip))
      for (const element of [box, ...siblings]) {
        if (observed.has(element)) continue
        observed.add(element)
        observer.observe(element)
      }
      const excess = overflowOf(box) + siblings.reduce((sum, child) => sum + overflowOf(child), 0)
      if (!compact) needed.current = box.clientWidth + excess
      setCompact(compact ? box.clientWidth < needed.current : excess > 0)
    }
    const observer = new ResizeObserver(measure)
    observed.add(strip)
    observer.observe(strip)
    measure()
    return () => { observer.disconnect() }
  }, [row, compact, space])
  return compact
}

/**
 * Props the strip reads. Restated structurally: the entry carries a foreign
 * plugin's store, which the typed slot overloads cannot describe.
 */
export interface GenerationSettingsProps {
  /** Selector hook over the chat store (the ring's active view lives here). */
  useStore: <T>(selector: (state: { view: string | null }) => T) => T
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
export function GenerationSettings({ useStore, useInput, inputActions, t }: GenerationSettingsProps) {
  const view = useStore(state => state.view)
  const draft = useInput(state => state.draft)
  const space = isGenerationView(view) ? view : null
  const [schema, setSchema] = useState<{ space: GenerationView; fields: readonly GenerationField[] } | null>(null)
  const root = useRef<HTMLDivElement | null>(null)
  const compact = useCompact(root, space)

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

  if (space === null) return null

  // The switches sit together after the other controls, so a compact row can
  // stack them in one column: box-then-word twice costs the width of one.
  const switches = fields.filter(field => field.kind === 'boolean')

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
        // Input and unit share one box: a compact row stacks the label above
        // the control, and without this wrapper the unit became a third line
        // under the field (JJ, 9 Sep 2026).
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
      ref={root}
      className={css.row}
      data-gen-settings-space={space}
      {...compact ? { 'data-gen-settings-compact': '' } : {}}
      {...space === GALLERY_VIEW ? { 'data-gallery-settings': '' } : {}}
      title={t('gallery.settings.hint')}
    >
      {fields.filter(field => field.kind !== 'boolean').map(field => (
        <label key={field.name} className={css.control} title={fieldLabel(field, space, t)} data-gen-setting-kind={field.kind}>
          <span className={css.label}>{fieldLabel(field, space, t)}</span>
          {control(field, valueOf(field, selection))}
        </label>
      ))}
      {switches.length === 0 ? null : (
        <span className={css.switches} data-gen-switches="">
          {switches.map(field => (
            <label key={field.name} className={css.control} title={fieldLabel(field, space, t)} data-gen-setting-kind={field.kind}>
              {control(field, valueOf(field, selection))}
              <span className={css.switchLabel}>{fieldLabel(field, space, t)}</span>
            </label>
          ))}
        </span>
      )}
      {strip.counts === undefined ? null : (
        <label className={css.control} title={t('gallery.settings.count')}>
          <span className={css.label}>{t('gallery.settings.count')}</span>
          <select className={css.select} aria-label={t('gallery.settings.count')} value={selection.count} onChange={onCount} data-gen-setting="count" data-gallery-count="">
            {strip.counts.map(count => <option key={count} value={count}>{count}</option>)}
          </select>
        </label>
      )}
    </div>
  )
}
