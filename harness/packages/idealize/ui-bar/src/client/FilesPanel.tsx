/**
 * The files panel: V0's two file windows in one drawer. A three-tab tree
 * rides on top — the current project, the projects root, and the
 * documentation vault, the last two being the folders first run captured as
 * workspace aliases — over the same fenced listing route. Each tab opens on
 * its folder's contents: the toolbar names the folder and the tree lists it
 * straight away, so a lone root renders no row of its own and several roots
 * keep their rows, open until folded. The subordinate browse pane
 * (home root, home-plus-roots fence) stacks beneath it, collapsed until
 * opened. Clicking any file opens it in the deck's viewer panel (a separate
 * resizable column, per V0). The toolbar creates files and folders in the
 * selected directory (V0's header-button + name-sheet pattern); every row
 * offers Reveal in Finder and files offer Add to chat on hover; the row menu
 * adds Open, Rename, Duplicate, New here and Move to Trash, and rows drag
 * between the two trees (a move) and into the composer (Add to chat). An alias
 * whose folder has gone keeps its tab and offers Reconnect, which picks a
 * replacement folder and writes it back through @idealize/setup's alias
 * route. A reveal request (`ctx.idealizeBar.revealFile`, raised by a
 * gallery's Reveal) opens the tab whose root holds the file, expands the way
 * down to it, selects its folder and lights its row until the next click. The
 * agent still does the editing — this panel keeps the project's shape
 * visible.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type React from 'react'
import {
  IconChevronDownOutline14, IconChevronRightOutline14, IconFolderClose16, IconFolderOpen16,
  IconPlusOutline16, IconRightUpOutline14, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { BarKey } from './locales.ts'
import type { RevealRequest } from './bar-store.ts'
import { BarIconBrowse, BarIconFilePlus, BarIconFolderPlus, BarIconRefresh } from './BarIcons.tsx'
import css from './FilesPanel.module.css'

/** The bar namespace's bound translate seat, passed down as a plain prop. */
type BarTranslate = PropsLocale<'idealize-bar'>['t']

/**
 * The drag payload type a Files row sets: its absolute path. The trees accept
 * it as a move and the composer card as Add to chat; `text/plain` rides along
 * so a drop anywhere else pastes the path.
 */
export const FILE_DRAG_TYPE = 'application/x-idealize-path'

/** Whether a drag carries a Files row. */
function carriesEntry(transfer: DataTransfer): boolean {
  return Array.from(transfer.types).includes(FILE_DRAG_TYPE)
}

interface RootEntry {
  name: string
  path: string
}

interface ListEntry {
  name: string
  kind: 'dir' | 'file'
}

/** Which Files tab; also the suffix of its label's locale key. */
type TabId = 'project' | 'projectsRoot' | 'documentation' | 'skills'

/**
 * One tab as `GET /idealize/bar/aliases` reports it: its tree roots plus the
 * live access verdict of the alias behind it. `roots` is empty exactly when
 * there is nothing to browse — an uncaptured alias (`state: 'unset'`) or one
 * whose folder failed its probe, both of which render Reconnect instead.
 */
interface AliasTab {
  id: TabId
  /** The alias to rewrite on Reconnect; absent on the project tab. */
  alias?: 'projectsRoot' | 'documentation' | 'skills'
  roots: RootEntry[]
  state: 'ok' | 'unset' | 'missing' | 'not-a-directory' | 'unreadable' | 'unwritable'
  /** The host's plain-language failure sentence, shown verbatim. */
  reason?: string
}

/** Tab labels, in header order. */
const TAB_LABELS: Readonly<Record<TabId, 'files.tab.project' | 'files.tab.projects' | 'files.tab.docs' | 'files.tab.skills'>> = {
  project: 'files.tab.project',
  projectsRoot: 'files.tab.projects',
  documentation: 'files.tab.docs',
  skills: 'files.tab.skills',
}

/** One directory re-list request; a bumped nonce re-fetches `path`'s listing. */
interface RefreshSignal {
  path: string
  nonce: number
}

/** How long a revealed row stays lit when nothing is clicked. */
const REVEAL_HIGHLIGHT_MS = 4000

/**
 * The folders a reveal has to open between a tree root and a file: every
 * directory strictly below the root on the way to the file's own folder,
 * outermost first. A file directly under the root needs none.
 * @param root - the tree root holding the file.
 * @param path - the file's absolute path, under `root`.
 * @returns the ancestor directories, outermost first.
 */
export function revealAncestors(root: string, path: string): string[] {
  const segments = path.slice(root.length + 1).split('/')
  segments.pop()
  const ancestors: string[] = []
  let current = root
  for (const segment of segments) {
    current = `${current}/${segment}`
    ancestors.push(current)
  }
  return ancestors
}

/**
 * Client half of the host route's single-component name rule: creation
 * refuses empty names and anything that could climb out of the parent.
 * @param raw - candidate name as typed.
 * @returns whether the trimmed name is a safe single path component.
 */
