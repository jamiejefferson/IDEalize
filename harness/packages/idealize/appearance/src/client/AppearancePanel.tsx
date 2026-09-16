/**
 * The appearance inspector (V0's AppearancePanel): a Theme tab for the
 * globals and one tab per surface (Projects, Panels, Chat, Document) for its
 * typography and background, the Chat tab adding the chat panel's own
 * scalars. Pure presentation over the store; every write goes through the
 * injected face so the plugin body stays the single writer.
 */
import { useEffect, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  actionCustomised, APPEARANCE_DEFAULTS, FILL_MODES, FONT_WEIGHTS, fontStack, GRADIENT_TYPES, PRESETS, SURFACES,
  surfaceColoured, surfaceCustomised, surfaceScheme, terminalCustomised, UI_SIZE_MAX, UI_SIZE_MIN,
  type ActionAppearance, type AppearanceSettings, type FillMode, type GradientStop, type GradientType, type PresetId,
  type SurfaceAppearance, type SurfaceId, type TerminalAppearanceSettings,
} from '../appearance-settings.ts'
import { TERMINAL_THEMES, terminalTheme } from '../terminal-themes.ts'
import { blend, parseHex, requireHex, toHex, UI_CONTRAST } from '../colour.ts'
import { presetPalette, resolveAppearance, surfaceHex, type Palette } from '../presets.ts'
import { actionAccent, gradientCss, seedStops, SURFACE_EXEMPT_ATTRIBUTE, type PanelScalars } from '../surface-css.ts'
import { SECTIONS, type AppearanceStore, type ModeId, type SectionId } from './store.ts'
import type { AppearanceKey } from './locales.ts'
import css from './AppearancePanel.module.css'

/** Registration-side face: the state hook plus the writes the panel can ask for. */
export interface AppearancePanelInjected {
  hooks: {
    /** The panel state (arrives as the `useAppearance` selector hook). */
    appearance: AppearanceStore
  }
  /** Hide the panel. */
  close: () => void
  /** Switch tab. */
  setSection: (section: SectionId) => void
  /** Switch light/dark/system (ui-theme's preference). */
  setMode: (mode: ModeId) => void
  /** Choose a preset; single-scheme presets also set the mode. */
  choosePreset: (preset: PresetId) => void
  /** Set or clear (empty string) the user's ground. */
  setGround: (hex: string) => void
  /** Patch the action colour. */
  setAction: (patch: Partial<ActionAppearance>) => void
  /** Set the interface font family; empty is the platform stack. */
  setUiFont: (family: string) => void
  /** Set the interface size in points. */
  setUiSize: (size: number) => void
  /** Patch one surface's override. */
  setSurface: (id: SurfaceId, patch: Partial<SurfaceAppearance>) => void
  /** Patch the chat panel's scalars. */
  setScalars: (patch: Partial<PanelScalars>) => void
  /** Patch the terminal grid's appearance. */
  setTerminal: (patch: Partial<TerminalAppearanceSettings>) => void
  /** Restore one tab's settings to their defaults (the Theme tab includes the mode). */
  resetSection: (section: SectionId) => void
}

/** Full props of the panel as a root-scoped slot occupant (a host composes these). */
export type AppearancePanelProps = PropsRuntime<'shell.drawer'>
  & PropsLocale<'idealize-appearance'>
  & InjectFace<AppearancePanelInjected>

/** The props the panel itself consumes (a host may supply them without the slot runtime). */
export type AppearancePanelComponentProps = Pick<AppearancePanelProps, 'useAppearance' | 't'> & Omit<AppearancePanelInjected, 'hooks'>

/** The translate function as the panel sees it. */
type Translate = AppearancePanelComponentProps['t']

const MODES: readonly ModeId[] = ['light', 'dark', 'system']

const MODE_LABEL: Record<ModeId, AppearanceKey> = { light: 'mode.light', dark: 'mode.dark', system: 'mode.system' }

const PRESET_LABEL: Record<PresetId, AppearanceKey> = {
  idealize: 'preset.idealize', og: 'preset.og', ink: 'preset.ink', linen: 'preset.linen',
}

const SECTION_LABEL: Record<SectionId, AppearanceKey> = {
  theme: 'tab.theme', sessions: 'tab.sessions', files: 'tab.files', chat: 'tab.chat', doc: 'tab.doc', terminal: 'tab.terminal',
}

const FILL_LABEL: Record<FillMode, AppearanceKey> = { inherit: 'fill.inherit', solid: 'fill.solid', gradient: 'fill.gradient' }

const GRADIENT_LABEL: Record<GradientType, AppearanceKey> = {
  linear: 'gradient.linear', radial: 'gradient.radial', angular: 'gradient.angular',
}

