/**
 * The Studio view: every project's coordination at a glance (JJ, 3 Sep 2026:
 * "the studio is for all projects"). One section per project over its folded
 * state — the coordinator's synthesis, the tasks holding unresolved attention,
 * every task, each participant's work view — then one timeline merged across
 * projects, each row naming its project and each addressed row offering the
 * way back to its source chat.
 *
 * Reading the Studio is what marks it read: while the view is mounted it
 * moves each project's read position to the newest event it shows, and rows
 * past the stored position carry `data-studio-unread`. An alert the person
 * opened names its event, and the view lands on that row (`data-studio-focused`)
 * showing the request's recorded resolution — an answered request offers
 * nothing to answer again.
 *
 * The chat's ordinary composer overlays the view's foot (the
 * `data-conversation-composer-overlay` contract ui-conversation offers a view
 * that scrolls itself, as Trajectory does): a leading `@name` reaches that
 * participant, anything else is a group post on every project; the host takes
 * the message before any model runs.
 *
 * Pure over the injected face: state arrives through the `useStudio` hook,
 * refresh through `sync`, and navigation through `openThread`. The component
 * polls while mounted; the store keeps the view across unmounts.
 * @module @idealize/ui-studio/client/StudioView
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import type { StudioKey } from './locales.ts'
import type { AgentViewRow, EventRow, ProjectView, StudioTranslate, TaskRow } from './studio-model.ts'
import type { StudioViewState } from './store.ts'
import { StudioOwl } from './StudioOwl.tsx'
import css from './StudioView.module.css'

/** How often the mounted view re-reads the overview. */
const POLL_MS = 3000

/** Merged timeline rows shown; older rows stay on disk. */
const SHOWN_EVENTS = 200
/** How far above the foot still counts as reading the foot, in px (a row's worth of slack). */
const FOOT_SLACK_PX = 24

/** Request-shaped rows: the events the fold can hold open against a task. */
const REQUEST_SUBTYPES = new Set(['needs-input', 'needs-action', 'blocked'])

/** Kinds with a dictionary label; an unknown kind renders as its raw string. */
const KNOWN_KINDS = new Set(['message', 'assignment', 'task-update', 'request', 'decision', 'handoff', 'delivery', 'synthesis', 'system'])

/** The wiring the view's plugin supplies (`studioSection.face()`). */
export interface StudioViewInjected {
  /** Selector hook over the Studio store. */
  useStudio: <T>(selector: (state: StudioViewState) => T) => T
  /** Read the overview; see the store. */
  sync: () => Promise<void>
  /** Open a participant's chat on the main surface, aimed at an instant when given (timeline source links). */
  openThread: (sessionId: string, at?: string) => void
  /** Take the Studio event an opened alert asked the view to land on. */
  takeFocus: () => string | null
  /**
   * Selector hook over the participant roster: session id to agent name. The
   * timeline stores authors as session ids, which is what an id is for, and
   * every row read as `session-11d20279-7215-…` until this resolved them
   * (JJ, 11 Sep 2026: "the studio chat view is broken").
   */
  useNames: <T>(selector: (names: Record<string, string>) => T) => T
  /**
   * Put `@name ` in the composer below, so a reference in the timeline is the
   * start of a reply rather than a label (JJ, 11 Sep 2026: "references to
   * agents should use the @ feature").
   */
  address: (name: string) => void
  /** Record that the person has seen a project's timeline up to `seq`. */
  markRead: (project: string, seq: number) => void
}

/** Everything the component renders from. */
export type StudioViewProps = StudioViewInjected & { t: StudioTranslate }

/** An ISO instant's HH:MM, as recorded (UTC): stable across viewer locales. */
const clock = (at: string): string => at.slice(11, 16)

/**
 * The Studio's own timeline key (`STUDIO_PROJECT` in `@idealize/studio`). Every
 * other timeline is keyed by an absolute project folder, so the bare word
 * cannot collide with one.
 */
const STUDIO_PROJECT = 'studio'

/** A timeline's name: the Studio's own, or a project folder's last segment. */
const projectName = (project: string, t: StudioTranslate): string => (
  project === STUDIO_PROJECT ? t('studio.title') : project.split(/[\\/]/).filter(Boolean).at(-1) ?? project
)

/**
 * Render the Studio view.
 * @param props - the wired face plus the bound translate.
 * @returns the view's element tree.
 */
