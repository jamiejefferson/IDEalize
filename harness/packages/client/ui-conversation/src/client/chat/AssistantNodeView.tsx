import { memo, useMemo } from 'react'
import type { ChatNodeViewProps, TurnTailOwnerProps } from '../contract/slots.ts'
import type { MarkdownFileMentions } from '@deepseek-ai/dsh-client-ui-primitives'
import { AssistantMarkdown } from './AssistantMarkdown.tsx'

/**
 * One resolver over two, the first that recognizes a token answering it.
 * @param first - The higher-priority vocabulary, when there is one.
 * @param second - The fallback vocabulary, when there is one.
 * @returns The composed resolver, the only one present, or undefined.
 */
export function firstResolving(
  first: MarkdownFileMentions | undefined,
  second: MarkdownFileMentions | undefined,
): MarkdownFileMentions | undefined {
  if (first === undefined) return second
  if (second === undefined) return first
  return { resolve: value => first.resolve(value) ?? second.resolve(value) }
}

/** Streaming, settled, and interrupted Assistant states share one keyed renderer instance. */
export const AssistantNodeView = memo(function AssistantNodeView({
  node, useTurnData, openFile, loadImage, fileMentions, fileLinks, t,
}: ChatNodeViewProps<'assistant-step'>) {
  const data = node.data
  const turn = node.location.kind === 'turn' || node.location.kind === 'step'
    ? node.location.turn
    : undefined
  const tail = useTurnData('turn-tail')
  const owner = useMemo<TurnTailOwnerProps | undefined>(() => {
    if (turn?.status !== 'closed' || data.finalNode === undefined) return undefined
    if (tail?.closing?.finalNode.seq !== data.finalNode.seq) return undefined
    return { turn, seq: data.finalNode.seq, openFile }
  }, [data.finalNode, openFile, tail, turn])
  // The closing message's produced files win; any message's prose paths the
  // in-app viewer shows come next.
  const mentions = useMemo(
    () => firstResolving(owner === undefined ? undefined : fileMentions(owner), fileLinks),
    [fileMentions, fileLinks, owner],
  )
  return (
    <AssistantMarkdown
      blocks={data.blocks}
      streaming={data.status === 'running'}
      interrupted={data.status === 'interrupted'}
      loadImage={loadImage}
      mentions={mentions}
      t={t}
    />
  )
})
