// @vitest-environment jsdom
/**
 * The tool rail's Terminal pane: the same grid over one plain shell. The open
 * asks the host for a bare shell under the pane's fixed key (no launch
 * command, no chat), and the shell survives the pane's unmounts, so reopening
 * the pane reattaches instead of opening a second shell.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { disposeTerminals, type StreamEvent, type TerminalTransport } from '../src/client/TerminalView.tsx'
import { createTerminalPane, PANE_KEY } from '../src/client/TerminalPane.tsx'

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

function recorder() {
  const opens: Parameters<TerminalTransport['open']>[0][] = []
  const transport: TerminalTransport = {
    open: (input) => {
      opens.push(input)
      return Promise.resolve({ id: `t${String(opens.length)}` })
    },
    stream: (_id: string, onEvent: (event: StreamEvent) => void) => {
      onEvent({ kind: 'replay', data: '' })
      return () => {}
    },
    input: () => {},
    resize: () => {},
    close: () => Promise.resolve(),
  }
  return { transport, opens }
}

afterEach(() => {
  cleanup()
  disposeTerminals()
})

describe('TerminalPane', () => {
  it('opens one plain shell under the pane key, in the given directory', async () => {
    const { transport, opens } = recorder()
    const Pane = createTerminalPane(key => key)
    await act(async () => { render(<Pane cwd="/tmp/project" transport={transport} />) })
    expect(opens).toEqual([{ key: PANE_KEY, cwd: '/tmp/project', activity: undefined, cols: 80, rows: 24, plain: true }])
  })

  it('reattaches to the same shell when the pane is closed and reopened', async () => {
    const { transport, opens } = recorder()
    const Pane = createTerminalPane(key => key)
    const view = await act(async () => render(<Pane cwd={undefined} transport={transport} />))
    view.unmount()
    await act(async () => { render(<Pane cwd={undefined} transport={transport} />) })
    expect(opens).toHaveLength(1)
    expect(opens[0]?.cwd).toBeUndefined()
  })
})
