/**
 * The three views under the hero composer (Paper "One core model", board 02,
 * with JJ's comment of 25 Nov 2026: the choice is made when a chat is opened,
 * and the chat keeps the view it was opened in). A new chat is a Chat already,
 * so a person can type straight away; the Coding and Studio tiles move this
 * blank chat into the Terminal or the media view.
 *
 * Nobody is shown a brain. Chat and Coding run on the core preset and Studio
 * on the seeded media preset, because a preset is what gives a chat its tools.
 *
 * NOTHING HERE IS EVER DIMMED OR DISABLED (JJ, 25 Aug). A tile that cannot
 * start says what is missing and opens the fix.
 *
 * A BLANK CHAT RUNS ON ITS PRESET WITHOUT ASKING. The band puts the chat on
 * the preset when it first shows, and records it once a person starts typing,
 * because a recorded preset takes the chat out of New chat's reuse scan.
 * @module @idealize/ui-bar/client/HeroBrains
 */
import { useEffect, useRef, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SpaceBrain, SpaceId, SpaceRosterEntry } from '@idealize/spaces/client'
import { onBrainsChanged } from './brains-changed.ts'
import type { BarKey } from './locales.ts'
import { SpaceIcon } from './SpaceIcon.tsx'
import { SPACE_LABELS, terminalCliOf, type BrainAccess, type HeroLauncherInjected, type TerminalLaunches } from './HeroLauncher.tsx'
import { suggestSpace } from './suggest-space.ts'
import css from './HeroLauncher.module.css'

/** Full slot props for the band under the card. */
export type HeroBrainsProps =
  PropsRuntime<'conversation.hero.below'>
  & PropsLocale<'idealize-bar'>
  & InjectFace<HeroLauncherInjected>

/** The preset every new Chat and Coding chat runs on (restated from `@idealize/activity-pills`, whose host half seeds it). */
export const CORE_PRESET = 'core'

/** The media space a Studio chat opens on; the chat box's toggle moves it to the other two. */
export const STUDIO_ENTRY: SpaceId = 'gallery'

/** The sentence that names a suggested space. */
const SUGGEST_LINES: Readonly<Partial<Record<SpaceId, BarKey>>> = {
  gallery: 'launcher.suggest.gallery',
  soundstage: 'launcher.suggest.soundstage',
  motion: 'launcher.suggest.motion',
}

/**
 * Whether a provider key is the thing a refused space is waiting on. The
 * desktop shell is not something a key can supply.
 */
function keyRecovers(entry: Pick<SpaceRosterEntry, 'reason' | 'keyMissing'>): boolean {
  return entry.reason === 'no-model' || (entry.reason === 'no-compatible-model' && entry.keyMissing === true)
}

/** Focus the composer textarea. */
function focusComposer(): void {
  window.setTimeout(() => {
    document.querySelector<HTMLTextAreaElement>('[data-composer-card] textarea')?.focus()
  }, 0)
}

/**
 * The preset a view starts on: the core preset where the space offers it,
 * else the space's default, else its first.
 * @param entry - the space's roster entry.
 * @returns the preset, or undefined when the space offers none.
 */
export function viewPreset(entry: SpaceRosterEntry | undefined): SpaceBrain | undefined {
  if (entry === undefined) return undefined
  return entry.brains.find(brain => brain.id === CORE_PRESET)
    ?? entry.brains.find(brain => brain.default === true)
    ?? entry.brains[0]
}

/**
 * The preset a blank Chat chat is running: the one it records, else the one
 * it was created on, else the view's own.
 * @param chat - the Chat roster entry.
 * @param session - the chat.
 * @returns the preset's id, or undefined when Chat offers none.
 */
function chatPresetOf(
  chat: SpaceRosterEntry | undefined,
  session: { brain?: string | undefined; agentPreset?: string | undefined } | undefined,
): string | undefined {
  if (chat === undefined) return undefined
  const offers = (id: string | undefined): id is string => id !== undefined && chat.brains.some(brain => brain.id === id)
  if (offers(session?.brain)) return session.brain
  if (offers(session?.agentPreset)) return session.agentPreset
  return viewPreset(chat)?.id
}

