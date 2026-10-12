/**
 * Project look in the sidebar: each project row's leading slot shows the
 * project's logo, or its folder glyph in the project's accent colour, and the
 * project's ⋯ menu opens a dialog to choose both (feedback b08b34bf, 8 Oct
 * 2026: "custom icons for the project folders ... to quickly see at a glance
 * the logo of a project in the side bar. Could even choose an accent colour").
 *
 * The looks come from `@idealize/spaces`' `/idealize/project-look` route,
 * fetched by its literal path for the same reason SpaceGlyph restates its
 * icon route: this upstream package may only reference that fork package
 * type-only. One module-level copy serves every row; the browser refreshes it
 * when the project list changes and the dialog refreshes it after each save.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import clsx from 'clsx'
import { Button, IconFolderClose16, IconFolderOpen16, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceBrowserProps } from '../contract/slots.ts'
import css from './Rows.module.css'

/** The route `@idealize/spaces` serves the looks under. */
export const PROJECT_LOOK_PATH = '/idealize/project-look'

/** The largest image the route stores, in bytes. */
const LOGO_MAX_BYTES = 512 * 1024

/** One project's look as the route reports it. */
export interface ProjectLook {
  accent: string | null
  logo: 'auto' | 'custom' | 'none'
  iconUrl: string | null
}

/**
 * The accent swatches the dialog offers. Mid-tone hues that hold their own as
 * a 16px glyph on both the light and the dark sidebar.
 */
export const ACCENT_SWATCHES = [
  { id: 'red', value: '#e5484d' },
  { id: 'orange', value: '#f76b15' },
  { id: 'yellow', value: '#d6a10a' },
  { id: 'green', value: '#30a46c' },
  { id: 'teal', value: '#12a594' },
  { id: 'blue', value: '#3e63dd' },
  { id: 'violet', value: '#8e4ec6' },
  { id: 'pink', value: '#d6409f' },
] as const

type Translate = WorkspaceBrowserProps['t']

let looks: Readonly<Record<string, ProjectLook>> = {}
const listeners = new Set<() => void>()
let inflight: Promise<void> | undefined

/**
 * Fetch every project's look again and tell the rows. A failed fetch keeps
 * the last copy: a missing route (a build without `@idealize/spaces`) leaves
 * every row on its folder glyph.
 * @returns when the fetch settles.
 */
