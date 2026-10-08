/**
 * Powell's whole window: the owl, the thought pill above it for typing, the
 * speech bubble for replies, and the status tag underneath (the three-part
 * rule from the Paper sketches: no coloured edges, one dark and one grey
 * button at most, red only for a problem).
 * @module @idealize/powell/client/PowellRoot
 */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { isActionable, pickAck } from '../speech-text.ts'
import type { PowellBubble, PowellChoice, PowellMood } from '../types.ts'
import { CENTRED_LAYOUT, desktop, OWL_WIDTH, post, type PowellLayout } from './desktop.ts'
import { Gestures, type GestureEffect } from './gestures.ts'
import { AMBIENT, pickAmbient, POSES, type Pose, type PoseName } from './owl.ts'
import type { PowellStore } from './store.ts'
import { listen, MicError, readyCue, warmEars, type Listening, type Mouth } from './voice.ts'
import styles from './Powell.module.css'

/** What the slot hands the root. */
export interface PowellRootInjected {
  store: PowellStore
  mouth: Mouth
}

/**
 * What the owl is doing on this side of the wire, ahead of the host.
 * `opening` is the gap between the press and the first microphone sample:
 * the owl leans in but says "Opening the mic", and only `listening` (audio is
 * flowing) says "Speak now" with a cue (JJ, 2 Oct 2026: "need better UI
 * indication of when to speak").
 */
type LocalMood = 'opening' | 'listening' | 'hearing' | 'dragging' | null

/** A bubble raised by the window itself (consent, a mic problem, nothing heard). */
type LocalBubble = (PowellBubble & { local: string }) | null

const CONSENT_TEXT = 'Your voice goes to a cloud service to be turned into text. IDEalize doesn\'t keep the recording.'

/** Which pose the owl shows for the combined state. */
function poseOf(mood: PowellMood, local: LocalMood): PoseName {
  if (local === 'dragging') return 'flap'
  if (local === 'listening' || local === 'opening') return 'listening'
  if (local === 'hearing') return 'thinking'
  switch (mood) {
    case 'listening': return 'listening'
    case 'thinking': return 'thinking'
    case 'acting': return 'acting'
    case 'waiting': return 'waiting'
    case 'done': return 'done'
    case 'problem': return 'problem'
    default: return 'idle'
  }
}

/** Space kept between a floating card and the window's side. */
const EDGE = 8

/** How soon the pointer may set off another flutter. */
const PERK_GAP_MS = 3000

/**
 * Plays one pose's frames. While idle the owl does small things by itself
 * every few seconds (blink, glance, sway, stretch), and `perk` plays a quick
 * flutter when the pointer arrives.
 * @param pose - the pose to play.
 * @returns the frame to show, and the flutter.
 */
function useOwlFrame(pose: PoseName): { frame: number; perk: () => void } {
  const [frame, setFrame] = useState<number>(POSES.idle.frames[0])
  const running = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
  const lastPerk = useRef(0)
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

  const run = useCallback((spec: Pose, done?: () => void): void => {
    clearInterval(running.current)
    running.current = undefined
    let index = 0
    setFrame(spec.frames[0] as number)
    if (spec.frames.length === 1) {
      done?.()
      return
    }
    running.current = setInterval(() => {
      index += 1
      if (index >= spec.frames.length) {
        if (!spec.loop) {
          clearInterval(running.current)
          running.current = undefined
          done?.()
          return
        }
        index = 0
      }
      setFrame(spec.frames[index] as number)
    }, 1000 / spec.fps)
  }, [])

  useEffect(() => {
    if (reduced) {
      setFrame(POSES[pose].frames[0])
      return undefined
    }
    run(POSES[pose])
    if (pose !== 'idle') return () => { clearInterval(running.current) }
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = (): void => {
      timer = setTimeout(() => { run(AMBIENT[pickAmbient(Math.random())], schedule) }, 4000 + Math.random() * 7000)
    }
    schedule()
    return () => {
      clearTimeout(timer)
      clearInterval(running.current)
    }
  }, [pose, reduced, run])

  const perk = useCallback((): void => {
    if (reduced || pose !== 'idle' || running.current !== undefined) return
    const now = Date.now()
    if (now - lastPerk.current < PERK_GAP_MS) return
    lastPerk.current = now
    run(AMBIENT.perk)
  }, [pose, reduced, run])

  return { frame, perk }
}