/** What a tile is missing, and the way to fix it. */
interface TileNeeds { line: string; action: string; fix: () => void }

/** One view: its name, what it is for, what it runs on, and either nothing more or what it is missing. */
function ViewTile({ view, icon, name, purpose, runsOn, selected, needs, onStart }: {
  view: 'chat' | 'coding' | 'studio'
  icon: SpaceId
  name: string
  purpose: string
  runsOn: string
  selected: boolean
  needs: TileNeeds | undefined
  onStart: () => void
}) {
  return (
    <div className={selected ? css.cardSelected : css.card} data-view-tile={view} data-view-selected={selected ? '' : undefined}>
      <button type="button" className={css.cardMain} aria-pressed={selected} onClick={needs === undefined ? onStart : needs.fix}>
        <span className={css.tileIcon}><SpaceIcon space={icon} size={22} /></span>
        <span className={css.tileName}>{name}</span>
        <span className={css.cardPurpose}>{purpose}</span>
        {needs === undefined && runsOn !== '' && <span className={css.tileRuns} data-view-runs="">{runsOn}</span>}
      </button>
      {needs !== undefined && (
        <span className={css.cardNeeds} data-view-needs="">
          {needs.line}
          {' '}
          <button type="button" className={css.cardFix} onClick={needs.fix}>{needs.action}</button>
        </span>
      )}
    </div>
  )
}

/**
 * Render the three views under the composer.
 * @param props - composed slot props.
 * @returns the band, or null where the chat has already gone elsewhere.
 */
