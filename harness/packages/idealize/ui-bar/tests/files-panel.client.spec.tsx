// @vitest-environment jsdom
// The files panel's tools: the two rows of tabs (whose files, then project
// files or documentation) — each view opening on its folder's contents with
// no root row to click — a project's own documentation folder, files leaving
// for their default application, and the Reconnect flow behind
// a dead one, creation through the fenced route with the name sheet's
// climbing-name refusal, add-to-chat feedback, surfaced reveal failures, and
// the bar's reveal request opening the way down to one file.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { en } from '../src/client/locales.ts'
import {
  currentProjectDocs, currentProjectRoots, FilesPanel, isValidEntryName, opensInApp, projectDocsRoots, revealAncestors, viewOf,
} from '../src/client/FilesPanel.tsx'
// Type-only: the locale-namespace merge the props type reads.
import type {} from '../src/client/index.ts'

type Props = ComponentProps<typeof FilesPanel>
const t: Props['t'] = makeTranslate(en, commonEn)

/** One JSON fetch response. */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response
}

/** The panel's route surface, overridable per test. */
interface Routes {
  aliases: () => Response
  listing: (path: string) => Response
  create: (body: { parent: string; name: string; kind: string }) => Response
  reveal: () => Response
  /** The Reconnect write, POST /idealize/setup/alias. */
  alias: (body: { name: string; path: string }) => Response
  /** The entry operations: rename, duplicate, move, trash. */
  operate: (route: string, body: Record<string, string>) => Response
  /** The default-application launch, POST /idealize/bar/open. */
  open: (body: { path: string }) => Response | Promise<Response>
  /** A project's documentation folder choice, POST /idealize/setup/project-docs. */
  projectDocs: (body: { project: string; path: string }) => Response
}

/** The four tabs as the host reports them, with every alias healthy. */
const healthyTabs = {
  tabs: [
    { id: 'project', roots: [{ name: 'proj', path: '/w/proj' }], state: 'ok' },
    { id: 'projectsRoot', alias: 'projectsRoot', roots: [{ name: 'Projects', path: '/w' }], state: 'ok' },
    { id: 'documentation', alias: 'documentation', roots: [{ name: 'vault', path: '/v' }], state: 'ok' },
    { id: 'skills', alias: 'skills', roots: [{ name: 'skills', path: '/s' }], state: 'ok' },
  ],
  projectDocs: [{ project: { name: 'proj', path: '/w/proj' }, folder: '/v/Projects/proj', source: 'note', state: 'ok' }],
}

/** The same four with the documentation folder gone (FIL-07). */
const deadDocsTabs = {
  tabs: [
    healthyTabs.tabs[0],
    healthyTabs.tabs[1],
    {
      id: 'documentation',
      alias: 'documentation',
      roots: [],
      state: 'missing',
      reason: 'There is no folder at /v. Check the location still exists.',
    },
    healthyTabs.tabs[3],
  ],
  projectDocs: [],
}

const fetchCalls: { url: string; body?: unknown }[] = []

function stubFetch(routes: Routes): void {
  vi.stubGlobal('fetch', vi.fn((input: string, init?: RequestInit) => {
    const url = input
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as unknown : undefined
    fetchCalls.push({ url, body })
    if (url === '/idealize/bar/aliases') return Promise.resolve(routes.aliases())
    if (url.startsWith('/idealize/bar/files?path=')) {
      return Promise.resolve(routes.listing(decodeURIComponent(url.split('=')[1] ?? '')))
    }
    if (url.startsWith('/idealize/bar/browse?path=')) {
      return Promise.resolve(routes.listing(decodeURIComponent(url.split('=')[1] ?? '')))
    }
    if (url === '/idealize/bar/browse') return Promise.resolve(jsonResponse({ root: { name: 'home', path: '/home/u' } }))
    if (url === '/idealize/bar/create') {
      return Promise.resolve(routes.create(body as { parent: string; name: string; kind: string }))
    }
    if (url === '/idealize/bar/reveal') return Promise.resolve(routes.reveal())
    if (url === '/idealize/bar/open') return Promise.resolve(routes.open(body as { path: string }))
    if (url === '/idealize/setup/project-docs') {
      return Promise.resolve(routes.projectDocs(body as { project: string; path: string }))
    }
    if (url === '/idealize/setup/alias') return Promise.resolve(routes.alias(body as { name: string; path: string }))
    const operation = /^\/idealize\/bar\/(rename|duplicate|move|trash)$/.exec(url)
    if (operation !== null) return Promise.resolve(routes.operate(operation[1]!, body as Record<string, string>))
    throw new Error(`unrouted fetch: ${url}`)
  }))
}

const defaultRoutes: Routes = {
  aliases: () => jsonResponse(healthyTabs),
  listing: path => jsonResponse({
    path,
    entries: [{ name: 'src', kind: 'dir' }, { name: 'notes.md', kind: 'file' }],
  }),
  create: body => jsonResponse({ ok: true, path: `${body.parent}/${body.name}` }),
  reveal: () => jsonResponse({ ok: true }),
  alias: () => jsonResponse({ ok: true, alias: { name: 'documentation', path: '/v2', accessState: 'ok' } }),
  operate: () => jsonResponse({ ok: true }),
  open: () => jsonResponse({ ok: true }),
  projectDocs: () => jsonResponse({ ok: true }),
}

/** Open All projects, then its documentation view: the vault. */
async function openAllDocumentation(view: ReturnType<typeof render>): Promise<void> {
  fireEvent.click(await view.findByRole('tab', { name: /^All projects/ }))
  fireEvent.click(view.getByRole('tab', { name: /^All documentation/ }))
}

