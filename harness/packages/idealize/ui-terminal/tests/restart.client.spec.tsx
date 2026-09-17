// @vitest-environment jsdom
/**
 * Restarting one chat's shell on another brain: the running shell is ended
 * before the reopen (the host reattaches by chat key, so a reopen any sooner
 * hands back the same process), and the fresh shell opens on the NEW brain —
 * the chat's own preset is fixed once it has started, so the summary cannot
 * report the brain that was just chosen.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import {
  closeTerminal, disposeTerminals, restartTerminal, SURFACE_EXEMPT, TerminalView, type StreamEvent, type TerminalTransport,
} from '../src/client/TerminalView.tsx'
import { SURFACE_EXEMPT_ATTRIBUTE } from '@idealize/appearance/src/surface-css.ts'

// jsdom paints nothing, so xterm's renderer has no dimensions and its fit
// addon throws on the first measure. The grid itself is not under test here —
// which shell is open, and on which brain, is.
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80
    rows = 24
    options: Record<string, unknown> = {}
    element: HTMLElement | undefined
    loadAddon(): void {}
    open(host: HTMLElement): void { this.element = host.appendChild(document.createElement('div')) }
    focus(): void {}
    write(): void {}
    dispose(): void {}
    onData(): { dispose: () => void } { return { dispose: () => {} } }
  },
}))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit(): void {} } }))

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    disconnect(): void {}
  })
})

interface Opened {
  key: string
  activity: string | undefined
}

function recorder(): { transport: TerminalTransport; opens: Opened[]; closed: string[] } {
  const opens: Opened[] = []
  const closed: string[] = []
  const transport: TerminalTransport = {
    open: (input) => {
      opens.push({ key: input.key, activity: input.activity })
      return Promise.resolve({ id: `t${String(opens.length)}` })
    },
    stream: (_id: string, onEvent: (event: StreamEvent) => void) => {
      onEvent({ kind: 'replay', data: '' })
      return () => {}
    },
    input: () => {},
    resize: () => {},
    close: (id: string) => {
      closed.push(id)
      return Promise.resolve()
    },
  }
  return { transport, opens, closed }
}

const t = (key: string): string => key

afterEach(() => {
  cleanup()
  disposeTerminals()
})

describe('restartTerminal', () => {
  it('ends the running shell, then reopens it on the chosen brain', async () => {
    const { transport, opens, closed } = recorder()
    await act(async () => {
      render(<TerminalView sessionId="s1" cwd="/tmp" activity="coding" transport={transport} t={t as never} />)
    })
    expect(opens).toEqual([{ key: 's1', activity: 'coding' }])

    await act(async () => { await restartTerminal('s1', 'design') })

    // Closed before reopened: the second open must not be handed the first shell.
    expect(closed).toEqual(['t1'])
    expect(opens).toEqual([
      { key: 's1', activity: 'coding' },
      { key: 's1', activity: 'design' },
    ])
  })

  it('leaves other chats alone', async () => {
    const { transport, opens, closed } = recorder()
    await act(async () => {
      render(<TerminalView sessionId="s1" cwd="/tmp" activity="coding" transport={transport} t={t as never} />)
    })
    await act(async () => { await restartTerminal('s2', 'design') })
    expect(closed).toEqual([])
    expect(opens).toHaveLength(1)
  })

  it('remembers the brain for a shell opened after the restart', async () => {
    const { transport, opens } = recorder()
    await act(async () => { await restartTerminal('s3', 'design') })
    await act(async () => {
      render(<TerminalView sessionId="s3" cwd="/tmp" activity="coding" transport={transport} t={t as never} />)
    })
    expect(opens).toEqual([{ key: 's3', activity: 'design' }])
  })
})

describe('surface exemption', () => {
  it('keeps the hosting surface\'s face, weight and tracking off the grid, which put a selection 100px from the pointer', async () => {
    const { transport } = recorder()
    let container!: HTMLElement
    await act(async () => {
      ({ container } = render(<TerminalView sessionId="s1" cwd="/tmp" activity="coding" transport={transport} t={t as never} />))
    })
    expect(SURFACE_EXEMPT).toBe(SURFACE_EXEMPT_ATTRIBUTE)
    expect(container.querySelector('[data-testid="idealize-terminal"]')?.hasAttribute(SURFACE_EXEMPT_ATTRIBUTE)).toBe(true)
  })
})

describe('closeTerminal', () => {
  it('ends an archived chat\'s shell and does not reopen it', async () => {
    const { transport, opens, closed } = recorder()
    await act(async () => {
      render(<TerminalView sessionId="s1" cwd="/tmp" activity="coding" transport={transport} t={t as never} />)
    })
    await act(async () => { await closeTerminal('s1') })
    expect(closed).toEqual(['t1'])
    expect(opens).toHaveLength(1)
  })

  it('is a no-op for a chat that never opened a shell here', async () => {
    const { closed } = recorder()
    await act(async () => { await closeTerminal('never') })
    expect(closed).toEqual([])
  })
})