export function StudioView({ useStudio, sync, openThread, takeFocus, markRead, useNames, address, t }: StudioViewProps) {
  const view = useStudio(state => state)
  const pending = useStudio(state => state.focus)
  const names = useNames(all => all)
  const [focused, setFocused] = useState<string | null>(null)
  const focusedRow = useRef<HTMLLIElement | null>(null)
  const scrolled = useRef<string | null>(null)
  const body = useRef<HTMLDivElement | null>(null)
  const atFoot = useRef(true)
  const opened = useRef(false)

  useEffect(() => {
    const tick = (): void => { void sync() }
    tick()
    const timer = setInterval(tick, POLL_MS)
    return () => { clearInterval(timer) }
  }, [sync])

  // An opened alert names one event; the view takes the request once, then
  // holds the mark so a later poll does not move the page under the reader.
  useEffect(() => {
    if (pending === null) return
    const target = takeFocus()
    if (target !== null) setFocused(target)
  }, [pending, takeFocus])

  // The row may arrive with a later poll, so the landing waits for it; once
  // it has landed, no further poll moves the page under the reader.
  useEffect(() => {
    if (focused === null || scrolled.current === focused) return
    const row = focusedRow.current
    if (row === null) return
    scrolled.current = focused
    row.scrollIntoView({ block: 'center' })
  }, [focused, view.projects])

  // Looking at the Studio is reading it.
  useEffect(() => {
    for (const project of view.projects) markRead(project.project, project.lastSeq)
  }, [markRead, view.projects])

  const empty = view.projects.every(project => (
    project.state.tasks.length === 0 && project.recent.length === 0 && project.state.synthesis === undefined
  ))
  const events = view.projects
    .flatMap(project => project.recent)
    .sort((a, b) => a.at.localeCompare(b.at) || a.seq - b.seq)
    .slice(-SHOWN_EVENTS)
  const newest = events.at(-1)
  const newestKey = newest === undefined ? '' : `${newest.project}:${newest.id}`

  // The newest rows sit at the foot, as in a chat: the view opens there
  // (JJ, 15 Sep 2026: it "seems to default to be scrolled to the top so you
  // have to scroll down every time you open it") and follows new rows while
  // the reader is at the foot; a reader who scrolled up keeps their place,
  // and an alert landing takes precedence. Before paint, so no top-first flash.
  useLayoutEffect(() => {
    const scroller = body.current
    if (scroller === null || focused !== null || !view.loaded || empty) return
    if (!opened.current) {
      opened.current = true
      atFoot.current = true
    }
    if (atFoot.current) scroller.scrollTop = scroller.scrollHeight
  }, [view.loaded, empty, newestKey, events.length, focused])
  const onScroll = (): void => {
    const scroller = body.current
    if (scroller === null) return
    atFoot.current = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= FOOT_SLACK_PX
  }
  const several = view.projects.length > 1
  // A request the fold still holds against a task is unanswered; every other
  // request-shaped row has its answer recorded, whatever an old alert says.
  const openRequests = new Set(
    view.projects.flatMap(project => project.state.tasks.flatMap(task => task.requestEvent ?? [])),
  )

  return (
    <div className={css.root} data-studio-pane="" data-conversation-composer-overlay="">
      <header className={css.header}>
        <h2 className={css.title}>{t('studio.title')}</h2>
      </header>
      <div className={css.body} ref={body} onScroll={onScroll} data-studio-body="">
        {view.loading && !view.loaded && <p className={css.hint}>{t('studio.loading')}</p>}
        {view.error !== null && (
          <p className={css.error} data-studio-error="">
            {t('studio.error.cause', { cause: view.error })}
            <button type="button" className={css.retry} onClick={() => { void sync() }}>{t('studio.retry')}</button>
          </p>
        )}
        {view.loaded && empty && (
          <div className={css.empty} data-studio-empty="">
            <StudioOwl />
            <p className={css.emptyLine}>{t('studio.empty')}</p>
          </div>
        )}
        {view.loaded && !empty && (
          <>
            {view.projects.map(project => (
              <ProjectSection
                key={project.project}
                project={project}
                named={several}
                names={names}
                address={address}
                t={t}
              />
            ))}
            <section className={css.section} aria-label={t('studio.timeline.title')}>
              <h3 className={css.sectionTitle}>{t('studio.timeline.title')}</h3>
              <ol className={css.timeline}>
                {events.map(event => (
                  <TimelineRow
                    key={`${event.project}:${event.id}`}
                    event={event}
                    named={several}
                    openThread={openThread}
                    unread={event.seq > (view.read[event.project] ?? 0)}
                    focused={event.id === focused}
                    rowRef={event.id === focused ? focusedRow : undefined}
                    open={openRequests.has(event.id)}
                    names={names}
                    address={address}
                    t={t}
                  />
                ))}
              </ol>
            </section>
          </>
        )}
      </div>
    </div>
  )
}

