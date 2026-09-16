/** General Settings row for the task-complete chime: on/off, volume, preview (V0's Sound section). */
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './ChimeRow.module.css'

/** The row's view of the chime preference. */
export interface ChimePreference {
  enabled: boolean
  /** 0…1 */
  volume: number
}

/** Registration-side face. */
export interface ChimeRowInjected {
  hooks: {
    /** Live chime preference (settings-backed). */
    chime: SnapshotStore<ChimePreference>
  }
  setEnabled: (enabled: boolean) => void
  setVolume: (volume: number) => void
  /** Play the chime at the current volume regardless of the enabled toggle. */
  preview: () => void
}

/** Full Settings-row props. */
export type ChimeRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'idealize-notify'>
  & InjectFace<ChimeRowInjected>

/**
 * Render the chime preference row.
 * @param props - composed Settings slot props.
 */
export function ChimeRow({ useChime, setEnabled, setVolume, preview, t }: ChimeRowProps) {
  const chime = useChime(value => value)
  return (
    <div className={css.row} data-chime-row>
      <div className={css.rowText}>
        <div className={css.title}>{t('chime.title')}</div>
        <div className={css.desc}>{t('chime.description')}</div>
      </div>
      <div className={css.controls} data-disabled={chime.enabled ? undefined : ''}>
        <label className={css.volume}>
          {t('chime.volume')}
          <input
            type="range"
            className={css.slider}
            min={0}
            max={1}
            step={0.05}
            value={chime.volume}
            disabled={!chime.enabled}
            onChange={(event) => { setVolume(Number(event.currentTarget.value)) }}
          />
        </label>
        <button type="button" className={css.preview} onClick={preview} disabled={!chime.enabled}>
          {t('chime.preview')}
        </button>
        <button
          type="button"
          role="switch"
          aria-checked={chime.enabled}
          aria-label={t('chime.title')}
          className={css.switch}
          onClick={() => { setEnabled(!chime.enabled) }}
        />
      </div>
    </div>
  )
}
