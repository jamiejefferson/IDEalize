/**
 * Browser entry of the blueprint paper proof page (bundled by
 * `paper-proof.mts`, never shipped). It mounts the REAL {@link TerminalView}
 * over a transport that prints a fixed session in the theme's ANSI colours,
 * and paints it from the REAL `resolveTerminalPaint`, so the page shows what
 * the app draws for a blueprint theme. The driver picks the theme and any
 * paper adjustments through `window.__proof.paint`.
 */
import { createRoot } from 'react-dom/client'
import { TERMINAL_DEFAULTS, type TerminalAppearanceSettings } from '../../appearance/src/appearance-settings.ts'
import { resolveTerminalPaint } from '../../appearance/src/terminal-themes.ts'
import { applyTerminalPaint, TerminalView } from '../src/client/TerminalView.tsx'
import type { StreamEvent, TerminalTransport } from '../src/client/TerminalView.tsx'

const ESC = String.fromCharCode(27)
const sgr = (code: number, text: string): string => `${ESC}[${String(code)}m${text}${ESC}[0m`
const prompt = `${sgr(90, 'jamie@idealize ~/dev/idealize')} ${sgr(36, '%')} `
const SESSION = [
  `${prompt}git status --short`,
  ' M packages/idealize/appearance/src/terminal-themes.ts',
  ' A packages/idealize/appearance/src/blueprint-paper.ts',
  sgr(31, '?? .DS_Store'),
  '',
  `${prompt}pnpm --filter appearance test`,
  sgr(90, '  RUN  v4.1.8 ~/dev/idealize/packages/idealize/appearance'),
  `  ${sgr(32, '✓')} tests/terminal-themes.client.spec.ts (17 tests) 38ms`,
  `  ${sgr(32, '✓')} tests/panel.client.spec.tsx (24 tests) 412ms`,
  sgr(31, '  ✗ tests/blueprint-paper.client.spec.ts (1 failed) 9ms'),
  sgr(31, '    AssertionError: expected grid opacity 24 to be at most 20'),
  '',
  // A block in an exact colour, as Claude Code paints its buttons.
  `  ${ESC}[48;2;55;55;55m Jump to bottom (click) ${ESC}[0m`,
  '',
  `${sgr(33, 'yellow')} ${sgr(34, 'blue')} ${sgr(35, 'magenta')} ${sgr(36, 'cyan')} ${sgr(92, 'bright green')} ${sgr(94, 'bright blue')} ${sgr(7, ' inverse ')}`,
  '',
  `${prompt}yes, commit it `,
].join('\r\n')

const transport: TerminalTransport = {
  open: () => Promise.resolve({ id: 'proof' }),
  stream: (_id, onEvent: (event: StreamEvent) => void) => {
    onEvent({ kind: 'data', data: SESSION })
    return () => {}
  },
  input: () => {},
  resize: () => {},
  close: () => Promise.resolve(),
}

const paint = (patch: Partial<TerminalAppearanceSettings>): void => {
  applyTerminalPaint(resolveTerminalPaint({ ...TERMINAL_DEFAULTS, fontName: 'DM Mono', fontSize: 13, lineSpacing: 1.3, margin: 26, ...patch }))
}
;(window as unknown as { __proof: { paint: typeof paint } }).__proof = { paint }
paint({ theme: 'blueprint-cyanotype' })

const stage = document.getElementById('stage')
if (stage === null) throw new Error('no stage')
// The strip above stands in for the chat's header, which reads the same variables through
// ui-conversation's `.header[data-view='terminal']` rule.
createRoot(stage).render(
  <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
    <div data-proof-header="" style={{ flex: 'none', height: 67, padding: '18px 40px 0', boxSizing: 'border-box', font: '800 28px system-ui', color: 'var(--dsh-terminal-fg)', background: 'var(--dsh-terminal-header, var(--dsh-terminal-bg))' }}>
      Blueprint proof
    </div>
    <div style={{ flex: '1 1 auto', minHeight: 0 }}>
      <TerminalView sessionId="proof" cwd={undefined} transport={transport} t={(key: string) => key} />
    </div>
  </div>,
)