/** A drag payload as the browser hands it to the handlers. */
function transferOf(path: string): DataTransfer {
  const data: Record<string, string> = { 'application/x-idealize-path': path, 'text/plain': path }
  return {
    types: Object.keys(data),
    getData: (type: string) => data[type] ?? '',
    setData: (type: string, value: string) => { data[type] = value },
    dropEffect: 'none',
    effectAllowed: 'all',
  } as unknown as DataTransfer
}

function mount(overrides: Partial<Props> = {}, routes: Partial<Routes> = {}) {
  stubFetch({ ...defaultRoutes, ...routes })
  const props: Props = {
    canReveal: true,
    canTrash: true,
    canOpenExternal: false,
    currentCwd: undefined,
    pickDirectory: vi.fn(() => Promise.resolve(null)),
    onOpenFile: vi.fn(),
    onAddToChat: vi.fn(() => true),
    onIdealize: vi.fn(),
    reveal: null,
    onRevealDone: vi.fn(),
    externalReload: 0,
    t,
    ...overrides,
  }
  return { view: render(<FilesPanel {...props} />), props }
}

beforeEach(() => { fetchCalls.length = 0 })

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('isValidEntryName', () => {
  it('accepts plain names and refuses climbing ones', () => {
    expect(isValidEntryName('notes.md')).toBe(true)
    expect(isValidEntryName('  spaced  ')).toBe(true)
    expect(isValidEntryName('')).toBe(false)
    expect(isValidEntryName('   ')).toBe(false)
    expect(isValidEntryName('..')).toBe(false)
    expect(isValidEntryName('.')).toBe(false)
    expect(isValidEntryName('a/b')).toBe(false)
    expect(isValidEntryName('a\\b')).toBe(false)
  })
})

describe('revealAncestors', () => {
  it('lists the folders between the root and the file, outermost first', () => {
    expect(revealAncestors('/w/proj', '/w/proj/Images/Archive/a.png')).toEqual(['/w/proj/Images', '/w/proj/Images/Archive'])
    expect(revealAncestors('/w/proj', '/w/proj/a.png')).toEqual([])
  })
})

describe('a reveal request', () => {
  /** A project holding `Images/2026-09-07_abc.png`; `Images/` lists only once asked. */
  const listing = (path: string): Response => jsonResponse({
    path,
    entries: path === '/w/proj/Images'
      ? [{ name: '2026-09-07_abc.png', kind: 'file' }]
      : path === '/v'
        ? [{ name: 'guide.md', kind: 'file' }]
        : [{ name: 'Images', kind: 'dir' }, { name: 'notes.md', kind: 'file' }],
  })
  const scrollIntoView = vi.fn()

  beforeEach(() => {
    scrollIntoView.mockClear()
    Element.prototype.scrollIntoView = scrollIntoView
  })

  it('opens the project tab down to the file, selects its folder, lights and scrolls to its row, then reports done', async () => {
    const onRevealDone = vi.fn()
    const { view } = mount({ reveal: { path: '/w/proj/Images/2026-09-07_abc.png', nonce: 1 }, onRevealDone }, { listing })
    const row = await view.findByText('2026-09-07_abc.png')
    const rowElement = row.closest('[data-path]')!
    expect(rowElement.hasAttribute('data-revealed')).toBe(true)
    expect(view.getByRole('button', { name: 'Images' }).getAttribute('aria-expanded')).toBe('true')
    // The file's folder is the creation target: New file would land beside it.
    expect(view.getByRole('button', { name: 'Images' }).hasAttribute('data-selected')).toBe(true)
    fireEvent.click(view.getByRole('button', { name: 'New file' }))
    expect(view.getByPlaceholderText('File name').closest('form')?.textContent).toContain('Images')
    fireEvent.click(view.getByRole('button', { name: 'Cancel' }))
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(onRevealDone).toHaveBeenCalledTimes(1)
    // The light goes out on the next click anywhere.
    fireEvent.pointerDown(document.body)
    expect(rowElement.hasAttribute('data-revealed')).toBe(false)
  })

  it('re-lists every loaded folder when the bar reports a landed artefact, so a new folder shows', async () => {
    let landed = false
    const { view, props } = mount({}, {
      listing: path => jsonResponse({
        path,
        entries: path === '/w/proj'
          ? (landed ? [{ name: 'Images', kind: 'dir' }, { name: 'Video', kind: 'dir' }] : [{ name: 'Images', kind: 'dir' }])
          : [],
      }),
    })
    await view.findByRole('button', { name: 'Images' })
    expect(view.queryByRole('button', { name: 'Video' })).toBeNull()
    landed = true
    view.rerender(<FilesPanel {...props} externalReload={1} />)
    await view.findByRole('button', { name: 'Video' })
  })

  it('re-lists the file\'s folder so a file newer than the listing shows', async () => {
    let served = false
    const { view, props } = mount({}, {
      listing: (path) => {
        if (path !== '/w/proj/Images') return listing(path)
        return jsonResponse({ path, entries: served ? [{ name: 'fresh.png', kind: 'file' }] : [] })
      },
    })
    await view.findByText('notes.md')
    fireEvent.click(view.getByRole('button', { name: 'Images' }))
    await waitFor(() => { expect(fetchCalls.some(call => call.url === `/idealize/bar/files?path=${encodeURIComponent('/w/proj/Images')}`)).toBe(true) })
    served = true
    view.rerender(<FilesPanel {...props} reveal={{ path: '/w/proj/Images/fresh.png', nonce: 1 }} />)
    const row = await view.findByText('fresh.png')
    expect(row.closest('[data-path]')!.hasAttribute('data-revealed')).toBe(true)
  })

  it('opens the folders between the root and a deeper file, and unfolds a folded root', async () => {
    const deep = (path: string): Response => jsonResponse({
      path,
      entries: path === '/w/a/Images/Archive'
        ? [{ name: 'old.png', kind: 'file' }]
        : path === '/w/a/Images'
          ? [{ name: 'Archive', kind: 'dir' }]
          : path === '/w/a'
            ? [{ name: 'Images', kind: 'dir' }]
            : [{ name: 'b.md', kind: 'file' }],
    })
    const { view, props } = mount({ currentCwd: undefined }, {
      aliases: () => jsonResponse({
        tabs: [
          { id: 'project', roots: [{ name: 'a', path: '/w/a' }, { name: 'b', path: '/w/b' }], state: 'ok' },
          ...healthyTabs.tabs.slice(1),
        ],
      }),
      listing: deep,
    })
    await view.findByText('b.md')
    // Fold `a` first: the reveal has to open it again.
    fireEvent.click(view.getByRole('button', { name: 'a' }))
    expect(view.queryByRole('button', { name: 'Images' })).toBeNull()
    view.rerender(<FilesPanel {...props} reveal={{ path: '/w/a/Images/Archive/old.png', nonce: 1 }} />)
    const row = await view.findByText('old.png')
    expect(row.closest('[data-path]')!.hasAttribute('data-revealed')).toBe(true)
    expect(view.getByRole('button', { name: 'Images' }).getAttribute('aria-expanded')).toBe('true')
    expect(view.getByRole('button', { name: 'Archive' }).getAttribute('aria-expanded')).toBe('true')
    expect(view.getByRole('button', { name: 'a' }).getAttribute('aria-expanded')).toBe('true')
  })

  it('does nothing further when the pane closes before the listing lands', async () => {
    const onRevealDone = vi.fn()
    // The file's folder answers only once released, after the pane has gone.
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const { view } = mount({ reveal: { path: '/w/proj/Images/2026-09-07_abc.png', nonce: 1 }, onRevealDone }, {
      listing: path => path === '/w/proj/Images'
        ? { ok: true, status: 200, json: () => gate.then(() => ({ entries: [{ name: '2026-09-07_abc.png', kind: 'file' }] })) } as Response
        : listing(path),
    })
    await view.findByText('notes.md')
    view.unmount()
    release!()
    await gate
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(onRevealDone).not.toHaveBeenCalled()
  })

  it('picks All documentation for a file under the vault', async () => {
    const { view } = mount({ reveal: { path: '/v/guide.md', nonce: 1 } }, { listing })
    const row = await view.findByText('guide.md')
    expect(row.closest('[data-path]')!.hasAttribute('data-revealed')).toBe(true)
    expect(view.getByRole('tab', { name: 'All projects' }).getAttribute('aria-selected')).toBe('true')
    expect(view.getByRole('tab', { name: 'All documentation' }).getAttribute('aria-selected')).toBe('true')
  })

  it('picks the project\'s own documentation before the vault that holds it', async () => {
    const { view } = mount({ reveal: { path: '/v/Projects/proj/plan.md', nonce: 1 } }, {
      listing: path => jsonResponse({ path, entries: path === '/v/Projects/proj' ? [{ name: 'plan.md', kind: 'file' }] : [] }),
    })
    const row = await view.findByText('plan.md')
    expect(row.closest('[data-path]')!.hasAttribute('data-revealed')).toBe(true)
    expect(view.getByRole('tab', { name: 'This project' }).getAttribute('aria-selected')).toBe('true')
    expect(view.getByRole('tab', { name: 'Documentation' }).getAttribute('aria-selected')).toBe('true')
  })

  it('says so, and reports done, for a path under no tab', async () => {
    const onRevealDone = vi.fn()
    const { view } = mount({ reveal: { path: '/elsewhere/x.png', nonce: 1 }, onRevealDone })
    expect(await view.findByText('That file isn’t under any of these folders')).toBeTruthy()
    expect(onRevealDone).toHaveBeenCalledTimes(1)
    expect(view.container.querySelector('[data-revealed]')).toBeNull()
  })
})

