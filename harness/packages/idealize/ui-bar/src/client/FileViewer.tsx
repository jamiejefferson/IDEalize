/**
 * The deck's file viewer: opened from either files tree, it renders the
 * fenced /idealize/bar/file envelope — markdown through the client's own
 * renderer, code through the shared highlighter, images from the raw route.
 * V0's viewer had neither highlighting nor images; both are deliberate here.
 * It lives in its own resizable column (shell.deck), beside the files
 * drawer, per V0's separate document panel.
 *
 * Markdown files also carry V0's section-title navigation: an outline column
 * to the right of the document, read from the rendered h1–h6 after the body
 * mounts (the renderer emits no heading ids, and reading the DOM keeps the
 * outline 1:1 with what jumping targets — fenced code is already a CodeBlock,
 * so a shell comment can never appear as a heading). Clicking an entry
 * scrolls that heading to the top of the document scroller. The outline
 * auto-collapses while the deck is narrower than 520px; the toolbar toggle
 * works at any width and its manual preference persists.
 *
 * The Notes scratchpad opens here too (`onNewNote` set): it starts in the
 * editor and saves as you type, so there is no Save or Cancel, only Preview
 * and New note (JJ, 6 Oct 2026: "editable by default").
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CodeBlock, IconPlusOutline16, MarkdownText, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { BarIconClose, BarIconOutline, BarIconReveal } from './BarIcons.tsx'
import { activeHeading } from './outline-active.ts'
import css from './FileViewer.module.css'
import { fileManagerKey } from './host-path.ts'

type BarTranslate = PropsLocale<'idealize-bar'>['t']

/** The /idealize/bar/file envelope. */
interface FileEnvelope {
  name: string
  kind: 'text' | 'image' | 'binary'
  size: number
  text?: string
  truncated?: boolean
}

/** V0's `markdownExtensions` gate, verbatim: only these get the outline column. */
const MARKDOWN_EXT = new Set(['md', 'markdown', 'mdown', 'mkd', 'mdx'])

/** One rendered heading, held as its live element so jumping cannot drift. */
interface OutlineHeading {
  level: number
  title: string
  el: HTMLElement
}

/** Persisted manual outline preference ('open' | 'closed'). */
const OUTLINE_PREF_KEY = 'idealize.viewer.outline'
/** Persisted outline column width, in CSS px. */
const OUTLINE_WIDTH_KEY = 'idealize.viewer.outlineWidth'
/** Measured viewer width under which the outline auto-collapses. */
const OUTLINE_AUTO_COLLAPSE_WIDTH = 520
/** What the outline column may be dragged between, and where it starts. */
const OUTLINE_WIDTH_MIN = 120
const OUTLINE_WIDTH_MAX = 420
const OUTLINE_WIDTH_DEFAULT = 176
/** How long typing in a note pauses before it is written to disk. */
export const NOTE_SAVE_DELAY_MS = 600

/**
 * Hold a width inside the outline's range.
 * @param width - the width asked for.
 * @returns the width the column will actually take.
 */
export function clampOutlineWidth(width: number): number {
  return Math.min(OUTLINE_WIDTH_MAX, Math.max(OUTLINE_WIDTH_MIN, Math.round(width)))
}

/** The persisted outline width; the default when unset or unreadable. */
function readOutlineWidth(): number {
  try {
    const stored = Number(localStorage.getItem(OUTLINE_WIDTH_KEY))
    return Number.isFinite(stored) && stored > 0 ? clampOutlineWidth(stored) : OUTLINE_WIDTH_DEFAULT
  } catch {
    // Storage access denied (private mode): the default; nothing else throws here.
    return OUTLINE_WIDTH_DEFAULT
  }
}

/**
 * Persist the outline width the drag settled on.
 * @param width - the width to remember.
 */
function writeOutlineWidth(width: number): void {
  try {
    localStorage.setItem(OUTLINE_WIDTH_KEY, String(width))
  } catch {
    // Storage access denied (private mode): the width still applies to this mount.
  }
}

/** The persisted outline preference; open when unset. */
function readOutlinePref(): boolean {
  try {
    return localStorage.getItem(OUTLINE_PREF_KEY) !== 'closed'
  } catch {
    // Storage access denied (private mode): default open; nothing else throws here.
    return true
  }
}

