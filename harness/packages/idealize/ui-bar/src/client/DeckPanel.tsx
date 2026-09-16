/**
 * The deck occupant: the file viewer in its own resizable column
 * (shell.deck), beside the files drawer — V0's separate document panel.
 * Reads the bar's view store; the file to show is store state so the files
 * tree (drawer) and this panel stay one fact apart.
 */
import { useEffect, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { BarViewStore } from './bar-store.ts'
import { FileViewer } from './FileViewer.tsx'

/** Registration-side face: the view store plus the close transition (index.ts owns the write). */
export interface DeckPanelInjected {
  hooks: {
    /** The bar's view state (arrives as the `useBarView` selector hook). */
    barView: BarViewStore
  }
  /** Close the deck column and clear the open file. */
  closeFile: () => void
  /** Hand a file's path to the active chat's composer; false = no active chat. */
  addToChat: (path: string) => boolean
}

export type DeckPanelProps = PropsRuntime<'shell.deck'>
  & PropsLocale<'idealize-bar'>
  & InjectFace<DeckPanelInjected>

interface Capabilities {
  reveal: boolean
}

export function DeckPanel({ useBarView, closeFile, addToChat, t }: DeckPanelProps) {
  const file = useBarView(state => state.file)
  const [canReveal, setCanReveal] = useState(false)

  useEffect(() => {
    let cancelled = false
    void fetch('/idealize/bar/capabilities')
      .then(response => response.json() as Promise<Capabilities>)
      .then((body) => { if (!cancelled) setCanReveal(body.reveal) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  if (file === null) return null
  return (
    <FileViewer
      path={file}
      canReveal={canReveal}
      onAddToChat={addToChat}
      onClose={closeFile}
      t={t}
    />
  )
}
