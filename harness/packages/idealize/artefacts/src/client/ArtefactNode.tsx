/**
 * The artefact chat node renderer: an inline image for `image/*`, an audio
 * element for `audio/*`, and a generic card otherwise; failures render the
 * provider cause. Media loads through the loopback raw route by artefact id,
 * so the renderer stays a pure function of the node payload.
 */

import { useEffect } from 'react'
import type { CSSProperties } from 'react'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ArtefactChatData } from './node.ts'
import { announceArtefact } from './reveal.ts'

/** The raw-route URL for one artefact id (same origin as the serving host). */
function rawUrl(id: string): string {
  return `/idealize/artefacts/raw?id=${encodeURIComponent(id)}`
}

/** `123456` bytes as a short human figure. */
function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return ''
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const cardStyle: CSSProperties = {
  border: '1px solid var(--dsw-border, #d0d0d0)',
  borderRadius: 8,
  padding: '8px 12px',
  margin: '4px 0',
  maxWidth: 480,
  fontSize: 13,
}

function GenericCard({ data }: { data: ArtefactChatData }) {
  return (
    <div style={cardStyle} data-artefact-card={data.mediaType}>
      <div>{data.relPath ?? data.id}</div>
      <div style={{ opacity: 0.7 }}>{data.mediaType}{data.bytes === undefined ? '' : ` · ${formatBytes(data.bytes)}`}</div>
    </div>
  )
}

/** Keyed `conversation.chat.node` renderer for `kind: 'artefact'`. */
export function ArtefactNodeView({ node }: ChatNodeViewProps<'artefact'>) {
  const data = node.data
  // The file is on disk once its node is in the transcript; the Files pane
  // re-lists on the announcement, so a new folder (the first video) shows.
  useEffect(() => {
    if (data.status === 'created' && data.relPath !== undefined) announceArtefact(data.relPath)
  }, [data.status, data.relPath])
  if (data.status === 'failed') {
    return (
      <div style={{ ...cardStyle, borderColor: 'var(--dsw-danger, #c0392b)' }} role="alert" data-artefact-failed={data.id}>
        <div>Artefact generation failed ({data.mediaType})</div>
        <div style={{ opacity: 0.8 }}>{data.error}</div>
      </div>
    )
  }
  if (data.mediaType.startsWith('image/')) {
    return (
      <img
        src={rawUrl(data.id)}
        alt={data.relPath ?? data.id}
        style={{ maxWidth: 480, maxHeight: 360, borderRadius: 8, margin: '4px 0', display: 'block' }}
      />
    )
  }
  if (data.mediaType.startsWith('audio/')) {
    // The caption keeps the artefact identifiable when the element has no visual body.
    return (
      <div style={{ margin: '4px 0' }}>
        <audio controls src={rawUrl(data.id)} style={{ display: 'block', maxWidth: 480 }} />
        <span style={{ fontSize: 12, opacity: 0.7 }}>{data.relPath ?? data.id} · {formatBytes(data.bytes)}</span>
      </div>
    )
  }
  return <GenericCard data={data} />
}