export function refreshProjectLooks(): Promise<void> {
  inflight ??= (async () => {
    try {
      const res = await fetch(PROJECT_LOOK_PATH, { cache: 'no-store' })
      if (!res.ok) return
      const body = await res.json() as { items?: Record<string, ProjectLook> }
      looks = body.items ?? {}
      for (const listener of listeners) listener()
    } catch {
      // Offline or no route: rows keep their folders.
    } finally {
      inflight = undefined
    }
  })()
  return inflight
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * One project's look, kept current.
 * @param workspaceId - the project's id, or undefined for a group with none.
 * @returns the look, or undefined while unknown.
 */
export function useProjectLook(workspaceId: string | undefined): ProjectLook | undefined {
  return useSyncExternalStore(subscribe, () => (workspaceId === undefined ? undefined : looks[workspaceId]))
}

/**
 * The project row's leading slot content: the logo when there is one, else
 * the folder glyph, coloured with the accent when one is set.
 * @param props.workspaceId - the project's id (absent for the ungrouped and Powell groups).
 * @param props.expanded - whether the group is open (open folder glyph).
 * @param props.active - whether the open group holds the current chat.
 * @returns the slot element.
 */
export function ProjectSlot({ workspaceId, expanded, active }: {
  workspaceId: string | undefined
  expanded: boolean
  active: boolean
}) {
  const look = useProjectLook(workspaceId)
  const [broken, setBroken] = useState<string | null>(null)
  const iconUrl = look?.iconUrl ?? null
  if (iconUrl !== null && broken !== iconUrl) {
    return (
      <span className={clsx(css.slot, css.folder)} data-project-logo="">
        <img
          className={css.projectLogo}
          src={iconUrl}
          alt=""
          draggable={false}
          onError={() => { setBroken(iconUrl) }}
        />
      </span>
    )
  }
  const accent = look?.accent ?? null
  return (
    <span
      className={clsx(css.slot, css.folder, active && accent === null && css.folderActive)}
      style={accent === null ? undefined : { color: accent }}
      data-project-accent={accent ?? undefined}
    >
      {expanded ? <IconFolderOpen16 /> : <IconFolderClose16 />}
    </span>
  )
}

async function send(url: string, init: RequestInit): Promise<void> {
  const res = await fetch(url, {
    ...init,
    headers: { 'x-idealize-auth': '1', ...init.headers as Record<string, string> },
  })
  if (!res.ok) {
    let message = `${res.status}`
    try {
      message = ((await res.json()) as { error?: string }).error ?? message
    } catch {
      // Keep the status.
    }
    throw new Error(message)
  }
}

/**
 * The Icon and colour dialog for one project. Every choice saves at once.
 * @param props.target - the project being edited, or null when closed.
 * @param props.onClose - close the dialog.
 * @param props.t - the browser root's locale seat.
 * @returns the dialog.
 */
export function ProjectLookDialog({ target, onClose, t }: {
  target: { workspaceId: string; title: string } | null
  onClose: () => void
  t: Translate
}) {
  const look = useProjectLook(target?.workspaceId)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setError(null)
    if (target !== null) void refreshProjectLooks()
  }, [target])

  const base = target === null ? '' : `${PROJECT_LOOK_PATH}/${encodeURIComponent(target.workspaceId)}`
  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await work()
      await refreshProjectLooks()
    } catch (e) {
      setError(t('look.error.failed', { message: e instanceof Error ? e.message : String(e) }))
    } finally {
      setBusy(false)
    }
  }
  const post = (body: { accent?: string | null; logo?: 'auto' | 'none' }) => run(() => send(base, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }))
  const upload = (file: File) => {
    if (file.size > LOGO_MAX_BYTES) {
      setError(t('look.error.tooLarge'))
      return
    }
    void run(async () => {
      await send(`${base}/image`, {
        method: 'PUT',
        headers: { 'content-type': 'application/octet-stream' },
        body: await file.arrayBuffer(),
      })
    }).then(() => {
      if (fileRef.current !== null) fileRef.current.value = ''
    })
  }

  const accent = look?.accent ?? null
  const logo = look?.logo ?? 'auto'
  const logoNote = logo === 'custom'
    ? t('look.logo.custom')
    : logo === 'none'
      ? t('look.logo.none')
      : look?.iconUrl === null || look === undefined ? t('look.logo.autoNone') : t('look.logo.auto')

  return (
    <Modal
      open={target !== null}
      onClose={onClose}
      closeLabel={t('close')}
      title={t('look.title')}
      {...target === null ? {} : { description: target.title }}
      footer={<Button variant="primary" onClick={onClose}>{t('look.done')}</Button>}
    >
      <div className={css.lookSection}>
        <div className={css.lookLabel}>{t('look.accent')}</div>
        <div className={css.swatches} role="radiogroup" aria-label={t('look.accent')}>
          <button
            type="button"
            role="radio"
            aria-checked={accent === null}
            aria-label={t('look.accent.none')}
            title={t('look.accent.none')}
            className={clsx(css.swatch, css.swatchNone, accent === null && css.swatchOn)}
            disabled={busy}
            onClick={() => { void post({ accent: null }) }}
          />
          {ACCENT_SWATCHES.map(swatch => (
            <button
              key={swatch.id}
              type="button"
              role="radio"
              aria-checked={accent === swatch.value}
              aria-label={t(`look.colour.${swatch.id}`)}
              title={t(`look.colour.${swatch.id}`)}
              className={clsx(css.swatch, accent === swatch.value && css.swatchOn)}
              style={{ background: swatch.value }}
              disabled={busy}
              onClick={() => { void post({ accent: swatch.value }) }}
            />
          ))}
        </div>
      </div>
      <div className={css.lookSection}>
        <div className={css.lookLabel}>{t('look.logo')}</div>
        <div className={css.lookLogoRow}>
          <span className={css.lookPreview}>
            {target !== null && <ProjectSlot workspaceId={target.workspaceId} expanded={false} active={false} />}
          </span>
          <span className={css.lookNote}>{logoNote}</span>
        </div>
        <div className={css.lookButtons}>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>{t('look.choose')}</Button>
          {logo !== 'auto' && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => { void post({ logo: 'auto' }) }}>{t('look.useAuto')}</Button>
          )}
          {logo !== 'none' && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => { void post({ logo: 'none' }) }}>{t('look.remove')}</Button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          hidden
          accept="image/png,image/jpeg,image/webp,image/gif,image/x-icon,image/vnd.microsoft.icon,image/svg+xml,.ico,.svg"
          data-project-look-file=""
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file !== undefined) upload(file)
          }}
        />
      </div>
      {error !== null && <div className={css.lookError} role="alert">{error}</div>}
    </Modal>
  )
}
