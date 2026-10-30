/**
 * The model browser: one modal that chooses every kind of model the Brains
 * sheet asks for (chat, image, video, sound), over the whole catalogue a
 * select could not show. Search, Takes, Good at and Controls chips, a Client work only
 * switch and a sort narrow and order a windowed list on the left; the
 * selected model's sample, description and facts read on the right; the
 * footer applies the choice (Paper "Model picker" boards 02 to 04, approved
 * by JJ on 23 Oct 2026). The rows come from model-browser.ts; this file only
 * renders them and fetches a media model's example output when it is
 * selected, so 400 rows never cost 400 schema reads.
 * @module @idealize/ui-bar/client/ModelBrowser
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { BarKey } from './locales.ts'
import {
  byline, filterModels, hasLicences, monthYear, PRICE_UNIT, sortModels, takesOffered, controlsOffered, goodAtOffered,
  ratingSummary, ratingTags, starsOf, tagKey,
} from './model-browser.ts'
import type { BrowserKind, BrowserModel, BrowserSort, RatingMap, Takes, Translate } from './model-browser.ts'
import css from './ModelBrowser.module.css'

/** An example output the backend publishes for a media model. */
export interface BrowserExample {
  url: string
  mediaType: string
}

export interface ModelBrowserProps {
  kind: BrowserKind
  /** The space or role the model is chosen for, as the eyebrow names it. */
  spaceLabel: string
  /** The catalogue; null while it is still being read. */
  models: readonly BrowserModel[] | null
  /** The value in use (`provider model`), empty for none or the default. */
  current: string
  /** Who publishes media samples, for the sample caption. */
  sampleSource?: string | undefined
  /** Offered for a chat model, whose empty choice follows the default model. */
  allowDefault?: boolean
  t: Translate
  onApply: (value: string) => void
  onClose: () => void
  /** Fetch one media model's example output; resolves null when it has none. */
  fetchExample?: (provider: string, model: string) => Promise<BrowserExample | null>
  /** The person's ratings; with {@link onRate}, the detail pane carries Your ratings. */
  ratings?: RatingMap | undefined
  /** Set (1 to 5) or clear (null) one tag's stars on a model. */
  onRate?: ((model: BrowserModel, tag: string, stars: number | null) => void) | undefined
}

/** Every list row is this tall, which is what lets the list render only the rows in view. */
export const ROW_HEIGHT = 62
/** Rows rendered beyond each edge of the view, so a fast scroll never shows a gap. */
const OVERSCAN = 6
/** Rows rendered before the list has measured itself (jsdom never does). */
const FIRST_PAINT_ROWS = 24

const TAKES_LABEL: Readonly<Record<Takes, BarKey>> = {
  text: 'browser.takes.text',
  image: 'browser.takes.image',
  file: 'browser.takes.file',
  audio: 'browser.takes.audio',
  video: 'browser.takes.video',
}

const SORTS: readonly BrowserSort[] = ['cheapest', 'newest', 'name']
const SORTS_RATED: readonly BrowserSort[] = ['rated', ...SORTS]

/** The waveform the sound player draws, as bar heights in px (board 04). */
const WAVE = [6, 12, 18, 10, 16, 8, 14, 20, 10, 14, 6, 16, 12, 18, 8, 14, 10, 18, 12, 6, 16, 10, 14, 20, 8, 12, 16, 6, 14, 10, 18, 8, 12, 6]