describe('currentProjectRoots', () => {
  const roots = [{ name: 'a', path: '/w/a' }, { name: 'b', path: '/w/b' }]

  it('narrows to the root holding the active chat, and keeps them all otherwise', () => {
    expect(currentProjectRoots(roots, '/w/b/src')).toEqual([roots[1]])
    expect(currentProjectRoots(roots, '/w/b')).toEqual([roots[1]])
    expect(currentProjectRoots(roots, undefined)).toEqual(roots)
    expect(currentProjectRoots(roots, '/elsewhere')).toEqual(roots)
    // A sibling with the same prefix is a different project, not a child.
    expect(currentProjectRoots([{ name: 'a', path: '/w/a' }], '/w/ab')).toEqual([{ name: 'a', path: '/w/a' }])
  })
})

describe('the two rows of tabs', () => {
  it('opens on the project with its contents listed, and lists each view on entry', async () => {
    const { view } = mount()
    const tabs = await view.findAllByRole('tab')
    expect(tabs.map(tab => tab.textContent)).toEqual(['This project', 'All projects', 'Skills', 'Project files', 'Documentation'])
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true')
    expect(tabs[3]!.getAttribute('aria-selected')).toBe('true')
    // The selected folder's contents show with no click; the toolbar names the
    // folder, so no root row repeats it.
    await view.findByText('notes.md')
    expect(view.queryByRole('button', { name: /proj/ })).toBeNull()
    expect(view.getByText('proj')).toBeTruthy()

    // All projects keeps the second row, relabelled, and lists the projects root.
    fireEvent.click(tabs[1]!)
    await waitFor(() => {
      expect(fetchCalls.some(call => call.url === `/idealize/bar/files?path=${encodeURIComponent('/w')}`)).toBe(true)
    })
    expect(view.queryByRole('button', { name: /Projects/ })).toBeNull()
    expect(view.getAllByRole('tab').slice(3).map(tab => tab.textContent)).toEqual(['All project files', 'All documentation'])

    fireEvent.click(view.getByRole('tab', { name: 'All documentation' }))
    await waitFor(() => {
      expect(fetchCalls.some(call => call.url === `/idealize/bar/files?path=${encodeURIComponent('/v')}`)).toBe(true)
    })
    expect(view.queryByRole('button', { name: /vault/ })).toBeNull()

    // The choice of documentation rides along to the other scope.
    fireEvent.click(tabs[0]!)
    expect(view.getByRole('tab', { name: 'Documentation' }).getAttribute('aria-selected')).toBe('true')
    await waitFor(() => {
      expect(fetchCalls.some(call => call.url === `/idealize/bar/files?path=${encodeURIComponent('/v/Projects/proj')}`)).toBe(true)
    })

    // The skills folder has one view, so the second row goes.
    fireEvent.click(tabs[2]!)
    expect(view.getAllByRole('tab')).toHaveLength(3)
  })

  it('shows only the current project on the project tab', async () => {
    const { view } = mount({ currentCwd: '/w/proj/src' }, {
      aliases: () => jsonResponse({
        tabs: [
          {
            id: 'project',
            roots: [{ name: 'proj', path: '/w/proj' }, { name: 'other', path: '/w/other' }],
            state: 'ok',
          },
          ...healthyTabs.tabs.slice(1),
        ],
      }),
    })
    await waitFor(() => {
      expect(fetchCalls.some(call => call.url === `/idealize/bar/files?path=${encodeURIComponent('/w/proj')}`)).toBe(true)
    })
    expect(fetchCalls.some(call => call.url === `/idealize/bar/files?path=${encodeURIComponent('/w/other')}`)).toBe(false)
    expect(view.queryByRole('button', { name: /other/ })).toBeNull()
  })

  it('renders several project roots as rows, open by default and folding on a click', async () => {
    const { view } = mount({ currentCwd: undefined }, {
      aliases: () => jsonResponse({
        tabs: [
          {
            id: 'project',
            roots: [{ name: 'a', path: '/w/a' }, { name: 'b', path: '/w/b' }],
            state: 'ok',
          },
          ...healthyTabs.tabs.slice(1),
        ],
      }),
      listing: path => jsonResponse({
        path,
        entries: [{ name: path === '/w/a' ? 'a.md' : 'b.md', kind: 'file' }],
      }),
    })
    // Both roots list themselves and render open.
    await view.findByText('a.md')
    await view.findByText('b.md')
    // A click on a root row is a fold, remembered until the next click.
    fireEvent.click(view.getByRole('button', { name: 'a' }))
    expect(view.queryByText('a.md')).toBeNull()
    expect(view.getByText('b.md')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'a' }))
    expect(await view.findByText('a.md')).toBeTruthy()
  })
})