/**
 * Persist the manual outline preference.
 * @param open - the preference the user just chose.
 */
function writeOutlinePref(open: boolean): void {
  try {
    localStorage.setItem(OUTLINE_PREF_KEY, open ? 'open' : 'closed')
  } catch {
    // Storage access denied (private mode): the toggle still applies to this mount.
  }
}

/** Lowercased extension without the dot, or undefined. */
function fileExtension(name: string): string | undefined {
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return undefined
  return name.slice(dot + 1).toLowerCase()
}

export function FileViewer({ path, canReveal, onClose, onAddToChat, onNewNote, t }: {
  path: string
  canReveal: boolean
  onClose: () => void
  /** Hand the file's path to the active chat's composer; false = no active chat. */
  onAddToChat: (path: string) => boolean
  /** Set while the file is the Notes scratchpad: start a fresh note in its place. */
  onNewNote?: () => void
  t: BarTranslate
}) {
  const isNote = onNewNote !== undefined
  const [envelope, setEnvelope] = useState<FileEnvelope | 'error' | undefined>(undefined)
  const [revealFailed, setRevealFailed] = useState(false)
  /** The editor's text while editing; null while reading. */
  const [editing, setEditing] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ level: 'info' | 'error'; text: string } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const markdownRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [headings, setHeadings] = useState<readonly OutlineHeading[]>([])
  const [active, setActive] = useState(-1)
  const [outlineOpen, setOutlineOpen] = useState(readOutlinePref)
  const [outlineWidth, setOutlineWidth] = useState(readOutlineWidth)
  const [narrow, setNarrow] = useState(false)
  /** A note's save state, shown in the toolbar in place of Save. */
  const [noteSave, setNoteSave] = useState<'idle' | 'saving' | 'saved'>('idle')
  /** The note's size on disk as last read or written: the next write's expectedSize. */
  const diskSize = useRef(0)
  /** The note's text as last written, so an unchanged editor writes nothing. */
  const diskText = useRef<string | null>(null)
  /** Writes run one after another, so each carries the size the one before left. */
  const writeChain = useRef<Promise<void>>(Promise.resolve())
  /** The note's editor opens once per load; Preview then stays put. */
  const autoEdited = useRef(false)

  useEffect(() => {
    let cancelled = false
    setEnvelope(undefined)
    setRevealFailed(false)
    setEditing(null)
    setNotice(null)
    setNoteSave('idle')
    autoEdited.current = false
    diskText.current = null
    void fetch(`/idealize/bar/file?path=${encodeURIComponent(path)}`)
      .then(response => response.ok
        ? response.json() as Promise<FileEnvelope>
        : Promise.reject(new Error('open failed')))
      .then((body) => { if (!cancelled) setEnvelope(body) })
      .catch(() => { if (!cancelled) setEnvelope('error') })
    return () => { cancelled = true }
  }, [path])

  // Auto-collapse watch: the deck column is user-resizable and the layout
  // solver squeezes it to its 360px floor at narrow windows, so the width is
  // measured on the rendered root, not derived from any stored preference.
  useEffect(() => {
    const root = rootRef.current
    if (root === null) return
    const observer = new ResizeObserver((entries) => {
      // One observed target, so at most one entry; a batch's last write wins.
      for (const entry of entries) setNarrow(entry.contentRect.width < OUTLINE_AUTO_COLLAPSE_WIDTH)
    })
    observer.observe(root)
    return () => { observer.disconnect() }
  }, [])

  // Crossing the width threshold re-applies the automatic state: collapsed
  // while narrow, the persisted preference once wide again. A manual toggle
  // after the crossing wins until the next crossing.
  useEffect(() => {
    setOutlineOpen(narrow ? false : readOutlinePref())
  }, [narrow])

  // The outline mirrors the rendered document, so it is (re)read after the
  // markdown body commits, and empties when a non-markdown envelope replaces it.
  useLayoutEffect(() => {
    const container = markdownRef.current
    if (container === null) {
      setHeadings([])
      return
    }
    const found = [...container.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')]
    setHeadings(found.map(el => ({
      level: Number(el.tagName.slice(1)),
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- tsc's lib.dom types textContent string | null; keep the guard
      title: el.textContent ?? '',
      el,
    })))
  }, [envelope])

  // The outline follows the scroll: the highlighted entry is the section the
  // reader is in. Read from the live rects rather than measured-once offsets,
  // because the deck resizes and the markdown reflows under it.
  useEffect(() => {
    const scroller = bodyRef.current
    if (scroller === null || headings.length === 0) {
      setActive(-1)
      return
    }
    const measure = (): void => {
      const top = scroller.getBoundingClientRect().top
      setActive(activeHeading(headings.map(heading => heading.el.getBoundingClientRect().top - top)))
    }
    measure()
    scroller.addEventListener('scroll', measure, { passive: true })
    return () => { scroller.removeEventListener('scroll', measure) }
  }, [headings])

  // A note opens in the editor once its text has loaded: complete text only,
  // since a truncated read would save a truncated file.
  useEffect(() => {
    if (!isNote || autoEdited.current || envelope === undefined || envelope === 'error') return
    if (envelope.kind !== 'text' || envelope.truncated === true) return
    autoEdited.current = true
    diskSize.current = envelope.size
    diskText.current = envelope.text ?? ''
    setEditing(envelope.text ?? '')
  }, [isNote, envelope])

  /**
   * Write a note's text behind any write still in flight. A 409 means
   * something else (an agent, another editor) changed the note since it was
   * read; the editor keeps its text and says so rather than overwrite it.
   */
  const writeNote = useCallback((text: string): Promise<void> => {
    const run = async (): Promise<void> => {
      if (text === diskText.current) return
      setNoteSave('saving')
      try {
        const response = await fetch('/idealize/bar/write', {
          method: 'POST',
          headers: { 'x-idealize-auth': '1', 'content-type': 'application/json' },
          body: JSON.stringify({ path, text, expectedSize: diskSize.current }),
          keepalive: true,
        })
        if (response.status === 409) {
          setNoteSave('idle')
          setNotice({ level: 'error', text: t('viewer.changedOnDisk') })
          return
        }
        if (!response.ok) throw new Error(String(response.status))
        const body = await response.json() as { size: number }
        diskSize.current = body.size
        diskText.current = text
        setEnvelope(previous => previous === undefined || previous === 'error'
          ? previous
          : { ...previous, text, size: body.size, truncated: false })
        setNoteSave('saved')
      } catch {
        // The host is unreachable or refused the write: the text stays in the editor.
        setNoteSave('idle')
        setNotice({ level: 'error', text: t('viewer.saveFailed') })
      }
    }
    writeChain.current = writeChain.current.then(run)
    return writeChain.current
  }, [path, t])

  // A note saves itself once typing pauses.
  useEffect(() => {
    if (!isNote || editing === null || editing === diskText.current) return
    const timer = setTimeout(() => { void writeNote(editing) }, NOTE_SAVE_DELAY_MS)
    return () => { clearTimeout(timer) }
  }, [isNote, editing, writeNote])

  // Closing the deck or switching file mid-pause still writes what was typed.
  const latestEdit = useRef<string | null>(null)
  latestEdit.current = editing
  useEffect(() => () => {
    if (isNote && latestEdit.current !== null) void writeNote(latestEdit.current)
  }, [isNote, writeNote])

  /** Leave a note's editor for the rendered note, after its last keystrokes are written. */
  const previewNote = (): void => {
    if (editing === null) return
    const text = editing
    void writeNote(text).then(() => { setEditing(null) })
  }

  const reveal = (): void => {
    setRevealFailed(false)
    void fetch('/idealize/bar/reveal', {
      method: 'POST',
      headers: { 'x-idealize-auth': '1', 'content-type': 'application/json' },
      body: JSON.stringify({ path }),
    })
      .then((response) => { if (!response.ok) setRevealFailed(true) })
      .catch(() => { setRevealFailed(true) })
  }

  /** Confirmations fade; errors stay until the next action replaces them. */
  useEffect(() => {
    if (notice === null || notice.level === 'error') return
    const timer = setTimeout(() => { setNotice(null) }, 2500)
    return () => { clearTimeout(timer) }
  }, [notice])

  const addToChat = (): void => {
    setNotice(onAddToChat(path)
      ? { level: 'info', text: t('files.addedToChat') }
      : { level: 'error', text: t('files.noSession') })
  }

  /**
   * Save the editor's text through the fenced write route, then re-read the
   * envelope so the rendered view is what is on disk. A 409 means another
   * writer changed the file since it was opened; the editor stays up with
   * its text, and closing it reloads.
   */
  const save = (): void => {
    if (editing === null || saving || envelope === undefined || envelope === 'error') return
    setSaving(true)
    void fetch('/idealize/bar/write', {
      method: 'POST',
      headers: { 'x-idealize-auth': '1', 'content-type': 'application/json' },
      body: JSON.stringify({ path, text: editing, expectedSize: envelope.size }),
    })
      .then(async (response) => {
        if (response.status === 409) {
          setNotice({ level: 'error', text: t('viewer.changedOnDisk') })
          return
        }
        if (!response.ok) {
          setNotice({ level: 'error', text: t('viewer.saveFailed') })
          return
        }
        const body = await response.json() as { size: number }
        setEnvelope({ ...envelope, text: editing, size: body.size, truncated: false })
        setEditing(null)
        setNotice({ level: 'info', text: t('viewer.saved') })
      })
      .catch(() => { setNotice({ level: 'error', text: t('viewer.saveFailed') }) })
      .finally(() => { setSaving(false) })
  }

  const toggleOutline = (): void => {
    const next = !outlineOpen
    setOutlineOpen(next)
    writeOutlinePref(next)
  }

  /** Scroll the heading to the top of the document scroller, IDE jump-to-symbol style. */
  const jumpTo = (heading: OutlineHeading): void => {
    heading.el.scrollIntoView({ block: 'start' })
  }

  const name = envelope !== undefined && envelope !== 'error' ? envelope.name : path.split(/[\\/]/).pop() ?? path
  const extension = fileExtension(name)
  const isMarkdown = envelope !== undefined && envelope !== 'error'
    && envelope.kind === 'text' && extension !== undefined && MARKDOWN_EXT.has(extension)

  // Editable while the envelope is complete text: a truncated read would
  // save a truncated file.
  const editable = envelope !== undefined && envelope !== 'error' && envelope.kind === 'text' && envelope.truncated !== true

  let body = null
  if (envelope === undefined) {
    body = <div className={css.notice}>{t('viewer.loading')}</div>
  } else if (envelope === 'error') {
    body = <div className={css.notice}>{t('viewer.error')}</div>
  } else if (editing !== null) {
    body = (
      <textarea
        className={css.editor}
        aria-label={t('viewer.edit')}
        value={editing}
        spellCheck={false}
        autoFocus
        onChange={(event) => { setEditing(event.currentTarget.value) }}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 's') {
            event.preventDefault()
            if (isNote) void writeNote(editing)
            else save()
          } else if (event.key === 'Escape' && !isNote) {
            setEditing(null)
          }
        }}
      />
    )
  } else {
    if (envelope.kind === 'image') {
      body = (
        <div className={css.imageStage}>
          <img className={css.image} src={`/idealize/bar/raw?path=${encodeURIComponent(path)}`} alt={name} />
        </div>
      )
    } else if (envelope.kind === 'binary') {
      body = <div className={css.notice}>{t('viewer.binary')}</div>
    } else if (isMarkdown) {
      body = (
        <div className={css.markdown} ref={markdownRef}>
          <MarkdownText
            text={envelope.text ?? ''}
            codeLabels={{ copyLabel: t('viewer.copy'), copiedLabel: t('viewer.copied') }}
          />
        </div>
      )
    } else {
      body = (
        <CodeBlock
          className={css.code}
          code={envelope.text ?? ''}
          lang={extension}
          copyLabel={t('viewer.copy')}
          copiedLabel={t('viewer.copied')}
        />
      )
    }
  }

  const truncated = envelope !== undefined && envelope !== 'error' && envelope.truncated === true

  const outlineBody = headings.length === 0
    ? <div className={css.noHeadings}>{t('viewer.noHeadings')}</div>
    : (
      <div className={css.outlineList}>
        {headings.map((heading, index) => (
          <button
            key={index}
            type="button"
            className={css.outlineEntry}
            title={heading.title}
            aria-current={index === active ? 'location' : undefined}
            {...index === active ? { 'data-outline-active': '' } : {}}
            // V0's ramp: 12px indent per level, font 10 + (6 - level).
            style={{
              paddingLeft: 8 + (heading.level - 1) * 12,
              fontSize: 10 + (6 - heading.level),
            }}
            onClick={() => { jumpTo(heading) }}
          >
            {heading.title}
          </button>
        ))}
      </div>
    )

  return (
    <div className={css.root} ref={rootRef}>
      <div className={css.toolbar}>
        <span className={css.name}>{name}</span>
        <span className={css.toolbarActions}>
          {isNote && noteSave !== 'idle' && (
            <span className={css.saveState} role="status" data-note-save={noteSave}>
              {t(noteSave === 'saving' ? 'viewer.saving' : 'viewer.saved')}
            </span>
          )}
          {isNote && editing !== null && (
            <button type="button" className={css.textAction} data-note-preview="" onClick={previewNote}>{t('viewer.preview')}</button>
          )}
          {isNote && (
            <button type="button" className={css.textAction} data-note-new="" onClick={onNewNote}>{t('viewer.newNote')}</button>
          )}
          {editing !== null && !isNote && (
            <>
              <button type="button" className={css.textAction} onClick={() => { setEditing(null) }}>{t('viewer.cancel')}</button>
              <button type="button" className={css.textActionPrimary} data-viewer-save="" disabled={saving} onClick={save}>{t('viewer.save')}</button>
            </>
          )}
          {editing === null && editable && (
            <button type="button" className={css.textAction} data-viewer-edit="" onClick={() => { setEditing(envelope.text ?? '') }}>
              {t('viewer.edit')}
            </button>
          )}
          <Tooltip label={t('viewer.addToChat')} delayMs={400}>
            <button type="button" className={css.iconAction} aria-label={t('viewer.addToChat')} onClick={addToChat}>
              <IconPlusOutline16 size={13} />
            </button>
          </Tooltip>
          {canReveal && (
            <Tooltip label={t(fileManagerKey('files.reveal'))} delayMs={400}>
              <button type="button" className={css.iconAction} aria-label={t(fileManagerKey('files.reveal'))} onClick={reveal}>
                <BarIconReveal size={13} />
              </button>
            </Tooltip>
          )}
          {isMarkdown && editing === null && (
            <button
              type="button"
              className={css.outlineToggle}
              aria-label={t('viewer.outline')}
              aria-pressed={outlineOpen}
              onClick={toggleOutline}
            >
              <BarIconOutline size={13} />
            </button>
          )}
          <button type="button" className={css.close} aria-label={t('panel.close')} onClick={onClose}>
            <BarIconClose size={13} />
          </button>
        </span>
      </div>
      {truncated && <div className={css.truncated}>{t('viewer.truncated')}</div>}
      {revealFailed && <div className={css.revealError}>{t(fileManagerKey('files.revealFailed'))}</div>}
      {notice !== null && <div className={css.revealError} data-level={notice.level} role="status">{notice.text}</div>}
      <div className={css.split}>
        <div className={css.body} ref={bodyRef} data-viewer-body="">{body}</div>
        {isMarkdown && outlineOpen && editing === null && (
          <>
            {/* The outline is a column like any other, so its border resizes it
                (JJ, 1 Sep 2026: "all columns including file viewer and menu
                within it should be draggable"). Pointer capture keeps the drag
                alive over the document, and the width settles on release. */}
            <div
              className={css.outlineHandle}
              role="separator"
              aria-orientation="vertical"
              aria-label={t('viewer.outlineResize')}
              data-viewer-outline-handle=""
              onPointerDown={(event) => {
                event.preventDefault()
                event.currentTarget.setPointerCapture(event.pointerId)
                const startX = event.clientX
                const startWidth = outlineWidth
                const move = (moveEvent: PointerEvent): void => {
                  setOutlineWidth(clampOutlineWidth(startWidth - (moveEvent.clientX - startX)))
                }
                const up = (): void => {
                  document.removeEventListener('pointermove', move)
                  document.removeEventListener('pointerup', up)
                  setOutlineWidth((width) => {
                    writeOutlineWidth(width)
                    return width
                  })
                }
                document.addEventListener('pointermove', move)
                document.addEventListener('pointerup', up)
              }}
            />
            <nav className={css.outline} style={{ width: `${String(outlineWidth)}px` }} aria-label={t('viewer.outline')}>
              {outlineBody}
            </nav>
          </>
        )}
      </div>
    </div>
  )
}