const WEIGHT_LABEL: Record<typeof FONT_WEIGHTS[number], AppearanceKey> = {
  inherit: 'weight.inherit', 100: 'weight.100', 200: 'weight.200', 300: 'weight.300', 400: 'weight.400',
  500: 'weight.500', 600: 'weight.600', 700: 'weight.700', 800: 'weight.800', 900: 'weight.900',
}

/** Which scheme a preset's swatch previews: its own side, or the painted one. */
function swatchScheme(id: PresetId, painted: 'light' | 'dark'): 'light' | 'dark' {
  if (id === 'ink') return 'dark'
  if (id === 'linen') return 'light'
  return painted
}

/**
 * Whether the Theme tab differs from the defaults (mode excluded: it is
 * ui-theme's). A panel's own colours count, because the tab's Reset clears
 * them: on 15 Sep 2026 JJ's document carried light panel colours and nothing
 * else, and the tab read "Following IDEalize" with no Reset to press.
 */
export function themeCustomised(settings: AppearanceSettings): boolean {
  return settings.preset !== APPEARANCE_DEFAULTS.preset
    || settings.groundHex !== ''
    || settings.uiFont !== ''
    || settings.uiSize !== APPEARANCE_DEFAULTS.uiSize
    || actionCustomised(settings.action)
    || SURFACES.some(id => surfaceColoured(settings.surfaces[id]))
}

/** Whether the chat panel's own scalars differ from the defaults. */
function chatCustomised(settings: AppearanceSettings): boolean {
  return settings.chatInputOpacity !== APPEARANCE_DEFAULTS.chatInputOpacity
    || settings.chatShadowOpacity !== APPEARANCE_DEFAULTS.chatShadowOpacity
    || settings.chatMargin !== APPEARANCE_DEFAULTS.chatMargin
}

/** Whether the document panel's own scalars differ from the defaults. */
function docCustomised(settings: AppearanceSettings): boolean {
  return settings.docMargin !== APPEARANCE_DEFAULTS.docMargin
}

/** The scheme that is not on screen. */
function otherScheme(scheme: 'light' | 'dark'): 'light' | 'dark' {
  return scheme === 'light' ? 'dark' : 'light'
}

/** Whether a tab shows its customised dot. */
function sectionCustomised(section: SectionId, settings: AppearanceSettings): boolean {
  if (section === 'theme') return themeCustomised(settings)
  if (section === 'terminal') return terminalCustomised(settings.terminal)
  if (surfaceCustomised(settings.surfaces[section])) return true
  if (section === 'chat') return chatCustomised(settings)
  return section === 'doc' && docCustomised(settings)
}

/** Normalise typed hex to `#RRGGBB`. */
function canonicalHex(raw: string): string {
  return raw.trim().toUpperCase().replace(/^([0-9A-F]{6})$/, '#$1')
}

interface HexRowProps {
  label: string
  value: string
  fallback: string
  placeholder: string
  clearLabel: string
  onChange: (hex: string) => void
}

/** A hex field with a native colour well beside it; commits on valid input, clears on empty. */
function HexRow({ label, value, fallback, placeholder, clearLabel, onChange }: HexRowProps) {
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])
  const parsed = parseHex(draft)
  const invalid = draft.trim() !== '' && parsed === undefined
  const commit = (next: string): void => {
    setDraft(next)
    if (next.trim() === '') onChange('')
    else if (parseHex(next) !== undefined) onChange(canonicalHex(next))
  }
  return (
    <div className={css.row}>
      <span className={css.rowLabel}>{label}</span>
      <input
        type="color"
        className={css.well}
        aria-label={`${label} colour`}
        value={parsed === undefined ? fallback : canonicalHex(draft)}
        onChange={(event) => { commit(event.currentTarget.value.toUpperCase()) }}
      />
      <input
        type="text"
        className={css.hexField}
        aria-label={label}
        aria-invalid={invalid}
        placeholder={placeholder}
        value={draft}
        spellCheck={false}
        onChange={(event) => { commit(event.currentTarget.value) }}
      />
      {value !== '' && (
        <button type="button" className={css.clear} onClick={() => { commit('') }}>{clearLabel}</button>
      )}
    </div>
  )
}

interface SliderRowProps {
  label: string
  min: number
  max: number
  step: number
  value: number
  /** The readout for a value; called with the dragged value while the pointer is down. */
  display: (value: number) => string
  onChange: (value: number) => void
  /**
   * `release` commits once, when the pointer lifts or the key is released.
   * The interface size uses it: committing per move rescales the panel under
   * the pointer, which moves the slider away from the thumb.
   */
  commit?: 'live' | 'release'
}

/**
 * A labelled range input with a value readout. A `release` slider shows the
 * dragged value from local state until the pointer lifts; a `live` slider is
 * controlled by the stored value, which the plugin mirrors optimistically.
 */
