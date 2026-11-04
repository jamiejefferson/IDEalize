/**
 * The starting points under the hero composer (Paper "Brains rethink", board
 * 12, approved by JJ on 4 Nov 2026: "we choose a broad task type and then the
 * model router can refine the specific model choice after that"). A person can
 * type straight away, and the composer runs on the brain its chip names. The
 * cards offer the brains as roles to start from, with examples that fill the
 * composer, so nobody needs a tile for their task (JJ on the tiles: "it assumes
 * we know all the types of task").
 *
 * NOTHING HERE IS EVER DIMMED OR DISABLED (JJ, 25 Aug: "yeah i want you to be
 * able to click it and then select a model on the next screen"). A card that
 * cannot answer says what is missing and opens the fix. A space with no brain,
 * no model or no backend opens the brain step, which states why, with the way
 * forward and the way back. A space with one reachable brain starts it at once
 * (JJ, 7 Sep 2026: "skip the brain selection if there's only one brain").
 *
 * The brain step has three states, driven by the roster entry alone:
 *
 * - brains listed: each row starts the chat on that brain;
 * - no brains but a model can serve the space: "Add a brain for <Space>";
 * - no model can serve it: the shared recovery sentence for the route's
 *   verdict, the provider-key action where a key is what is missing, and the
 *   way back. Its brains are not offered as rows, because starting a chat in a
 *   space nothing can serve is the dead end the step exists to explain.
 *
 * A BLANK CHAT RUNS ON ITS BRAIN WITHOUT ASKING. The card puts the chat on its
 * brain when it first shows, so the chip tells the truth before anything is
 * typed. It records the brain only once a person starts typing, because a
 * recorded brain takes the chat out of New chat's reuse scan and the router
 * reads its criteria from that record.
 * @module @idealize/ui-bar/client/HeroBrains
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SpaceBrain, SpaceId, SpaceRosterEntry } from '@idealize/spaces/client'
import { onBrainsChanged } from './brains-changed.ts'
import type { BarKey } from './locales.ts'
import { mediaRecoveryText } from './media-recovery.ts'
import { BarIconArrowRight, BarIconChevronLeft, BarIconKey, BarIconPlus } from './BarIcons.tsx'
import { SpaceIcon } from './SpaceIcon.tsx'
import { SPACE_LABELS, terminalCliOf, type BrainAccess, type HeroLauncherInjected, type LauncherSpaces, type TerminalLaunches } from './HeroLauncher.tsx'
import { suggestSpace } from './suggest-space.ts'
import css from './HeroLauncher.module.css'

/** Full slot props for the band under the card. */
export type HeroBrainsProps =
  PropsRuntime<'conversation.hero.below'>
  & PropsLocale<'idealize-bar'>
  & InjectFace<HeroLauncherInjected>

/** What a seeded brain's card says. A brain somebody authored shows its name alone. */
const SEEDED_CARDS: Readonly<Record<string, { purpose: BarKey; examples: readonly BarKey[] }>> = {
  coding: { purpose: 'launcher.purpose.coding', examples: ['launcher.example.coding1', 'launcher.example.coding2'] },
  design: { purpose: 'launcher.purpose.design', examples: ['launcher.example.design1', 'launcher.example.design2'] },
  writing: { purpose: 'launcher.purpose.writing', examples: ['launcher.example.writing1', 'launcher.example.writing2'] },
  admin: { purpose: 'launcher.purpose.admin', examples: ['launcher.example.admin1', 'launcher.example.admin2'] },
  free: { purpose: 'launcher.purpose.free', examples: ['launcher.example.free1', 'launcher.example.free2'] },
}

/** The Images card, which starts a space rather than a chat brain. */
const IMAGES_CARD = { purpose: 'launcher.purpose.gallery', examples: ['launcher.example.gallery1', 'launcher.example.gallery2'] } as const satisfies { purpose: BarKey; examples: readonly BarKey[] }

/** The spaces offered beside the cards, in this order. */
const ALSO_HERE: readonly SpaceId[] = ['soundstage', 'motion', 'terminal']

