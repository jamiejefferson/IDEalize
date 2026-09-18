/**
 * Browser entry of the terminal resize proof page (bundled by
 * `resize-proof.mts`, never shipped). It mounts the REAL {@link TerminalView}
 * inside the REAL conversation column styles (`ConversationRoot.module.css`:
 * root, scroll body, view area), or the REAL {@link createTerminalPane} inside
 * a drawer-like flex column, over a transport that stands in for the desktop
 * shell's PTY.
 *
 * The stand-in behaves like a full-screen TUI: every size it is told, it
 * clears the grid and draws an ask bar on the last row of THAT size. A grid the
 * PTY was not told about therefore shows its ask bar on the wrong row, and the
 * proof reads which row carries it.
 *
 * Query: `?layout=chat|pane`, and `&font=late` to open on a face that arrives
 * after the grid. The page exposes `window.__proof` for the driver.
 */
import { createRoot } from 'react-dom/client'
import type { TerminalPaint } from '@idealize/appearance/client'
import conversation from '../../../client/ui-conversation/src/client/skeleton/ConversationRoot.module.css'
import { applyTerminalPaint, TerminalView } from '../src/client/TerminalView.tsx'
import type { StreamEvent, TerminalTransport } from '../src/client/TerminalView.tsx'
import { createTerminalPane } from '../src/client/TerminalPane.tsx'

const ASK_BAR = '> ASK-BAR'

interface ProofWindow {
  __proof: {
    /** Every size the PTY stand-in was told, in order. */
    resizes: { cols: number; rows: number }[]
    /** The size the stand-in opened at. */
    opened: { cols: number; rows: number } | undefined
    paint: (patch: Partial<TerminalPaint>) => void
  }
}

const PAINT: TerminalPaint = {
  background: '#F7F5F0',
  foreground: '#2A2A27',
  cursor: '#B67A12',
  selection: '#E7E0D1',
  ansi: Array.from({ length: 16 }, () => '#555555'),
  fontFamily: 'Menlo, monospace',
  fontSize: 14,
  lineHeight: 1.2,
  margin: 16,
}

let emit: ((event: StreamEvent) => void) | undefined

/** Draw the TUI for one size: a cleared screen, a header, the ask bar on the last row. */
function draw(cols: number, rows: number): void {
  emit?.({ kind: 'data', data: `[2J[H${String(cols)}x${String(rows)}[${String(rows)};1H${ASK_BAR}` })
}

const proof: ProofWindow['__proof'] = {
  resizes: [],
  opened: undefined,
  paint: (patch) => { applyTerminalPaint({ ...PAINT, ...patch }) },
}
;(window as unknown as ProofWindow).__proof = proof

const transport: TerminalTransport = {
  open: (input) => {
    proof.opened = { cols: input.cols, rows: input.rows }
    return Promise.resolve({ id: 'proof' })
  },
  stream: (_id, onEvent) => {
    emit = onEvent
    const size = proof.resizes.at(-1) ?? proof.opened
    if (size !== undefined) draw(size.cols, size.rows)
    return () => { emit = undefined }
  },
  input: () => {},
  resize: (_id, cols, rows) => {
    proof.resizes.push({ cols, rows })
    draw(cols, rows)
  },
  close: () => Promise.resolve(),
}

const t = (key: string): string => key
const params = new URLSearchParams(window.location.search)
const layout = params.get('layout') ?? 'chat'
// `ProofLate` is a face the proof host serves after a delay.
if (params.get('font') === 'late') PAINT.fontFamily = '"ProofLate", Menlo, monospace'
const Pane = createTerminalPane(t)

applyTerminalPaint(PAINT)

const stage = document.getElementById('stage')
if (stage === null) throw new Error('no stage')
createRoot(stage).render(
  layout === 'pane'
    ? (
      <div data-proof-frame="" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
        <Pane cwd={undefined} transport={transport} />
      </div>
    )
    : (
      <div className={conversation.root} data-phase="active" data-idealize-surface="chat">
        <div className={conversation.scrollBody} data-proof-frame="">
          <div data-slot="conversation.session" style={{ display: 'contents' }}>
            <div className={conversation.viewArea}>
              <div data-slot="conversation.view" style={{ display: 'contents' }}>
                <TerminalView sessionId="proof" cwd={undefined} transport={transport} t={t} />
              </div>
            </div>
          </div>
        </div>
      </div>
    ),
)
