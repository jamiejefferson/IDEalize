/**
 * The Service tab of the Service hatch drawer pane: V0's hatch chat brought
 * into V1 as a full chat surface. A real agent session rooted in IDEalize's
 * own source checkout renders with the complete transcript projection
 * (user/assistant rows, tool cards, command and failure rows) and a real
 * composer (image attachments, stop) right inside the pane — describe a
 * change and it gets made from in here. The session is a normal one (it
 * appears in the rail under the source project once engaged), so "Open as a
 * chat" hands it to the main surface. Every failure path renders a visible
 * message in the pane: the service probe, the session create, and the send
 * each have their own strip.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { displayFailureMessage, toAssistantBlocks } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  AssistantBlock, ChatConversationViewNode, CommandNode, SessionBinding, ToolCallBlock,
  ToolResultNode, UserMessageNode,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {
  AssistantChatData, ManualCompactionChatData, ToolChatData,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { IconPlusOutline16, MarkdownText, MessageText } from '@deepseek-ai/dsh-client-ui-primitives'
import { AttachmentRail, ImageLightbox } from '@deepseek-ai/dsh-client-ui-attachment'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './ServiceSection.module.css'

/** The /idealize/hatch/service report (host half of @idealize/hatch). */
interface ServiceInfo {
  path: string
  valid: boolean
  configured: boolean
  workspaceId?: string
}

/** Registration-side face, built over ctx.workspaces/ctx.sessions (index.ts). */
export interface ServiceSectionInjected {
  /** A binding for the newest existing hatch session, without creating anything. */
  adoptSession: (path: string) => SessionBinding | null
  /**
   * Create/find the source workspace and a session in it, stage it open so
   * the transcript streams, and bind it. Rejects on any create failure —
   * the section renders the message; it never fails silently.
   */
  ensureSession: (path: string) => Promise<SessionBinding>
  /** Open the Brains pane (model connections), from the connect-a-model notice. */
  openModels: () => void
}

/** The pane hands the section its copy and the session plumbing. */
export type ServiceSectionProps = PropsLocale<'idealize-bar'> & ServiceSectionInjected

/** The bar-namespace translate as the transcript components consume it. */
type T = PropsLocale<'idealize-bar'>['t']

/** The image media types the host prompt route accepts (apiproxy contract). */
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

/** One browser-held composer image (object URL owned until send/remove). */
interface DraftImage {
  id: string
  file: File
  previewUrl: string
}

/** Byte cap for inline tool args/results before the pane truncates them. */
const TOOL_TEXT_CAP = 4000

/** How long the quote's typing indicator holds before the line lands. */
const QUOTE_TYPING_MS = 600

/**
 * The movie quote as the chat's opening message: a typing indicator that
 * resolves into the line, so it arrives in the chat format rather than
 * sitting in the banner (JJ, 2026-09-01). Reduced motion lands the line at
 * once.
 */
function QuoteRow({ t }: { t: T }) {
  const [typed, setTyped] = useState(() =>
    typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    if (typed) return
    const timer = setTimeout(() => { setTyped(true) }, QUOTE_TYPING_MS)
    return () => { clearTimeout(timer) }
  }, [typed])
  return (
    <div className={css.quoteRow}>
      {typed
        ? <p className={css.quoteBubble}>{t('service.banner.quote')}</p>
        : (
          <span className={css.typingBubble} aria-hidden="true">
            <span className={css.typingDot} />
            <span className={css.typingDot} />
            <span className={css.typingDot} />
          </span>
        )}
    </div>
  )
}

function capText(text: string): string {
  return text.length > TOOL_TEXT_CAP ? `${text.slice(0, TOOL_TEXT_CAP)}…` : text
}