/** One project's four state sections; the project heading shows once the Studio watches more than one. */
function ProjectSection({ project, named, names, address, t }: {
  project: ProjectView
  named: boolean
  /** Session id to agent name; an unnamed id renders as itself. */
  names: Record<string, string>
  /** Start a reply to a named agent in the composer below. */
  address: (name: string) => void
  t: StudioTranslate
}) {
  const { state } = project
  const byId = new Map(state.tasks.map(task => [task.id, task]))
  const attention = state.tasks.filter(task => task.attention !== 'none')
  return (
    <section className={css.project} data-studio-project={project.project}>
      {named && <h3 className={css.projectTitle}>{projectName(project.project, t)}</h3>}
      <section className={css.section} aria-label={t('studio.synthesis.title')}>
        <h4 className={css.sectionTitle}>{t('studio.synthesis.title')}</h4>
        {state.synthesis === undefined
          ? <p className={css.hint}>{t('studio.synthesis.none')}</p>
          : (
            <div className={css.synthesis} data-studio-synthesis="" data-stale={state.synthesis.stale ? '' : undefined}>
              <div className={css.synthesisMeta}>
                <AgentRef id={state.synthesis.author} names={names} address={address} t={t} />
                {t('studio.synthesis.at', { at: clock(state.synthesis.at) })}
                {state.synthesis.stale && <span className={css.stale}>{t('studio.synthesis.stale')}</span>}
              </div>
              <p className={css.synthesisBody}>{state.synthesis.body}</p>
            </div>
          )}
      </section>
      <section className={css.section} aria-label={t('studio.attention.title')}>
        <h4 className={css.sectionTitle}>{t('studio.attention.title')}</h4>
        {attention.length === 0
          ? <p className={css.hint}>{t('studio.attention.none')}</p>
          : attention.map(task => (
            <div key={task.id} className={css.row} data-studio-attention={task.id}>
              <span className={css.rowLabel}>{task.goal === '' ? task.id : task.goal}</span>
              <span className={css.chipWarn}>{attnLabel(task, t)}</span>
              {task.attentionOwner !== undefined && (
                <span className={css.rowMeta}>
                  {t('studio.attention.for')}
                  {' '}
                  <AgentRef id={task.attentionOwner} names={names} address={address} t={t} />
                </span>
              )}
            </div>
          ))}
      </section>
      <section className={css.section} aria-label={t('studio.tasks.title')}>
        <h4 className={css.sectionTitle}>{t('studio.tasks.title')}</h4>
        {state.tasks.length === 0
          ? <p className={css.hint}>{t('studio.tasks.none')}</p>
          : state.tasks.map(task => (
            <div key={task.id} className={css.row} data-studio-task={task.id}>
              <span className={css.rowLabel}>{task.goal === '' ? task.id : task.goal}</span>
              <span className={css.chip} data-state={task.state}>{t(`studio.state.${task.state}`)}</span>
              {task.attention !== 'none' && <span className={css.chipWarn}>{attnLabel(task, t)}</span>}
              <span className={css.rowMeta}>
                <AgentRef id={task.owner} names={names} address={address} t={t} />
              </span>
            </div>
          ))}
      </section>
      <section className={css.section} aria-label={t('studio.agents.title')}>
        <h4 className={css.sectionTitle}>{t('studio.agents.title')}</h4>
        {Object.entries(state.agents).map(([participant, agent]) => (
          <div key={participant} className={css.row} data-studio-agent={participant}>
            <span
              className={css.presence}
              data-presence={state.presence[participant] ?? 'unreachable'}
              title={t(state.presence[participant] === 'reachable' ? 'studio.presence.reachable' : 'studio.presence.unreachable')}
            />
            <span className={css.rowLabel}>
              <AgentRef id={participant} names={names} address={address} t={t} />
            </span>
            <span className={css.rowMeta} data-studio-agent-finished={agent.finished === undefined ? undefined : ''}>
              {agentWork(agent, byId, t)}
            </span>
            {agent.queued.length > 0 && (
              <span className={css.rowMeta}>{t('studio.agents.queued', { count: agent.queued.length })}</span>
            )}
          </div>
        ))}
      </section>
    </section>
  )
}

