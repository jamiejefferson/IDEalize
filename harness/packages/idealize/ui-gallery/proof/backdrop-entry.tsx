/**
 * Browser entry of the Studio backdrop proof page (bundled by
 * `backdrop-proof.mts`, never shipped). It mounts the REAL {@link GalleryView}
 * inside the conversation frame's own layout: the markup `ConversationRoot`
 * writes, styled by its REAL stylesheet, so the title strip floats, the body
 * scrolls and the message box's seat sticks to the foot with tiles passing
 * under it, as in the app. The message box is the app's REAL `InputBar` with
 * the Studio's REAL settings strip on its tool row, and the page loads the
 * app's REAL colour tokens (`design-platform.css`), so a control that keeps a
 * fill of its own shows it here as it does in the app. The buttons other
 * packages seat on the right of the tool row and the stats line are stand-ins
 * painted with the app's tokens. It seats the REAL backdrop layers from
 * `@idealize/ui-studio` and paints them from the REAL `resolveStudioPaint`.
 * The driver picks the backdrop and any adjustments through
 * `window.__proof.paint`.
 */
import { createRoot } from 'react-dom/client'
import { resolveStudioPaint, STUDIO_DEFAULTS, type StudioAppearanceSettings } from '../../appearance/src/appearance-settings.ts'
import { applyStudioBackdrop, StudioBackdropLayers } from '../../ui-studio/src/client/backdrop.tsx'
import { GalleryView } from '../src/client/GalleryView.tsx'
import type { GalleryViewProps } from '../src/client/GalleryView.tsx'
import { setBackdropLayers } from '../src/client/backdrop.tsx'
import type { GalleryRow, GalleryTurn } from '../src/client/contract.ts'
import { en } from '../src/client/locales.ts'
import frame from '../../../client/ui-conversation/src/client/skeleton/ConversationRoot.module.css'
import '../../../client/ui-theme/src/styles/design-platform.css'
import { useSyncExternalStore } from 'react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { InputBar } from '../../../client/ui-conversation/src/client/skeleton/InputBar.tsx'
import type { InputBarProps } from '../../../client/ui-conversation/src/client/skeleton/InputBar.tsx'
import { SessionInputShell } from '../../../client/ui-conversation/src/client/input/facade.ts'
import { en as conversationEn } from '../../../client/ui-conversation/src/client/locales.ts'
import { GenerationSettings } from '../src/client/GenerationSettings.tsx'
import type { GenerationSettingsProps } from '../src/client/GenerationSettings.tsx'

const sound = (callId: string, seq: number, prompt: string): GalleryRow => ({
  callId, toolName: 'generate_sound', artefactKind: 'audio', prompt, settings: {}, status: 'done', startedAt: 1_700_000_000_000 + seq, startSeq: seq, turn: seq,
  artefacts: [{ id: `artefact-${callId}`, mediaType: 'audio/mpeg', bytes: 2048, relPath: `Sounds/${callId}.mp3`, archived: false }],
} as GalleryRow)
const PROMPTS = [
  'An 8-second cheerful cartoon dance soundtrack for a bunny video: upbeat electro-pop with bright marimba and playful synth bass.',
  'Create an audio-only soundscape using performance and sound-effect cues. Do not narrate the cue text.',
]
// Enough tiles to fill the column several times over, so some always sit under the message box.
const ROWS: GalleryRow[] = Array.from({ length: 18 }, (_, index) => sound(`row-${String(index)}`, 2 + index * 2, PROMPTS[index % 2] ?? ''))
// The newest sound carries a router's note, as a tile does when its model was changed.
ROWS[17] = { ...ROWS[17], note: 'Elevenlabs Tts Eleven V3 cannot take this request. Changed to ElevenLabs TTS Multilingual v2.' } as GalleryRow
// One generation that failed, and one sound the person archived.
ROWS.push({ callId: 'failed', toolName: 'generate_sound', artefactKind: 'audio', prompt: 'a thunderclap', settings: {}, status: 'failed', error: 'The provider refused this request.', startedAt: 1_700_000_000_050, startSeq: 50, turn: 50, artefacts: [] } as unknown as GalleryRow)
ROWS[3] = { ...ROWS[3], artefacts: (ROWS[3]?.artefacts ?? []).map(artefact => ({ ...artefact, archived: true })) } as GalleryRow
const TURNS: GalleryTurn[] = [
  {
    turn: 60, startSeq: 60, startedAt: 1_700_000_000_060, prompt: 'hand the soundtrack over', phase: 'no-generation', callIds: [],
    reply: 'I have handed the soundtrack replacement to the Documents agent, which has the required video-editing access. The existing files remain untouched.',
  } as unknown as GalleryTurn,
  { turn: 61, startSeq: 61, startedAt: 1_700_000_000_061, prompt: 'replace the current soundtrack with the new one', phase: 'thinking', callIds: [], reply: '' } as GalleryTurn,
]

const dictionary: Record<string, string> = en
const t = ((key: string, params?: Record<string, unknown>): string => {
  let text = dictionary[key] ?? key
  for (const [name, value] of Object.entries(params ?? {})) text = text.replace(`{${name}}`, String(value))
  return text
}) as GalleryViewProps['t']
const useSession = (<T,>(selector: (state: { views: { get: (target: string) => unknown } }) => T): T =>
  selector({ views: { get: () => ({ rows: ROWS, turns: TURNS }) } })) as unknown as GalleryViewProps['useSession']