describe('viewOf, opensInApp and the documentation roots', () => {
  it('maps a scope and a kind to one view, the skills folder having one', () => {
    expect(viewOf('project', 'files')).toBe('project')
    expect(viewOf('project', 'docs')).toBe('projectDocs')
    expect(viewOf('all', 'files')).toBe('projectsRoot')
    expect(viewOf('all', 'docs')).toBe('documentation')
    expect(viewOf('skills', 'docs')).toBe('skills')
  })

  it('keeps Markdown and images in the viewer and nothing else', () => {
    for (const name of ['notes.md', '/w/proj/README.MD', 'a.markdown', 'shot.png', 'photo.JPEG', 'mark.svg', 'anim.gif']) {
      expect(opensInApp(name), name).toBe(true)
    }
    for (const name of ['brief.pdf', 'deck.pptx', 'sheet.xlsx', 'index.ts', 'data.json', 'LICENSE', '.gitignore', '/w/my.md/file', 'clip.mp4']) {
      expect(opensInApp(name), name).toBe(false)
    }
  })

  it('narrows the documentation folders to the current project and names several by project', () => {
    const alpha = { project: { name: 'Alpha', path: '/w/a' }, folder: '/v/Projects/Alpha', source: 'note' as const, state: 'ok' as const }
    const beta = { project: { name: 'Beta', path: '/w/b' }, folder: '/elsewhere/docs', source: 'chosen' as const, state: 'ok' as const }
    const gamma = { project: { name: 'Gamma', path: '/w/c' }, state: 'unset' as const }
    const dead = { project: { name: 'Delta', path: '/w/d' }, folder: '/gone', source: 'chosen' as const, state: 'missing' as const }
    expect(currentProjectDocs([alpha, beta, gamma], [{ name: 'Beta', path: '/w/b' }])).toEqual([beta])
    expect(projectDocsRoots([alpha])).toEqual([{ name: 'Alpha', path: '/v/Projects/Alpha' }])
    expect(projectDocsRoots([beta])).toEqual([{ name: 'docs', path: '/elsewhere/docs' }])
    expect(projectDocsRoots([alpha, beta, gamma, dead])).toEqual([
      { name: 'Alpha', path: '/v/Projects/Alpha' },
      { name: 'Beta', path: '/elsewhere/docs' },
    ])
  })
})

