// @vitest-environment jsdom
/**
 * A still-blank chat normally renders no session body (the hero owns the
 * screen). When the active view is not Chat — a welcome-card launch into
 * Terminal, Gallery or Sound Stage — the body renders that view full-height
 * with `data-blank-view` carrying that view's id. The header stays hidden as
 * it is for the hero: the ring renders no tab row, because a chat's view is
 * fixed by its space and there is no way back to offer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import {
  ConversationSession, ConversationSessionHeader,
  type ConversationSessionHeaderProps, type ConversationSessionProps,
} from '../src/client/skeleton/ConversationSession.tsx'
import { createChatStore } from '../src/client/stores.ts'

const SID = 's1' as SessionId

afterEach(cleanup)
// The chat store persists under its declared key; clear so one case's active
// view cannot rehydrate into the next.
beforeEach(() => { localStorage.clear() })

function mountBlank() {
  const chat = createChatStore().create()
  const useSession = bindSnapshotSelector(
    createSnapshotStore({ blank: true, composerPhase: 'blank' as const }),
  ) as unknown as ConversationSessionProps['useSession']
  const useSessions = bindSnapshotSelector(
    createSnapshotStore({ ids: [], byId: {}, current: undefined }),
  ) as unknown as ConversationSessionHeaderProps['useSessions']
  const useInput = bindSnapshotSelector(createSnapshotStore({ draft: '' }))
  const views = {
    list: () => [{ id: 'chat', label: 'Chat' }, { id: 'terminal', label: 'Terminal' }],
    subscribe: () => () => {},
    version: () => 1,
  }
  const renderSlot = ((_key: string, _owner: object, opts?: { only?: string }): ReactNode =>
    <div data-testid={`view-${opts?.only ?? 'none'}`} />)
  const view = render(
    <>
      <ConversationSessionHeader
        {...({
          sessionId: SID, useSession, useSessions,
          useStore: bindSnapshotSelector(chat), actions: chat.actions,
          renderSlot: () => null, views, open: vi.fn(), t: (key: string) => key,
        } as unknown as ConversationSessionHeaderProps)}
      />
      <ConversationSession
        {...({
          sessionId: SID, useSession, useSessions,
          useStore: bindSnapshotSelector(chat), actions: chat.actions,
          renderSlot, views, useInput, inputActions: { setDraft: vi.fn() },
          bindDraftMirror: () => () => {}, releaseSessionImages: vi.fn(),
        } as unknown as ConversationSessionProps)}
      />
    </>,
  )
  return { view, chat }
}

describe('blank session view area', () => {
  it('renders nothing on the Chat view (the hero owns the screen) and hides the header', () => {
    const { view } = mountBlank()
    expect(view.queryByTestId('view-chat')).toBeNull()
    expect(view.container.querySelector('header')!.getAttribute('aria-hidden')).toBe('true')
  })

  it('renders a non-chat view with data-blank-view, header still hidden and no tab row', async () => {
    const { view, chat } = mountBlank()
    await act(async () => { chat.actions.setView('terminal') })
    const body = view.getByTestId('view-terminal')
    // The mark carries the ACTIVE VIEW'S ID: a view that owns its whole column
    // suppresses the composer seat from its own package by matching on it.
    expect(body.parentElement!.getAttribute('data-blank-view')).toBe('terminal')
    expect(view.container.querySelector('header')!.getAttribute('aria-hidden')).toBe('true')
    expect(view.queryAllByRole('tab')).toHaveLength(0)
    expect(view.container.querySelector('[role="tablist"]')).toBeNull()

    // A store write back to Chat restores the hero: the body returns null again.
    await act(async () => { chat.actions.setView('chat') })
    expect(view.queryByTestId('view-terminal')).toBeNull()
    expect(view.container.querySelector('header')!.getAttribute('aria-hidden')).toBe('true')
  })
})
