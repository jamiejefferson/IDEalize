// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { droppedPaths, dropText } from '../src/client/TerminalView.tsx'

const BRIDGE = '__DSH_DESKTOP_FILE_PATH__'

function transfer(input: { files?: File[]; row?: string }): DataTransfer {
  return {
    files: input.files ?? [],
    types: input.row === undefined ? ['Files'] : ['application/x-idealize-path'],
    getData: (type: string) => type === 'application/x-idealize-path' ? input.row ?? '' : '',
  } as unknown as DataTransfer
}

afterEach(() => { (window as unknown as Record<string, unknown>)[BRIDGE] = undefined })

describe('a file dropped on the terminal', () => {
  it('types each path escaped as Terminal.app would, with a trailing space', () => {
    expect(dropText(['/Users/jj/Desktop/Screenshot 2026-09-18 at 13.05.22.png']))
      .toBe('/Users/jj/Desktop/Screenshot\\ 2026-09-18\\ at\\ 13.05.22.png ')
    expect(dropText(['/a/plain.png', "/a/it's (1).png"])).toBe("/a/plain.png /a/it\\'s\\ \\(1\\).png ")
    expect(dropText([])).toBe('')
    expect(dropText(['  '])).toBe('')
  })

  it('reads disk paths through the desktop bridge, and a Files pane row by its own type', () => {
    ;(window as unknown as Record<string, unknown>)[BRIDGE] = { getPathForFile: (file: File) => `/shots/${file.name}` }
    expect(droppedPaths(transfer({ files: [new File(['x'], 'a.png'), new File(['y'], 'b c.png')] }))).toEqual(['/shots/a.png', '/shots/b c.png'])
    expect(droppedPaths(transfer({ row: '/project/ref.png' }))).toEqual(['/project/ref.png'])
  })

  it('types nothing where no bridge can name a path (the browser build)', () => {
    expect(droppedPaths(transfer({ files: [new File(['x'], 'a.png')] }))).toEqual([])
  })
})