/** The sentence that names a suggested space. */
const SUGGEST_LINES: Readonly<Partial<Record<SpaceId, BarKey>>> = {
  gallery: 'launcher.suggest.gallery',
  soundstage: 'launcher.suggest.soundstage',
  motion: 'launcher.suggest.motion',
}

/**
 * Whether a provider key is the thing a refused space is waiting on. The
 * desktop shell is not something a key can supply, so that state offers the
 * sentence and the way back and no key action.
 */
function keyRecovers(entry: Pick<SpaceRosterEntry, 'reason' | 'keyMissing'>): boolean {
  return entry.reason === 'no-model' || (entry.reason === 'no-compatible-model' && entry.keyMissing === true)
}

/**
 * Whether a brain's row on step 2 would start the chat rather than send the
 * person to the key editor or the sign-in surface. In Terminal the brain runs
 * a CLI on its own login, so its chat route's access does not apply.
 * @param space - the space the brain is offered in.
 * @param access - the brain's access row, undefined while the map is unread.
 * @returns true when a click on the row starts the chat.
 */
function startsChat(space: SpaceId, access: BrainAccess | undefined): boolean {
  return space === 'terminal' || access?.state !== 'unavailable'
}

/**
 * The brain a tile starts on its own: the one brain of a space a model can
 * serve, when its row would start the chat. A lone brain whose route wants a
 * key or a sign-in is not returned, so step 2 renders and explains.
 * @param entry - the space the tile names.
 * @param access - the access map the card read.
 * @returns the brain, or undefined when step 2 must render.
 */
function soleReachableBrain(entry: SpaceRosterEntry, access: Readonly<Record<string, BrainAccess>>): SpaceBrain | undefined {
  const brain = entry.brains[0]
  if (entry.brainCount !== 1 || entry.models !== 'some' || brain === undefined) return undefined
  return startsChat(entry.id, access[brain.id]) ? brain : undefined
}

/** Focus the composer textarea. */
function focusComposer(): void {
  window.setTimeout(() => {
    document.querySelector<HTMLTextAreaElement>('[data-composer-card] textarea')?.focus()
  }, 0)
}

/**
 * The brain a blank Chat chat is running: the one it records, else the preset
 * it was created on, else the space's default.
 * @param chat - the Chat roster entry.
 * @param session - the chat.
 * @returns the brain's id, or undefined when Chat has no brains.
 */
function chatBrainOf(
  chat: SpaceRosterEntry | undefined,
  session: { brain?: string | undefined; agentPreset?: string | undefined } | undefined,
): string | undefined {
  if (chat === undefined) return undefined
  const offers = (id: string | undefined): id is string => id !== undefined && chat.brains.some(brain => brain.id === id)
  if (offers(session?.brain)) return session.brain
  if (offers(session?.agentPreset)) return session.agentPreset
  return (chat.brains.find(brain => brain.default === true) ?? chat.brains[0])?.id
}

function Tick() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className={css.cardTick} data-card-mark="ready">
      <path d="m3.5 8.5 3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function Warning() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className={css.cardWarning} data-card-mark="needs">
      <path d="M8 3.5v5.5M8 12h.01" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  )
}

