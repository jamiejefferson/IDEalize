// @vitest-environment jsdom
/**
 * Markdown paths in a terminal chat's output open in the app's file viewer:
 * the provider finds them in a logical line (wrapped rows read as one, wide
 * glyphs counted by cell), links only what the viewer shows, resolves a
 * relative path under the chat's folder, and opens nothing at the end of a
 * drag-selection. The grid every view creates carries the provider.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import type { IBuffer, IBufferCell, IBufferLine, ILink, ILinkProvider } from '@xterm/xterm'
import { markdownPathLinks, terminalFilePath, type LinkGrid, type TerminalFileViewer } from '../src/client/file-links.ts'
import { disposeTerminals, setTerminalFileViewer, TerminalView, type TerminalTransport } from '../src/client/TerminalView.tsx'

const registered = vi.hoisted(() => ({ providers: [] as unknown[], rows: [] as string[] }))

/** One cell per character; `＊` stands for a wide glyph, which takes two cells. */
function bufferLine(text: string, wrapped: boolean, cols: number): IBufferLine {
  const cells: { chars: string; width: number }[] = []
  for (const char of text) {
    if (char === '＊') {
      cells.push({ chars: char, width: 2 }, { chars: '', width: 0 })
    } else {
      cells.push({ chars: char, width: 1 })
    }
  }
  while (cells.length < cols) cells.push({ chars: '', width: 1 })
  return {
    isWrapped: wrapped,
    length: cols,
    getCell: (x: number) => {
      const cell = cells[x]
      return cell === undefined ? undefined : { getChars: () => cell.chars, getWidth: () => cell.width } as IBufferCell
    },
    translateToString: () => text,
  }
}

/** A grid whose rows are `rows`; a row starting with `>` continues the one above. */
function gridOf(rows: readonly string[], cols: number, selected = false): LinkGrid {
  const lines = rows.map(row => bufferLine(row.startsWith('>') ? row.slice(1) : row, row.startsWith('>'), cols))
  return {
    cols,
    hasSelection: () => selected,
    buffer: { active: { getLine: (y: number) => lines[y] } as IBuffer },
  }
}

/** The links the provider hands back for 1-based row `y`. */
function linksAt(provider: ILinkProvider, y: number): ILink[] | undefined {
  let out: ILink[] | undefined
  provider.provideLinks(y, (links) => { out = links })
  return out
}

function viewer(shows: (path: string) => boolean = path => path.endsWith('.md') || path.endsWith('.markdown')) {
  const opened: string[] = []
  const face: TerminalFileViewer = { shows, open: (path) => { opened.push(path) } }
  return { face, opened }
}

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 40
    rows = 24
    options: Record<string, unknown> = {}
    element: HTMLElement | undefined
    get buffer() {
      const row = (y: number) => registered.rows[y]
      return { active: { getLine: (y: number) => row(y) === undefined ? undefined : bufferLine(row(y)!, false, 40) } }
    }
    loadAddon(): void {}
    open(host: HTMLElement): void { this.element = host.appendChild(document.createElement('div')) }
    focus(): void {}
    hasSelection(): boolean { return false }
    registerLinkProvider(provider: unknown): { dispose: () => void } {
      registered.providers.push(provider)
      return { dispose: () => {} }
    }
    write(): void {}
    dispose(): void {}
    onData(): { dispose: () => void } { return { dispose: () => {} } }
    onResize(): { dispose: () => void } { return { dispose: () => {} } }
  },
}))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit(): void {} } }))

afterEach(() => {
  cleanup()
  disposeTerminals()
  setTerminalFileViewer(() => undefined)
  registered.providers = []
  registered.rows = []
})

