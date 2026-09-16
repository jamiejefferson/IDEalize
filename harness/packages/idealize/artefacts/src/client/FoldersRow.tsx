/**
 * General Settings row for where generated media saves: one field per kind
 * (Images, Sounds, Video) and the archive subfolder's name, each a
 * project-relative folder. A field commits on blur or Enter when it passes
 * {@link FOLDER_PATTERN}; an invalid value stays in the field, marked, and
 * writes nothing. Existing artefacts keep the path they were written with.
 * @module @idealize/artefacts/client/FoldersRow
 */
import { useEffect, useState } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { FOLDER_PATTERN, type ArtefactFolderSettings } from '../settings.ts'
import type { ArtefactsKey } from './locales.ts'
import css from './FoldersRow.module.css'

/** The editable fields, in display order. */
export const FOLDER_FIELDS = ['images', 'sounds', 'video', 'archive'] as const

/** One editable field name. */
export type FolderField = typeof FOLDER_FIELDS[number]

/** Registration-side face. */
export interface FoldersRowInjected {
  hooks: {
    /** The live folder settings (settings-backed, defaults until the scope loads). */
    folders: SnapshotStore<ArtefactFolderSettings>
  }
  /** Write one field; the caller has validated the value. */
  setFolder: (field: FolderField, value: string) => void
}

/** Full Settings-row props. */
export type FoldersRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'idealize-artefacts'>
  & InjectFace<FoldersRowInjected>

const LABEL_KEY: Record<FolderField, ArtefactsKey> = {
  images: 'folders.images',
  sounds: 'folders.sounds',
  video: 'folders.video',
  archive: 'folders.archive',
}

function Field({ field, stored, setFolder, t }: {
  field: FolderField
  stored: string
  setFolder: FoldersRowInjected['setFolder']
  t: FoldersRowProps['t']
}) {
  const [draft, setDraft] = useState(stored)
  // A settings change from elsewhere (another window, the file) replaces an
  // uncommitted draft only when the stored value actually moved.
  useEffect(() => { setDraft(stored) }, [stored])
  const valid = FOLDER_PATTERN.test(draft)
  const commit = (): void => {
    if (!valid || draft === stored) return
    setFolder(field, draft)
  }
  const id = `idealize-artefacts-folder-${field}`
  return (
    <>
      <label className={css.label} htmlFor={id}>{t(LABEL_KEY[field])}</label>
      <input
        id={id}
        className={css.input}
        type="text"
        value={draft}
        aria-invalid={valid ? undefined : 'true'}
        data-artefact-folder={field}
        onChange={(event) => { setDraft(event.currentTarget.value) }}
        onBlur={commit}
        onKeyDown={(event) => { if (event.key === 'Enter') commit() }}
      />
      {!valid && <span className={css.invalid} role="alert">{t('folders.invalid')}</span>}
    </>
  )
}

/**
 * Render the media-folders row.
 * @param props - composed Settings slot props.
 * @returns the row.
 */
export function FoldersRow({ useFolders, setFolder, t }: FoldersRowProps) {
  const folders = useFolders(value => value)
  return (
    <div className={css.row} data-artefact-folders-row="">
      <div className={css.rowText}>
        <div className={css.title}>{t('folders.title')}</div>
        <div className={css.desc}>{t('folders.description')}</div>
      </div>
      <div className={css.fields}>
        {FOLDER_FIELDS.map(field => (
          <Field key={field} field={field} stored={folders[field]} setFolder={setFolder} t={t} />
        ))}
      </div>
    </div>
  )
}