export function isValidEntryName(raw: string): boolean {
  const name = raw.trim()
  return name !== '' && name !== '.' && name !== '..'
    && !name.includes('/') && !name.includes('\\')
}

/**
 * One lazy tree over a listing endpoint. Roots list themselves and render
 * open — explicit user folds are the recorded state, per the sidebar's
 * collapsedGroups precedent — and a lone root renders its contents directly,
 * since the pane's header already names it. Deeper expansion and every
 * listing are local state; both the project tree and the browse pane are
 * instances of this.
 */
function LazyTree({
  endpoint, roots, canReveal, selectedDir, refresh, reloadNonce, reveal, onRevealed,
  onOpenFile, onReveal, onAddToChat, onRowMenu, onDropEntry, onSelectDir, t,
}: {
  endpoint: string
  roots: RootEntry[]
  /** Show the reveal action on rows (macOS only). */
  canReveal: boolean
  /** Highlighted creation target (path). */
  selectedDir: string | undefined
  /** Re-list request from the panel (after a create). */
  refresh: RefreshSignal | undefined
  /** Toolbar Refresh: a bump re-lists every directory this tree has loaded. */
  reloadNonce: number
  /** A file to open the way down to and light; the panel hands it to the tab tree alone. */
  reveal: RevealRequest | null
  /** The revealed file's folder has been listed and its row marked. */
  onRevealed: () => void
  onOpenFile: (path: string) => void
  onReveal: (path: string) => void
  onAddToChat: (path: string) => void
  /** Right-click on a row: open the panel's context menu at the pointer. */
  onRowMenu: (path: string, kind: 'dir' | 'file', x: number, y: number) => void
  /** A row dropped on a folder: move the entry into it. */
  onDropEntry: (path: string, parent: string) => void
  onSelectDir: (dir: RootEntry) => void
  t: BarTranslate
}) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  /** Root folders a user explicitly folded; a root is open unless it is here. */
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set())
  const [listings, setListings] = useState<Readonly<Record<string, ListEntry[] | 'error'>>>({})

  /** Fetch one directory's listing into state; settles once the listing (or its error) is recorded. */
  const list = useCallback((path: string): Promise<void> => fetch(`${endpoint}?path=${encodeURIComponent(path)}`)
    .then(response => response.ok
      ? response.json() as Promise<{ entries: ListEntry[] }>
      : Promise.reject(new Error('listing failed')))
    .then((body) => { setListings(current => ({ ...current, [path]: body.entries })) })
    .catch(() => { setListings(current => ({ ...current, [path]: 'error' })) }), [endpoint])

  const toggleDir = useCallback((path: string) => {
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(path)) {
        next.delete(path)
        return next
      }
      next.add(path)
      return next
    })
    setListings((previous) => {
      if (previous[path] === undefined) void list(path)
      return previous
    })
  }, [list])

  const toggleRoot = useCallback((path: string) => {
    setFolded((previous) => {
      const next = new Set(previous)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  // Roots list themselves so their contents show without a click.
  useEffect(() => {
    setListings((previous) => {
      for (const root of roots) if (previous[root.path] === undefined) void list(root.path)
      return previous
    })
  }, [roots, list])

  // The toolbar's Refresh: re-list every directory this tree has loaded.
  useEffect(() => {
    if (reloadNonce === 0) return
    setListings((previous) => {
      for (const path of Object.keys(previous)) void list(path)
      return previous
    })
  }, [reloadNonce, list])

  // A create landed in `refresh.path`: re-list it and keep it open, when it
  // belongs to this tree (both trees receive every signal).
  useEffect(() => {
    if (refresh === undefined) return
    const { path } = refresh
    if (!roots.some(root => path === root.path || path.startsWith(`${root.path}/`))) return
    setExpanded(previous => previous.has(path) ? previous : new Set(previous).add(path))
    void list(path)
  }, [refresh, roots, list])

  // A reveal: unfold the root, open every folder down to the file, re-list
  // the file's folder (a fresh artefact postdates any earlier listing) and
  // light the row once that listing lands. One request is served once,
  // however often the panel re-renders around it.
  const [revealed, setRevealed] = useState<string | null>(null)
  const handledReveal = useRef(0)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])
  useEffect(() => {
    if (reveal === null || handledReveal.current === reveal.nonce) return
    const root = roots.find(candidate => reveal.path.startsWith(`${candidate.path}/`))
    if (root === undefined) return
    handledReveal.current = reveal.nonce
    const ancestors = revealAncestors(root.path, reveal.path)
    const parent = ancestors.at(-1) ?? root.path
    setFolded(previous => new Set([...previous].filter(path => path !== root.path)))
    setExpanded(previous => new Set([...previous, ...ancestors]))
    setListings((previous) => {
      for (const dir of ancestors) if (dir !== parent && previous[dir] === undefined) void list(dir)
      return previous
    })
    void list(parent).then(() => {
      if (!alive.current) return
      setRevealed(reveal.path)
      onRevealed()
    })
  }, [reveal, roots, list, onRevealed])
  // The light goes out on the next click anywhere, or on its own.
  useEffect(() => {
    if (revealed === null) return
    const clear = (): void => { setRevealed(null) }
    const timer = setTimeout(clear, REVEAL_HIGHLIGHT_MS)
    document.addEventListener('pointerdown', clear)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('pointerdown', clear)
    }
  }, [revealed])
  /** Bring the lit row into view when it mounts or takes the light; React hands null as the light leaves it. */
  const scrollToRow = useCallback((element: HTMLDivElement | null) => {
    element?.scrollIntoView({ block: 'center' })
  }, [])

  const [dropTarget, setDropTarget] = useState<string | null>(null)
  /** Every row drags its path; folders (and roots) also take a dropped row as a move. */
  const dragSource = (path: string) => ({
    draggable: true,
    onDragStart: (event: React.DragEvent) => {
      event.dataTransfer.setData(FILE_DRAG_TYPE, path)
      event.dataTransfer.setData('text/plain', path)
      event.dataTransfer.effectAllowed = 'copyMove'
    },
  })
  const dropZone = (dir: string) => ({
    onDragOver: (event: React.DragEvent) => {
      if (!carriesEntry(event.dataTransfer)) return
      event.preventDefault()
      // A lone root's zone wraps the row zones: the innermost claims the drag.
      event.stopPropagation()
      event.dataTransfer.dropEffect = 'move'
      if (dropTarget !== dir) setDropTarget(dir)
    },
    onDragLeave: (event: React.DragEvent) => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
      setDropTarget(current => (current === dir ? null : current))
    },
    onDrop: (event: React.DragEvent) => {
      if (!carriesEntry(event.dataTransfer)) return
      event.preventDefault()
      event.stopPropagation()
      setDropTarget(null)
      const source = event.dataTransfer.getData(FILE_DRAG_TYPE)
      // A row dropped on its own folder, or a folder on itself, moves nothing.
      if (source === '' || source === dir || source.slice(0, source.lastIndexOf('/')) === dir) return
      onDropEntry(source, dir)
    },
  })

  const rowActions = (path: string, kind: 'dir' | 'file') => (
    <span className={css.rowActions}>
      {kind === 'file' && (
        <Tooltip label={t('files.addToChat')} delayMs={400}>
          <button
            type="button"
            className={css.rowAction}
            aria-label={t('files.addToChat')}
            onClick={(event) => { event.stopPropagation(); onAddToChat(path) }}
          >
            <IconPlusOutline16 size={12} />
          </button>
        </Tooltip>
      )}
      {canReveal && (
        <Tooltip label={t('files.reveal')} delayMs={400}>
          <button
            type="button"
            className={css.rowAction}
            aria-label={t('files.reveal')}
            onClick={(event) => { event.stopPropagation(); onReveal(path) }}
          >
            <IconRightUpOutline14 size={12} />
          </button>
        </Tooltip>
      )}
    </span>
  )

  const renderDir = (path: string, depth: number): React.ReactNode => {
    const listing = listings[path]
    if (listing === undefined) return null
    if (listing === 'error') {
      return <div className={css.error} style={{ paddingLeft: `${12 + depth * 14}px` }}>{t('files.error')}</div>
    }
    return renderEntries(path, listing, depth)
  }

  const renderEntries = (parent: string, entries: ListEntry[], depth: number) => (
    <div>
      {entries.map((entry) => {
        const path = `${parent}/${entry.name}`
        if (entry.kind === 'file') {
          return (
            <div
              key={path}
              ref={revealed === path ? scrollToRow : undefined}
              className={css.row}
              data-path={path}
              data-revealed={revealed === path ? '' : undefined}
              {...dragSource(path)}
              onContextMenu={(event) => { event.preventDefault(); onRowMenu(path, 'file', event.clientX, event.clientY) }}
            >
              <button
                type="button"
                className={css.file}
                style={{ paddingLeft: `${28 + depth * 14}px` }}
                onClick={() => { onOpenFile(path) }}
              >
                {entry.name}
              </button>
              {rowActions(path, 'file')}
            </div>
          )
        }
        const open = expanded.has(path)
        return (
          <div key={path}>
            <div
              className={css.row}
              data-path={path}
              data-drop-target={dropTarget === path ? '' : undefined}
              {...dragSource(path)}
              {...dropZone(path)}
              onContextMenu={(event) => { event.preventDefault(); onRowMenu(path, 'dir', event.clientX, event.clientY) }}
            >
              <button
                type="button"
                className={css.dir}
                style={{ paddingLeft: `${12 + depth * 14}px` }}
                aria-expanded={open}
                data-selected={selectedDir === path ? '' : undefined}
                onClick={() => { toggleDir(path); onSelectDir({ name: entry.name, path }) }}
              >
                {open ? <IconChevronDownOutline14 size={12} /> : <IconChevronRightOutline14 size={12} />}
                {open ? <IconFolderOpen16 size={14} /> : <IconFolderClose16 size={14} />}
                <span className={css.name}>{entry.name}</span>
              </button>
              {rowActions(path, 'dir')}
            </div>
            {open && renderDir(path, depth + 1)}
          </div>
        )
      })}
    </div>
  )

  // A lone root would only repeat the name the pane's header already shows,
  // so its contents render directly; the container inherits the root's drop
  // zone and, on background right-clicks, its folder menu.
  const loneRoot = roots.length === 1 ? roots[0] : undefined
  if (loneRoot !== undefined) {
    const root = loneRoot
    return (
      <div
        className={css.flatRoot}
        data-path={root.path}
        data-drop-target={dropTarget === root.path ? '' : undefined}
        {...dropZone(root.path)}
        onContextMenu={(event) => {
          // Row menus bubble up through here; only a background click is the root's.
          if ((event.target as Element).closest('[data-path]') !== event.currentTarget) return
          event.preventDefault()
          onRowMenu(root.path, 'dir', event.clientX, event.clientY)
        }}
      >
        {renderDir(root.path, 0)}
      </div>
    )
  }

  return (
    <div>
      {roots.map((root) => {
        const open = !folded.has(root.path)
        return (
          <div key={root.path}>
            <div
              className={css.row}
              data-path={root.path}
              data-drop-target={dropTarget === root.path ? '' : undefined}
              {...dropZone(root.path)}
              onContextMenu={(event) => { event.preventDefault(); onRowMenu(root.path, 'dir', event.clientX, event.clientY) }}
            >
              <button
                type="button"
                className={css.dir}
                aria-expanded={open}
                data-selected={selectedDir === root.path ? '' : undefined}
                onClick={() => { toggleRoot(root.path); onSelectDir(root) }}
              >
                {open ? <IconChevronDownOutline14 size={12} /> : <IconChevronRightOutline14 size={12} />}
                {open ? <IconFolderOpen16 size={14} /> : <IconFolderClose16 size={14} />}
                <span className={css.rootName}>{root.name}</span>
              </button>
              {rowActions(root.path, 'dir')}
            </div>
            {open && renderDir(root.path, 1)}
          </div>
        )
      })}
    </div>
  )
}

