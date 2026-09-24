/** General Settings row for the task-complete chime: on/off, sound, volume, preview (V0's Sound section). */
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { BUILT_IN_CHIME_SOUND, type ChimeSound } from '../chime-sounds.ts'
import css from './ChimeRow.module.css'

/** The row's view of the chime preference. */
export interface ChimePreference {
  enabled: boolean
  /** 0…1 */
  volume: number
  /** The catalogue id of the sound that plays. */
  sound: string
}

/** Registration-side face. */
export interface ChimeRowInjected {
  hooks: {
    /** Live chime preference (settings-backed). */
    chime: SnapshotStore<ChimePreference>
    /** The catalogue the host answered, the built-in chime first. */
    sounds: SnapshotStore<ChimeSound[]>
  }
  setEnabled: (enabled: boolean) => void
  setVolume: (volume: number) => void
  /** Choose a sound: saved, and played once so the person hears what they chose. */
  setSound: (sound: string) => void
  /** Play the chosen sound at the current volume regardless of the enabled toggle. */
  preview: () => void
}

/** Full Settings-row props. */
export type ChimeRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'idealize-notify'>
  & InjectFace<ChimeRowInjected>

/** The name shown for a stored id the catalogue no longer lists (a sound from another machine). */
function orphanLabel(id: string): string {
  return id.replace(/^system:/, '')
}

/**
 * Render the chime preference row.
 * @param props - composed Settings slot props.
 */
export function ChimeRow({ useChime, useSounds, setEnabled, setVolume, setSound, preview, t }: ChimeRowProps) {
  const chime = useChime(value => value)
  const sounds = useSounds(value => value)
  // The stored sound stays selectable even when this machine does not list it, so the select never shows a lie.
  const options = sounds.some(entry => entry.id === chime.sound)
    ? sounds
    : [...sounds, { id: chime.sound, label: orphanLabel(chime.sound) }]
  return (
    <div className={css.row} data-chime-row>
      <div className={css.rowText}>
        <div className={css.title}>{t('chime.title')}</div>
        <div className={css.desc}>{t('chime.description')}</div>
      </div>
      <div className={css.controls} data-disabled={chime.enabled ? undefined : ''}>
        <label className={css.sound}>
          {t('chime.sound')}
          <select
            className={css.select}
            value={chime.sound}
            disabled={!chime.enabled}
            onChange={(event) => { setSound(event.currentTarget.value) }}
          >
            {options.map(entry => (
              <option key={entry.id} value={entry.id}>
                {entry.id === BUILT_IN_CHIME_SOUND ? t('chime.sound.builtIn') : entry.label}
              </option>
            ))}
          </select>
        </label>
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