describe("a project's documentation folder", () => {
  it('lists the resolved folder, names it, and changes it through the picker', async () => {
    let served = healthyTabs as unknown
    const pickDirectory = vi.fn(() => Promise.resolve('/elsewhere/docs'))
    const { view } = mount({ pickDirectory, currentCwd: '/w/proj' }, { aliases: () => jsonResponse(served) })
    fireEvent.click(await view.findByRole('tab', { name: 'Documentation' }))
    await waitFor(() => {
      expect(fetchCalls.some(call => call.url === `/idealize/bar/files?path=${encodeURIComponent('/v/Projects/proj')}`)).toBe(true)
    })
    expect(view.getByText('/v/Projects/proj')).toBeTruthy()
    // A folder found in the vault is the default already.
    expect(view.queryByRole('button', { name: 'Use the default folder' })).toBeNull()

    served = {
      ...healthyTabs,
      projectDocs: [{ project: { name: 'proj', path: '/w/proj' }, folder: '/elsewhere/docs', source: 'chosen', state: 'ok' }],
    }
    fireEvent.click(view.getByRole('button', { name: 'Change folder' }))
    expect(await view.findByText('Documentation folder set')).toBeTruthy()
    expect(fetchCalls.find(call => call.url === '/idealize/setup/project-docs')?.body)
      .toEqual({ project: '/w/proj', path: '/elsewhere/docs' })
    await waitFor(() => {
      expect(fetchCalls.some(call => call.url === `/idealize/bar/files?path=${encodeURIComponent('/elsewhere/docs')}`)).toBe(true)
    })

    // A chosen folder can go back to the vault's: the write carries an empty path and no picker.
    served = healthyTabs
    fireEvent.click(view.getByRole('button', { name: 'Use the default folder' }))
    expect(await view.findByText('Back to the default documentation folder')).toBeTruthy()
    expect(fetchCalls.filter(call => call.url === '/idealize/setup/project-docs').at(-1)?.body)
      .toEqual({ project: '/w/proj', path: '' })
    expect(pickDirectory).toHaveBeenCalledTimes(1)
  })

  it('offers Choose folder for a project with none, and shows a refusal verbatim', async () => {
    const { view } = mount({ pickDirectory: vi.fn(() => Promise.resolve('/nope')) }, {
      aliases: () => jsonResponse({ ...healthyTabs, projectDocs: [{ project: { name: 'proj', path: '/w/proj' }, state: 'unset' }] }),
      projectDocs: () => jsonResponse({ ok: false, failure: { accessState: 'unwritable', reason: 'IDEalize cannot save files inside /nope.' } }, 400),
    })
    fireEvent.click(await view.findByRole('tab', { name: 'Documentation' }))
    expect(await view.findByText(/This project has no documentation folder yet/)).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Choose folder' }))
    expect(await view.findByText('IDEalize cannot save files inside /nope.')).toBeTruthy()
  })

  it('says which chosen folder died and offers both ways out', async () => {
    const { view } = mount({}, {
      aliases: () => jsonResponse({
        ...healthyTabs,
        projectDocs: [{
          project: { name: 'proj', path: '/w/proj' }, folder: '/gone', source: 'chosen', state: 'missing',
          reason: 'There is no folder at /gone. Check the location still exists.',
        }],
      }),
    })
    fireEvent.click(await view.findByRole('tab', { name: 'Documentation' }))
    expect(await view.findByText(/There is no folder at \/gone/)).toBeTruthy()
    expect(view.getByRole('button', { name: 'Choose folder' })).toBeTruthy()
    expect(view.getByRole('button', { name: 'Use the default folder' })).toBeTruthy()
  })

  it('lists every project\'s folder and offers no choice while several projects show', async () => {
    const { view } = mount({}, {
      aliases: () => jsonResponse({
        tabs: [
          { id: 'project', roots: [{ name: 'Alpha', path: '/w/a' }, { name: 'Beta', path: '/w/b' }], state: 'ok' },
          ...healthyTabs.tabs.slice(1),
        ],
        projectDocs: [
          { project: { name: 'Alpha', path: '/w/a' }, folder: '/v/Projects/Alpha', source: 'note', state: 'ok' },
          { project: { name: 'Beta', path: '/w/b' }, state: 'unset' },
        ],
      }),
    })
    fireEvent.click(await view.findByRole('tab', { name: 'Documentation' }))
    await waitFor(() => {
      expect(fetchCalls.some(call => call.url === `/idealize/bar/files?path=${encodeURIComponent('/v/Projects/Alpha')}`)).toBe(true)
    })
    expect(view.queryByRole('button', { name: 'Change folder' })).toBeNull()
  })
})

describe('opening a file', () => {
  const listing = (path: string): Response => jsonResponse({
    path,
    entries: [{ name: 'brief.pdf', kind: 'file' }, { name: 'notes.md', kind: 'file' }, { name: 'shot.png', kind: 'file' }],
  })

  it('keeps Markdown and images in the viewer and hands the rest to the default application', async () => {
    const { view, props } = mount({ canOpenExternal: true }, { listing })
    fireEvent.click(await view.findByText('notes.md'))
    fireEvent.click(view.getByText('shot.png'))
    expect(props.onOpenFile).toHaveBeenCalledTimes(2)
    expect(fetchCalls.some(call => call.url === '/idealize/bar/open')).toBe(false)

    fireEvent.click(view.getByText('brief.pdf'))
    expect(await view.findByText('Opened in its default app')).toBeTruthy()
    expect(fetchCalls.find(call => call.url === '/idealize/bar/open')?.body).toEqual({ path: '/w/proj/brief.pdf' })
    expect(props.onOpenFile).toHaveBeenCalledTimes(2)
  })

  it('opens every file in the viewer where the host has no default-application launch', async () => {
    const { view, props } = mount({ canOpenExternal: false }, { listing })
    fireEvent.click(await view.findByText('brief.pdf'))
    expect(props.onOpenFile).toHaveBeenCalledWith('/w/proj/brief.pdf')
    expect(fetchCalls.some(call => call.url === '/idealize/bar/open')).toBe(false)
  })

  it('falls back to the viewer when the host refuses the file or cannot be reached', async () => {
    const refused = mount({ canOpenExternal: true }, { listing, open: () => jsonResponse({ error: 'no application opens this file' }, 422) })
    fireEvent.click(await refused.view.findByText('brief.pdf'))
    await waitFor(() => { expect(refused.props.onOpenFile).toHaveBeenCalledWith('/w/proj/brief.pdf') })
    cleanup()

    const unreachable = mount({ canOpenExternal: true }, { listing, open: () => Promise.reject(new Error('offline')) })
    fireEvent.click(await unreachable.view.findByText('brief.pdf'))
    await waitFor(() => { expect(unreachable.props.onOpenFile).toHaveBeenCalledWith('/w/proj/brief.pdf') })
  })

  it('offers Open in IDEalize on the menu of a file that would leave', async () => {
    const { view, props } = mount({ canOpenExternal: true }, { listing })
    fireEvent.contextMenu(await view.findByText('notes.md'))
    expect(view.queryByRole('menuitem', { name: 'Open in IDEalize' })).toBeNull()
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.contextMenu(view.getByText('brief.pdf'))
    fireEvent.click(view.getByRole('menuitem', { name: 'Open in IDEalize' }))
    expect(props.onOpenFile).toHaveBeenCalledWith('/w/proj/brief.pdf')
    expect(fetchCalls.some(call => call.url === '/idealize/bar/open')).toBe(false)
  })
})

