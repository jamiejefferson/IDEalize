/**
 * The ⌘/ sheet (V0's ShortcutsHelpView): every registered shortcut, grouped
 * the way the catalogue groups them. Return or Escape closes it.
 */
import { useEffect } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { formatChords, type Keybind } from './keybinds.ts'
import type { TourKey } from './locales.ts'
import css from './KeybindsSheet.module.css'

export interface KeybindsSheetProps {
  groups: { group: string; items: Keybind[] }[]
  onClose: () => void
  t: TranslateNS<'idealize-tour'>
}

/** Resolve a group or label: this plugin's own keys translate; foreign text prints as given. */
function copy(t: TranslateNS<'idealize-tour'>, text: string): string {
  return text.startsWith('group.') || text.startsWith('bind.') ? t(text as TourKey) : text
}

export function KeybindsSheet({ groups, onClose, t }: KeybindsSheetProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' || event.key === 'Enter') {
        event.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [onClose])

  return (
    <div className={css.root} data-idealize-keybinds onClick={onClose}>
      <div className={css.sheet} role="dialog" aria-label={t('keys.title')} onClick={(event) => { event.stopPropagation() }}>
        <div className={css.head}>
          <h2 className={css.title}>{t('keys.title')}</h2>
          <button type="button" className={css.done} onClick={onClose}>{t('keys.done')}</button>
        </div>
        <div className={css.list}>
          {groups.length === 0 && <div className={css.empty}>{t('keys.empty')}</div>}
          {groups.map(({ group, items }) => (
            <div key={group} className={css.group}>
              <div className={css.groupTitle}>{copy(t, group)}</div>
              {items.map(item => (
                <div key={item.id} className={css.row}>
                  <span>{copy(t, item.label)}</span>
                  <span className={css.keys}>{formatChords(item.chords)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