/** One input kind as a glyph: "Aa" for text, a drawn icon for the rest. */
function TakesGlyph({ takes, label }: { takes: Takes; label: string }): ReactNode {
  return (
    <span className={css.glyph} title={label} aria-label={label} role="img">
      {takes === 'text' && <span className={css.glyphText} aria-hidden="true">Aa</span>}
      {takes === 'image' && (
        <svg width="13" height="13" viewBox="0 0 13 13" aria-hidden="true">
          <rect x="1" y="2" width="11" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <path d="M2 10l3-3 2 2 2-2 2 2" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        </svg>
      )}
      {takes === 'file' && (
        <svg width="12" height="13" viewBox="0 0 12 13" aria-hidden="true">
          <path d="M2.5 1h5l3 3v8h-8z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        </svg>
      )}
      {takes === 'audio' && (
        <svg width="13" height="13" viewBox="0 0 13 13" aria-hidden="true">
          <path d="M2 5v3M4.5 3v7M7 1.5v10M9.5 4v5M12 5.5v2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      )}
      {takes === 'video' && (
        <svg width="13" height="13" viewBox="0 0 13 13" aria-hidden="true">
          <rect x="1" y="3" width="8" height="7" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <path d="M9 6l3-2v5l-3-2z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  )
}

/**
 * The browser itself, rendered into the document body so it sits over the
 * whole window rather than inside the Brains pane.
 * @param props - the kind, catalogue, current choice and callbacks.
 * @returns the portal.
 */
export function ModelBrowser(props: ModelBrowserProps): ReactNode {
  const { kind, models, current, t } = props
  const all = useMemo(() => models ?? [], [models])
  const licensed = hasLicences(all)
  // A route that publishes no dates (a subscription's list) would fill the
  // lane with dashes; without one, the lane goes and the name takes its room.
  const dated = all.some(row => row.released !== undefined)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<BrowserSort>('cheapest')
  const [takes, setTakes] = useState<Takes[]>([])
  const [goodAt, setGoodAt] = useState<BarKey[]>([])
  const [controls, setControls] = useState<BarKey[]>([])
  const [clientOnly, setClientOnly] = useState(true)
  const [selected, setSelected] = useState(current)
  const rates = props.onRate !== undefined
  const shown = useMemo(
    () => sortModels(filterModels(all, { query, takes, goodAt, controls, clientOnly: licensed && clientOnly }), sort, props.ratings),
    [all, query, takes, goodAt, controls, clientOnly, licensed, sort, props.ratings],
  )
  // The current model is selected when the catalogue arrives, so the detail
  // pane opens on what is in use.
  useEffect(() => { setSelected(current) }, [current, models])
  const model = all.find(row => row.value === selected)

  // ── Windowed list ───────────────────────────────────────────────────────
  const listRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewHeight, setViewHeight] = useState(0)
  useEffect(() => {
    const list = listRef.current
    if (list === null) return
    const measure = (): void => { setViewHeight(list.clientHeight) }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(list)
    return () => { observer.disconnect() }
  }, [models])
  // The selected row is scrolled into view when the browser opens on it.
  const scrolledTo = useRef(false)
  useEffect(() => {
    if (scrolledTo.current || models === null || listRef.current === null) return
    const index = shown.findIndex(row => row.value === current)
    if (index > 0) listRef.current.scrollTop = Math.max(0, index * ROW_HEIGHT - ROW_HEIGHT * 2)
    scrolledTo.current = true
  }, [models, shown, current])
  const visibleRows = viewHeight === 0 ? FIRST_PAINT_ROWS : Math.ceil(viewHeight / ROW_HEIGHT)
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const last = Math.min(shown.length, Math.floor(scrollTop / ROW_HEIGHT) + visibleRows + OVERSCAN)

  // ── Example output, fetched when a media model is selected ─────────────
  const [examples, setExamples] = useState<Record<string, BrowserExample | null>>({})
  const [playing, setPlaying] = useState(false)
  const clip = useRef<HTMLVideoElement>(null)
  // Chrome can leave an autoplay clip unloaded; an explicit play() fetches and starts it.
  useEffect(() => {
    if (playing) void clip.current?.play().catch(() => { setPlaying(false) })
  }, [playing])
  useEffect(() => {
    setPlaying(false)
    if (model === undefined || !model.hasExample || props.fetchExample === undefined) return
    if (model.value in examples) return
    let live = true
    void props.fetchExample(model.provider, model.id).then(
      (example) => { if (live) setExamples(held => ({ ...held, [model.value]: example })) },
      () => { if (live) setExamples(held => ({ ...held, [model.value]: null })) },
    )
    return () => { live = false }
    // Keyed on the model alone: re-running on every examples change would refetch.
  }, [model?.value])
  const example = model === undefined ? undefined : examples[model.value] ?? undefined

  // ── Keyboard: Escape closes, arrows move the selection ─────────────────
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      props.onClose()
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    if ((event.target as HTMLElement).tagName === 'SELECT') return
    event.preventDefault()
    const index = shown.findIndex(row => row.value === selected)
    const next = shown[Math.min(shown.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)))]
    if (next === undefined) return
    setSelected(next.value)
    const list = listRef.current
    if (list === null) return
    const top = shown.indexOf(next) * ROW_HEIGHT
    if (top < list.scrollTop) list.scrollTop = top
    else if (top + ROW_HEIGHT > list.scrollTop + list.clientHeight) list.scrollTop = top + ROW_HEIGHT - list.clientHeight
  }

  const toggle = <T,>(list: readonly T[], value: T): T[] =>
    list.includes(value) ? list.filter(one => one !== value) : [...list, value]
  const kindLabel = t(`browser.kind.${kind}`)
  const makesLabel = t(`browser.makes.${kind}`)
  const keep = selected === current && selected !== ''
  const chosenName = model?.name ?? ''

  const body = (
    <div className={css.scrim} onMouseDown={(event) => { if (event.target === event.currentTarget) props.onClose() }}>
      <div
        className={css.browser}
        role="dialog"
        aria-modal="true"
        aria-label={t('browser.title')}
        data-model-browser={kind}
        onKeyDown={onKeyDown}
      >
        <header className={css.head}>
          <div className={css.titles}>
            <span className={css.eyebrow}>
              {/* "Video · video model" says one thing twice; a space named after its kind reads once. */}
              {props.spaceLabel.toLowerCase() === kindLabel.toLowerCase()
                ? t('browser.eyebrowKind', { kind: kindLabel })
                : t('browser.eyebrow', { space: props.spaceLabel, kind: kindLabel })}
            </span>
            <h2 className={css.title}>{t('browser.title')}</h2>
          </div>
          <div className={css.headEnd}>
            <span className={css.count} data-browser-count="">
              {t('browser.count', { shown: shown.length, total: all.length })}
            </span>
            <button type="button" className={css.close} aria-label={t('browser.close')} onClick={props.onClose}>
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </header>

        <div className={css.searchRow}>
          <label className={css.search}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M9.5 9.5L13 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <input
              type="search"
              className={css.searchInput}
              data-browser-search=""
              aria-label={t(`browser.search.${kind}`)}
              placeholder={t(`browser.search.${kind}`)}
              value={query}
              // The search box takes the focus the dialog opens with.
              autoFocus
              onChange={(event) => { setQuery(event.target.value) }}
            />
          </label>
          <label className={css.sort}>
            <span className={css.sortLabel}>{t('browser.sort')}</span>
            <select
              className={css.sortSelect}
              data-browser-sort=""
              value={sort}
              onChange={(event) => { setSort(event.target.value as BrowserSort) }}
            >
              {(rates ? SORTS_RATED : SORTS).map(one => <option key={one} value={one}>{t(`browser.sort.${one}`)}</option>)}
            </select>
          </label>
        </div>

        <div className={css.filters}>
          <div className={css.chipGroup} role="group" aria-label={t('browser.takes')}>
            <span className={css.groupLabel}>{t('browser.takes')}</span>
            {takesOffered(all).map(one => (
              <button
                key={one}
                type="button"
                className={css.chip}
                aria-pressed={takes.includes(one)}
                data-browser-takes={one}
                onClick={() => { setTakes(toggle(takes, one)) }}
              >
                {t(TAKES_LABEL[one])}
              </button>
            ))}
          </div>
          <div className={css.chipGroup} role="group" aria-label={t('browser.goodAt')}>
            <span className={css.groupLabel}>{t('browser.goodAt')}</span>
            {goodAtOffered(kind, all).map(label => (
              <button
                key={label}
                type="button"
                className={css.chip}
                aria-pressed={goodAt.includes(label)}
                data-browser-good-at={label}
                onClick={() => { setGoodAt(toggle(goodAt, label)) }}
              >
                {t(label)}
              </button>
            ))}
          </div>
          <div className={css.chipGroup} role="group" aria-label={t('browser.controls')}>
            <span className={css.groupLabel}>{t('browser.controls')}</span>
            {controlsOffered(kind, all).map(control => (
              <button
                key={control}
                type="button"
                className={css.chip}
                aria-pressed={controls.includes(control)}
                data-browser-control={control}
                onClick={() => { setControls(toggle(controls, control)) }}
              >
                {t(control)}
              </button>
            ))}
          </div>
          {licensed && (
            <label className={css.switchRow}>
              <input
                type="checkbox"
                role="switch"
                className={css.switchInput}
                data-browser-client-only=""
                checked={clientOnly}
                onChange={(event) => { setClientOnly(event.target.checked) }}
              />
              <span className={css.switchTrack} aria-hidden="true"><span className={css.switchKnob} /></span>
              {t('browser.clientOnly')}
            </label>
          )}
        </div>

        <div className={css.body}>
          <div className={css.listPane}>
            <div className={css.columns} aria-hidden="true">
              <span className={css.colModel}>{t('browser.col.model')}</span>
              <span className={css.colTakes}>{t('browser.col.takes')}</span>
              {dated && <span className={css.colReleased}>{t('browser.col.released')}</span>}
              <span className={css.colPrice}>{t(PRICE_UNIT[kind])}</span>
            </div>
            <div
              ref={listRef}
              className={css.list}
              role="listbox"
              aria-label={t('browser.title')}
              data-browser-list=""
              onScroll={(event) => { setScrollTop(event.currentTarget.scrollTop) }}
            >
              {models === null && <p className={css.empty}>{t('browser.loading')}</p>}
              {models !== null && shown.length === 0 && <p className={css.empty}>{t('browser.empty')}</p>}
              <div style={{ height: shown.length * ROW_HEIGHT, position: 'relative' }}>
                {shown.slice(first, last).map((row, offset) => {
                  const extra = row.takes.length - 3
                  const released = monthYear(row.released)
                  const rated = rates ? ratingSummary(starsOf(props.ratings, row), t) : undefined
                  return (
                    <div
                      key={row.value}
                      role="option"
                      aria-selected={row.value === selected}
                      tabIndex={row.value === selected ? 0 : -1}
                      className={css.row}
                      data-browser-row={row.value}
                      data-in-use={row.value === current ? '' : undefined}
                      style={{ top: (first + offset) * ROW_HEIGHT }}
                      onClick={() => { setSelected(row.value) }}
                      onDoubleClick={() => { props.onApply(row.value) }}
                    >
                      <span className={css.cellModel}>
                        <span className={css.rowName}>{row.name}</span>
                        <span className={css.rowMaker}>
                          <span data-browser-byline="">{byline(row)}</span>
                          {rated !== undefined && <span className={css.rowRating} data-browser-row-rating="">{` · ${rated}`}</span>}
                        </span>
                      </span>
                      <span className={css.cellTakes}>
                        {row.takes.slice(0, 3).map(one => <TakesGlyph key={one} takes={one} label={t(TAKES_LABEL[one])} />)}
                        {extra > 0 && <span className={css.glyph}>{t('browser.more', { count: extra })}</span>}
                      </span>
                      {dated && <span className={css.cellReleased}>{released ?? '—'}</span>}
                      <span className={css.cellPrice}>
                        {row.price.headline === undefined
                          ? (
                            <>
                              <span className={css.priceMuted}>—</span>
                              <span className={css.priceSubMuted}>{t('browser.noPrice')}</span>
                            </>
                          )
                          : (
                            <>
                              <span className={row.price.comparable ? css.price : css.priceMuted}>{row.price.headline}</span>
                              {row.price.sub !== undefined && (
                                <span className={row.price.comparable ? css.priceSub : css.priceSubMuted}>{row.price.sub}</span>
                              )}
                            </>
                          )}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          <div className={css.detail} data-browser-detail={model?.value ?? ''}>
            {model !== undefined && (
              <>
                {model.thumbnailUrl !== undefined && kind !== 'chat' && (
                  <div className={css.sample} data-browser-sample="">
                    <div className={css.sampleFrame}>
                      {playing && example?.mediaType.startsWith('video/') === true
                        ? (
                          // Example clips carry no captions: they are the provider's silent or musical samples.
                          <video ref={clip} className={css.sampleMedia} src={example.url} controls playsInline data-browser-video="" />
                        )
                        : <img className={css.sampleMedia} src={model.thumbnailUrl} alt="" />}
                      {kind === 'video' && example !== undefined && !playing && (
                        <button type="button" className={css.playPill} data-browser-play="" onClick={() => { setPlaying(true) }}>
                          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                            <circle cx="9" cy="9" r="9" fill="currentColor" />
                            <path d="M7 5.5v7l5.5-3.5z" className={css.playMark} />
                          </svg>
                          {t('browser.play')}
                        </button>
                      )}
                      {kind === 'audio' && example !== undefined && <SoundPlayer url={example.url} t={t} />}
                    </div>
                    <span className={css.caption}>
                      {kind === 'image' || example === undefined
                        ? t('browser.sample', { from: props.sampleSource ?? '' })
                        : t(kind === 'video' ? 'browser.example.video' : 'browser.example.audio', { from: props.sampleSource ?? '' })}
                    </span>
                  </div>
                )}
                <div className={css.identity}>
                  {model.value === current && <span className={css.eyebrow}>{t('browser.inUse')}</span>}
                  <h3 className={css.detailName}>{model.name}</h3>
                  {(model.maker !== undefined || model.released !== undefined) && (
                    <span className={css.detailMaker}>
                      {model.released === undefined
                        ? model.maker
                        : model.maker === undefined
                          ? t('browser.released', { date: monthYear(model.released) ?? '' })
                          : t('browser.makerReleased', { maker: model.maker, date: monthYear(model.released) ?? '' })}
                    </span>
                  )}
                </div>
                {model.description !== undefined && <p className={css.description}>{model.description}</p>}
                {props.onRate !== undefined && (
                  <RatingsBox
                    // Keyed by model, so a tag added to one model's card is not offered on the next.
                    key={model.value}
                    kind={model.makes}
                    stars={starsOf(props.ratings, model)}
                    t={t}
                    onRate={(tag, stars) => { props.onRate?.(model, tag, stars) }}
                  />
                )}
                <dl className={css.facts}>
                  <Fact label={t('browser.fact.takes')} value={model.takes.map(one => t(TAKES_LABEL[one])).join(', ')} />
                  <Fact label={t('browser.fact.makes')} value={makesLabel} />
                  {model.goodAt.length > 0 && <Fact label={t('browser.fact.goodAt')} value={model.goodAt.map(key => t(key)).join(' · ')} />}
                  {model.controls.length > 0 && <Fact label={t('browser.fact.controls')} value={model.controls.map(key => t(key)).join(' · ')} />}
                  {model.licence !== undefined && (
                    <Fact
                      label={t('browser.fact.licence')}
                      value={model.licence === 'commercial' ? t('browser.licence.commercial') : model.licence === 'research' ? t('browser.licence.research') : model.licence}
                    />
                  )}
                  {model.contextWindow !== undefined && (
                    <Fact label={t('browser.fact.context')} value={t('browser.tokens', { count: model.contextWindow.toLocaleString('en-GB') })} figure />
                  )}
                  {model.price.lines.map(line => <Fact key={line.label} label={line.label} value={line.value} figure={line.figure} />)}
                  {model.price.from !== undefined && <Fact label={t('browser.fact.priceFrom')} value={model.price.from} />}
                </dl>
              </>
            )}
          </div>
        </div>

        <footer className={css.foot}>
          <span className={css.footNote}>
            {props.allowDefault === true && current !== ''
              ? (
                <button type="button" className={css.linkButton} data-browser-default="" onClick={() => { props.onApply('') }}>
                  {t('browser.useDefault')}
                </button>
              )
              : t(`browser.footer.${kind}`)}
          </span>
          <span className={css.footActions}>
            <button type="button" className={css.secondary} onClick={props.onClose}>{t('browser.cancel')}</button>
            <button
              type="button"
              className={css.primary}
              data-browser-apply=""
              disabled={model === undefined}
              onClick={() => { if (model !== undefined) props.onApply(model.value) }}
            >
              {model === undefined ? t('browser.title') : t(keep ? 'browser.keep' : 'browser.use', { name: chosenName })}
            </button>
          </span>
        </footer>
      </div>
    </div>
  )
  return createPortal(body, document.body)
}

/** A star, filled or open, drawn at the size of the card's text. */
function Star({ filled }: { filled: boolean }): ReactNode {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"
        className={filled ? css.starFilled : css.starOpen}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * Your ratings on a model's card (Paper "Ratings and dislike" board 05): a row
 * of stars per rated tag, then the kind's other tags as chips that add a row.
 * Tapping a star sets the rating and tapping it again clears it.
 */
function RatingsBox({ kind, stars, t, onRate }: {
  kind: BrowserKind
  stars: Readonly<Record<string, number>>
  t: Translate
  onRate: (tag: string, stars: number | null) => void
}): ReactNode {
  const tags = ratingTags(kind)
  const [adding, setAdding] = useState<string[]>([])
  const rows = tags.filter(tag => stars[tag] !== undefined || adding.includes(tag))
  const offered = tags.filter(tag => !rows.includes(tag))
  return (
    <section className={css.ratings} aria-label={t('browser.ratings')} data-browser-ratings="">
      <span className={css.eyebrow}>{t('browser.ratings')}</span>
      {rows.map((tag) => {
        const label = t(tagKey(tag))
        const value = stars[tag] ?? 0
        return (
          <div key={tag} className={css.ratingRow} data-browser-rating={tag} data-stars={value}>
            <span className={css.ratingTag}>{label}</span>
            <span className={css.ratingEnd}>
              <button
                type="button"
                className={css.ratingRemove}
                aria-label={t('browser.ratings.remove', { tag: label })}
                data-browser-rating-remove={tag}
                onClick={() => {
                  setAdding(adding.filter(one => one !== tag))
                  if (stars[tag] !== undefined) onRate(tag, null)
                }}
              >
                <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
                  <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </button>
              <span className={css.ratingStars} role="group" aria-label={label}>
                {[1, 2, 3, 4, 5].map(count => (
                  <button
                    key={count}
                    type="button"
                    className={css.starButton}
                    aria-pressed={value >= count}
                    aria-label={t('browser.ratings.star', { count, tag: label })}
                    data-browser-star={count}
                    onClick={() => { onRate(tag, value === count ? null : count) }}
                  >
                    <Star filled={value >= count} />
                  </button>
                ))}
              </span>
            </span>
          </div>
        )
      })}
      {offered.length > 0 && (
        <div className={css.ratingAdd}>
          <span className={css.ratingAddLabel}>{t('browser.ratings.add')}</span>
          <div className={css.ratingChips}>
            {offered.map(tag => (
              <button
                key={tag}
                type="button"
                className={css.ratingChip}
                data-browser-rating-add={tag}
                onClick={() => { setAdding([...adding, tag]) }}
              >
                {`+ ${t(tagKey(tag))}`}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

/** One line of the facts table. */
function Fact({ label, value, figure }: { label: string; value: string; figure?: boolean | undefined }): ReactNode {
  return (
    <div className={css.fact}>
      <dt className={css.factLabel}>{label}</dt>
      <dd className={figure === true ? css.factFigure : css.factValue}>{value}</dd>
    </div>
  )
}

/**
 * The sound sample's player: a play button and a waveform that fills as the
 * example plays, laid over the model's picture (board 04).
 */
function SoundPlayer({ url, t }: { url: string; t: Translate }): ReactNode {
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const toggle = (): void => {
    const element = audio.current
    if (element === null) return
    if (element.paused) void element.play().catch(() => { setPlaying(false) })
    else element.pause()
  }
  const lit = Math.round(progress * WAVE.length)
  return (
    <div className={css.player} data-browser-player="">
      <audio
        ref={audio}
        src={url}
        preload="none"
        data-browser-audio=""
        onPlay={() => { setPlaying(true) }}
        onPause={() => { setPlaying(false) }}
        onEnded={() => { setPlaying(false); setProgress(0) }}
        onTimeUpdate={(event) => {
          const { currentTime, duration } = event.currentTarget
          setProgress(Number.isFinite(duration) && duration > 0 ? currentTime / duration : 0)
        }}
      />
      <button
        type="button"
        className={css.playerButton}
        aria-label={t(playing ? 'browser.pause' : 'browser.play')}
        data-browser-play=""
        onClick={toggle}
      >
        <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
          <circle cx="13" cy="13" r="13" fill="currentColor" />
          {playing
            ? <path d="M10 8.5v9M16 8.5v9" className={css.playStroke} strokeWidth="2.4" strokeLinecap="round" />
            : <path d="M10.5 8v10l8-5z" className={css.playMark} />}
        </svg>
      </button>
      <svg className={css.wave} viewBox={`0 0 ${String(WAVE.length * 7)} 22`} preserveAspectRatio="none" aria-hidden="true">
        {WAVE.map((height, index) => (
          <rect
            // The bars are a fixed drawing; their index is their identity.
            key={index}
            x={index * 7}
            y={(22 - height) / 2}
            width="3"
            height={height}
            rx="1.5"
            className={index < lit ? css.waveLit : css.waveDim}
          />
        ))}
      </svg>
    </div>
  )
}