/** One starting point: its name, what it is for, and either its examples or what it is missing. */
function BrainCard({ id, name, purpose, examples, selected, free, needs, onStart, onExample, t }: {
  id: string
  name: string
  purpose: string
  examples: readonly string[]
  selected: boolean
  free: boolean
  /** What the brain is missing, and the way to fix it; undefined when it can answer. */
  needs: { line: string; action: string; fix: () => void } | undefined
  onStart: () => void
  onExample: (text: string) => void
  t: HeroBrainsProps['t']
}) {
  return (
    <div className={selected ? css.cardSelected : css.card} data-brain-card={id} data-brain-selected={selected ? '' : undefined}>
      <button type="button" className={css.cardMain} aria-pressed={selected} onClick={needs === undefined ? onStart : needs.fix}>
        <span className={css.cardHead}>
          <span className={css.cardName}>{name}</span>
          {needs !== undefined ? <Warning /> : free ? <span className={css.cardFree}>{t('launcher.free')}</span> : <Tick />}
        </span>
        {purpose !== '' && <span className={css.cardPurpose}>{purpose}</span>}
      </button>
      {needs !== undefined
        ? (
          <span className={css.cardNeeds} data-brain-card-needs="">
            {needs.line}
            {' '}
            <button type="button" className={css.cardFix} onClick={needs.fix}>{needs.action}</button>
          </span>
        )
        : examples.length > 0 && (
          <span className={css.cardExamples}>
            {examples.map(text => (
              <button key={text} type="button" className={css.cardExample} data-brain-example="" onClick={() => { onExample(text) }}>
                {t('launcher.example', { text })}
              </button>
            ))}
          </span>
        )}
    </div>
  )
}

/**
 * Render the starting points under the composer.
 * @param props - composed slot props.
 * @returns the band, or null where the chat has already gone elsewhere.
 */
