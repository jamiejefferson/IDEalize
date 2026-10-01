// @vitest-environment jsdom
// The router's line in the transcript (JJ, 30 Sep 2026: "I want to be able to
// see it inline in the chat"): each idealize/router event folds into a keyed
// chat node anchored on the event, and the line says what the router did.
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { ConversationMatch, ConversationNodeContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatNode, ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { RouterEventData } from '@idealize/router/client'
import { routerNoteDefinition, routerNoteView } from '../src/client/index.ts'
import { en } from '../src/client/locales.ts'

const t = makeTranslate(en) as Parameters<typeof routerNoteView>[0]
const RouterNoteView = routerNoteView(t)

const astra = { provider: 'openai-codex', model: 'gpt-6-astra', label: 'GPT-6 Astra' }
const spark = { provider: 'openai-codex', model: 'gpt-5.3-codex-spark', label: 'GPT-5.3 Codex Spark' }
const opus = { provider: 'openrouter', model: 'anthropic/claude-opus', label: 'Claude Opus' }

function event(data: RouterEventData, seq = 12): SessionEvent {
  return { type: 'idealize/router', seq, time: 0, data }
}

/** Fold one event through match/start/buildViewNode as the assembler would. */
function nodeFor(from: SessionEvent): ChatNode<'router-note'> {
  const matched = routerNoteDefinition.match(from)
  if (matched === null) throw new Error('event did not match')
  const match = { event: from, role: matched.role, location: { kind: 'unresolved' } } as unknown as ConversationMatch
  const base = {
    key: `8:router-note${matched.id}`, kind: 'router-note', id: matched.id, matches: [match], start: match, state: undefined, current: new Map(),
  } as unknown as ConversationNodeContext<RouterEventData>
  const state = routerNoteDefinition.start(base, match, { previous: () => undefined })
  const node = routerNoteDefinition.buildViewNode?.({ ...base, state })
  if (node === null || node === undefined) throw new Error('definition built no node')
  return node as ChatNode<'router-note'>
}

const mount = (node: ChatNode<'router-note'>) => render(<RouterNoteView {...({ node } as ChatNodeViewProps<'router-note'>)} />)

afterEach(cleanup)

describe('the router note in the transcript', () => {
  it('ignores every other event, and keys each router event by its place in the log', () => {
    expect(routerNoteDefinition.match({ type: 'turn/start', seq: 1, time: 0, data: { turn: 1 } })).toBeNull()
    const first = nodeFor(event({ outcome: 'switched', at: '', from: astra, to: spark }, 12))
    const second = nodeFor(event({ outcome: 'reset', at: '', from: spark, to: astra }, 20))
    expect(first.id).not.toBe(second.id)
    expect(first.anchorSeq).toBe(12)
  })

  it('names both models of a switch and gives the router\'s reason', () => {
    const view = mount(nodeFor(event({
      outcome: 'switched', at: '', from: astra, to: spark, task: 'quick',
      rationale: 'GPT-5.3 Codex Spark handles a quick answer as well as GPT-6 Astra, and free.',
    })))
    const note = view.container.querySelector('[data-router-note="switched"]')!
    expect(note.textContent).toContain('Switched from GPT-6 Astra to GPT-5.3 Codex Spark for this reply.')
    expect(note.textContent).toContain('handles a quick answer as well as GPT-6 Astra, and free.')
  })

  it('says why an offer was left to the person, and when the chat is back on its own model', () => {
    const offer = mount(nodeFor(event({ outcome: 'offer', at: '', from: astra, to: opus, reason: 'needs-payment' })))
    expect(offer.container.textContent).toBe('⇄Claude Opus suits this work better. It is a paid model, so the choice is yours.')
    cleanup()
    const back = mount(nodeFor(event({ outcome: 'reset', at: '', from: spark, to: astra })))
    expect(back.container.querySelector('[data-router-note="reset"]')?.textContent).toBe('⇄Back on GPT-6 Astra.')
  })
})