/** One-line tool-args digest: scalar fields joined, or the raw text. */
function argsSummary(argsRaw: string): string {
  try {
    const parsed = JSON.parse(argsRaw) as unknown
    if (parsed !== null && typeof parsed === 'object') {
      const parts = Object.entries(parsed as Record<string, unknown>)
        .filter(([, value]) => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
        .map(([key, value]) => `${key}: ${String(value)}`)
      if (parts.length > 0) return parts.join(', ')
    }
  } catch {
    // argsRaw may be a streaming fragment or non-JSON; the raw text below is
    // the complete fallback presentation.
  }
  return argsRaw
}

/** Pretty-printed args for the expanded card; raw when not JSON. */
function argsDetail(argsRaw: string): string {
  try {
    return capText(JSON.stringify(JSON.parse(argsRaw), null, 2))
  } catch {
    // Non-JSON args render verbatim.
    return capText(argsRaw)
  }
}

/** Concatenated text blocks of one tool result. */
function toolResultText(node: ToolResultNode): string {
  return toAssistantBlocks(node.content)
    .filter((block): block is AssistantBlock & { kind: 'text' } => block.kind === 'text')
    .map(block => block.text)
    .join('\n')
}

/** One tool call (running or settled), with its nested subcalls. */
function ToolCard({ block, depth, t }: { block: ToolCallBlock; depth: number; t: T }) {
  const settled = 'kind' in block
  const failed = settled && (block.isError || block.error !== undefined)
  const status = !settled ? 'running' : failed ? 'error' : 'done'
  const name = settled ? block.call?.name ?? block.callId : block.name
  const argsRaw = settled ? block.call?.argsRaw ?? '' : block.argsRaw
  const result = settled ? capText(toolResultText(block)) : ''
  const statusLabel = status === 'running'
    ? t('service.tool.running')
    : status === 'error' ? t('service.tool.error') : t('service.tool.done')
  return (
    <details className={css.toolCard} data-status={status}>
      <summary className={css.toolHead}>
        <span className={css.toolDot} data-status={status} role="img" aria-label={statusLabel} />
        <span className={css.toolName}>{name}</span>
        <span className={css.toolArgs}>{argsSummary(argsRaw)}</span>
      </summary>
      {argsRaw !== '' && <pre className={css.toolPre}>{argsDetail(argsRaw)}</pre>}
      {result !== '' && (
        <>
          <div className={css.toolLabel}>{t('service.tool.result')}</div>
          <pre className={css.toolPre}>{result}</pre>
        </>
      )}
      {settled && failed && result === '' && (
        <div className={css.errorLine}>
          {block.error !== undefined ? `${block.error.name} (${block.error.code})` : t('service.tool.error')}
        </div>
      )}
      {depth < 4 && block.subCalls.length > 0 && (
        <div className={css.subCalls}>
          {block.subCalls.map(sub => <ToolCard key={sub.callId} block={sub} depth={depth + 1} t={t} />)}
        </div>
      )}
    </details>
  )
}

/** A user or steering message bubble (text plus an image count chip). */
function UserRow({ content, t }: { content: UserMessageNode['content']; t: T }) {
  const blocks = toAssistantBlocks(content)
  const text = blocks
    .filter((block): block is AssistantBlock & { kind: 'text' } => block.kind === 'text')
    .map(block => block.text)
    .join('\n')
  const images = blocks.filter(block => block.kind === 'image').length
  if (text === '' && images === 0) return null
  return (
    <div className={css.userRow}>
      <div className={css.userBubble}>
        {images > 0 && <span className={css.imageChip}>{`${t('service.image')} ×${images}`}</span>}
        {text !== '' && <MessageText text={text} />}
      </div>
    </div>
  )
}

/** An assistant step: markdown text, collapsible reasoning; tool heads render as tool nodes. */
function AssistantRow({ data, t }: { data: AssistantChatData; t: T }) {
  return (
    <div className={css.assistantRow}>
      {data.blocks.map((block, index) => {
        if (block.kind === 'text') {
          return (
            <MarkdownText
              key={index}
              text={block.text}
              streaming={data.status === 'running' && index === data.blocks.length - 1}
            />
          )
        }
        if (block.kind === 'reasoning') {
          return (
            <details key={index} className={css.reasoning}>
              <summary className={css.reasoningLabel}>{t('service.reasoning')}</summary>
              <MessageText text={block.text} />
            </details>
          )
        }
        if (block.kind === 'image') {
          return <span key={index} className={css.imageChip}>{t('service.image')}</span>
        }
        // tool-call heads render as their own 'tool-call' nodes; 'other' has no presentation.
        return null
      })}
    </div>
  )
}

/** One slash-command lifecycle line. */
function CommandRow({ command, t }: { command: CommandNode; t: T }) {
  const line = `/${command.name ?? '?'}${command.args === null || command.args === '' ? '' : command.args}`
  return (
    <div className={css.commandRow}>
      <code className={css.commandLine}>{line}</code>
      {command.outcome === null && <span className={css.mutedLine}>{t('service.command.running')}</span>}
      {command.outcome !== null && command.outcome.text !== undefined && command.outcome.text !== '' && (
        <span className={command.outcome.kind === 'error' ? css.errorLine : css.mutedLine}>
          {command.outcome.text}
        </span>
      )}
    </div>
  )
}

/** One transcript row: the full projection this pane renders (kind-dispatched). */
function TranscriptRow({ node, onConnectModel, t }: { node: ChatConversationViewNode; onConnectModel: () => void; t: T }): ReactNode {
  if (node.visibility === 'hidden') return null
  switch (node.kind) {
    case 'user':
    case 'steering':
      return <UserRow content={(node.data as UserMessageNode).content} t={t} />
    case 'assistant-step':
      return <AssistantRow data={node.data as AssistantChatData} t={t} />
    case 'tool-call':
      return <ToolCard block={(node.data as ToolChatData).root} depth={0} t={t} />
    case 'command':
      return <CommandRow command={node.data as CommandNode} t={t} />
    case 'manual-compaction': {
      const data = node.data as ManualCompactionChatData
      return (
        <>
          <CommandRow command={data.command} t={t} />
          {data.compaction !== null && <div className={css.mutedLine}>{t('service.compaction')}</div>}
        </>
      )
    }
    case 'compaction':
      return <div className={css.mutedLine}>{t('service.compaction')}</div>
    case 'model-retry':
      return <div className={css.mutedLine}>{t('service.retrying')}</div>
    case 'turn-error':
      // A turn that failed because no model is connected gets the actionable
      // notice (the prompt was accepted, so the failure lands here rather
      // than on promptError).
      if (needsModelConnection(node.data)) {
        return (
          <div className={css.notice} role="alert">
            <span>{displayFailureMessage(node.data)}</span>
            <button type="button" className={css.secondary} onClick={onConnectModel}>
              {t('service.connect')}
            </button>
          </div>
        )
      }
      return <div className={css.errorLine} role="alert">{displayFailureMessage(node.data)}</div>
    case 'turn-max-tokens':
      return <div className={css.errorLine}>{t('service.maxtokens')}</div>
    default:
      // turn-tail (actions strip) and unknown kinds have no compact-pane presentation.
      return null
  }
}

/** Whether a prompt failure means no model is connected (the actionable pair failure-display.ts maps to connect-a-model copy). */
function needsModelConnection(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  return code === 'MISSING_CREDENTIAL' || code === 'AUTH'
}

/**
 * The live transcript over one bound session: every visible chat node, the
 * running indicator, and the session's own prompt failure. A failure that
 * means "no model connected" renders as a notice with a Connect-a-model
 * button (JJ round 3: the plain line read as a dead chat); other failures
 * keep the plain error line. Follows the tail unless the reader scrolled up.
 */
function ServiceChat({ binding, onConnectModel, t }: { binding: SessionBinding; onConnectModel: () => void; t: T }) {
  const useSession = useMemo(() => bindSnapshotSelector(binding.session), [binding])
  const chat = useSession(snapshot => snapshot.chat)
  const running = useSession(snapshot => snapshot.running)
  const promptError = useSession(snapshot => snapshot.promptError)
  const scroller = useRef<HTMLDivElement | null>(null)
  const stick = useRef(true)

  useEffect(() => {
    const element = scroller.current
    if (element !== null && stick.current) element.scrollTop = element.scrollHeight
  }, [chat, running])

  return (
    <div
      ref={scroller}
      className={css.transcript}
      onScroll={(event) => {
        const element = event.currentTarget
        stick.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48
      }}
    >
      <QuoteRow t={t} />
      {chat.order.map((key) => {
        const node = chat.nodes.get(key)
        return node === undefined ? null : <TranscriptRow key={key} node={node} onConnectModel={onConnectModel} t={t} />
      })}
      {running && <div className={css.workingRow}>{t('service.working')}</div>}
      {promptError !== null && needsModelConnection(promptError.error) && (
        <div className={css.notice} role="alert">
          <span>{displayFailureMessage(promptError.error)}</span>
          <button type="button" className={css.secondary} onClick={onConnectModel}>
            {t('service.connect')}
          </button>
        </div>
      )}
      {promptError !== null && !needsModelConnection(promptError.error) && (
        <div className={css.errorLine} role="alert">
          {`${t('service.error.send')} ${displayFailureMessage(promptError.error)}`}
        </div>
      )}
    </div>
  )
}

/** Serialize composer images to the host's base64 prompt parts. */
async function toImageParts(images: readonly DraftImage[]) {
  return Promise.all(images.map(async ({ file }) => ({
    type: 'image' as const,
    mediaType: file.type as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif',
    data: bytesToBase64(new Uint8Array(await file.arrayBuffer())),
    ...(file.name === '' ? {} : { name: file.name }),
  })))
}

function bytesToBase64(data: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < data.length; index += chunk) {
    binary += String.fromCharCode(...data.subarray(index, index + chunk))
  }
  return btoa(binary)
}