export function HeroBrains(props: HeroBrainsProps) {
  const { t, spaces, currentSession, projectOpen, draft, setDraft } = props
  const [roster, setRoster] = useState<readonly SpaceRosterEntry[]>([])
  const [access, setAccess] = useState<Readonly<Record<string, BrainAccess>>>({})
  // The chosen space is keyed to the session it was chosen for: a new blank
  // chat starts at the cards, rather than on what the last chat picked.
  const [chosen, setChosen] = useState<{ session: string | null; space: SpaceId } | null>(null)
  const [busy, setBusy] = useState(false)
  // The brain a tile is starting on its own, while that launch is in flight.
  // The cards stay on screen for the round-trip; a refusal clears this and the
  // brain step takes over, so the person sees why.
  const [autoStart, setAutoStart] = useState<string | null>(null)
  const [keepAsking, setKeepAsking] = useState<string | null>(null)
  const load = spaces.load
  const loadAccess = spaces.access

  // Loaded on mount and again whenever the Brains pane saves something.
  useEffect(() => {
    let cancelled = false
    const reload = (): void => {
      void load().then((entries) => { if (!cancelled) setRoster(entries) })
      void loadAccess().then((map) => { if (!cancelled) setAccess(map) })
    }
    reload()
    const stop = onBrainsChanged(reload)
    return () => { cancelled = true; stop() }
  }, [load, loadAccess])

  const session = currentSession()
  const sessionKey = session?.id ?? null
  const space = session?.space ?? 'chat'
  const chat = roster.find(entry => entry.id === 'chat')
  const currentBrain = chatBrainOf(chat, session)
  const blank = session?.blank === true
  const unrecorded = blank && space === 'chat' && session.brain === undefined

  // Once per blank chat, keyed by session so a re-render cannot run it again.
  const prepared = useRef<string | null>(null)
  useEffect(() => {
    if (!projectOpen || !unrecorded || sessionKey === null || currentBrain === undefined) return
    if (prepared.current === sessionKey) return
    prepared.current = sessionKey
    void spaces.prepare(currentBrain, sessionKey)
  }, [projectOpen, unrecorded, sessionKey, currentBrain, spaces])

  const typing = draft.trim() !== ''
  const noted = useRef<string | null>(null)
  useEffect(() => {
    if (!typing || !unrecorded || sessionKey === null || currentBrain === undefined) return
    if (noted.current === sessionKey) return
    noted.current = sessionKey
    spaces.noteTyping(currentBrain, sessionKey)
  }, [typing, unrecorded, sessionKey, currentBrain, spaces])

  const back = useCallback(() => { setChosen(null) }, [])

  // One launch at a time: `busy` is the guard, whatever the trigger. A
  // re-render cannot launch again, because a click is the only way in.
  const launch = (target: SpaceRosterEntry, brain: string, then?: () => void): void => {
    if (busy) return
    setBusy(true)
    void spaces.enter(target.id, brain, session?.id).then((opened) => {
      setBusy(false)
      setAutoStart(null)
      if (!opened) return
      setChosen(null)
      then?.()
      focusComposer()
    })
  }
  // A space's card or chip: when one reachable brain works there it starts at
  // once, otherwise the brain step says what there is and what is missing.
  const pick = (id: SpaceId, then?: () => void): void => {
    setChosen({ session: sessionKey, space: id })
    const target = roster.find(row => row.id === id)
    const brain = target === undefined ? undefined : soleReachableBrain(target, access)
    if (target === undefined || brain === undefined || busy) return
    setAutoStart(brain.id)
    launch(target, brain.id, then)
  }
  const fill = (text: string): void => {
    setDraft?.(text)
    focusComposer()
  }

  // A Studio chat is launched by construction. A chat that left for a media
  // space or Terminal carries on there, under that view's own composer.
  if (!projectOpen || !blank || space !== 'chat') return null

  const entry = chosen !== null && chosen.session === sessionKey && autoStart === null
    ? roster.find(row => row.id === chosen.space)
    : undefined
  if (entry !== undefined) {
    return (
      <div className={css.below} data-hero-below="">
        <BrainStep
          entry={entry}
          access={access}
          busy={busy}
          onStart={(brain) => { launch(entry, brain) }}
          onBack={back}
          spaces={spaces}
          t={t}
        />
      </div>
    )
  }

  const gallery = roster.find(row => row.id === 'gallery')
  const suggested = keepAsking === sessionKey ? undefined : suggestSpace(draft)
  const suggestedEntry = suggested === undefined ? undefined : roster.find(row => row.id === suggested)

  const needsOf = (brain: SpaceBrain): { line: string; action: string; fix: () => void } | undefined => {
    const row = access[brain.id]
    if (startsChat('chat', row) || row === undefined) return undefined
    if (row.reason === 'no-model' && brain.id === 'free') {
      return { line: t('launcher.card.noModel'), action: t('launcher.card.setUp'), fix: () => { window.open('/idealize/freetokens', '_blank', 'noopener') } }
    }
    return {
      line: t('launcher.card.needsAccount'),
      action: t('launcher.card.connect'),
      fix: row.reason === 'no-sign-in' ? () => { spaces.signIn() } : () => { spaces.addKey(row.model?.provider) },
    }
  }

  // Images is blocked by its catalogue or by the chat route driving its tool,
  // and the second is what a blank install meets: the catalogue is public.
  const galleryBrain = gallery?.brains.find(brain => brain.default === true) ?? gallery?.brains[0]
  const galleryNeeds = gallery?.models === 'none' && keyRecovers(gallery)
    ? { line: t('launcher.card.needsAccount'), action: t('launcher.card.connect'), fix: () => { spaces.addKey() } }
    : galleryBrain === undefined ? undefined : needsOf(galleryBrain)

  return (
    <div className={css.below} data-hero-below="">
      {suggested !== undefined && suggestedEntry !== undefined && (
        <div className={css.suggest} data-hero-suggest={suggested}>
          <span className={css.suggestLine}>{t(SUGGEST_LINES[suggested] ?? 'launcher.suggest.gallery')}</span>
          <button type="button" className={css.suggestMake} data-hero-suggest-make="" onClick={() => { pick(suggested) }}>
            {t('launcher.suggest.make', { space: t(SPACE_LABELS[suggested]) })}
          </button>
          <button type="button" className={css.suggestKeep} data-hero-suggest-keep="" onClick={() => { setKeepAsking(sessionKey) }}>
            {t('launcher.suggest.keep')}
          </button>
        </div>
      )}
      <div className={css.startFrom}>{t('launcher.startFrom')}</div>
      <div className={css.cards} role="group" aria-label={t('launcher.startFrom')}>
        {chat?.brains.map((brain) => {
          const seeded = SEEDED_CARDS[brain.id]
          return (
            <BrainCard
              key={brain.id}
              id={brain.id}
              name={brain.name}
              purpose={seeded === undefined ? '' : t(seeded.purpose)}
              examples={seeded === undefined ? [] : seeded.examples.map(key => t(key))}
              selected={brain.id === currentBrain}
              free={brain.id === 'free'}
              needs={needsOf(brain)}
              onStart={() => {
                if (brain.id === currentBrain) focusComposer()
                else launch(chat, brain.id)
              }}
              onExample={(text) => {
                if (brain.id === currentBrain) fill(text)
                else launch(chat, brain.id, () => { fill(text) })
              }}
              t={t}
            />
          )
        })}
        {gallery !== undefined && (
          <BrainCard
            id="gallery"
            name={t(SPACE_LABELS.gallery)}
            purpose={t(IMAGES_CARD.purpose)}
            examples={IMAGES_CARD.examples.map(key => t(key))}
            selected={false}
            free={false}
            needs={galleryNeeds}
            onStart={() => { pick('gallery') }}
            onExample={(text) => { pick('gallery', () => { fill(text) }) }}
            t={t}
          />
        )}
      </div>
      <div className={css.alsoHere}>
        <span className={css.alsoLabel}>{t('launcher.alsoHere')}</span>
        {ALSO_HERE.filter(id => roster.some(row => row.id === id)).map(id => (
          <button key={id} type="button" className={css.alsoChip} data-space={id} onClick={() => { pick(id) }}>
            {t(SPACE_LABELS[id])}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Step 2: the brains of one space, or the reason there are none to offer. */
function BrainStep(
  { entry, access, busy, onStart, onBack, spaces, t }: {
    access: Readonly<Record<string, BrainAccess>>
    entry: SpaceRosterEntry
    busy: boolean
    onStart: (brain: string) => void
    onBack: () => void
    spaces: LauncherSpaces
    t: HeroBrainsProps['t']
  },
) {
  const name = t(SPACE_LABELS[entry.id])
  // Terminal rows name the CLI they launch; the table is read once per step.
  const [launches, setLaunches] = useState<TerminalLaunches | undefined>(undefined)
  useEffect(() => {
    if (entry.id !== 'terminal') return
    let cancelled = false
    void spaces.terminalLaunches().then((table) => { if (!cancelled) setLaunches(table) })
    return () => { cancelled = true }
  }, [entry.id, spaces])
  return (
    <div className={css.step} data-launcher-step="brain" data-space={entry.id}>
      <div className={css.stepHead}>
        <button type="button" className={css.back} aria-label={t('launcher.back')} data-launcher-back="" onClick={onBack}>
          <BarIconChevronLeft size={17} />
        </button>
        <span className={css.spaceChip}><SpaceIcon space={entry.id} size={18} />{name}</span>
      </div>
      <div className={css.question}>
        <span className={css.questionText}>{t('launcher.whichBrain')}</span>
        <span className={css.questionNote} data-brain-summary="">
          {entry.brainCount === 0
            ? t('launcher.noBrains')
            : entry.brainCount === 1
              ? t('launcher.worksHereOne', { space: name })
              : t('launcher.worksHereMany', { count: entry.brainCount, space: name })}
        </span>
      </div>
      {/* A space no model can serve offers no rows: starting a chat there
          would land the user in a space that cannot answer. The refusal below
          is what step 2 shows instead — the invariant's "explains" half. */}
      {entry.brainCount > 0 && entry.models === 'some' && (
        <div className={css.brains}>
          {entry.brains.map(brain => (
            <BrainRow
              key={brain.id}
              space={entry.id}
              brain={brain}
              access={access[brain.id]}
              cli={entry.id === 'terminal' && launches !== undefined ? terminalCliOf(brain.id, launches, t) : undefined}
              busy={busy}
              onStart={onStart}
              onAddKey={spaces.addKey}
              onSignIn={spaces.signIn}
              t={t}
            />
          ))}
          <button
            type="button"
            className={css.addBrain}
            data-launcher-add-brain={entry.id}
            onClick={() => { spaces.addBrain(entry.id) }}
          >
            <BarIconPlus size={17} />
            {t('launcher.addBrain', { space: name })}
          </button>
        </div>
      )}
      {entry.brainCount === 0 && entry.models === 'some' && (
        <div className={css.empty}>
          <button
            type="button"
            className={css.addBrainPrimary}
            data-launcher-add-brain={entry.id}
            onClick={() => { spaces.addBrain(entry.id) }}
          >
            <BarIconPlus size={17} />
            <span className={css.addBrainLabel}>{t('launcher.addBrain', { space: name })}</span>
            <BarIconArrowRight size={17} />
          </button>
          <p className={css.emptyNote}>{t('launcher.addBrainNote', { space: name })}</p>
        </div>
      )}
      {entry.models === 'none' && (
        <div className={css.empty} data-launcher-refusal={entry.reason}>
          <p className={css.refusal} data-launcher-recovery="">
            {mediaRecoveryText(entry.id, entry, t)}
          </p>
          <div className={css.refusalActions}>
            {keyRecovers(entry) && (
              <button type="button" className={css.keyAction} data-launcher-add-key="" onClick={() => { spaces.addKey('openrouter') }}>
                <BarIconKey size={17} />
                {t('brains.media.addKey')}
              </button>
            )}
            <button type="button" className={css.backLink} data-launcher-back="" onClick={onBack}>
              <BarIconChevronLeft size={17} />
              {t('launcher.pickAnother')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * The row's second line: the brain's access when the route cannot serve it,
 * else the model it runs.
 */
function brainNote(brain: SpaceBrain, access: BrainAccess | undefined, blocked: boolean, t: HeroBrainsProps['t']): string {
  if (blocked && access !== undefined) {
    if (access.reason === 'no-model') return t('launcher.noModel')
    const provider = access.providerName ?? access.model?.provider ?? brain.model?.provider ?? ''
    return t(access.reason === 'no-sign-in' ? 'launcher.noSignIn' : 'launcher.noKey', { provider })
  }
  return brain.model === undefined ? t('launcher.brainDefaultModel') : `${brain.model.provider} · ${brain.model.model}`
}

/**
 * One brain: a button that starts the chat, with its model and the default
 * mark. A brain whose route has no key says so and opens the key editor
 * instead, and one whose route waits on a sign-in opens the sign-in surface:
 * a chat started on either would fail at its first turn. The same
 * {@link startsChat} test decides whether a tile starts a lone brain itself.
 */
function BrainRow(
  { space, brain, access, cli, busy, onStart, onAddKey, onSignIn, t }: {
    space: SpaceId
    brain: SpaceBrain
    access: BrainAccess | undefined
    /** In Terminal: the CLI this brain launches, once the launch table is read. The chat model and its key are irrelevant there. */
    cli: { label: string; installed: boolean | null } | undefined
    busy: boolean
    onStart: (brain: string) => void
    onAddKey: (provider?: string) => void
    onSignIn: () => void
    t: HeroBrainsProps['t']
  },
) {
  const blocked = !startsChat(space, access)
  const recover = access?.reason === 'no-sign-in' ? onSignIn : () => { onAddKey(access?.model?.provider) }
  const note = cli === undefined
    ? brainNote(brain, access, blocked, t)
    : cli.installed === false ? t('launcher.cliMissing', { cli: cli.label }) : cli.label
  return (
    <button
      type="button"
      className={css.brain}
      data-brain={brain.id}
      data-brain-default={brain.default === true ? '' : undefined}
      data-brain-access={blocked ? access?.reason ?? 'unavailable' : undefined}
      data-brain-cli={cli?.label}
      aria-busy={busy}
      onClick={() => { if (blocked) recover(); else onStart(brain.id) }}
    >
      <span className={css.brainName}>{brain.name}</span>
      <span className={blocked || cli?.installed === false ? css.brainBlocked : css.brainModel}>{note}</span>
      {brain.default === true && <span className={css.brainBadge}>{t('launcher.default')}</span>}
      <span className={css.brainGo}>{blocked ? <BarIconKey size={17} /> : <BarIconArrowRight size={17} />}</span>
    </button>
  )
}
