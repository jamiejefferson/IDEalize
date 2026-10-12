// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { ProjectRowItem } from '../src/client/rows/Rows.tsx'
import { ProjectLookDialog, ProjectSlot, refreshProjectLooks } from '../src/client/rows/ProjectLook.tsx'
import type { ProjectLook } from '../src/client/rows/ProjectLook.tsx'
import type { GroupNode } from '../src/client/tree.ts'
import { en } from '../src/client/locales.ts'

const t = makeTranslate(en, commonEn) as never
const wid = (id: string) => id as WorkspaceId

let items: Record<string, ProjectLook>
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  items = {}
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === undefined) return new Response(JSON.stringify({ items }), { status: 200 })
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const group: GroupNode = {
  key: 'p', workspaceId: wid('p'), cwd: '/projects/p', createdAt: 0, label: 'Project',
  sessionCount: 0, expanded: false, containsCurrent: false, sessions: [],
}

describe('project look', () => {
  it('shows the project logo in the row slot once the looks arrive', async () => {
    const view = render(<ProjectRowItem group={group} onToggle={vi.fn()} onCreate={vi.fn()} t={t} />)
    expect(view.container.querySelector('[data-project-logo]')).toBeNull()
    items = { p: { accent: '#3e63dd', logo: 'auto', iconUrl: '/idealize/project-look/icon/p?v=1' } }
    await act(() => refreshProjectLooks())
    const img = view.container.querySelector('[data-project-logo] img')
    expect(img?.getAttribute('src')).toBe('/idealize/project-look/icon/p?v=1')
    // A logo that fails to load falls back to the folder, in the accent.
    fireEvent.error(img as Element)
    expect(view.container.querySelector('[data-project-accent="#3e63dd"]')).not.toBeNull()
  })

  it('colours the folder with the accent when there is no logo', async () => {
    items = { p: { accent: '#e5484d', logo: 'none', iconUrl: null } }
    await act(() => refreshProjectLooks())
    const view = render(<ProjectSlot workspaceId="p" expanded active />)
    const slot = view.container.querySelector('[data-project-accent]') as HTMLElement
    expect(slot.style.color).toBe('rgb(229, 72, 77)')
    expect(slot.querySelector('svg')).not.toBeNull()
  })

  it('keeps a failed fetch from clearing the last looks', async () => {
    items = { p: { accent: '#e5484d', logo: 'none', iconUrl: null } }
    await act(() => refreshProjectLooks())
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 404 }))
    await act(() => refreshProjectLooks())
    const view = render(<ProjectSlot workspaceId="p" expanded={false} active={false} />)
    expect(view.container.querySelector('[data-project-accent="#e5484d"]')).not.toBeNull()
  })

  it('adds Icon and colour to the project menu', () => {
    const look = vi.fn()
    render(<ProjectRowItem
      group={group} onToggle={vi.fn()} onCreate={vi.fn()}
      actions={{ rename: vi.fn(), look, delete: vi.fn() }} t={t}
    />)
    fireEvent.click(screen.getByRole('button', { name: 'Project actions for Project' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Icon and colour…' }))
    expect(look).toHaveBeenCalledOnce()
  })

  it('saves an accent, a chosen image and the logo mode from the dialog', async () => {
    items = { p: { accent: null, logo: 'auto', iconUrl: null } }
    await act(() => refreshProjectLooks())
    render(<ProjectLookDialog target={{ workspaceId: 'p', title: 'Project' }} onClose={vi.fn()} t={t} />)
    expect(screen.getByText('No logo found in the project folder, so the folder icon shows.')).toBeTruthy()

    fireEvent.click(screen.getByRole('radio', { name: 'Blue' }))
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/idealize/project-look/p', expect.objectContaining({
        method: 'POST', body: JSON.stringify({ accent: '#3e63dd' }),
      }))
    })
    const sent = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'POST')?.[1] as RequestInit
    expect((sent.headers as Record<string, string>)['x-idealize-auth']).toBe('1')

    const input = document.querySelector('[data-project-look-file]') as HTMLInputElement
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'logo.png', { type: 'image/png' })
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/idealize/project-look/p/image', expect.objectContaining({ method: 'PUT' }))
    })

    fireEvent.click(screen.getByRole('button', { name: 'Show folder icon' }))
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/idealize/project-look/p', expect.objectContaining({
        body: JSON.stringify({ logo: 'none' }),
      }))
    })
  })

  it('refuses a large image before sending and shows a save failure', async () => {
    items = { p: { accent: null, logo: 'custom', iconUrl: '/x' } }
    await act(() => refreshProjectLooks())
    render(<ProjectLookDialog target={{ workspaceId: 'p', title: 'Project' }} onClose={vi.fn()} t={t} />)
    const input = document.querySelector('[data-project-look-file]') as HTMLInputElement
    const big = new File([new Uint8Array(600 * 1024)], 'big.png', { type: 'image/png' })
    fireEvent.change(input, { target: { files: [big] } })
    expect(screen.getByRole('alert').textContent).toBe('The image must be under 512 KB.')

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'no such project' }), { status: 404 }))
    fireEvent.click(screen.getByRole('button', { name: 'Use automatic' }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe("Couldn't save: no such project") })
  })
})
