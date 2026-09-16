/**
 * The Feedback pane: V0's feedback form as a token-styled drawer pane
 * posting through the host's `/idealize/feedback/submit` proxy (which
 * appends the local backup before Supabase). Replaces the standalone iframe
 * page, and unlike it surfaces every failure in the pane: an upstream
 * failure says the report is kept locally, any other failure shows its
 * reason.
 *
 * Screenshots attach three ways (V0 parity): the Attach button, drag-drop
 * anywhere on the pane, or paste. Images are downscaled in-pane to at most
 * 1600px on the long edge and sent as plain base64 JPEG (the table's
 * `screenshot_b64` format; the host refuses payloads over 2M characters).
 */
import { useRef, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './FeedbackPanel.module.css'

/** The bar namespace's bound translate seat, passed down as a plain prop. */
type BarTranslate = PropsLocale<'idealize-bar'>['t']

/** Mutating /idealize routes require the auth marker (host route fence). */
const HEADERS = { 'x-idealize-auth': '1', 'content-type': 'application/json' }

type FeedbackType = 'feedback' | 'bug' | 'idea'

/** The status line under the actions; errors persist until the next action. */
interface Status {
  level: 'muted' | 'error'
  text: string
}

/** An adopted screenshot: the wire base64 and the thumbnail's data URL. */
interface Shot {
  b64: string
  dataUrl: string
}

/** Downscale to a 1600px long edge and re-encode as JPEG (V0's wire format). */
async function encodeImage(blob: Blob): Promise<Shot> {
  const url = URL.createObjectURL(blob)
  try {
    const image = new Image()
    await new Promise((resolve, reject) => {
      image.onload = resolve
      image.onerror = reject
      image.src = url
    })
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(image.naturalWidth * scale)
    canvas.height = Math.round(image.naturalHeight * scale)
    canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
    return { b64: dataUrl.slice(dataUrl.indexOf(',') + 1), dataUrl }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Render the Feedback pane.
 * @param props.t - the bar namespace's bound translate.
 * @param props.notifyDone - chime + notification after a submit lands (JJ round 3: the in-pane line alone went unnoticed).
 * @returns the pane element tree.
 */
export function FeedbackPanel({ t, notifyDone }: { t: BarTranslate; notifyDone: (title: string, body: string) => void }) {
  const [type, setType] = useState<FeedbackType>('feedback')
  const [text, setText] = useState('')
  const [shot, setShot] = useState<Shot | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status | null>(null)
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement | null>(null)

  const adopt = async (blob: Blob | null | undefined): Promise<void> => {
    if (blob == null || !blob.type.startsWith('image/')) return
    try {
      setShot(await encodeImage(blob))
      setStatus(null)
    } catch {
      setStatus({ level: 'error', text: t('feedback.badImage') })
    }
  }

  const send = async (): Promise<void> => {
    const words = text.trim()
    if (words === '') {
      setStatus({ level: 'error', text: t('feedback.empty') })
      return
    }
    setBusy(true)
    setStatus({ level: 'muted', text: t('feedback.sending') })
    try {
      const response = await fetch('/idealize/feedback/submit', {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({ text: words, feedbackType: type, ...shot === null ? {} : { screenshot: shot.b64 } }),
      })
      const body = await response.json().catch(() => ({})) as { error?: string; backedUpLocally?: boolean }
      if (response.ok) {
        setText('')
        setShot(null)
        setStatus({ level: 'muted', text: t('feedback.sent') })
        notifyDone(t('feedback.notify.title'), t('feedback.notify.body'))
      } else if (body.backedUpLocally === true) {
        setStatus({ level: 'error', text: t('feedback.failedKept', { detail: body.error ?? `HTTP ${response.status}` }) })
      } else {
        setStatus({ level: 'error', text: t('feedback.failed', { detail: body.error ?? `HTTP ${response.status}` }) })
      }
    } catch (error) {
      // The submit never reached the host, so no local backup exists either.
      setStatus({ level: 'error', text: t('feedback.failed', { detail: error instanceof Error ? error.message : String(error) }) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      className={css.root}
      aria-label={t('bar.feedback')}
      data-dragging={dragging ? '' : undefined}
      onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
      onDragEnter={(event) => { event.preventDefault(); setDragging(true) }}
      onDragLeave={(event) => { event.preventDefault(); setDragging(false) }}
      onDrop={(event) => {
        event.preventDefault()
        setDragging(false)
        void adopt([...event.dataTransfer.files].find(file => file.type.startsWith('image/')))
      }}
      onPaste={(event) => {
        const item = [...event.clipboardData.items].find(entry => entry.type.startsWith('image/'))
        if (item !== undefined) {
          event.preventDefault()
          void adopt(item.getAsFile())
        }
      }}
    >
      <p className={css.intro}>{t('feedback.intro')}</p>
      <select
        className={css.select}
        value={type}
        aria-label={t('feedback.type')}
        onChange={(event) => { setType(event.target.value as FeedbackType) }}
      >
        <option value="feedback">{t('feedback.type.feedback')}</option>
        <option value="bug">{t('feedback.type.bug')}</option>
        <option value="idea">{t('feedback.type.idea')}</option>
      </select>
      <textarea
        className={css.text}
        rows={6}
        value={text}
        placeholder={t('feedback.placeholder')}
        aria-label={t('feedback.message')}
        onChange={(event) => { setText(event.target.value) }}
      />
      {shot !== null && (
        <div className={css.shotRow}>
          <img className={css.shotThumb} src={shot.dataUrl} alt={t('feedback.screenshot')} />
          <button type="button" className={css.shotRemove} onClick={() => { setShot(null) }}>
            {t('feedback.remove')}
          </button>
        </div>
      )}
      <div className={css.actions}>
        <button type="button" className={css.send} disabled={busy} onClick={() => { void send() }}>
          {t('feedback.send')}
        </button>
        <button type="button" className={css.attach} disabled={busy} onClick={() => { fileInput.current?.click() }}>
          {t('feedback.attach')}
        </button>
        <input
          ref={fileInput}
          className={css.fileInput}
          type="file"
          accept="image/*"
          aria-label={t('feedback.attach')}
          onChange={(event) => {
            void adopt(event.target.files?.[0])
            event.target.value = ''
          }}
        />
      </div>
      <p className={css.status} data-level={status?.level} role="status">{status?.text ?? ''}</p>
    </section>
  )
}