function SliderRow({ label, min, max, step, value, display, onChange, commit = 'live' }: SliderRowProps) {
  const [dragging, setDragging] = useState<number | null>(null)
  const shown = commit === 'release' ? dragging ?? value : value
  const release = (): void => {
    if (dragging === null) return
    if (commit === 'release' && dragging !== value) onChange(dragging)
    setDragging(null)
  }
  return (
    <div className={css.row}>
      <span className={css.rowLabel}>{label}</span>
      <input
        type="range"
        className={css.slider}
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={shown}
        onChange={(event) => {
          const next = Number(event.currentTarget.value)
          if (commit === 'live') onChange(next)
          else setDragging(next)
        }}
        onPointerUp={release}
        onKeyUp={release}
        onBlur={release}
      />
      <span className={css.value}>{display(shown)}</span>
    </div>
  )
}

interface SegmentProps<T extends string> {
  label: string
  options: readonly T[]
  value: T
  name: (option: T) => string
  disabled?: boolean
  onChange: (option: T) => void
}

/** A segmented control. */
function Segment<T extends string>({ label, options, value, name, disabled, onChange }: SegmentProps<T>) {
  return (
    <div className={css.segment} role="group" aria-label={label}>
      {options.map(option => (
        <button
          key={option}
          type="button"
          className={css.segmentButton}
          aria-pressed={value === option}
          disabled={disabled}
          onClick={() => { onChange(option) }}
        >
          {name(option)}
        </button>
      ))}
    </div>
  )
}

interface FontPickerProps {
  label: string
  value: string
  fonts: string[] | undefined
  emptyLabel: string
  loadingLabel: string
  /** The type-to-find field's label and placeholder. */
  findLabel: string
  onChange: (family: string) => void
}

/**
 * A family picker over the installed fonts as the panel's own listbox (a
 * native `<select>` popup cannot be styled on macOS): the trigger and every
 * option render in their own face, and the current value stays listed even
 * when the Host does not know it.
 */