/**
 * Narrow the workspace roots to the one holding the active chat, so the
 * project tab shows the current project rather than every registered one.
 * With no chat open, or a cwd under none of them, every root stands.
 * @param roots - the registered workspace roots.
 * @param cwd - the active chat's working directory, when there is one.
 * @returns the roots the project tab shows.
 */
export function currentProjectRoots(roots: RootEntry[], cwd: string | undefined): RootEntry[] {
  if (cwd === undefined) return roots
  const owning = roots.filter(root => cwd === root.path || cwd.startsWith(`${root.path}/`))
  return owning.length === 0 ? roots : owning
}

export function FilesPanel({
  canReveal, canTrash, currentCwd, pickDirectory, onOpenFile, onAddToChat, onIdealize, reveal, onRevealDone, externalReload, t,
}: {
  canReveal: boolean
  /** Offer Move to Trash on rows (macOS only: the Finder does the moving). */
  canTrash: boolean
  /** The active chat's working directory; picks the current project out of the roots. */
  currentCwd: string | undefined
  /** Raise the host's folder picker for Reconnect; rejects where the shell has none. */
  pickDirectory: () => Promise<string | null>
  /** Open a file in the deck's viewer panel. */
  onOpenFile: (path: string) => void
  /** Hand a file's path to the active chat's composer; false = no active chat. */
  onAddToChat: (path: string) => boolean
  /** Register a folder as a project and open a chat in it (the row menu's "Idealize this"). */
  onIdealize: (path: string) => void
  /** The bar's pending reveal (`ctx.idealizeBar.revealFile`); null while none is outstanding. */
  reveal: RevealRequest | null
  /** The reveal has been shown, or refused for a path under no tab: the bar clears it. */
  onRevealDone: () => void
  /** Bumped by the bar when an artefact lands; every loaded folder is listed again. */
  externalReload: number
  t: BarTranslate
}) {
  const [tabs, setTabs] = useState<AliasTab[] | 'error' | undefined>(undefined)
  const [activeTab, setActiveTab] = useState<TabId>('project')
  const [reconnecting, setReconnecting] = useState(false)
  const [browseRoot, setBrowseRoot] = useState<RootEntry | undefined>(undefined)
  const [browseOpen, setBrowseOpen] = useState(false)
  const [target, setTarget] = useState<RootEntry | undefined>(undefined)
  const [sheet, setSheet] = useState<'file' | 'dir' | 'rename' | null>(null)
  /** The entry the rename sheet is for; set with `sheet === 'rename'`. */
  const [renaming, setRenaming] = useState<{ path: string; name: string } | null>(null)
  /** The entry whose Move to Trash awaits its second click. */
  const [trashArmed, setTrashArmed] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [sheetError, setSheetError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [status, setStatus] = useState<{ level: 'info' | 'error'; text: string } | null>(null)
  const [refresh, setRefresh] = useState<RefreshSignal | undefined>(undefined)
  const [reloadNonce, setReloadNonce] = useState(0)
  const [menu, setMenu] = useState<{ path: string; kind: 'dir' | 'file'; x: number; y: number } | null>(null)

  const loadTabs = useCallback(async (): Promise<AliasTab[] | undefined> => {
    const response = await fetch('/idealize/bar/aliases')
    if (!response.ok) throw new Error('aliases failed')
    const body = await response.json() as { tabs: AliasTab[] }
    setTabs(body.tabs)
    return body.tabs
  }, [])

  useEffect(() => {
    let cancelled = false
    void loadTabs()
      .then((loaded) => {
        if (cancelled || loaded === undefined) return
        const project = loaded.find(tab => tab.id === 'project')
        setTarget(current => current ?? currentProjectRoots(project?.roots ?? [], currentCwd)[0])
      })
      .catch(() => { if (!cancelled) setTabs('error') })
    return () => { cancelled = true }
  }, [loadTabs, currentCwd])

  useEffect(() => {
    let cancelled = false
    void fetch('/idealize/bar/browse')
      .then(response => response.ok
        ? response.json() as Promise<{ root: RootEntry }>
        : Promise.reject(new Error('browse failed')))
      .then((body) => { if (!cancelled) setBrowseRoot(body.root) })
      .catch(() => {
        // Browse is a subordinate window: without its root the panel simply
        // shows the project tree alone.
      })
    return () => { cancelled = true }
  }, [])

  // Confirmations fade; errors stay until the next action replaces them.
  useEffect(() => {
    if (status === null || status.level === 'error') return
    const timer = setTimeout(() => { setStatus(null) }, 2500)
    return () => { clearTimeout(timer) }
  }, [status])

  /** The roots one tab shows: the project tab narrowed to the current project, the alias tabs whole. */
  const rootsOf = useCallback((tab: AliasTab): RootEntry[] =>
    tab.id === 'project' ? currentProjectRoots(tab.roots, currentCwd) : tab.roots, [currentCwd])

  // A reveal: the tab whose root holds the file, the project tab first (the
  // projects root holds every project), its folder as the creation target,
  // and the tab's tree opens the way down. A path under no tab is said so.
  const handledReveal = useRef(0)
  useEffect(() => {
    if (reveal === null || !Array.isArray(tabs) || handledReveal.current === reveal.nonce) return
    handledReveal.current = reveal.nonce
    const owner = tabs.find(tab => rootsOf(tab).some(root => reveal.path.startsWith(`${root.path}/`)))
    if (owner === undefined) {
      setStatus({ level: 'error', text: t('files.revealMissing') })
      onRevealDone()
      return
    }
    setActiveTab(owner.id)
    const dir = reveal.path.slice(0, reveal.path.lastIndexOf('/'))
    setTarget({ name: dir.slice(dir.lastIndexOf('/') + 1), path: dir })
  }, [reveal, tabs, rootsOf, onRevealDone, t])

  const revealInFinder = useCallback((path: string) => {
    void fetch('/idealize/bar/reveal', {
      method: 'POST',
      headers: { 'x-idealize-auth': '1', 'content-type': 'application/json' },
      body: JSON.stringify({ path }),
    })
      .then((response) => {
        if (!response.ok) setStatus({ level: 'error', text: t('files.revealFailed') })
      })
      .catch(() => { setStatus({ level: 'error', text: t('files.revealFailed') }) })
  }, [t])

  const addToChat = useCallback((path: string) => {
    setStatus(onAddToChat(path)
      ? { level: 'info', text: t('files.addedToChat') }
      : { level: 'error', text: t('files.noSession') })
  }, [onAddToChat, t])

  const copyPath = useCallback((path: string) => {
    // jsdom and insecure contexts surface no clipboard; the DOM types declare
    // it unconditionally, so the absence probe needs the partial view.
    const clipboard = (navigator as Partial<Navigator>).clipboard
    if (clipboard === undefined) {
      setStatus({ level: 'error', text: t('files.copyFailed') })
      return
    }
    clipboard.writeText(path)
      .then(() => { setStatus({ level: 'info', text: t('files.copiedPath') }) })
      .catch(() => { setStatus({ level: 'error', text: t('files.copyFailed') }) })
  }, [t])

  /** POST one entry operation; the status line reports the outcome by its own pair of sentences. */
  const operate = useCallback(async (
    route: string, body: Record<string, string>, done: BarKey, failed: BarKey, refreshPath: string,
  ): Promise<{ path?: string } | undefined> => {
    try {
      const response = await fetch(`/idealize/bar/${route}`, {
        method: 'POST',
        headers: { 'x-idealize-auth': '1', 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        setStatus({ level: 'error', text: t(response.status === 409 ? 'files.exists' : failed) })
        return undefined
      }
      const result = await response.json() as { path?: string }
      setStatus({ level: 'info', text: t(done) })
      setRefresh(previous => ({ path: refreshPath, nonce: (previous?.nonce ?? 0) + 1 }))
      return result
    } catch {
      setStatus({ level: 'error', text: t(failed) })
      return undefined
    }
  }, [t])
  const parentOf = (path: string): string => path.slice(0, path.lastIndexOf('/'))
  const duplicateEntry = useCallback((path: string) => {
    void operate('duplicate', { path }, 'files.duplicated', 'files.duplicateFailed', parentOf(path))
  }, [operate])
  const moveEntry = useCallback((path: string, parent: string) => {
    void operate('move', { path, parent }, 'files.moved', 'files.moveFailed', parent)
      .then((result) => { if (result !== undefined) setRefresh(previous => ({ path: parentOf(path), nonce: (previous?.nonce ?? 0) + 1 })) })
  }, [operate])
  // Move to Trash arms on the first click and goes on the second: the menu
  // stays open in between, so the confirmation is the same item reworded.
  const trashEntry = useCallback((path: string) => {
    if (trashArmed !== path) {
      setTrashArmed(path)
      return
    }
    setTrashArmed(null)
    setMenu(null)
    void operate('trash', { path }, 'files.trashed', 'files.trashFailed', parentOf(path))
  }, [operate, trashArmed])
  const renameEntry = useCallback(async (): Promise<void> => {
    if (renaming === null || creating || !isValidEntryName(draftName)) return
    setCreating(true)
    setSheetError(null)
    try {
      const response = await fetch('/idealize/bar/rename', {
        method: 'POST',
        headers: { 'x-idealize-auth': '1', 'content-type': 'application/json' },
        body: JSON.stringify({ path: renaming.path, name: draftName.trim() }),
      })
      if (!response.ok) {
        setSheetError(t(response.status === 409 ? 'files.exists' : 'files.renameFailed'))
        return
      }
      setSheet(null)
      setRenaming(null)
      setDraftName('')
      setStatus({ level: 'info', text: t('files.renamed') })
      setRefresh(previous => ({ path: parentOf(renaming.path), nonce: (previous?.nonce ?? 0) + 1 }))
    } catch {
      setSheetError(t('files.renameFailed'))
    } finally {
      setCreating(false)
    }
  }, [renaming, creating, draftName, t])

  // FIL-07: a dead alias keeps its tab, and Reconnect points it at a new
  // folder through @idealize/setup's alias route, which re-probes and
  // re-seeds before it stores anything. A refused folder answers with the
  // host's own plain sentence, which the status line shows verbatim.
  const reconnect = useCallback((alias: 'projectsRoot' | 'documentation' | 'skills') => {
    setReconnecting(true)
    pickDirectory()
      .then(async (path) => {
        if (path === null) return
        const response = await fetch('/idealize/setup/alias', {
          method: 'POST',
          headers: { 'x-idealize-auth': '1', 'content-type': 'application/json' },
          body: JSON.stringify({ name: alias, path }),
        })
        const body = await response.json() as { ok?: boolean; failure?: { reason?: string } }
        if (response.ok && body.ok === true) {
          await loadTabs()
          setStatus({ level: 'info', text: t('files.reconnected') })
          return
        }
        setStatus({ level: 'error', text: body.failure?.reason ?? t('files.reconnectFailed') })
      })
      .catch(() => { setStatus({ level: 'error', text: t('files.reconnectFailed') }) })
      .finally(() => { setReconnecting(false) })
  }, [pickDirectory, loadTabs, t])

  const openRowMenu = useCallback((path: string, kind: 'dir' | 'file', x: number, y: number) => {
    setTrashArmed(null)
    setMenu({ path, kind, x, y })
  }, [])
  const closeMenu = useCallback(() => {
    setTrashArmed(null)
    setMenu(null)
  }, [])
  /** Open the name sheet on an entry's current name; the target row is the entry's parent. */
  const openRename = (path: string): void => {
    setSheet('rename')
    setRenaming({ path, name: path.slice(path.lastIndexOf('/') + 1) })
    setDraftName(path.slice(path.lastIndexOf('/') + 1))
    setSheetError(null)
  }

  // The context menu closes on Escape; click-away is the overlay's own click.
  useEffect(() => {
    if (menu === null) return
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') closeMenu() }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [menu, closeMenu])

  const openSheet = (kind: 'file' | 'dir'): void => {
    setSheet(kind)
    setDraftName('')
    setSheetError(null)
  }

  const closeSheet = (): void => {
    setSheet(null)
    setRenaming(null)
    setDraftName('')
    setSheetError(null)
  }
  /** New file / New folder from a folder's menu: the folder becomes the target, then the sheet opens. */
  const openSheetIn = (kind: 'file' | 'dir', dir: string): void => {
    setTarget({ name: dir.slice(dir.lastIndexOf('/') + 1), path: dir })
    openSheet(kind)
  }

  const create = async (): Promise<void> => {
    if (sheet === 'rename') {
      await renameEntry()
      return
    }
    if (sheet === null || target === undefined || creating || !isValidEntryName(draftName)) return
    setCreating(true)
    setSheetError(null)
    try {
      const response = await fetch('/idealize/bar/create', {
        method: 'POST',
        headers: { 'x-idealize-auth': '1', 'content-type': 'application/json' },
        body: JSON.stringify({ parent: target.path, name: draftName.trim(), kind: sheet }),
      })
      if (!response.ok) {
        setSheetError(t(response.status === 409 ? 'files.exists' : 'files.createFailed'))
        return
      }
      const body = await response.json() as { path: string }
      closeSheet()
      setRefresh(previous => ({ path: target.path, nonce: (previous?.nonce ?? 0) + 1 }))
      if (sheet === 'file') onOpenFile(body.path)
    } catch {
      setSheetError(t('files.createFailed'))
    } finally {
      setCreating(false)
    }
  }

  if (tabs === undefined) return <div className={css.empty}>{t('files.loading')}</div>
  if (tabs === 'error') return <div className={css.empty}>{t('files.rootsError')}</div>

  const nameValid = isValidEntryName(draftName)
  const active = tabs.find(tab => tab.id === activeTab)
  const activeRoots = active === undefined ? [] : rootsOf(active)
  const deadAlias = activeRoots.length === 0 ? active?.alias : undefined

  return (
    <div className={css.split}>
      <div className={css.tabs} role="tablist" aria-label={t('files.tabs')}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            className={css.tab}
            data-tab={tab.id}
            aria-selected={tab.id === activeTab}
            onClick={() => { setActiveTab(tab.id); setTarget(rootsOf(tab)[0]) }}
          >
            {t(TAB_LABELS[tab.id])}
            {tab.alias !== undefined && tab.state !== 'ok' && (
              <span className={css.tabDead} aria-label={t('files.needsReconnect')} role="img" />
            )}
          </button>
        ))}
      </div>
      <div className={css.toolbar}>
        <span className={css.toolbarTarget}>{target?.name ?? ''}</span>
        <Tooltip label={t('files.newFile')} delayMs={400}>
          <button
            type="button"
            className={css.toolButton}
            aria-label={t('files.newFile')}
            disabled={target === undefined}
            onClick={() => { openSheet('file') }}
          >
            <BarIconFilePlus size={15} />
          </button>
        </Tooltip>
        <Tooltip label={t('files.newFolder')} delayMs={400}>
          <button
            type="button"
            className={css.toolButton}
            aria-label={t('files.newFolder')}
            disabled={target === undefined}
            onClick={() => { openSheet('dir') }}
          >
            <BarIconFolderPlus size={15} />
          </button>
        </Tooltip>
        <Tooltip label={t('files.refresh')} delayMs={400}>
          <button
            type="button"
            className={css.toolButton}
            aria-label={t('files.refresh')}
            onClick={() => { setReloadNonce(nonce => nonce + 1) }}
          >
            <BarIconRefresh size={15} />
          </button>
        </Tooltip>
        <Tooltip label={t('files.browse')} delayMs={400}>
          <button
            type="button"
            className={css.toolButton}
            aria-label={t('files.browse')}
            data-active={browseOpen ? '' : undefined}
            disabled={browseRoot === undefined}
            onClick={() => { setBrowseOpen(open => !open) }}
          >
            <BarIconBrowse size={15} />
          </button>
        </Tooltip>
      </div>
      {sheet !== null && (sheet === 'rename' ? renaming !== null : target !== undefined) && (
        <form
          className={css.sheet}
          data-sheet={sheet}
          onSubmit={(event) => { event.preventDefault(); void create() }}
        >
          <div className={css.sheetTitle}>
            {t(sheet === 'file' ? 'files.newFile' : sheet === 'dir' ? 'files.newFolder' : 'files.rename')}
            <span className={css.sheetTarget}> · {sheet === 'rename' ? renaming?.name : target?.name}</span>
          </div>
          <input
            className={css.nameInput}
            placeholder={t(sheet === 'dir' ? 'files.name.folder' : 'files.name.file')}
            value={draftName}
            autoFocus
            onChange={(event) => { setDraftName(event.target.value); setSheetError(null) }}
            onKeyDown={(event) => { if (event.key === 'Escape') closeSheet() }}
          />
          {!nameValid && draftName !== '' && <div className={css.sheetError}>{t('files.invalidName')}</div>}
          {sheetError !== null && <div className={css.sheetError}>{sheetError}</div>}
          <div className={css.sheetActions}>
            <button type="button" className={css.sheetButton} onClick={closeSheet}>{t('files.cancel')}</button>
            <button type="submit" className={css.sheetPrimary} disabled={!nameValid || creating}>
              {t(sheet === 'rename' ? 'files.rename' : 'files.create')}
            </button>
          </div>
        </form>
      )}
      <div className={css.tree}>
        {deadAlias !== undefined
          ? (
            <div className={css.reconnect} data-alias={deadAlias}>
              <p className={css.reconnectReason}>{active?.reason ?? t('files.aliasUnset')}</p>
              <button
                type="button"
                className={css.reconnectButton}
                disabled={reconnecting}
                onClick={() => { reconnect(deadAlias) }}
              >
                {t('files.reconnect')}
              </button>
            </div>
          )
          : activeRoots.length === 0
            ? <div className={css.empty}>{t('files.empty')}</div>
            : (
              <LazyTree
                key={activeTab}
                endpoint="/idealize/bar/files"
                roots={activeRoots}
                canReveal={canReveal}
                selectedDir={target?.path}
                refresh={refresh}
                reloadNonce={reloadNonce + externalReload}
                reveal={reveal}
                onRevealed={onRevealDone}
                onOpenFile={onOpenFile}
                onReveal={revealInFinder}
                onAddToChat={addToChat}
                onRowMenu={openRowMenu}
                onDropEntry={moveEntry}
                onSelectDir={setTarget}
                t={t}
              />
            )}
      </div>
      {status !== null && (
        <div className={css.status} data-level={status.level} role="status">{status.text}</div>
      )}
      {menu !== null && (
        <div
          className={css.menuOverlay}
          onClick={closeMenu}
          onContextMenu={(event) => { event.preventDefault(); closeMenu() }}
        >
          <div
            className={css.menu}
            role="menu"
            aria-label={t('files.menu')}
            style={{
              left: Math.min(menu.x, window.innerWidth - 190),
              top: Math.min(menu.y, window.innerHeight - 320),
            }}
            onClick={(event) => { event.stopPropagation() }}
          >
            {menu.kind === 'file' && (
              <>
                <button type="button" role="menuitem" className={css.menuItem} onClick={() => { onOpenFile(menu.path); closeMenu() }}>
                  {t('files.open')}
                </button>
                <button type="button" role="menuitem" className={css.menuItem} onClick={() => { addToChat(menu.path); closeMenu() }}>
                  {t('files.addToChat')}
                </button>
              </>
            )}
            {canReveal && (
              <button type="button" role="menuitem" className={css.menuItem} onClick={() => { revealInFinder(menu.path); closeMenu() }}>
                {t('files.reveal')}
              </button>
            )}
            <button type="button" role="menuitem" className={css.menuItem} onClick={() => { copyPath(menu.path); closeMenu() }}>
              {t('files.copyPath')}
            </button>
            {menu.kind === 'dir' && (
              <>
                <div className={css.menuRule} role="separator" />
                {/* A folder is a project waiting to be one (JJ, 13 Sep 2026). */}
                <button type="button" role="menuitem" className={css.menuItem} onClick={() => { onIdealize(menu.path); closeMenu() }}>
                  {t('files.idealize')}
                </button>
                <div className={css.menuRule} role="separator" />
                <button type="button" role="menuitem" className={css.menuItem} onClick={() => { openSheetIn('file', menu.path); closeMenu() }}>
                  {t('files.newFileHere')}
                </button>
                <button type="button" role="menuitem" className={css.menuItem} onClick={() => { openSheetIn('dir', menu.path); closeMenu() }}>
                  {t('files.newFolderHere')}
                </button>
              </>
            )}
            <div className={css.menuRule} role="separator" />
            <button type="button" role="menuitem" className={css.menuItem} onClick={() => { openRename(menu.path); closeMenu() }}>
              {t('files.rename')}
            </button>
            <button type="button" role="menuitem" className={css.menuItem} onClick={() => { duplicateEntry(menu.path); closeMenu() }}>
              {t('files.duplicate')}
            </button>
            {canTrash && (
              <button
                type="button"
                role="menuitem"
                className={css.menuItem}
                data-danger=""
                data-armed={trashArmed === menu.path ? '' : undefined}
                onClick={() => { trashEntry(menu.path) }}
              >
                {t(trashArmed === menu.path ? 'files.trashConfirm' : 'files.trash')}
              </button>
            )}
          </div>
        </div>
      )}
      {browseRoot !== undefined && (
        <div className={css.browseSection} data-open={browseOpen ? '' : undefined}>
          <button
            type="button"
            className={css.browseHeader}
            aria-expanded={browseOpen}
            onClick={() => { setBrowseOpen(open => !open) }}
          >
            {browseOpen ? <IconChevronDownOutline14 size={12} /> : <IconChevronRightOutline14 size={12} />}
            <span className={css.browseTitle}>{t('files.browse')}</span>
          </button>
          {browseOpen && (
            <div className={css.browseTree}>
              <LazyTree
                endpoint="/idealize/bar/browse"
                roots={[browseRoot]}
                canReveal={canReveal}
                selectedDir={target?.path}
                refresh={refresh}
                reloadNonce={reloadNonce + externalReload}
                reveal={null}
                onRevealed={onRevealDone}
                onOpenFile={onOpenFile}
                onReveal={revealInFinder}
                onAddToChat={addToChat}
                onRowMenu={openRowMenu}
                onDropEntry={moveEntry}
                onSelectDir={setTarget}
                t={t}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
