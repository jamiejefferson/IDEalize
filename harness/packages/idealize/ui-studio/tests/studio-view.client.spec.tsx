// @vitest-environment jsdom
/**
 * The view over realistic folded state: the synthesis card carries its
 * staleness, unresolved attention lists apart from the full task list, the
 * agents row reads presence, a timeline row's source link opens its chat, and
 * with several projects each gets its heading and the timeline merges them.
 * Plus what A6 added: unread rows past the read position, the row an opened
 * alert lands on, and each request's recorded resolution.
 */
import { describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { StudioView } from '../src/client/StudioView.tsx'
import { createStudioStore } from '../src/client/store.ts'
import type { EventRow, StateResponse, StudioTranslate } from '../src/client/studio-model.ts'
import { en } from '../src/client/locales.ts'

const t: StudioTranslate = makeTranslate(en, commonEn)

/** A fold with every section populated. */
const STATE: StateResponse = {
  tasks: [
    {
      id: 't1', goal: 'Wire the roster', owner: 'session-a', state: 'working', attention: 'blocked',
      attentionOwner: 'user', created: '2026-09-01T10:00:00.000Z', createdSeq: 1, updated: '2026-09-01T10:05:00.000Z',
    },
    {
      id: 't2', goal: 'Ship the pane', owner: 'session-a', state: 'queued', attention: 'none',
      created: '2026-09-01T10:01:00.000Z', createdSeq: 2, updated: '2026-09-01T10:01:00.000Z',
    },
  ],
  agents: { 'session-a': { active: 't1', queued: ['t2'], displayed: 't1', unresolved: ['t1'] } },
  deliveries: {},
  synthesis: { event: 'se-1', author: 'session-lead', at: '2026-09-01T09:30:00.000Z', body: 'All on track.', stale: true },
  presence: { 'session-a': 'reachable' },
}

const EVENTS: EventRow[] = [
  { id: 'se-2', seq: 2, at: '2026-09-01T10:00:00.000Z', project: '/proj/alpha', author: 'user', kind: 'assignment', subtype: 'new-task', target: 'session-a', taskId: 't1', body: 'Wire the roster' },
  { id: 'se-3', seq: 3, at: '2026-09-01T10:05:00.000Z', project: '/proj/alpha', author: 'session-a', kind: 'request', taskId: 't1', body: 'Which port?', source: { thread: 'session-a' } },
]

interface MoreProject { project: string; state: StateResponse; recent: EventRow[] }

/** Roster the pane resolves authors through; a caller may name more. */
function paneWith(
  state: StateResponse | null,
  events: EventRow[] = [],
  more: MoreProject[] = [],
  names: Record<string, string> = {},
) {
  const store = createStudioStore()
  store.state.update((draft) => {
    draft.loading = false
    draft.loaded = true
    draft.projects = [
      ...state === null ? [] : [{ project: '/proj/alpha', lastSeq: events.at(-1)?.seq ?? 0, state, recent: events }],
      ...more.map(row => ({ project: row.project, lastSeq: row.recent.at(-1)?.seq ?? 0, state: row.state, recent: row.recent })),
    ]
  })
  const openThread = vi.fn()
  const sync = vi.fn(async () => {})
  const markRead = vi.fn()
  const address = vi.fn()
  const view = render(
    <StudioView
      useStudio={bindSnapshotSelector(store.state)}
      sync={sync}
      openThread={openThread}
      takeFocus={store.takeFocus}
      markRead={markRead}
      useNames={selector => selector(names)}
      address={address}
      t={t}
    />,
  )
  return { view, openThread, sync, markRead, address, store }
}

afterEach(cleanup)

/** jsdom implements no scrolling; the view asks the focused row to show itself. */
const scrollIntoView = vi.fn()
Element.prototype.scrollIntoView = scrollIntoView

/**
 * jsdom lays nothing out either: every element reports the same content
 * height and viewport, a spec grows the content, and scrollTop clamps to the
 * foot as a browser's does.
 */
const layout = { scrollHeight: 1000, clientHeight: 200 }
const scrollTops = new WeakMap<Element, number>()
Object.defineProperties(Element.prototype, {
  scrollHeight: { configurable: true, get: () => layout.scrollHeight },
  clientHeight: { configurable: true, get: () => layout.clientHeight },
  scrollTop: {
    configurable: true,
    get(this: Element) { return scrollTops.get(this) ?? 0 },
    set(this: Element, value: number) { scrollTops.set(this, Math.max(0, Math.min(value, layout.scrollHeight - layout.clientHeight))) },
  },
})
const foot = (): number => layout.scrollHeight - layout.clientHeight

describe('the Studio pane', () => {
  it('renders the synthesis with its staleness, attention apart, tasks, presence and the timeline', () => {
    const { view } = paneWith(STATE, EVENTS)
    expect(view.getByText('All on track.')).toBeTruthy()
    expect(view.getByText('Out of date')).toBeTruthy()
    const attention = view.container.querySelector('[data-studio-attention="t1"]')
    expect(attention?.textContent).toContain('Blocked')
    expect(attention?.textContent).toContain('for user')
    expect(view.container.querySelector('[data-studio-attention="t2"]')).toBeNull()
    expect(view.container.querySelector('[data-studio-task="t2"]')?.textContent).toContain('Queued')
    const agent = view.container.querySelector('[data-studio-agent="session-a"]')
    expect(agent?.querySelector('[data-presence="reachable"]')).toBeTruthy()
    expect(agent?.textContent).toContain('Wire the roster')
    expect(agent?.textContent).toContain('1 queued')
    expect(view.container.querySelector('[data-studio-event="2"]')?.textContent).toContain('Assignment')
    expect(view.container.querySelector('[data-studio-event="2"]')?.textContent).toContain('new-task')
  })

  it('opens the source chat from a timeline row and polls the overview', () => {
    const { view, openThread, sync } = paneWith(STATE, EVENTS)
    fireEvent.click(view.getByRole('button', { name: 'Open chat' }))
    expect(openThread).toHaveBeenCalledWith('session-a', '2026-09-01T10:05:00.000Z')
    expect(sync).toHaveBeenCalledTimes(1)
    // One project: no project heading, no project tags on the rows.
    expect(view.container.querySelector('[data-studio-project]')).toBeTruthy()
    expect([...view.container.querySelectorAll('h3')].map(node => node.textContent)).toEqual(['Timeline'])
  })

  it('names participants from the roster and starts a reply from any reference', () => {
    const { view, address } = paneWith(STATE, EVENTS, [], { 'session-a': 'Watto', 'session-lead': 'Sebulba' })
    const row = view.container.querySelector('[data-studio-event-id="se-3"]')
    expect(row?.textContent).toContain('@Watto')
    expect(row?.textContent).not.toContain('session-a')
    // The assignment's target is a reference too, not only its author.
    expect(view.container.querySelector('[data-studio-event-id="se-2"]')?.textContent).toContain('@Watto')
    // The synthesis, the task owner and the agent row all read as names.
    expect(view.container.querySelector('[data-studio-synthesis]')?.textContent).toContain('@Sebulba')
    expect(view.container.querySelector('[data-studio-task="t2"]')?.textContent).toContain('@Watto')
    expect(view.container.querySelector('[data-studio-agent="session-a"]')?.textContent).toContain('@Watto')
    fireEvent.click(view.getAllByRole('button', { name: '@Watto' })[0]!)
    expect(address).toHaveBeenCalledWith('Watto')
  })

  it('shows an id the roster cannot name as recorded, with nothing to address', () => {
    const { view } = paneWith(STATE, EVENTS)
    const ref = view.container.querySelector('[data-studio-event-id="se-3"] [data-studio-agent-ref]')
    expect(ref?.textContent).toBe('session-a')
    expect(ref?.tagName).toBe('SPAN')
  })

  it('shows the owl with one line on an empty Studio rather than bare sections or a subtitle', () => {
    const { view } = paneWith({ tasks: [], agents: {}, deliveries: {}, presence: {} })
    const empty = view.container.querySelector('[data-studio-empty]')
    expect(empty).toBeTruthy()
    const owl = empty?.querySelector('[data-studio-owl] img')
    expect(owl?.getAttribute('src')).toMatch(/^data:image\/webp;base64,/)
    expect(owl?.getAttribute('height')).toBe('120')
    expect(empty?.textContent).toBe('Nothing here yet. Message the Studio coordinator below, or @name to ask one agent.')
    expect(view.container.querySelector('[data-studio-task]')).toBeNull()
    // The header is the title alone: the Studio needs no project and no explainer.
    expect(view.container.querySelector('header')?.textContent).toBe('Studio')
  })

  it('holds the owl on its resting frame under prefers-reduced-motion', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce') }))
    vi.useFakeTimers()
    try {
      const { view } = paneWith({ tasks: [], agents: {}, deliveries: {}, presence: {} })
      const owl = view.container.querySelector('[data-studio-owl] img')
      const first = owl?.getAttribute('src')
      vi.advanceTimersByTime(2000)
      expect(owl?.getAttribute('src')).toBe(first)
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })

  it('heads each project and merges every project\'s timeline by time', () => {
    const beta: EventRow[] = [
      { id: 'se-1', seq: 1, at: '2026-09-01T10:02:00.000Z', project: '/proj/beta', author: 'user', kind: 'message', body: 'everyone: lunch' },
    ]
    const { view } = paneWith(STATE, EVENTS, [{ project: '/proj/beta', state: { tasks: [], agents: {}, deliveries: {}, presence: {} }, recent: beta }])
    expect([...view.container.querySelectorAll('[data-studio-project]')].map(node => node.getAttribute('data-studio-project'))).toEqual(['/proj/alpha', '/proj/beta'])
    expect([...view.container.querySelectorAll('h3')].map(node => node.textContent)).toEqual(['alpha', 'beta', 'Timeline'])
    expect([...view.container.querySelectorAll('[data-studio-event]')].map(node => node.getAttribute('data-studio-event-project')))
      .toEqual(['/proj/alpha', '/proj/beta', '/proj/alpha'])
    expect(view.container.querySelectorAll('[data-studio-event]')[1]?.textContent).toContain('beta')
  })

  it("names the Studio's own timeline rather than showing its bare key", () => {
    const own: EventRow[] = [
      { id: 'se-s1', seq: 1, at: '2026-09-01T10:02:00.000Z', project: 'studio', author: 'user', kind: 'message', body: 'where are we?' },
    ]
    const { view } = paneWith(STATE, EVENTS, [{ project: 'studio', state: { tasks: [], agents: {}, deliveries: {}, presence: {} }, recent: own }])
    expect([...view.container.querySelectorAll('h3')].map(node => node.textContent)).toEqual(['alpha', 'Studio', 'Timeline'])
    const rows = [...view.container.querySelectorAll('[data-studio-event]')]
    expect(rows.find(row => row.getAttribute('data-studio-event-project') === 'studio')?.textContent).toContain('Studio')
  })

  it('marks every row past the read position, and reads the Studio by showing it', () => {
    const { view, markRead, store } = paneWith(STATE, EVENTS)
    expect(markRead).toHaveBeenCalledWith('/proj/alpha', 3)
    // Nothing recorded as read: both rows carry the mark.
    expect(view.container.querySelectorAll('[data-studio-unread]')).toHaveLength(2)
    act(() => { store.state.update((draft) => { draft.read = { '/proj/alpha': 2 } }) })
    expect([...view.container.querySelectorAll('[data-studio-unread]')].map(node => node.getAttribute('data-studio-event')))
      .toEqual(['3'])
  })

  it('shows a request as waiting while the fold holds it, and answered once it does not', () => {
    const asked: EventRow = {
      id: 'se-9', seq: 9, at: '2026-09-01T10:06:00.000Z', project: '/proj/alpha', author: 'session-a',
      kind: 'request', subtype: 'needs-input', target: 'user', taskId: 't1', body: 'Which port?',
    }
    const open: StateResponse = {
      ...STATE,
      tasks: [{ ...STATE.tasks[0]!, attention: 'needs-input', requestEvent: 'se-9' }, STATE.tasks[1]!],
    }
    const { view, store } = paneWith(open, [...EVENTS, asked])
    const row = () => view.container.querySelector('[data-studio-event-id="se-9"] [data-studio-resolution]')
    expect(row()?.getAttribute('data-studio-resolution')).toBe('open')
    expect(row()?.textContent).toBe('Waiting for you')
    // The fold answered it; the timeline row says so, whatever an old alert says.
    act(() => {
      store.state.update((draft) => {
        const { requestEvent: _answered, ...cleared } = open.tasks[0]!
        draft.projects[0]!.state = { ...open, tasks: [{ ...cleared, attention: 'none' }, open.tasks[1]!] }
      })
    })
    expect(row()?.getAttribute('data-studio-resolution')).toBe('answered')
    expect(row()?.textContent).toBe('Answered')
  })

  it('opens at the foot, follows new rows there, and holds the place of a reader who scrolled up', () => {
    layout.scrollHeight = 1000
    const { view, store } = paneWith(STATE, EVENTS)
    const body = view.container.querySelector('[data-studio-body]') as HTMLElement
    expect(body.scrollTop).toBe(foot())
    // A new row while the reader is at the foot: the view follows it.
    layout.scrollHeight = 1200
    act(() => {
      store.state.update((draft) => {
        draft.projects[0]!.recent = [...EVENTS, { ...EVENTS[1]!, id: 'se-4', seq: 4, at: '2026-09-01T10:06:00.000Z', body: 'Port 9333' }]
      })
    })
    expect(body.scrollTop).toBe(foot())
    // The reader scrolls up to read; the next row does not move the page.
    body.scrollTop = 100
    fireEvent.scroll(body)
    layout.scrollHeight = 1400
    act(() => {
      store.state.update((draft) => {
        draft.projects[0]!.recent = [...draft.projects[0]!.recent, { ...EVENTS[1]!, id: 'se-5', seq: 5, at: '2026-09-01T10:07:00.000Z', body: 'Confirmed' }]
      })
    })
    expect(body.scrollTop).toBe(100)
    // Back at the foot, the view follows again.
    body.scrollTop = foot()
    fireEvent.scroll(body)
    layout.scrollHeight = 1600
    act(() => {
      store.state.update((draft) => {
        draft.projects[0]!.recent = [...draft.projects[0]!.recent, { ...EVENTS[1]!, id: 'se-6', seq: 6, at: '2026-09-01T10:08:00.000Z', body: 'Done' }]
      })
    })
    expect(body.scrollTop).toBe(foot())
  })

  it('stays off the foot on an empty Studio, and an alert landing is not followed by a jump to the foot', () => {
    layout.scrollHeight = 1000
    const { synthesis: _synthesis, ...rest } = STATE
    const blank = paneWith({ ...rest, tasks: [] }, [])
    expect((blank.view.container.querySelector('[data-studio-body]') as HTMLElement).scrollTop).toBe(0)
    cleanup()
    const { view, store } = paneWith(STATE, EVENTS)
    const body = view.container.querySelector('[data-studio-body]') as HTMLElement
    act(() => { store.focus('se-2') })
    body.scrollTop = 300
    layout.scrollHeight = 1200
    act(() => {
      store.state.update((draft) => {
        draft.projects[0]!.recent = [...EVENTS, { ...EVENTS[1]!, id: 'se-4', seq: 4, at: '2026-09-01T10:06:00.000Z', body: 'Port 9333' }]
      })
    })
    expect(body.scrollTop).toBe(300)
  })

  it('lands on the event an opened alert named, once', () => {
    scrollIntoView.mockClear()
    const { view, store } = paneWith(STATE, EVENTS)
    expect(view.container.querySelector('[data-studio-focused]')).toBeNull()
    act(() => { store.focus('se-3') })
    const landed = view.container.querySelector('[data-studio-focused]')
    expect(landed?.getAttribute('data-studio-event-id')).toBe('se-3')
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    // The target is taken, so a later poll does not move the page again.
    expect(store.state.getSnapshot().focus).toBeNull()
    act(() => {
      store.state.update((draft) => { draft.projects = [...draft.projects] })
    })
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
  })
})