describe('a dead alias (FIL-07 / AC-27)', () => {
  it('keeps its tab, explains the failure, and reconnects through the picker', async () => {
    let served = deadDocsTabs as unknown
    const pickDirectory = vi.fn(() => Promise.resolve('/v2'))
    const { view } = mount({ pickDirectory }, { aliases: () => jsonResponse(served) })

    const tabs = await view.findAllByRole('tab')
    expect(tabs).toHaveLength(5)
    // The dot rides the scope that holds the dead folder.
    expect(view.getByRole('tab', { name: /^All projects/ }).querySelector('[role="img"]')).not.toBeNull()
    await openAllDocumentation(view)

    expect(await view.findByText(/There is no folder at \/v/)).toBeTruthy()
    served = {
      tabs: [healthyTabs.tabs[0], healthyTabs.tabs[1], { ...healthyTabs.tabs[2], roots: [{ name: 'vault', path: '/v2' }] }, healthyTabs.tabs[3]],
      projectDocs: [],
    }
    fireEvent.click(view.getByRole('button', { name: 'Choose the folder again' }))

    await waitFor(() => {
      expect(fetchCalls.some(call => call.url === '/idealize/setup/alias')).toBe(true)
    })
    expect(pickDirectory).toHaveBeenCalled()
    expect(fetchCalls.find(call => call.url === '/idealize/setup/alias')?.body)
      .toEqual({ name: 'documentation', path: '/v2' })
    expect(await view.findByText('Folder reconnected')).toBeTruthy()
    // The reconnected folder lists itself straight away.
    await waitFor(() => {
      expect(fetchCalls.some(call => call.url === `/idealize/bar/files?path=${encodeURIComponent('/v2')}`)).toBe(true)
    })
  })

  it('shows the host refusal verbatim when the chosen folder fails its probe', async () => {
    const { view } = mount({ pickDirectory: vi.fn(() => Promise.resolve('/nope')) }, {
      aliases: () => jsonResponse(deadDocsTabs),
      alias: () => jsonResponse({ ok: false, failure: { accessState: 'unwritable', reason: 'IDEalize cannot save files inside /nope.' } }, 400),
    })
    await openAllDocumentation(view)
    fireEvent.click(await view.findByRole('button', { name: 'Choose the folder again' }))
    expect(await view.findByText('IDEalize cannot save files inside /nope.')).toBeTruthy()
  })

  it('stays put when the picker is dismissed or the shell has none', async () => {
    const { view } = mount({ pickDirectory: vi.fn(() => Promise.reject(new Error('no picker'))) }, {
      aliases: () => jsonResponse(deadDocsTabs),
    })
    await openAllDocumentation(view)
    fireEvent.click(await view.findByRole('button', { name: 'Choose the folder again' }))
    expect(await view.findByText('Couldn’t reconnect that folder')).toBeTruthy()
    expect(fetchCalls.some(call => call.url === '/idealize/setup/alias')).toBe(false)
  })
})

