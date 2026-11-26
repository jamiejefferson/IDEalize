/**
 * The parts the set-up step and the welcome sheet both render: the
 * coding-subscription radio list, a key block (title, reason, paste field,
 * "Get a key" link, connected state), and the OpenRouter and fal blocks built
 * on it.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { OnboardingKey } from './locales.ts'
import { COMPANY_APP, COMPANY_LABEL, COMPANY_MODELS } from './setup-model.ts'
import type { CodingRow, SetupCompany } from './setup-model.ts'
import type { Setup } from './use-setup.ts'
import css from './SetupParts.module.css'

/** The namespace translator the parts take. */
type Translate = (key: OnboardingKey) => string

/** Where OpenRouter issues keys. */
const OPENROUTER_KEYS_URL = 'https://openrouter.ai/keys'

/** Where fal issues keys. */
const FAL_KEYS_URL = 'https://fal.ai/dashboard/keys'

/** Props for {@link CodingAppList}. */
export interface CodingAppListProps {
  /** The rows, one per company. */
  rows: readonly CodingRow[]
  /** The selected row's launch choice id. */
  selected: string | null
  /** Select a row. */
  onSelect: (id: string) => void
  /** The namespace translator. */
  t: Translate
}

function installedLabel(installed: boolean | null): OnboardingKey {
  if (installed === true) return 'setup.coding.installed'
  return installed === false ? 'setup.coding.missing' : 'setup.coding.unchecked'
}

/**
 * The coding-subscription radio list: one row per company, Kimi behind a
 * "Show Kimi" link until asked for or selected. A row whose app is not
 * installed cannot be selected.
 */
export function CodingAppList({ rows, selected, onSelect, t }: CodingAppListProps) {
  const [kimiShown, setKimiShown] = useState(false)
  const kimi = rows.find(row => row.company === 'kimi')
  const kimiVisible = kimiShown || (kimi !== undefined && kimi.id === selected)
  const visible = rows.filter(row => row.company !== 'kimi' || kimiVisible)
  return (
    <div className={css.list} role="radiogroup" aria-label={t('setup.coding.title')}>
      {visible.map(row => (
        <label
          key={row.company}
          className={css.row}
          data-setup-cli={row.id}
          data-setup-company={row.company}
          data-installed={row.installed === true ? '' : undefined}
          data-selected={row.id === selected ? '' : undefined}
        >
          <input
            type="radio"
            name="idealize-setup-cli"
            className={css.radio}
            checked={row.id === selected}
            disabled={row.installed === false}
            onChange={() => { onSelect(row.id) }}
          />
          <span className={css.company}>{t(COMPANY_LABEL[row.company])}</span>
          <span className={css.app}>{t(COMPANY_APP[row.company])}</span>
          <span className={css.status} data-setup-status>{t(installedLabel(row.installed))}</span>
        </label>
      ))}
      {kimi !== undefined && !kimiVisible && (
        <button type="button" className={css.link} onClick={() => { setKimiShown(true) }} data-setup-show-kimi>
          {t('setup.coding.showKimi')}
        </button>
      )}
    </div>
  )
}

/** Props for {@link KeyBlock}. */
export interface KeyBlockProps {
  /** The block's title. */
  title: string
  /** The sentence saying what the key unlocks. */
  reason: string
  /** Whether the key is optional; an optional block carries the tag. */
  optional?: boolean
  /** Whether a key is already connected; a connected block shows a tick in place of the field. */
  connected: boolean
  /** The pasted key. */
  value: string
  /** Change the pasted key. */
  onChange: (value: string) => void
  /** The field's placeholder. */
  placeholder: string
  /** The page where the service issues keys. */
  keysUrl: string
  /** The save's refusal, shown under the field. */
  error: string | null
  /** Which key this is; lands on the field as `data-setup-<name>`. */
  name: 'openrouter' | 'fal'
  /** The namespace translator. */
  t: Translate
  /** A line under the field. */
  children?: ReactNode
}

/** One key's block: what it unlocks, then the paste field or the connected tick. */
export function KeyBlock(props: KeyBlockProps) {
  const { title, reason, optional, connected, value, onChange, placeholder, keysUrl, error, name, t, children } = props
  return (
    <div className={css.block} data-setup-block={name} data-connected={connected ? '' : undefined}>
      <div className={css.heading}>
        <span className={css.title}>{title}</span>
        {optional === true && <span className={css.tag} data-setup-optional>{t('setup.optional')}</span>}
      </div>
      <p className={css.reason} data-setup-reason={name}>{reason}</p>
      {connected
        ? (
          <span className={css.connected} data-setup-connected={name}>
            <span aria-hidden="true">✓</span>
            {t('setup.connected')}
          </span>
        )
        : (
          <div className={css.fieldLine}>
            <input
              className={css.input}
              type="password"
              autoComplete="off"
              placeholder={placeholder}
              aria-label={title}
              value={value}
              onChange={(event) => { onChange(event.target.value) }}
              {...{ [`data-setup-${name}`]: '' }}
            />
            <a className={css.link} href={keysUrl} target="_blank" rel="noreferrer" data-setup-get-key={name}>
              {t('setup.getKey')}
            </a>
          </div>
        )}
      {error !== null && <p className={css.error} data-setup-error={name}>{error}</p>}
      {children}
    </div>
  )
}

/** Props for the two key blocks bound to the shared set-up state. */
export interface SetupKeyProps {
  /** The shared set-up state. */
  setup: Setup
  /** Whether a key is connected. */
  connected: boolean
  /** The namespace translator. */
  t: Translate
}

/**
 * The OpenRouter block. Once a coding app is selected it says which company's
 * models Chat will start on.
 */
export function OpenRouterBlock({ setup, connected, t, matching }: SetupKeyProps & { matching: SetupCompany | undefined }) {
  return (
    <KeyBlock
      name="openrouter"
      title={t('setup.openrouter.title')}
      reason={t('setup.openrouter.reason')}
      connected={connected}
      value={setup.openrouterDraft}
      onChange={setup.setOpenrouterDraft}
      placeholder={t('setup.openrouter.placeholder')}
      keysUrl={OPENROUTER_KEYS_URL}
      error={setup.openrouterError}
      t={t}
    >
      {matching !== undefined && (
        <p className={css.reason} data-setup-match={matching}>
          {t('setup.openrouter.match').replace('{company}', t(COMPANY_MODELS[matching]))}
        </p>
      )}
    </KeyBlock>
  )
}

/**
 * The fal block, tagged Optional. Its reason names how many models the key
 * adds only when the host states a count.
 */
export function FalBlock({ setup, connected, t, modelCount }: SetupKeyProps & { modelCount: number | null }) {
  return (
    <KeyBlock
      name="fal"
      title={t('setup.fal.title')}
      reason={modelCount === null ? t('setup.fal.reason') : t('setup.fal.reasonCount').replace('{count}', String(modelCount))}
      optional
      connected={connected}
      value={setup.falDraft}
      onChange={setup.setFalDraft}
      placeholder={t('setup.fal.placeholder')}
      keysUrl={FAL_KEYS_URL}
      error={setup.falError}
      t={t}
    />
  )
}