/**
 * Render the Service section: source status with its in-place edit (persisted
 * through POST /idealize/hatch/service), the full hatch transcript opened by
 * the animated quote row, and the composer (attachments, stop) that starts
 * the session on first send. Probe, create, edit, and send failures each
 * render a visible strip.
 * @param props - composed slot props.
 * @returns the section element tree.
 */
export function ServiceSection(props: ServiceSectionProps) {
  const { t, adoptSession, ensureSession, openModels } = props
  const [info, setInfo] = useState<ServiceInfo | null>(null)
  const [infoFailed, setInfoFailed] = useState(false)
  const [probe, setProbe] = useState(0)
  const [binding, setBinding] = useState<SessionBinding | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [paneError, setPaneError] = useState<string | null>(null)
  const [images, setImages] = useState<readonly DraftImage[]>([])
  const [preview, setPreview] = useState<DraftImage | null>(null)
  const [editingSource, setEditingSource] = useState(false)
  const [sourceDraft, setSourceDraft] = useState('')
  const [sourceBusy, setSourceBusy] = useState(false)
  const [sourceError, setSourceError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement | null>(null)
  const running = useRunning(binding)

  /**
   * Persist an edited source path through the hatch route. A success carries
   * the fresh service report, so the header renders exactly what the host now
   * believes; the bound session roots in the old checkout, so it is re-adopted
   * at the new path.
   */
  const saveSource = async (): Promise<void> => {
    const path = sourceDraft.trim()
    if (path === '' || sourceBusy) return
    setSourceBusy(true)
    setSourceError(null)
    try {
      const response = await fetch('/idealize/hatch/service', {
        method: 'POST',
        headers: { 'x-idealize-auth': '1', 'content-type': 'application/json' },
        body: JSON.stringify({ path }),
      })
      const body = await response.json() as ServiceInfo & { error?: string }
      if (!response.ok) {
        setSourceError(`${t('service.error.source')} ${body.error ?? String(response.status)}`)
        return
      }
      setInfo(body)
      setEditingSource(false)
      setBinding(body.valid ? adoptSession(body.path) : null)
    } catch (error) {
      setSourceError(`${t('service.error.source')} ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setSourceBusy(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    setInfoFailed(false)
    void fetch('/idealize/hatch/service')
      .then((response) => {
        if (!response.ok) throw new Error(`service check answered ${response.status}`)
        return response.json() as Promise<ServiceInfo>
      })
      .then((body) => {
        if (cancelled) return
        setInfo(body)
        // Adopt quietly: an existing hatch chat shows its transcript at once;
        // nothing is created until the first send.
        if (body.valid) setBinding(current => current ?? adoptSession(body.path))
      })
      .catch(() => {
        if (!cancelled) {
          setInfo(null)
          setInfoFailed(true)
        }
      })
    return () => { cancelled = true }
  }, [adoptSession, probe])

  // Object URLs live until removed, sent, or the section unmounts.
  const imagesRef = useRef(images)
  imagesRef.current = images
  useEffect(() => () => {
    for (const image of imagesRef.current) URL.revokeObjectURL(image.previewUrl)
  }, [])

  const addFiles = (files: readonly File[]): void => {
    if (files.some(file => !IMAGE_TYPES.has(file.type))) {
      setPaneError(t('service.attach.unsupported'))
    }
    const accepted = files.filter(file => IMAGE_TYPES.has(file.type))
    if (accepted.length === 0) return
    setImages(current => [
      ...current,
      ...accepted.map(file => ({
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
        file,
        previewUrl: URL.createObjectURL(file),
      })),
    ])
  }

  const removeImage = (id: string): void => {
    setImages((current) => {
      const hit = current.find(image => image.id === id)
      if (hit !== undefined) URL.revokeObjectURL(hit.previewUrl)
      return current.filter(image => image.id !== id)
    })
  }

  const disabled = info === null || !info.valid || busy

  const send = async (): Promise<void> => {
    const text = draft.trim()
    if ((text === '' && images.length === 0) || busy || info === null || !info.valid) return
    setBusy(true)
    setPaneError(null)
    try {
      let bound = binding
      if (bound === null) {
        try {
          bound = await ensureSession(info.path)
        } catch (error) {
          setPaneError(`${t('service.error.session')} ${error instanceof Error ? error.message : String(error)}`)
          return
        }
        setBinding(bound)
      }
      try {
        const parts = [
          ...await toImageParts(images),
          ...(text === '' ? [] : [{ type: 'text' as const, text }]),
        ]
        const response = await bound.session.prompt(parts, 'queue')
        // A business failure mirrors into snapshot.promptError, which the
        // transcript renders; the draft stays for a retry.
        if (!response.ok) return
      } catch (error) {
        setPaneError(`${t('service.error.send')} ${error instanceof Error ? error.message : String(error)}`)
        return
      }
      setDraft('')
      setImages((current) => {
        for (const image of current) URL.revokeObjectURL(image.previewUrl)
        return []
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={css.root}
      onDragOver={(event) => { event.preventDefault() }}
      onDrop={(event) => {
        event.preventDefault()
        if (!disabled) addFiles([...event.dataTransfer.files])
      }}
    >
      <header className={css.top}>
        {/* The pane's own header carries the hatch title, so it stands over
            both tabs (JJ, 10 Sep 2026); this bubble opens with the path. */}
        {/* The path renders whether or not it is valid: a wrong source is
            fixed right here, through the edit form. */}
        {info !== null && !editingSource && (
          <p className={css.path}>
            <span className={css.pathLabel}>{t('service.path')}</span>
            {' '}
            {info.path}
            {' '}
            <button
              type="button"
              className={css.pathEdit}
              onClick={() => {
                setSourceDraft(info.path)
                setSourceError(null)
                setEditingSource(true)
              }}
            >
              {t('service.path.edit')}
            </button>
          </p>
        )}
        {info !== null && editingSource && (
          <div className={css.pathForm}>
            <input
              className={css.pathInput}
              value={sourceDraft}
              placeholder={t('service.path.placeholder')}
              aria-label={t('service.path')}
              disabled={sourceBusy}
              onChange={(event) => { setSourceDraft(event.target.value) }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void saveSource()
                }
              }}
            />
            <div className={css.pathActions}>
              <button
                type="button"
                className={css.secondary}
                disabled={sourceBusy || sourceDraft.trim() === ''}
                onClick={() => { void saveSource() }}
              >
                {t('service.path.save')}
              </button>
              <button
                type="button"
                className={css.secondary}
                disabled={sourceBusy}
                onClick={() => {
                  setEditingSource(false)
                  setSourceError(null)
                }}
              >
                {t('service.path.cancel')}
              </button>
            </div>
            {sourceError !== null && <p className={css.errorNotice} role="alert">{sourceError}</p>}
          </div>
        )}
      </header>
      {infoFailed && (
        <div className={css.notice} role="alert">
          <span>{t('service.error.check')}</span>
          <button
            type="button"
            className={css.secondary}
            onClick={() => { setProbe(count => count + 1) }}
          >
            {t('service.retry')}
          </button>
        </div>
      )}
      {info !== null && !info.valid && <p className={css.invalid} role="alert">{t('service.invalid')}</p>}
      {binding !== null && <ServiceChat binding={binding} onConnectModel={openModels} t={t} />}
      {binding === null && (
        <div className={css.transcriptEmpty}>
          <QuoteRow t={t} />
          {info !== null && info.valid && <p className={css.mutedLine}>{t('service.banner.ask')}</p>}
        </div>
      )}
      <div className={css.composer}>
        {images.length > 0 && (
          <AttachmentRail
            items={images.map(image => ({
              id: image.id,
              previewUrl: image.previewUrl,
              alt: image.file.name === '' ? t('service.image') : image.file.name,
              removeLabel: t('service.attach.remove'),
              image,
            }))}
            labels={{
              group: t('service.attach.group'),
              open: t('service.attach.open'),
              scrollLeft: t('service.attach.left'),
              scrollRight: t('service.attach.right'),
            }}
            onOpen={(item) => { setPreview(item.image) }}
            onRemove={(item) => { removeImage(item.id) }}
          />
        )}
        {paneError !== null && <p className={css.errorNotice} role="alert">{paneError}</p>}
        <div className={css.inputRow}>
          <button
            type="button"
            className={css.attach}
            aria-label={t('service.attach')}
            disabled={disabled}
            onClick={() => { fileInput.current?.click() }}
          >
            <IconPlusOutline16 size={16} />
          </button>
          <input
            ref={fileInput}
            className={css.fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            onChange={(event) => {
              addFiles([...event.target.files ?? []])
              event.target.value = ''
            }}
          />
          <textarea
            className={css.input}
            rows={2}
            placeholder={t('service.placeholder')}
            value={draft}
            disabled={disabled}
            onChange={(event) => { setDraft(event.target.value) }}
            onPaste={(event) => {
              const files = [...event.clipboardData.files]
              if (files.length > 0) {
                event.preventDefault()
                addFiles(files)
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void send()
              }
            }}
          />
        </div>
        <div className={css.composerActions}>
          {running && binding !== null && (
            <button
              type="button"
              className={css.secondary}
              onClick={() => { void binding.session.cancel() }}
            >
              {t('service.stop')}
            </button>
          )}

          <button
            type="button"
            className={css.send}
            disabled={disabled || (draft.trim() === '' && images.length === 0)}
            onClick={() => { void send() }}
          >
            {t('service.send')}
          </button>
        </div>
      </div>
      {preview !== null && (
        <ImageLightbox
          src={preview.previewUrl}
          alt={preview.file.name === '' ? t('service.image') : preview.file.name}
          labels={{ dialog: t('service.attach.open'), close: t('panel.close') }}
          onClose={() => { setPreview(null) }}
        />
      )}
    </div>
  )
}

/** Live running flag for one optional binding (subscribes only while bound). */
function useRunning(binding: SessionBinding | null): boolean {
  const [running, setRunning] = useState(false)
  useEffect(() => {
    if (binding === null) {
      setRunning(false)
      return
    }
    const read = (): void => { setRunning(binding.session.getSnapshot().running) }
    read()
    return binding.session.subscribe(read)
  }, [binding])
  return running
}