describe('markdownPathLinks', () => {
  it('links the Markdown paths an agent prints, and opens them under the chat\'s folder', () => {
    const { face, opened } = viewer()
    const grid = gridOf(['⏺ Write(docs/plan.md) and ~/n.markdown.', 'cat /abs/x.md:12 ./r.md'], 80)
    const provider = markdownPathLinks(grid, () => '/proj/', () => face)

    const first = linksAt(provider, 1) ?? []
    expect(first.map(link => link.text)).toEqual(['docs/plan.md', '~/n.markdown'])
    expect(first[0]?.range).toEqual({ start: { x: 9, y: 1 }, end: { x: 20, y: 1 } })
    for (const link of [...first, ...linksAt(provider, 2) ?? []]) link.activate(new MouseEvent('click'), link.text)
    expect(opened).toEqual(['/proj/docs/plan.md', '~/n.markdown', '/abs/x.md', '/proj/r.md'])
  })

  it('leaves look-alikes, files the viewer does not show, and relative paths with no folder unlinked', () => {
    const { face } = viewer(path => !path.includes('skip'))
    const grid = gridOf(['a.mdx notes.md.bak foo.md5 x/skip.md', 'rel.md'], 80)
    expect(linksAt(markdownPathLinks(grid, () => '/p', () => face), 1)).toBeUndefined()
    expect(linksAt(markdownPathLinks(grid, () => undefined, () => face), 2)).toBeUndefined()
    // No viewer composed in: nothing links at all.
    expect(linksAt(markdownPathLinks(grid, () => '/p', () => undefined), 2)).toBeUndefined()
  })

  it('reads a path broken across wrapped rows as one, and counts a wide glyph by its cells', () => {
    const { face, opened } = viewer()
    const grid = gridOf(['＊ see docs/l', '>ong-plan.md ok', '>'], 13)
    const provider = markdownPathLinks(grid, () => '/proj', () => face)
    const fromFirst = linksAt(provider, 1) ?? []
    const fromSecond = linksAt(provider, 2) ?? []
    expect(fromFirst.map(link => link.text)).toEqual(['docs/long-plan.md'])
    expect(fromSecond[0]?.range).toEqual(fromFirst[0]?.range)
    // The wide glyph takes cells 0 and 1, so `docs` starts at cell 7 (x = 8).
    expect(fromFirst[0]?.range).toEqual({ start: { x: 8, y: 1 }, end: { x: 11, y: 2 } })
    // The third row continues the line too, but the path does not touch it.
    expect(linksAt(provider, 3)).toBeUndefined()
    fromFirst[0]?.activate(new MouseEvent('click'), 'docs/long-plan.md')
    expect(opened).toEqual(['/proj/docs/long-plan.md'])
  })

  it('opens nothing when the click ends a drag-selection', () => {
    const { face, opened } = viewer()
    const link = (linksAt(markdownPathLinks(gridOf(['plan.md'], 20, true), () => '/p', () => face), 1) ?? [])[0]
    link?.activate(new MouseEvent('click'), 'plan.md')
    expect(link).toBeDefined()
    expect(opened).toEqual([])
  })

  it('stops at a row the buffer no longer holds', () => {
    const { face } = viewer()
    const grid: LinkGrid = {
      cols: 10,
      hasSelection: () => false,
      // Row 1 claims to continue a row the buffer has dropped.
      buffer: { active: { getLine: (y: number) => y === 1 ? bufferLine('a.md', false, 10) : y === 2 ? bufferLine('', true, 10) : undefined } as IBuffer },
    }
    expect(linksAt(markdownPathLinks(grid, () => '/p', () => face), 2)?.map(link => link.text)).toEqual(['a.md'])
    expect(linksAt(markdownPathLinks(gridOf([], 10), () => '/p', () => face), 1)).toBeUndefined()
  })
})

describe('terminalFilePath', () => {
  it('keeps absolute and home paths, and puts relative ones under the folder', () => {
    expect(terminalFilePath('/a/b.md', undefined)).toBe('/a/b.md')
    expect(terminalFilePath('~/b.md', '')).toBe('~/b.md')
    expect(terminalFilePath('./b.md', '/p//')).toBe('/p/b.md')
    expect(terminalFilePath('b.md', '')).toBeUndefined()
  })
})

describe('the terminal view', () => {
  it('gives every grid a provider that reads the viewer and the chat\'s folder at hover time', async () => {
    const transport: TerminalTransport = {
      open: () => new Promise(() => {}),
      stream: () => () => {},
      input: () => {},
      resize: () => {},
      close: () => Promise.resolve(),
    }
    const t = (key: string) => key
    vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} })
    await act(async () => {
      render(<TerminalView sessionId="s1" cwd="/proj" transport={transport} t={t as never} />)
      await Promise.resolve()
    })
    const provider = registered.providers[0] as ILinkProvider
    registered.rows = ['wrote notes.md']
    expect(linksAt(provider, 1)).toBeUndefined()
    const { face, opened } = viewer()
    setTerminalFileViewer(() => face)
    const link = (linksAt(provider, 1) ?? [])[0]
    link?.activate(new MouseEvent('click'), 'notes.md')
    expect(opened).toEqual(['/proj/notes.md'])
    vi.unstubAllGlobals()
  })
})