setBackdropLayers(StudioBackdropLayers)
const paint = (patch: Partial<StudioAppearanceSettings>): void => {
  applyStudioBackdrop(resolveStudioPaint({ ...STUDIO_DEFAULTS, ...patch }))
}
;(window as unknown as { __proof: { paint: typeof paint } }).__proof = { paint }

// The app's message box, on a real input machine with an empty session behind it.
interface Store<S> { getSnapshot: () => S; subscribe: (listener: () => void) => () => void }
const bind = <S,>(store: Store<S>) => <T,>(selector: (state: S) => T): T =>
  useSyncExternalStore(listener => store.subscribe(listener), () => selector(store.getSnapshot()))
const SID = 'proof'
const session = createSnapshotStore({
  sessionId: SID, views: { get: () => undefined }, chat: {}, nodes: [], turnTimings: new Map(), turnEnds: new Map(),
  partial: null, runningCalls: [],
  pending: [], queue: [], running: false, composerPhase: 'active', removed: false, openState: 'open', openError: null, hasMore: false,
  loadingOlder: false, promptError: null, blank: false, subagent: null, lastAgentError: null,
})
const shell = new SessionInputShell({
  actx: {}, defaultSink: () => undefined,
  queue: { getSnapshot: () => session.getSnapshot().queue, subscribe: (fn: () => void) => session.subscribe(fn) },
} as unknown as ConstructorParameters<typeof SessionInputShell>[0])
const conversationText: Record<string, string> = conversationEn
const tc = ((key: string): string => conversationText[key] ?? key) as unknown as InputBarProps['t']
const chat = createSnapshotStore<{ view: string | null }>({ view: 'soundstage' })
const strip = {
  useStore: bind(chat), actions: { setView: (view: string) => { chat.update((draft) => { draft.view = view }) } }, sessionId: SID,
  useInput: bind(shell.state), inputActions: shell.actions, t,
} as unknown as GenerationSettingsProps
/** A stand-in for a button another package seats on the tool row, painted with the app's tokens. */
const toolButton = (label: string, background: string) => (
  <button type="button" data-proof-tool="" style={{ width: 32, height: 32, border: 0, borderRadius: 16, background, color: 'var(--dsw-alias-label-primary)', font: '14px system-ui' }}>{label}</button>
)
const bar = {
  sessionId: SID, SessionProvider: ({ children }: { children: (id: string) => unknown }) => children(SID), useSession: bind(session),
  useSessions: bind(createSnapshotStore({ ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined })),
  useWorkspaces: bind(createSnapshotStore({ items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null, baselinesReady: true, recentWorkspaceId: undefined })),
  useProjection: (_key: string, selector?: (value: unknown) => unknown) => (selector ?? ((value: unknown) => value))(undefined),
  useInput: bind(shell.state), inputActions: shell.actions, keyboard: shell,
  addImages: () => null, removeImage: () => undefined, draftImages: () => [],
  resolveSubmitMode: () => 'queue', enterInserts: () => false, toggleCommandMenu: () => undefined,
  useNotices: bind(shell.notices), useLexicon: bind(shell.lexicon), useMenuLauncher: bind(createSnapshotStore<string | null>(null)),
  useComposerMenu: bind(createSnapshotStore<readonly unknown[]>([])), stop: () => undefined, command: () => Promise.resolve(true),
  t: tc, renderSlot: (_key: string, _owner: object, options?: { fallback?: unknown }) => options?.fallback ?? null, variant: 'composer',
  placeholder: 'What do you want to Idealize?',
  leftItems: <GenerationSettings {...strip} />,
  rightItems: <>{toolButton('↵', 'transparent')}{toolButton('♥', 'var(--dsw-alias-bg-layer-1)')}{toolButton('+', 'var(--dsw-alias-fill-l1)')}</>,
} as unknown as InputBarProps

const stage = document.getElementById('stage')
if (stage === null) throw new Error('backdrop proof: no stage')
const props = { useSession, retry: () => Promise.resolve(null), setDisposition: () => Promise.resolve(null), kind: 'audio', t } as unknown as GalleryViewProps
createRoot(stage).render(
  <div className={frame.root} data-phase="active" data-idealize-surface="chat" style={{ fontFamily: '"Instrument Sans", system-ui, sans-serif' }}>
    {/* The app's Title card writes the title's colour on the title, at this strength. */}
    <style>{'[data-idealize-surface="chat"][data-idealize-surface] [data-session-title] { --dsh-session-title-color: #24292f; }'}</style>
    <header className={frame.header} data-view="gallery" style={{ font: '800 28px system-ui', color: 'var(--dsw-alias-label-primary, #24292f)' }}>
      <h1 data-session-title="" style={{ margin: 0, font: 'inherit', color: 'var(--dsh-session-title-color)' }}>Horse Image</h1>
    </header>
    <div className={frame.scrollBody} data-conversation-scroll="">
      <div data-slot="conversation.session" style={{ display: 'contents' }}>
        <div className={frame.viewArea}><GalleryView {...props} /></div>
      </div>
      <div className={frame.composerSeat} data-composer-seat="">
        <div className={frame.composerStack} style={{ padding: '0 0 8px' }}>
          <InputBar {...bar} />
          <div data-proof-stats="" style={{ minHeight: 24, textAlign: 'center', font: '12px/20px system-ui', color: 'var(--dsw-alias-label-tertiary, #a5a8ac)' }}>
            6 turns · 45 steps | LLM 3m15s · Tool call 4m31s | Cache hit 96%
          </div>
        </div>
      </div>
    </div>
  </div>,
)
paint({})