function FontPicker({ label, value, fonts, emptyLabel, loadingLabel, findLabel, onChange }: FontPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const families = fonts ?? []
  const extra = value !== '' && !families.includes(value) ? [value] : []
  const needle = query.trim().toLowerCase()
  const listed = [...extra, ...families].filter(family => needle === '' || family.toLowerCase().includes(needle))
  const select = (family: string): void => {
    setOpen(false)
    setQuery('')
    onChange(family)
  }
  return (
    <div className={css.row}>
      <span className={css.rowLabel}>{label}</span>
      <div
        className={css.fontPicker}
        onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false) }}
        onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}
      >
        <button
          type="button"
          className={css.fontValue}
          aria-label={label}
          aria-haspopup="listbox"
          aria-expanded={open}
          style={value === '' ? undefined : { fontFamily: fontStack(value) }}
          onClick={() => { setOpen(state => !state) }}
        >
          <span className={css.fontValueText}>{value === '' ? emptyLabel : value}</span>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 3.75 5 6.75l3-3" /></svg>
        </button>
        {open && (
          <div role="listbox" aria-label={label} className={css.fontList}>
            {/* Type-to-find: the inventory runs to hundreds of families. Enter
                picks the first match; the empty pick stays listed throughout. */}
            <input
              type="search"
              className={css.fontFind}
              aria-label={findLabel}
              placeholder={findLabel}
              value={query}
              autoFocus
              onChange={(event) => { setQuery(event.currentTarget.value) }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return
                event.preventDefault()
                const first = listed[0]
                if (first !== undefined) select(first)
              }}
            />
            <button type="button" role="option" aria-selected={value === ''} className={css.fontOption} onClick={() => { select('') }}>
              {emptyLabel}
            </button>
            {fonts === undefined && <span className={css.fontLoading}>{loadingLabel}</span>}
            {listed.map(family => (
              <button
                key={family}
                type="button"
                role="option"
                aria-selected={family === value}
                className={css.fontOption}
                style={{ fontFamily: fontStack(family) }}
                onClick={() => { select(family) }}
              >
                {family}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** What the gradient editor can change. */
interface GradientPatch {
  stops?: GradientStop[]
  type?: GradientType
  angle?: number
}

interface GradientEditorProps {
  t: Translate
  stops: GradientStop[]
  type: GradientType
  angle: number
  opacity: number
  seed: [string, string]
  onChange: (patch: GradientPatch) => void
}

/** Map an editor patch onto the action's gradient fields. */
function actionPatch(patch: GradientPatch): Partial<ActionAppearance> {
  return {
    ...(patch.stops === undefined ? {} : { gradientStops: patch.stops }),
    ...(patch.type === undefined ? {} : { gradientType: patch.type }),
    ...(patch.angle === undefined ? {} : { angle: patch.angle }),
  }
}

/** Map an editor patch onto a surface's gradient fields. */
function surfacePatch(patch: GradientPatch): Partial<SurfaceAppearance> {
  return {
    ...(patch.stops === undefined ? {} : { bgGradientStops: patch.stops }),
    ...(patch.type === undefined ? {} : { bgGradientType: patch.type }),
    ...(patch.angle === undefined ? {} : { gradientAngle: patch.angle }),
  }
}

/** Insert a stop at the midpoint of the largest gap (V0 GradientEditor.addStop). */
function withAddedStop(stops: GradientStop[]): GradientStop[] {
  // The editor always holds at least one stop (seeded when empty; removal stops at one).
  const sorted = [...stops].sort((a, b) => a.location - b.location)
  const first = requireStop(sorted, 0)
  let best: { at: number; colour: string; gap: number } = { at: first.location / 2, colour: first.colorHex, gap: first.location }
  for (let i = 0; i + 1 < sorted.length; i += 1) {
    const a = requireStop(sorted, i)
    const b = requireStop(sorted, i + 1)
    const gap = b.location - a.location
    if (gap > best.gap) {
      const mix = blend(parseHex(a.colorHex) ?? { r: 136, g: 136, b: 136 }, parseHex(b.colorHex) ?? { r: 136, g: 136, b: 136 }, 0.5)
      best = { at: a.location + gap / 2, colour: toHex(mix), gap }
    }
  }
  const last = requireStop(sorted, sorted.length - 1)
  if (1 - last.location > best.gap) best = { at: last.location + (1 - last.location) / 2, colour: last.colorHex, gap: 1 - last.location }
  return [...sorted, { colorHex: best.colour, location: Math.round(best.at * 100) / 100 }]
}

/** The CSS weight keyword at a schema-bounded index. */
function requireWeight(index: number): typeof FONT_WEIGHTS[number] {
  const weight = FONT_WEIGHTS[index]
  /* v8 ignore next -- the schema bounds the index to 0–9; the throw only names a broken store. */
  if (weight === undefined) throw new RangeError(`no font weight at ${index}`)
  return weight
}

/** Index into a stop list known to hold the index. */
function requireStop(stops: GradientStop[], index: number): GradientStop {
  const stop = stops[index]
  /* v8 ignore next -- callers index within `sorted.length`; the throw only names a broken loop bound. */
  if (stop === undefined) throw new RangeError(`no gradient stop at ${index}`)
  return stop
}

/** Type, direction, preview and stop list of one gradient (V0 GradientEditor). */
function GradientEditor({ t, stops, type, angle, opacity, seed, onChange }: GradientEditorProps) {
  const effective = stops.length > 0 ? stops : seedStops(seed[0], seed[1])
  const setStop = (index: number, patch: Partial<GradientStop>): void => {
    onChange({ stops: effective.map((stop, i) => (i === index ? { ...stop, ...patch } : stop)) })
  }
  return (
    <div className={css.gradient}>
      <Segment label={t('background.card')} options={GRADIENT_TYPES} value={type} name={id => t(GRADIENT_LABEL[id])} onChange={(next) => { onChange({ type: next }) }} />
      <div className={css.row}>
        <div className={css.preview} style={{ background: gradientCss(effective, type, angle, opacity, seed[0]) }} />
        <button type="button" className={css.iconButton} title={t('gradient.reverse')} aria-label={t('gradient.reverse')} onClick={() => { onChange({ stops: effective.map(stop => ({ ...stop, location: Math.round((1 - stop.location) * 100) / 100 })) }) }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M1.5 4h9M8 1.5 10.5 4 8 6.5M10.5 8h-9M4 5.5 1.5 8 4 10.5" /></svg>
        </button>
        <button type="button" className={css.iconButton} title={t('gradient.rotate')} aria-label={t('gradient.rotate')} disabled={type === 'radial'} onClick={() => { onChange({ angle: (angle + 45) % 360 }) }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M10 6A4 4 0 1 1 7.2 2.2M7 1l3 1-1 3" /></svg>
        </button>
      </div>
      {type !== 'radial' && (
        <SliderRow label={t('gradient.angle')} min={0} max={360} step={1} value={angle} display={v => `${Math.round(v)}°`} onChange={(next) => { onChange({ angle: next }) }} />
      )}
      <div className={css.stopsHeader}>
        <span className={css.stopsTitle}>{t('gradient.stops')}</span>
        <button type="button" className={css.iconButton} title={t('gradient.add')} aria-label={t('gradient.add')} onClick={() => { onChange({ stops: withAddedStop(effective) }) }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M6 1.5v9M1.5 6h9" /></svg>
        </button>
      </div>
      {effective.map((stop, index) => (
        <div className={css.stopRow} key={index}>
          <input
            type="color"
            className={css.well}
            aria-label={t('gradient.stopColour', { n: index + 1 })}
            value={parseHex(stop.colorHex) === undefined ? seed[0] : canonicalHex(stop.colorHex)}
            onChange={(event) => { setStop(index, { colorHex: event.currentTarget.value.toUpperCase() }) }}
          />
          <input
            type="number"
            className={css.percent}
            aria-label={t('gradient.stopPosition', { n: index + 1 })}
            min={0}
            max={100}
            step={1}
            value={Math.round(stop.location * 100)}
            onChange={(event) => { setStop(index, { location: Math.min(1, Math.max(0, Number(event.currentTarget.value) / 100)) }) }}
          />
          <input
            type="text"
            className={css.hexField}
            aria-label={t('gradient.stopHex', { n: index + 1 })}
            value={stop.colorHex}
            spellCheck={false}
            onChange={(event) => {
              const raw = event.currentTarget.value
              setStop(index, { colorHex: parseHex(raw) === undefined ? raw : canonicalHex(raw) })
            }}
          />
          <button
            type="button"
            className={css.iconButton}
            title={t('gradient.removeStop', { n: index + 1 })}
            aria-label={t('gradient.removeStop', { n: index + 1 })}
            disabled={effective.length <= 1}
            onClick={() => { onChange({ stops: effective.filter((_, i) => i !== index) }) }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M1.5 6h9" /></svg>
          </button>
        </div>
      ))}
    </div>
  )
}

interface StatusRowProps {
  t: Translate
  section: SectionId
  customised: boolean
  themeName: string
  onReset: () => void
}

/** "Following <theme>" or "Customised" plus the section's Reset (the Terminal tab follows its own defaults, not the theme). */
function StatusRow({ t, section, customised, themeName, onReset }: StatusRowProps) {
  const following = section === 'terminal' ? t('status.terminalDefaults') : t('status.following', { theme: themeName })
  return (
    <div className={css.status}>
      <span className={customised ? css.statusCustom : css.statusText}>
        {customised ? t('status.customised') : following}
      </span>
      {customised && (
        <button type="button" className={css.reset} title={section === 'theme' ? t('status.resetThemeHelp') : t('status.resetHelp', { section: t(SECTION_LABEL[section]) })} onClick={onReset}>
          {t('status.reset')}
        </button>
      )}
    </div>
  )
}

/** Theme and surface tabs share these. */
interface TabContext {
  t: Translate
  settings: AppearanceSettings
  palette: Palette
  surfaceHex: string
  fonts: string[] | undefined
  face: Omit<AppearancePanelComponentProps, 'useAppearance' | 't'>
}

function ThemeTab({ t, settings, palette, fonts, face, mode, scheme, groundLocked }: TabContext & { mode: ModeId; scheme: 'light' | 'dark'; groundLocked: boolean }) {
  const action = settings.action
  const solidHex = parseHex(action.colorHex) === undefined ? palette.accent : canonicalHex(action.colorHex)
  // The same rule actionTokens applies, so the readout names what the borders paint.
  const accent = actionAccent(requireHex(solidHex), action.opacity, requireHex(palette.ground))
  const ratio = Math.round(accent.ratio * 10) / 10
  // Which panels carry colours of their own over the scheme on screen, and
  // which keep colours for the other scheme (shown when it comes back).
  const overriding = SURFACES.filter(id => surfaceScheme(settings.surfaces[id]) === scheme)
  const waiting = SURFACES.filter(id => surfaceScheme(settings.surfaces[id]) === otherScheme(scheme))
  return (
    <>
      <Segment label={t('mode.light')} options={MODES} value={mode} name={id => t(MODE_LABEL[id])} disabled={groundLocked} onChange={face.setMode} />
      {groundLocked && <span className={css.hint}>{t('mode.groundDecides')}</span>}

      <section className={css.card} aria-label={t('theme.card')}>
        <span className={css.cardTitle}>{t('theme.card')}</span>
        <span className={css.hint}>{t('theme.hint')}</span>
        <div className={css.presets}>
          {PRESETS.map((id) => {
            const swatch = presetPalette(id, swatchScheme(id, scheme))
            return (
              <button key={id} type="button" className={css.preset} aria-pressed={settings.preset === id} onClick={() => { face.choosePreset(id) }}>
                <span className={css.swatch} style={{ background: swatch.ground }}>
                  <span className={css.swatchDot} style={{ background: swatch.ink }} />
                  <span className={css.swatchDot} style={{ background: swatch.accent }} />
                </span>
                <span className={css.presetName}>{t(PRESET_LABEL[id])}</span>
                {settings.preset === id && <span className={css.check} aria-hidden="true">✓</span>}
              </button>
            )
          })}
        </div>
        {overriding.length > 0 && (
          <span className={css.hint}>{t('theme.overrides', { names: overriding.map(id => t(SECTION_LABEL[id])).join(', '), mode: t(MODE_LABEL[scheme]) })}</span>
        )}
        {waiting.length > 0 && (
          <span className={css.hint}>{t('theme.waiting', { names: waiting.map(id => t(SECTION_LABEL[id])).join(', '), mode: t(MODE_LABEL[otherScheme(scheme)]) })}</span>
        )}
        <HexRow label={t('ground.label')} value={settings.groundHex} fallback={palette.ground} placeholder={t('colour.placeholder')} clearLabel={t('colour.clear')} onChange={face.setGround} />
        <span className={css.hint}>{t('ground.hint')}</span>
      </section>

      <section className={css.card} aria-label={t('action.card')}>
        <span className={css.cardTitle}>{t('action.card')}</span>
        <span className={css.hint}>{t('action.hint')}</span>
        <Segment label={t('action.card')} options={['solid', 'gradient'] as const} value={action.mode} name={id => t(FILL_LABEL[id])} onChange={(next) => { face.setAction({ mode: next }) }} />
        {action.mode === 'solid'
          ? <HexRow label={t('colour.label')} value={action.colorHex} fallback={palette.accent} placeholder={t('colour.placeholder')} clearLabel={t('colour.clear')} onChange={(hex) => { face.setAction({ colorHex: hex }) }} />
          : (
            <GradientEditor
              t={t}
              stops={action.gradientStops}
              type={action.gradientType}
              angle={action.angle}
              opacity={action.opacity}
              seed={[solidHex, solidHex]}
              onChange={(patch) => { face.setAction(actionPatch(patch)) }}
            />
          )}
        <SliderRow label={t('opacity.label')} min={0} max={1} step={0.02} value={action.opacity} display={v => `${Math.round(v * 100)}%`} onChange={(next) => { face.setAction({ opacity: next }) }} />
        <span className={css.hint}>
          {t('action.readsAt', { ratio: ratio.toFixed(1) })}
          {accent.deepened && ` ${t('action.deepened', { ratio: UI_CONTRAST.toFixed(1) })}`}
        </span>
      </section>

      <section className={css.card} aria-label={t('interface.card')}>
        <span className={css.cardTitle}>{t('interface.card')}</span>
        <FontPicker label={t('interface.font')} value={settings.uiFont} fonts={fonts} emptyLabel={t('font.system')} loadingLabel={t('font.loading')} findLabel={t('font.find')} onChange={face.setUiFont} />
        <SliderRow label={t('interface.size')} min={UI_SIZE_MIN} max={UI_SIZE_MAX} step={1} value={settings.uiSize} display={String} commit="release" onChange={face.setUiSize} />
      </section>
    </>
  )
}

/** The Terminal tab (V0 Appearance ▸ Terminal): theme rows, custom ground, and the grid's type settings. */
function TerminalTab({ t, settings, fonts, monospaced, face }: TabContext & { monospaced: string[] }) {
  const terminal = settings.terminal
  const set = (patch: Partial<TerminalAppearanceSettings>): void => { face.setTerminal(patch) }
  const theme = terminalTheme(terminal.theme)
  // Monospaced families lead the terminal's picker (V0 terminalFamilies).
  const ordered = fonts === undefined ? undefined : [...monospaced, ...fonts.filter(family => !monospaced.includes(family))]
  return (
    <>
      <section className={css.card} aria-label={t('terminal.themeCard')}>
        <span className={css.cardTitle}>{t('terminal.themeCard')}</span>
        <span className={css.hint}>{t('terminal.themeHint')}</span>
        <div className={css.themeRows}>
          {TERMINAL_THEMES.map(option => (
            <button key={option.id} type="button" className={css.preset} aria-pressed={terminal.theme === option.id} onClick={() => { set({ theme: option.id }) }}>
              <span className={css.swatch} style={{ background: option.background }}>
                {option.ansi.slice(1, 5).map(colour => <span key={colour} className={css.swatchDot} style={{ background: colour }} />)}
              </span>
              <span className={css.presetName}>{option.name}</span>
              {terminal.theme === option.id && <span className={css.check} aria-hidden="true">✓</span>}
            </button>
          ))}
        </div>
        <HexRow label={t('background.card')} value={terminal.bgHex} fallback={theme.background} placeholder={t('colour.placeholder')} clearLabel={t('colour.clear')} onChange={(hex) => { set({ bgHex: hex }) }} />
        <span className={css.hint}>{t('terminal.bgHint')}</span>
      </section>

      <section className={css.card} aria-label={t('terminal.typeCard')}>
        <span className={css.cardTitle}>{t('terminal.typeCard')}</span>
        <FontPicker label={t('typography.font')} value={terminal.fontName} fonts={ordered} emptyLabel={t('font.system')} loadingLabel={t('font.loading')} findLabel={t('font.find')} onChange={(family) => { set({ fontName: family }) }} />
        <SliderRow label={t('terminal.fontSize')} min={9} max={28} step={0.5} value={terminal.fontSize} display={v => v.toFixed(1)} onChange={(next) => { set({ fontSize: next }) }} />
        <SliderRow label={t('typography.lineSpacing')} min={1} max={3} step={0.1} value={terminal.lineSpacing} display={v => v.toFixed(1)} onChange={(next) => { set({ lineSpacing: Math.round(next * 10) / 10 }) }} />
        <SliderRow label={t('chat.margins')} min={0} max={80} step={2} value={terminal.margin} display={v => `${v}px`} onChange={(next) => { set({ margin: next }) }} />
      </section>
    </>
  )
}

type SurfaceTabProps = TabContext & { id: SurfaceId; scheme: 'light' | 'dark' }

function SurfaceTab({ t, settings, palette, surfaceHex, fonts, face, id, scheme }: SurfaceTabProps) {
  const surface = settings.surfaces[id]
  const set = (patch: Partial<SurfaceAppearance>): void => { face.setSurface(id, patch) }
  // The schema bounds the weight index to 0–9.
  const weight = requireWeight(surface.fontWeight)
  const colourScheme = surfaceScheme(surface)
  return (
    <>
      {/* The drawer column hosts every rail pane, so the tab says which panels it reaches. */}
      {id === 'files' && <span className={css.hint}>{t('tab.filesHint')}</span>}
      {colourScheme !== undefined && colourScheme !== scheme && (
        <span className={css.hint}>{t('surface.otherScheme', { mode: t(MODE_LABEL[colourScheme]), current: t(MODE_LABEL[scheme]) })}</span>
      )}
      <section className={css.card} aria-label={t('typography.card')}>
        <span className={css.cardTitle}>{t('typography.card')}</span>
        <FontPicker label={t('typography.font')} value={surface.fontName} fonts={fonts} emptyLabel={t('font.inherit')} loadingLabel={t('font.loading')} findLabel={t('font.find')} onChange={(family) => { set({ fontName: family }) }} />
        <div className={css.row}>
          <span className={css.rowLabel}>{t('typography.weight')}</span>
          <select className={css.select} aria-label={t('typography.weight')} value={weight} onChange={(event) => { set({ fontWeight: FONT_WEIGHTS.indexOf(event.currentTarget.value as typeof FONT_WEIGHTS[number]) }) }}>
            {FONT_WEIGHTS.map(option => <option key={option} value={option}>{t(WEIGHT_LABEL[option])}</option>)}
          </select>
        </div>
        <SliderRow label={t('typography.size')} min={0} max={28} step={0.5} value={surface.fontSize} display={v => (v === 0 ? t('typography.auto') : String(v))} onChange={(next) => { set({ fontSize: next }) }} />
        <SliderRow label={t('typography.tracking')} min={-2} max={8} step={0.1} value={surface.tracking} display={v => v.toFixed(1)} onChange={(next) => { set({ tracking: Math.round(next * 10) / 10 }) }} />
        <SliderRow label={t('typography.lineSpacing')} min={0} max={16} step={0.5} value={surface.lineSpacing} display={v => v.toFixed(1)} onChange={(next) => { set({ lineSpacing: next }) }} />
        <HexRow label={t('typography.textColour')} value={surface.textColorHex} fallback={palette.ink} placeholder={t('colour.placeholder')} clearLabel={t('colour.clear')} onChange={(hex) => { set({ textColorHex: hex }) }} />
      </section>

      <section className={css.card} aria-label={t('background.card')}>
        <span className={css.cardTitle}>{t('background.card')}</span>
        <Segment label={t('background.card')} options={FILL_MODES} value={surface.bgMode} name={option => t(FILL_LABEL[option])} onChange={(next) => { set({ bgMode: next }) }} />
        {surface.bgMode === 'solid' && (
          <HexRow label={t('colour.label')} value={surface.bgColorHex} fallback={palette.ground} placeholder={t('colour.placeholder')} clearLabel={t('colour.clear')} onChange={(hex) => { set({ bgColorHex: hex }) }} />
        )}
        {surface.bgMode === 'gradient' && (
          <GradientEditor
            t={t}
            stops={surface.bgGradientStops}
            type={surface.bgGradientType}
            angle={surface.gradientAngle}
            opacity={surface.bgOpacity}
            seed={[palette.ground, surfaceHex]}
            onChange={(patch) => { set(surfacePatch(patch)) }}
          />
        )}
        {surface.bgMode !== 'inherit' && (
          <SliderRow label={t('opacity.label')} min={0} max={1} step={0.02} value={surface.bgOpacity} display={v => `${Math.round(v * 100)}%`} onChange={(next) => { set({ bgOpacity: next }) }} />
        )}
      </section>

      {id === 'doc' && (
        <section className={css.card} aria-label={t('doc.card')}>
          <span className={css.cardTitle}>{t('doc.card')}</span>
          <SliderRow label={t('doc.margins')} min={0} max={64} step={1} value={settings.docMargin} display={v => `${v}px`} onChange={(next) => { face.setScalars({ docMargin: next }) }} />
        </section>
      )}

      {id === 'chat' && (
        <section className={css.card} aria-label={t('chat.card')}>
          <span className={css.cardTitle}>{t('chat.card')}</span>
          <SliderRow label={t('chat.inputOpacity')} min={0.3} max={1} step={0.02} value={settings.chatInputOpacity} display={v => `${Math.round(v * 100)}%`} onChange={(next) => { face.setScalars({ chatInputOpacity: next }) }} />
          <SliderRow label={t('chat.shadow')} min={0} max={0.8} step={0.02} value={settings.chatShadowOpacity} display={v => `${Math.round(v * 100)}%`} onChange={(next) => { face.setScalars({ chatShadowOpacity: next }) }} />
          <SliderRow label={t('chat.margins')} min={8} max={40} step={1} value={settings.chatMargin} display={v => `${v}px`} onChange={(next) => { face.setScalars({ chatMargin: next }) }} />
        </section>
      )}
    </>
  )
}

export function AppearancePanel(props: AppearancePanelComponentProps) {
  const { useAppearance, t, ...face } = props
  const open = useAppearance(state => state.open)
  const section = useAppearance(state => state.section)
  const settings = useAppearance(state => state.settings)
  const mode = useAppearance(state => state.mode)
  const scheme = useAppearance(state => state.scheme)
  const fonts = useAppearance(state => state.fonts)
  const monospaced = useAppearance(state => state.monospaced)
  if (!open) return null

  const resolved = resolveAppearance(settings.preset, settings.groundHex, settings.action.colorHex)
  const side = resolved[scheme]
  const palette = side.palette
  const layerHex = surfaceHex(side)
  const groundLocked = resolved.forcedScheme !== undefined && parseHex(settings.groundHex) !== undefined
  const themeName = t(PRESET_LABEL[settings.preset])
  const shared: TabContext = { t, settings, palette, surfaceHex: layerHex, fonts, face }

  // The panel sits inside the drawer surface it edits; the exempt hook keeps
  // that surface's typography and ink off the panel so it stays legible.
  const exempt = { [SURFACE_EXEMPT_ATTRIBUTE]: '' }
  return (
    <aside className={css.root} aria-label={t('panel.title')} {...exempt}>
      <header className={css.header}>
        <span className={css.headerIcon} aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M8 1.5a6.5 6.5 0 1 0 0 13h.5a1.5 1.5 0 0 0 1-2.6 1.2 1.2 0 0 1 .9-2h1.6a2.5 2.5 0 0 0 2.5-2.5A6.4 6.4 0 0 0 8 1.5Z" />
            <circle cx="5" cy="6" r="0.9" fill="currentColor" stroke="none" />
            <circle cx="8" cy="4.5" r="0.9" fill="currentColor" stroke="none" />
            <circle cx="11" cy="6" r="0.9" fill="currentColor" stroke="none" />
          </svg>
        </span>
        <span className={css.title}>{t('panel.title')}</span>
        <button type="button" className={css.close} aria-label={t('panel.close')} onClick={face.close}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M2 2l8 8M10 2l-8 8" />
          </svg>
        </button>
      </header>
      <div className={css.tabs} role="tablist" aria-label={t('panel.title')}>
        {SECTIONS.map(id => (
          <button key={id} type="button" role="tab" className={css.tab} aria-selected={section === id} onClick={() => { face.setSection(id) }}>
            {t(SECTION_LABEL[id])}
            {sectionCustomised(id, settings) && <span className={css.tabDot} aria-hidden="true" />}
          </button>
        ))}
      </div>
      <div className={css.scroll}>
        <StatusRow
          t={t}
          section={section}
          customised={sectionCustomised(section, settings)}
          themeName={themeName}
          onReset={() => { face.resetSection(section) }}
        />
        {section === 'theme' && <ThemeTab {...shared} mode={mode} scheme={scheme} groundLocked={groundLocked} />}
        {section === 'terminal' && <TerminalTab {...shared} monospaced={monospaced} />}
        {section !== 'theme' && section !== 'terminal' && <SurfaceTab {...shared} id={section} scheme={scheme} />}
      </div>
    </aside>
  )
}
