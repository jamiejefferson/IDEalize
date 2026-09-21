/**
 * The documentation views' one standing choice: whether each chat keeps a
 * Markdown copy in its project's documentation folder. Reads and writes
 * `@idealize/vault`'s settings route; a shell without the vault answers 404
 * and the control stays away.
 */
import { useEffect, useState } from 'react'
import type { BarKey } from './locales.ts'
import css from './FilesPanel.module.css'

const PATH = '/idealize/vault/settings'

/**
 * Render the switch.
 * @param props.t - bar copy.
 * @returns the labelled checkbox, or null until the host has answered.
 */
export function SessionFilesToggle({ t }: { t: (key: BarKey) => string }) {
  const [on, setOn] = useState<boolean | null>(null)
  useEffect(() => {
    let live = true
    const read = async (): Promise<void> => {
      const response = await fetch(PATH)
      const body = response.ok ? await response.json() as { sessionFiles?: boolean } : null
      if (live && typeof body?.sessionFiles === 'boolean') setOn(body.sessionFiles)
    }
    // A shell without the vault has no such route; the control then stays away.
    read().catch(() => undefined)
    return () => { live = false }
  }, [])
  if (on === null) return null
  const save = (next: boolean): void => {
    setOn(next)
    const write = async (): Promise<void> => {
      const response = await fetch(PATH, {
        method: 'POST',
        headers: { 'x-idealize-auth': '1', 'content-type': 'application/json' },
        body: JSON.stringify({ sessionFiles: next }),
      })
      if (!response.ok) setOn(!next)
    }
    write().catch(() => { setOn(!next) })
  }
  return (
    <label className={css.sessionFiles} data-session-files="" title={t('files.sessionFilesHint')}>
      <input type="checkbox" checked={on} onChange={(event) => { save(event.target.checked) }} />
      {t('files.sessionFiles')}
    </label>
  )
}