/**
 * Render Powell.
 * @param props - the injected store and mouth.
 * @returns the owl surface.
 */
export function PowellRoot({ store, mouth }: PowellRootInjected): React.JSX.Element {
  const view = useSyncExternalStore(listener => store.subscribe(listener), () => store.getSnapshot())
  const bridge = useMemo(() => desktop(), [])
  const [local, setLocal] = useState<LocalMood>(null)
  const [localBubble, setLocalBubble] = useState<LocalBubble>(null)
  const [pill, setPill] = useState<{ open: boolean; text: string; sending: boolean }>({ open: false, text: '', sending: false })
  const [menu, setMenu] = useState<null | { projects: string[] | null }>(null)
  const [level, setLevel] = useState(0)
  const [speaking, setSpeaking] = useState(false)
  const [hiddenBubble, setHiddenBubble] = useState<string | null>(null)
  const listening = useRef<Listening | null>(null)
  const handsFree = useRef(false)
  const turn = useRef(0)
  const input = useRef<HTMLInputElement>(null)
  const hit = useRef(false)
  /** The hold ended (or a toggle was pressed again) before the microphone finished opening. */
  const released = useRef(false)
  // Read through a function: the flag changes across the microphone's await.
  const releasedNow = (): boolean => released.current

  // Where the owl sits in its window; the desktop shell moves it near an edge.
  const [layout, setLayout] = useState<PowellLayout>(CENTRED_LAYOUT)
  useEffect(() => bridge.onLayout(setLayout), [bridge])
  // Tell the shell once the new layout has painted, so it moves the window then.
  useLayoutEffect(() => {
    let second = 0
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => { bridge.layoutApplied() }) })
    return () => {
      cancelAnimationFrame(first)
      cancelAnimationFrame(second)
    }
  }, [bridge, layout])

  // The bubble, pill or menu centres over the owl but never past the window's side.
  const above = useRef<HTMLDivElement>(null)
  const [float, setFloat] = useState({ left: EDGE, tail: 0 })
  useLayoutEffect(() => {
    const element = above.current
    if (element === null) return undefined
    const measure = (): void => {
      const width = element.offsetWidth
      const centre = layout.owlX + OWL_WIDTH / 2
      const left = Math.round(Math.min(Math.max(centre - width / 2, EDGE), Math.max(EDGE, window.innerWidth - width - EDGE)))
      setFloat(prior => prior.left === left && prior.tail === centre - left ? prior : { left, tail: centre - left })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => { observer.disconnect() }
  }, [layout])

  const [frames, setFrames] = useState<readonly string[]>([])
  useEffect(() => {
    void fetch('/idealize/powell/owl.json').then(async response => response.ok ? await response.json() as string[] : [])
      .then(setFrames).catch(() => undefined)
  }, [])
  useEffect(() => mouth.onSpeaking(setSpeaking), [mouth])
  useEffect(() => { void mouth.preload() }, [mouth])
  // The audio graph is built before the first press, so a hold starts on the microphone alone.
  useEffect(() => {
    if (view.voiceConsent) void warmEars().catch(() => undefined)
  }, [view.voiceConsent])

  // ── sending ────────────────────────────────────────────────────────────────
  const send = useCallback((text: string, modality: 'text' | 'voice'): void => {
    const words = text.trim()
    if (words === '') return
    mouth.hush()
    setLocalBubble(null)
    setHiddenBubble(null)
    // The instant acknowledgement (latency addendum §1): a cached clip that
    // claims no outcome, only for a clear instruction.
    if (isActionable(words)) {
      const ack = pickAck(turn.current)
      turn.current += 1
      if (mouth.has(ack)) mouth.say(`ack-${String(turn.current)}`, '', ack)
    }
    void post('/idealize/powell/say', { text: words, modality })
  }, [mouth])

  // ── voice ──────────────────────────────────────────────────────────────────
  const stopListening = useCallback(async (): Promise<void> => {
    const session = listening.current
    listening.current = null
    handsFree.current = false
    setLevel(0)
    if (session === null) {
      setLocal(null)
      return
    }
    setLocal('hearing')
    const heard = await session.finish()
    setLocal(null)
    if (!heard.ok) {
      setLocalBubble({
        local: 'stt',
        kind: 'problem',
        text: heard.code === 'no-key' ? 'Voice needs a fal key. Add it in Settings → Brains.' : 'I couldn\'t hear that properly.',
        choices: heard.code === 'no-key' ? [{ label: 'Open Settings', action: 'open', target: 'settings', primary: true }] : [],
      })
      return
    }
    if (heard.text === '') {
      setLocalBubble({ local: 'empty', kind: 'reply', text: 'I didn\'t catch that.', choices: [] })
      if (mouth.has('try-again')) mouth.say('nothing', '', 'try-again')
      return
    }
    // Show what was heard going into the owl's head, then send it.
    setPill({ open: true, text: heard.text, sending: true })
    window.setTimeout(() => { setPill({ open: false, text: '', sending: false }) }, 420)
    send(heard.text, 'voice')
  }, [mouth, send])

  const startListening = useCallback(async (free: boolean): Promise<void> => {
    if (listening.current !== null) return
    if (!store.getSnapshot().voiceConsent) {
      setLocalBubble({
        local: 'consent',
        kind: 'consent',
        text: CONSENT_TEXT,
        choices: [
          { label: 'Turn on voice', action: 'say', target: 'consent-yes', primary: true },
          { label: 'Not now', action: 'say', target: 'consent-no' },
        ],
      })
      return
    }
    mouth.hush()
    setLocalBubble(null)
    setPill(prior => prior.text === '' ? { open: false, text: '', sending: false } : prior)
    setLocal('opening')
    handsFree.current = free
    released.current = false
    try {
      listening.current = await listen({
        onLevel: setLevel,
        onReady: () => {
          if (releasedNow()) return
          setLocal('listening')
          readyCue()
        },
        ...free ? { onEnd: () => { void stopListening() } } : {},
      })
      // The hold ended while the microphone was opening: nothing was said.
      if (releasedNow()) {
        listening.current.cancel()
        listening.current = null
        setLocal(null)
        setLevel(0)
      }
    } catch (error) {
      setLocal(null)
      const denied = error instanceof MicError && error.refusal === 'denied'
      setLocalBubble({
        local: 'mic',
        kind: 'problem',
        text: denied ? 'I need the microphone. Allow IDEalize in System Settings → Privacy → Microphone.' : 'No microphone is available.',
        choices: [],
      })
    }
  }, [mouth, stopListening, store])

  // ── gestures ───────────────────────────────────────────────────────────────
  // One tracker for the window's lifetime: rebuilding it mid-press would drop
  // the hold, so it calls the latest handlers through a ref.
  const onGesture = useRef<(effect: GestureEffect) => void>(() => undefined)
  onGesture.current = (effect: GestureEffect): void => {
    switch (effect.kind) {
      case 'hold-start':
        void startListening(false)
        return
      case 'hold-end':
        if (listening.current === null) released.current = true
        void stopListening()
        return
      case 'drag-start':
        setLocal('dragging')
        bridge.dragStart()
        return
      case 'drag-end':
        bridge.dragEnd()
        setLocal(null)
        return
      case 'click':
        setMenu(null)
        setPill(prior => prior.open ? { open: false, text: '', sending: false } : { open: true, text: '', sending: false })
        return
      case 'double-click':
        setPill({ open: false, text: '', sending: false })
        bridge.openMain()
    }
  }
  const gestures = useMemo(() => new Gestures((effect) => { onGesture.current(effect) }), [])

  // The pill takes the keyboard while open, and gives it back when it closes.
  useEffect(() => {
    if (pill.open && !pill.sending) {
      bridge.focus(true)
      input.current?.focus()
    } else if (!pill.open) {
      bridge.focus(false)
    }
  }, [bridge, pill.open, pill.sending])

  // Global keys from the desktop shell.
  useEffect(() => bridge.onCommand((command) => {
    if (command === 'type') {
      setPill({ open: true, text: '', sending: false })
      return
    }
    if (listening.current !== null) void stopListening()
    else if (local === 'listening' || local === 'opening') released.current = true
    else void startListening(true)
  }), [bridge, local, startListening, stopListening])

  // Click-through: only Powell's own pixels take the pointer.
  useEffect(() => {
    const update = (event: MouseEvent): void => {
      const target = event.target instanceof Element ? event.target : null
      const over = target?.closest('[data-powell-hit]') !== null && target !== null
      if (over === hit.current) return
      hit.current = over
      bridge.hit(over)
    }
    const leave = (): void => {
      if (!hit.current) return
      hit.current = false
      bridge.hit(false)
    }
    window.addEventListener('mousemove', update)
    document.addEventListener('mouseleave', leave)
    return () => {
      window.removeEventListener('mousemove', update)
      document.removeEventListener('mouseleave', leave)
    }
  }, [bridge])

  // Escape: close the pill, else stop talking.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (menu !== null) setMenu(null)
      else if (pill.open) setPill({ open: false, text: '', sending: false })
      else mouth.hush()
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [menu, mouth, pill.open])

  // ── bubble ─────────────────────────────────────────────────────────────────
  const hostBubble = view.bubble !== null && view.bubble.text !== hiddenBubble ? view.bubble : null
  const bubble: PowellBubble | null = localBubble ?? (view.busy && view.bubble?.kind === 'reply' ? null : hostBubble)

  // A plain reply fades on its own once read; questions, approvals and problems wait.
  useEffect(() => {
    if (bubble === null || bubble.kind !== 'reply' || speaking) return undefined
    const ms = 4000 + bubble.text.length * 55
    const timer = setTimeout(() => {
      if (localBubble !== null) setLocalBubble(null)
      else setHiddenBubble(bubble.text)
    }, ms)
    return () => { clearTimeout(timer) }
  }, [bubble, localBubble, speaking])

  const choose = (choice: PowellChoice): void => {
    if (localBubble !== null) {
      setLocalBubble(null)
      if (choice.target === 'consent-yes') {
        void post('/idealize/powell/prefs', { voiceConsent: true })
        if (mouth.has('listening')) mouth.say('consent', '', 'listening')
        return
      }
      if (choice.target === 'settings') bridge.openMain()
      return
    }
    setHiddenBubble(view.bubble?.text ?? null)
    void post('/idealize/powell/choose', { choice })
  }

  // ── menu ───────────────────────────────────────────────────────────────────
  const openMenu = (event: React.MouseEvent): void => {
    event.preventDefault()
    setPill({ open: false, text: '', sending: false })
    setMenu({ projects: null })
    void fetch('/idealize/powell/project').then(async (response) => {
      const body = await response.json() as { projects: { name: string }[] }
      setMenu(prior => prior === null ? prior : { projects: body.projects.map(project => project.name) })
    }).catch(() => undefined)
  }

  const pose = poseOf(view.mood, local)
  const { frame, perk } = useOwlFrame(pose)
  const status = local === 'opening'
    ? 'Opening the mic…'
    : local === 'listening'
      ? 'Speak now'
      : local === 'hearing'
        ? 'Got it'
        : view.status !== ''
          ? view.status
          : view.project?.name ?? 'No project'
  const tone = local === 'listening' ? 'listening' : local === 'opening' ? 'opening' : view.mood === 'problem' ? 'problem' : view.busy || local === 'hearing' ? 'busy' : 'rest'

  return (
    <div className={styles.stage} data-flip={layout.flip ? '' : undefined}>
      <div
        ref={above}
        className={styles.above}
        style={{ left: `${String(float.left)}px`, ['--tail-x' as string]: `${String(float.tail)}px` }}
      >
        {menu !== null && (
          <div className={styles.menu} data-powell-hit="" role="menu">
            <button type="button" role="menuitem" className={styles.menuItem} onClick={() => { setMenu(null); bridge.openMain() }}>Open IDEalize</button>
            <div className={styles.menuLabel}>Project</div>
            <div className={styles.menuProjects}>
              {menu.projects === null && <span className={styles.menuNote}>Loading…</span>}
              {menu.projects?.slice(0, 30).map(name => (
                <button
                  key={name}
                  type="button"
                  role="menuitemradio"
                  aria-checked={view.project?.name === name}
                  className={styles.menuItem}
                  data-current={view.project?.name === name ? '' : undefined}
                  onClick={() => {
                    setMenu(null)
                    void post('/idealize/powell/project', { name })
                  }}
                >
                  {name}
                </button>
              ))}
            </div>
            <div className={styles.menuRule} />
            {view.busy && <button type="button" role="menuitem" className={styles.menuItem} onClick={() => { setMenu(null); void post('/idealize/powell/stop') }}>Stop</button>}
            <button type="button" role="menuitem" className={styles.menuItem} onClick={() => { setMenu(null); void post('/idealize/powell/prefs', { muted: !view.muted }) }}>
              {view.muted ? 'Read replies aloud' : 'Mute voice replies'}
            </button>
            {view.voiceConsent && (
              <button type="button" role="menuitem" className={styles.menuItem} onClick={() => { setMenu(null); void post('/idealize/powell/prefs', { voiceConsent: false }) }}>
                Turn off voice input
              </button>
            )}
            <button type="button" role="menuitem" className={styles.menuItem} onClick={() => { setMenu(null); bridge.hide() }}>Hide Powell</button>
          </div>
        )}

        {menu === null && bubble !== null && !pill.open && (
          <div className={styles.bubble} data-powell-hit="" data-kind={bubble.kind} role="status" aria-live="polite">
            <p className={styles.bubbleText}>{bubble.text}</p>
            {bubble.choices.length > 0 && (
              <div className={styles.choices}>
                {bubble.choices.slice(0, 2).map(choice => (
                  <button
                    key={`${choice.action}:${choice.label}`}
                    type="button"
                    className={choice.primary === true ? styles.primary : styles.secondary}
                    onClick={() => { choose(choice) }}
                  >
                    {choice.label}
                  </button>
                ))}
              </div>
            )}
            {bubble.kind !== 'consent' && bubble.kind !== 'approval' && (
              <button type="button" className={styles.close} aria-label="Dismiss" onClick={() => {
                if (localBubble !== null) setLocalBubble(null)
                else setHiddenBubble(bubble.text)
              }}>×</button>
            )}
          </div>
        )}

        {menu === null && pill.open && (
          <form
            className={styles.pill}
            data-powell-hit=""
            data-sending={pill.sending ? '' : undefined}
            onSubmit={(event) => {
              event.preventDefault()
              const text = pill.text
              if (text.trim() === '') return
              setPill({ open: true, text, sending: true })
              window.setTimeout(() => { setPill({ open: false, text: '', sending: false }) }, 420)
              send(text, 'text')
            }}
          >
            <input
              ref={input}
              className={styles.input}
              value={pill.text}
              readOnly={pill.sending}
              placeholder="Ask Powell…"
              aria-label="Ask Powell"
              onChange={(event) => { setPill({ open: true, text: event.target.value, sending: false }) }}
              onBlur={() => {
                if (!pill.sending && pill.text.trim() === '') setPill({ open: false, text: '', sending: false })
              }}
            />
            <span className={styles.thoughtDot} data-size="big" />
            <span className={styles.thoughtDot} data-size="small" />
          </form>
        )}
      </div>

      <div className={styles.perch} style={{ left: `${String(layout.owlX)}px` }}>
        <div
          className={styles.owl}
          data-powell-hit=""
          data-pose={pose}
          data-speaking={speaking ? '' : undefined}
          role="button"
          tabIndex={0}
          aria-label="Powell. Click to type, hold to talk, drag to move, double-click to open IDEalize."
          onPointerEnter={perk}
          onPointerDown={(event) => {
            if (event.button !== 0) return
            event.currentTarget.setPointerCapture(event.pointerId)
            gestures.down(event.screenX, event.screenY)
          }}
          onPointerMove={(event) => { gestures.move(event.screenX, event.screenY) }}
          onPointerUp={() => { gestures.up() }}
          onPointerCancel={() => { gestures.cancel() }}
          onLostPointerCapture={() => { gestures.cancel() }}
          onContextMenu={openMenu}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') setPill({ open: true, text: '', sending: false })
          }}
        >
          {local === 'listening' && (
            <span className={styles.marks} style={{ ['--level' as string]: String(level) }} aria-hidden="true">
              <i /><i /><i />
            </span>
          )}
          {/* Every frame stays decoded in the page and only its visibility
            changes: swapping one image's source to the next frame's data URL
            made the owl flash blank between frames (JJ, 2 Oct 2026). */}
          {frames.map((src, index) => (
            <img key={index} className={styles.owlImage} data-on={index === frame ? '' : undefined} src={src} alt="" draggable={false} />
          ))}
        </div>

        <div className={styles.tag} data-tone={tone} data-powell-hit="">
          <span className={styles.dot} />
          <span className={styles.tagText}>{status}</span>
          {view.busy && local === null && (
            <button type="button" className={styles.stop} aria-label="Stop" onClick={() => { void post('/idealize/powell/stop') }}>■</button>
          )}
        </div>
      </div>
    </div>
  )
}