describe('FilesPanel', () => {
  it('shows loading, then the project tree, then a listing error surface', async () => {
    const { view } = mount({}, {
      listing: () => jsonResponse({ error: 'nope' }, 500),
    })
    expect(view.getByText('Reading…')).toBeTruthy()
    // The project folder lists itself, so its failure surfaces with no click.
    expect(await view.findByText('Couldn’t read this folder')).toBeTruthy()
  })

  it('shows the roots error when the tab fetch fails', async () => {
    const { view } = mount({}, { aliases: () => jsonResponse({ error: 'x' }, 500) })
    expect(await view.findByText('Couldn’t read the project folders')).toBeTruthy()
  })

  it('creates a folder in the selected directory and re-lists it', async () => {
    const { view } = mount()
    await view.findByText('notes.md')
    fireEvent.click(view.getByRole('button', { name: 'New folder' }))
    fireEvent.change(view.getByPlaceholderText('Folder name'), { target: { value: 'docs' } })
    fireEvent.click(view.getByRole('button', { name: 'Create' }))
    await waitFor(() => {
      expect(fetchCalls.some(call => call.url === '/idealize/bar/create')).toBe(true)
    })
    const create = fetchCalls.find(call => call.url === '/idealize/bar/create')
    expect(create?.body).toEqual({ parent: '/w/proj', name: 'docs', kind: 'dir' })
    // The parent is re-listed (beyond its self-listing) so the new entry shows.
    await waitFor(() => {
      expect(fetchCalls.filter(call => call.url === `/idealize/bar/files?path=${encodeURIComponent('/w/proj')}`).length).toBeGreaterThan(1)
    })
  })

  it('refuses a climbing name and keeps Create disabled', async () => {
    const { view } = mount()
    await view.findByText('notes.md')
    fireEvent.click(view.getByRole('button', { name: 'New file' }))
    fireEvent.change(view.getByPlaceholderText('File name'), { target: { value: '../escape' } })
    expect(view.getByText('Names can’t be empty or contain / or ..')).toBeTruthy()
    expect((view.getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(true)
    expect(fetchCalls.some(call => call.url === '/idealize/bar/create')).toBe(false)
  })

  it('surfaces a duplicate-name refusal from the host', async () => {
    const { view } = mount({}, { create: () => jsonResponse({ error: 'already exists' }, 409) })
    await view.findByText('notes.md')
    fireEvent.click(view.getByRole('button', { name: 'New file' }))
    fireEvent.change(view.getByPlaceholderText('File name'), { target: { value: 'notes.md' } })
    fireEvent.click(view.getByRole('button', { name: 'Create' }))
    expect(await view.findByText('Something with that name already exists')).toBeTruthy()
  })

  it('opens a created file in the viewer', async () => {
    const { view, props } = mount()
    await view.findByText('notes.md')
    fireEvent.click(view.getByRole('button', { name: 'New file' }))
    fireEvent.change(view.getByPlaceholderText('File name'), { target: { value: 'todo.md' } })
    fireEvent.click(view.getByRole('button', { name: 'Create' }))
    await waitFor(() => { expect(props.onOpenFile).toHaveBeenCalledWith('/w/proj/todo.md') })
  })

  it('hands a file to the composer and confirms, or reports no chat', async () => {
    const { view, props } = mount()
    await view.findByText('notes.md')
    fireEvent.click(view.getAllByRole('button', { name: 'Add to chat' })[0]!)
    expect(props.onAddToChat).toHaveBeenCalledWith('/w/proj/notes.md')
    expect(await view.findByText('Path added to the composer')).toBeTruthy()
  })

  it('reports when no chat can receive the file', async () => {
    const { view } = mount({ onAddToChat: vi.fn(() => false) })
    await view.findByText('notes.md')
    fireEvent.click(view.getAllByRole('button', { name: 'Add to chat' })[0]!)
    expect(await view.findByText('Open a chat first')).toBeTruthy()
  })

  it('opens a context menu on right-click with the file and folder actions', async () => {
    const { view, props } = mount()
    await view.findByText('notes.md')
    fireEvent.contextMenu(view.getByText('notes.md'))
    expect(await view.findByRole('menu', { name: 'File actions' })).toBeTruthy()
    expect(view.getAllByRole('menuitem').map(item => item.textContent)).toEqual([
      'Open', 'Add to chat', 'Reveal in Finder', 'Copy path', 'Rename…', 'Duplicate', 'Move to Trash',
    ])
    fireEvent.click(view.getByRole('menuitem', { name: 'Add to chat' }))
    expect(props.onAddToChat).toHaveBeenCalledWith('/w/proj/notes.md')
    expect(view.queryByRole('menu')).toBeNull()
    // A folder's menu creates inside it instead of opening it.
    fireEvent.contextMenu(view.getByText('src'))
    expect((await view.findAllByRole('menuitem')).map(item => item.textContent)).toEqual([
      'Reveal in Finder', 'Copy path', 'Idealize this', 'New file here', 'New folder here', 'Rename…', 'Duplicate', 'Move to Trash',
    ])
    // Only a folder can become a project, so only a folder's menu offers it.
    fireEvent.click(view.getByRole('menuitem', { name: 'Idealize this' }))
    expect(props.onIdealize).toHaveBeenCalledWith('/w/proj/src')
    fireEvent.contextMenu(view.getByText('src'))
    fireEvent.click(view.getByRole('menuitem', { name: 'New file here' }))
    const sheet = view.getByPlaceholderText('File name')
    expect(sheet.closest('form')?.textContent).toContain('src')
  })

  it('opens a file from its menu, and hides Move to Trash where the Finder is absent', async () => {
    const { view, props } = mount({ canTrash: false })
    await view.findByText('notes.md')
    fireEvent.contextMenu(view.getByText('notes.md'))
    expect(view.queryByRole('menuitem', { name: 'Move to Trash' })).toBeNull()
    fireEvent.click(await view.findByRole('menuitem', { name: 'Open' }))
    expect(props.onOpenFile).toHaveBeenCalledWith('/w/proj/notes.md')
  })

  it('renames through the name sheet, seeded with the current name', async () => {
    const { view } = mount()
    await view.findByText('notes.md')
    fireEvent.contextMenu(view.getByText('notes.md'))
    fireEvent.click(await view.findByRole('menuitem', { name: 'Rename…' }))
    const input = view.getByDisplayValue('notes.md')
    fireEvent.change(input, { target: { value: 'ideas.md' } })
    fireEvent.click(view.getByRole('button', { name: 'Rename…' }))
    await waitFor(() => {
      expect(fetchCalls.find(call => call.url === '/idealize/bar/rename')?.body).toEqual({ path: '/w/proj/notes.md', name: 'ideas.md' })
    })
    expect(await view.findByText('Renamed')).toBeTruthy()
    expect(view.queryByDisplayValue('ideas.md')).toBeNull()
    // The parent is re-listed.
    expect(fetchCalls.filter(call => call.url === '/idealize/bar/files?path=%2Fw%2Fproj').length).toBeGreaterThan(1)
  })

  it('duplicates from the menu and surfaces the host refusal', async () => {
    const { view } = mount({}, { operate: route => (route === 'duplicate' ? jsonResponse({ error: 'no' }, 500) : jsonResponse({ ok: true })) })
    await view.findByText('notes.md')
    fireEvent.contextMenu(view.getByText('notes.md'))
    fireEvent.click(await view.findByRole('menuitem', { name: 'Duplicate' }))
    expect(await view.findByText('Could not duplicate.')).toBeTruthy()
    expect(fetchCalls.find(call => call.url === '/idealize/bar/duplicate')?.body).toEqual({ path: '/w/proj/notes.md' })
  })

  it('moves to Trash on the second click only, and the menu stays up in between', async () => {
    const { view } = mount()
    await view.findByText('notes.md')
    fireEvent.contextMenu(view.getByText('notes.md'))
    const item = await view.findByRole('menuitem', { name: 'Move to Trash' })
    fireEvent.click(item)
    expect(fetchCalls.some(call => call.url === '/idealize/bar/trash')).toBe(false)
    expect(view.getByRole('menuitem', { name: 'Click again to move to Trash' })).toBeTruthy()
    fireEvent.click(view.getByRole('menuitem', { name: 'Click again to move to Trash' }))
    await waitFor(() => { expect(fetchCalls.find(call => call.url === '/idealize/bar/trash')?.body).toEqual({ path: '/w/proj/notes.md' }) })
    expect(await view.findByText('Moved to Trash')).toBeTruthy()
    expect(view.queryByRole('menu')).toBeNull()
  })

  it('drags a row onto a folder as a move, and refuses a drop on its own folder', async () => {
    const { view } = mount()
    await view.findByText('notes.md')
    const fileRow = view.getByText('notes.md').closest('[data-path]')!
    expect(fileRow.getAttribute('draggable')).toBe('true')
    const transfer = transferOf('/w/proj/notes.md')
    fireEvent.dragStart(fileRow, { dataTransfer: transfer })
    const folderRow = view.getByText('src').closest('[data-path]')!
    fireEvent.dragOver(folderRow, { dataTransfer: transfer })
    expect(folderRow.hasAttribute('data-drop-target')).toBe(true)
    fireEvent.drop(folderRow, { dataTransfer: transfer })
    await waitFor(() => {
      expect(fetchCalls.find(call => call.url === '/idealize/bar/move')?.body).toEqual({ path: '/w/proj/notes.md', parent: '/w/proj/src' })
    })
    expect(await view.findByText('Moved')).toBeTruthy()
    expect(folderRow.hasAttribute('data-drop-target')).toBe(false)
    // Dropped back on the folder it is already in — the tree background, which
    // carries the lone root's drop zone: nothing is posted.
    const moves = fetchCalls.filter(call => call.url === '/idealize/bar/move').length
    const background = view.container.querySelector('[data-path="/w/proj"]')!
    fireEvent.drop(background, { dataTransfer: transfer })
    expect(fetchCalls.filter(call => call.url === '/idealize/bar/move').length).toBe(moves)
    // A nested entry dropped on the background moves to the root folder.
    fireEvent.drop(background, { dataTransfer: transferOf('/w/proj/src/inner.md') })
    await waitFor(() => {
      expect(fetchCalls.filter(call => call.url === '/idealize/bar/move').length).toBe(moves + 1)
    })
    expect(fetchCalls.filter(call => call.url === '/idealize/bar/move').at(-1)?.body)
      .toEqual({ path: '/w/proj/src/inner.md', parent: '/w/proj' })
  })

  it('opens the root folder menu from a right-click on the tree background', async () => {
    const { view } = mount()
    await view.findByText('notes.md')
    fireEvent.contextMenu(view.container.querySelector('[data-path="/w/proj"]')!)
    expect(await view.findByRole('menu', { name: 'File actions' })).toBeTruthy()
    fireEvent.click(view.getByRole('menuitem', { name: 'New file here' }))
    expect(view.getByPlaceholderText('File name').closest('form')?.textContent).toContain('proj')
  })

  it('copies a row path from the context menu and confirms', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const { view } = mount()
    await view.findByText('notes.md')
    fireEvent.contextMenu(view.getByText('notes.md'))
    fireEvent.click(await view.findByRole('menuitem', { name: 'Copy path' }))
    expect(writeText).toHaveBeenCalledWith('/w/proj/notes.md')
    expect(await view.findByText('Path copied')).toBeTruthy()
  })

  it('re-lists loaded directories from the toolbar Refresh and toggles the browse pane from its icon', async () => {
    const { view } = mount()
    await view.findByText('notes.md')
    const listUrl = `/idealize/bar/files?path=${encodeURIComponent('/w/proj')}`
    const before = fetchCalls.filter(call => call.url === listUrl).length
    fireEvent.click(view.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => {
      expect(fetchCalls.filter(call => call.url === listUrl).length).toBe(before + 1)
    })
    // The toolbar's browse icon opens the browse pane (same state as the
    // section header), and the home folder lists itself straight away.
    fireEvent.click(view.getAllByRole('button', { name: 'Browse this computer' })[0]!)
    await waitFor(() => {
      expect(fetchCalls.some(call => call.url === `/idealize/bar/browse?path=${encodeURIComponent('/home/u')}`)).toBe(true)
    })
    expect((await view.findAllByText('notes.md')).length).toBe(2)
  })

  it('offers reveal on every row and surfaces its failure', async () => {
    const { view } = mount({}, { reveal: () => jsonResponse({ error: 'gone' }, 403) })
    await view.findByText('notes.md')
    // The dir row and the file row both carry the action.
    const reveals = view.getAllByRole('button', { name: 'Reveal in Finder' })
    expect(reveals.length).toBeGreaterThanOrEqual(2)
    fireEvent.click(reveals[reveals.length - 1]!)
    expect(await view.findByText('Couldn’t reveal in Finder')).toBeTruthy()
    // The row menu reaches the same route.
    const posted = fetchCalls.filter(call => call.url === '/idealize/bar/reveal').length
    fireEvent.contextMenu(view.getByText('notes.md'))
    fireEvent.click(await view.findByRole('menuitem', { name: 'Reveal in Finder' }))
    await waitFor(() => { expect(fetchCalls.filter(call => call.url === '/idealize/bar/reveal').length).toBe(posted + 1) })
  })
})
