import type { ReactNode } from 'react'
import { IconDownloadOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { SessionLogDownloadDialog, type SessionLogDownloadDialogProps } from './Dialog.tsx'
import css from './HeaderAction.module.css'

/**
 * Render the Session Header export button (a 24px icon control, labelled by
 * its tooltip and aria-label) and its shared result dialog.
 * @param props - Session runtime, download controller, and localized dialog copy.
 * @returns the persistent Header action and Session-scoped dialog.
 */
export function SessionLogDownloadHeaderAction(props: SessionLogDownloadDialogProps): ReactNode {
  const { sessionId, useSessionLogDownload, request } = props
  const entry = useSessionLogDownload(state => state.bySession[String(sessionId)])
  const busy = entry?.status === 'downloading'

  return (
    <>
      <Tooltip label="Session log" delayMs={400}>
        <button
          type="button"
          className={css.sessionLogButton}
          disabled={busy}
          aria-busy={busy}
          aria-label="Session log"
          onClick={() => { void request(sessionId) }}
        >
          <IconDownloadOutline16 size={14} />
        </button>
      </Tooltip>
      <SessionLogDownloadDialog {...props} />
    </>
  )
}