export function HeroBrains(props: HeroBrainsProps) {
  const { t, spaces, currentSession, projectOpen, draft } = props
  const [roster, setRoster] = useState<readonly SpaceRosterEntry[]>([])
  const [access, setAccess] = useState<Readonly<Record<string, BrainAccess>>>({})
  const [launches, setLaunches] = useState<TerminalLaunches | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [keepAsking, setKeepAsking] = useState<string | null>(null)
  const load = spaces.load
  const loadAccess = spaces.access
  const loadLaunches = spaces.terminalLaunches

  // Loaded on mount and again whenever the Models pane saves something.
  useEffect(() => {
    let cancelled = false
    const reload = (): void => {
      void load().then((entries) => { if (!cancelled) setRoster(entries) })
      void loadAccess().then((map) => { if (!cancelled) setAccess(map) })
      void loadLaunches().then((table) => { if (!cancelled) setLaunches(table) })
    }
    reload()
    const stop = onBrainsChanged(reload)
    return () => { cancelled = true; stop() }
  }, [load, loadAccess, loadLaunches])

  const session = currentSession()
  const sessionKey = session?.id ?? null
  const space = session?.space ?? 'chat'
  const chat = roster.find(entry => entry.id === 'chat')
  const terminal = roster.find(entry => entry.id === 'terminal')
  const studio = roster.find(entry => entry.id === STUDIO_ENTRY)
  const currentPreset = chatPresetOf(chat, session)
  const blank = session?.blank === true
  const unrecorded = blank && space === 'chat' && session.brain === undefined

  // Once per blank chat, keyed by session so a re-render cannot run it again.
  const prepared = useRef<string | null>(null)
  useEffect(() => {
    if (!projectOpen || !unrecorded || sessionKey === null || currentPreset === undefined) return
    if (prepared.current === sessionKey) return
    prepared.current = sessionKey
    void spaces.prepare(currentPreset, sessionKey)
  }, [projectOpen, unrecorded, sessionKey, currentPreset, spaces])

  const typing = draft.trim() !== ''
  const noted = useRef<string | null>(null)
  useEffect(() => {
    if (!typing || !unrecorded || sessionKey === null || currentPreset === undefined) return
    if (noted.current === sessionKey) return
    noted.current = sessionKey
    spaces.noteTyping(currentPreset, sessionKey)
  }, [typing, unrecorded, sessionKey, currentPreset, spaces])

  // One launch at a time: `busy` is the guard, and a click is the only way in.
  const launch = (target: SpaceId, preset: string): void => {
    if (busy) return
    setBusy(true)
    void spaces.enter(target, preset, session?.id).then((opened) => {
      setBusy(false)
      if (opened) focusComposer()
    })
  }

  // A Studio chat is launched by construction. A chat that left for a media
  // view or the Terminal carries on there, under that view's own composer.
  if (!projectOpen || !blank || space !== 'chat') return null

  const connect = (provider?: string): TileNeeds => ({
    line: t('launcher.tile.needsKey'),
    action: t('launcher.card.connect'),
    fix: () => { spaces.addKey(provider) },
  })

  const chatAccess = currentPreset === undefined ? undefined : access[currentPreset]
  const chatNeeds: TileNeeds | undefined = chatAccess?.state === 'unavailable'
    ? chatAccess.reason === 'no-sign-in'
      ? { line: t('launcher.tile.needsSignIn'), action: t('launcher.card.connect'), fix: () => { spaces.signIn() } }
      : connect(chatAccess.model?.provider ?? 'openrouter')
    : chat?.models === 'none' ? connect('openrouter') : undefined
  const chatRuns = chatAccess?.providerName === undefined ? '' : t('launcher.tile.through', { provider: chatAccess.providerName })

  const codingPreset = viewPreset(terminal)
  const cli = codingPreset === undefined || launches === undefined ? undefined : terminalCliOf(codingPreset.id, launches, t)
  const codingNeeds: TileNeeds | undefined = cli?.installed === false
    ? { line: t('launcher.tile.cliMissing', { cli: cli.label }), action: t('launcher.card.setUp'), fix: () => { spaces.addKey() } }
    : undefined

  const studioPreset = viewPreset(studio)
  const studioNeeds: TileNeeds | undefined = studio?.models === 'none' && keyRecovers(studio) ? connect('openrouter') : undefined

  const suggested = keepAsking === sessionKey ? undefined : suggestSpace(draft)
  const suggestedEntry = suggested === undefined ? undefined : roster.find(row => row.id === suggested)
  const suggestedPreset = viewPreset(suggestedEntry)

  return (
    <div className={css.below} data-hero-below="">
      {suggested !== undefined && suggestedEntry !== undefined && suggestedPreset !== undefined && (
        <div className={css.suggest} data-hero-suggest={suggested}>
          <span className={css.suggestLine}>{t(SUGGEST_LINES[suggested] ?? 'launcher.suggest.gallery')}</span>
          <button type="button" className={css.suggestMake} data-hero-suggest-make="" onClick={() => { launch(suggested, suggestedPreset.id) }}>
            {t('launcher.suggest.make', { space: t(SPACE_LABELS[suggested]) })}
          </button>
          <button type="button" className={css.suggestKeep} data-hero-suggest-keep="" onClick={() => { setKeepAsking(sessionKey) }}>
            {t('launcher.suggest.keep')}
          </button>
        </div>
      )}
      <div className={css.tiles} role="group" aria-label={t('launcher.views')}>
        {chat !== undefined && (
          <ViewTile
            view="chat"
            icon="chat"
            name={t('launcher.chat')}
            purpose={t('launcher.tile.chat')}
            runsOn={chatRuns}
            selected
            needs={chatNeeds}
            onStart={focusComposer}
          />
        )}
        {terminal !== undefined && codingPreset !== undefined && (
          <ViewTile
            view="coding"
            icon="terminal"
            name={t('launcher.terminal')}
            purpose={t('launcher.tile.coding')}
            runsOn={cli === undefined ? '' : t('launcher.tile.subscription', { cli: cli.label })}
            selected={false}
            needs={codingNeeds}
            onStart={() => { launch('terminal', codingPreset.id) }}
          />
        )}
        {studio !== undefined && studioPreset !== undefined && (
          <ViewTile
            view="studio"
            icon={STUDIO_ENTRY}
            name={t('launcher.gallery')}
            purpose={t('launcher.tile.studio')}
            runsOn={t('launcher.tile.studioRuns')}
            selected={false}
            needs={studioNeeds}
            onStart={() => { launch(STUDIO_ENTRY, studioPreset.id) }}
          />
        )}
      </div>
    </div>
  )
}