/**
 * One participant reference: the agent's name as an `@` address, which is
 * what the composer below takes. Clicking it starts a reply to that agent.
 * An id the roster does not name renders as itself, never as a fake name.
 */
function AgentRef({ id, names, address, t }: {
  id: string
  names: Record<string, string>
  address: (name: string) => void
  t: StudioTranslate
}) {
  const name = names[id]
  if (name === undefined) {
    return <span className={css.agentRefPlain} data-studio-agent-ref={id}>{id}</span>
  }
  return (
    <button
      type="button"
      className={css.agentRef}
      data-studio-agent-ref={id}
      title={t('studio.address', { name })}
      onClick={() => { address(name) }}
    >
      {`@${name}`}
    </button>
  )
}

/** One merged-timeline row, tagged with its project while several are watched. */
function TimelineRow({ event, named, openThread, unread, focused, rowRef, open, names, address, t }: {
  event: EventRow
  named: boolean
  openThread: (sessionId: string, at?: string) => void
  /** Session id to agent name; an unnamed id renders as itself. */
  names: Record<string, string>
  /** Start a reply to a named agent in the composer below. */
  address: (name: string) => void
  /** True while the row sits past the project's stored read position. */
  unread: boolean
  /** True for the one row an opened alert asked the view to land on. */
  focused: boolean
  /** Set on the focused row so the view can scroll to it. */
  rowRef?: MutableRefObject<HTMLLIElement | null> | undefined
  /** True while the fold still holds this request against a task. */
  open: boolean
  t: StudioTranslate
}) {
  const thread = event.source?.thread
  const request = event.subtype !== undefined && REQUEST_SUBTYPES.has(event.subtype)
  return (
    <li
      ref={rowRef ?? null}
      className={css.event}
      data-studio-event={String(event.seq)}
      data-studio-event-id={event.id}
      data-studio-event-project={event.project}
      data-studio-unread={unread ? '' : undefined}
      data-studio-focused={focused ? '' : undefined}
    >
      <span className={css.eventTime}>{clock(event.at)}</span>
      <span className={css.eventHead}>
        {named && <span className={css.eventProject}>{projectName(event.project, t)}</span>}
        <AgentRef id={event.author} names={names} address={address} t={t} />
        {event.target !== undefined && (
          <>
            {' → '}
            <AgentRef id={event.target} names={names} address={address} t={t} />
          </>
        )}
        <span className={css.eventKind}>
          {KNOWN_KINDS.has(event.kind) ? t(`studio.kind.${event.kind}` as StudioKey) : event.kind}
          {event.subtype !== undefined && ` · ${event.subtype}`}
        </span>
      </span>
      {event.body !== undefined && event.body !== '' && <span className={css.eventBody}>{event.body}</span>}
      {request && (
        <span className={css.eventResolution} data-studio-resolution={open ? 'open' : 'answered'}>
          {t(open ? 'studio.request.open' : 'studio.request.answered')}
        </span>
      )}
      {thread !== undefined && (
        <button
          type="button"
          className={css.eventLink}
          onClick={() => { openThread(thread, event.at) }}
        >
          {t('studio.openThread')}
        </button>
      )}
    </li>
  )
}

/** What one agent's row says it is doing: its active task, else that it has finished, else that it is idle. */
function agentWork(agent: AgentViewRow, byId: ReadonlyMap<string, TaskRow>, t: StudioTranslate): string {
  if (agent.active !== undefined) return byId.get(agent.active)?.goal ?? agent.active
  return t(agent.finished === undefined ? 'studio.agents.idle' : 'studio.agents.finished')
}

/** A task's attention label; `none` never reaches here. */
function attnLabel(task: TaskRow, t: StudioTranslate): string {
  return t(`studio.attn.${task.attention}` as StudioKey)
}
