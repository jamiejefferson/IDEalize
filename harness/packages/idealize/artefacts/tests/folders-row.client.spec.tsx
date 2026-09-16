// @vitest-environment jsdom
/**
 * The media-folders settings row: the plugin seats it in General settings
 * over the `idealize-artefacts` scope, a valid edit commits on blur or Enter,
 * an invalid one is marked and writes nothing, and a Host publication moves
 * the fields.
 */
import { Context } from '@deepseek-ai/cordis'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore, SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { stubSettingsScope, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { apply, FoldersRow, inject, type FoldersRowInjected } from '../src/client/index.ts'
import { ARTEFACT_FOLDER_DEFAULTS, FOLDER_PATTERN, folderFor, type ArtefactFolderSettings } from '../src/settings.ts'

usePinnedBrowserLanguages('en')
afterEach(cleanup)

const unused = (): never => { throw new Error('unused hook') }
const t = (key: string): string => key

function row() {
  const folders = createSnapshotStore<ArtefactFolderSettings>({ ...ARTEFACT_FOLDER_DEFAULTS })
  const setFolder = vi.fn()
  const view = render(
    <FoldersRow
      useFolders={bindSnapshotSelector(folders)}
      setFolder={setFolder}
      t={t as never}
      useSessions={unused}
      useWorkspaces={unused}
    />,
  )
  return { view, folders, setFolder }
}

describe('the folder pattern', () => {
  it('accepts plain project-relative paths and refuses anything that could leave the project', () => {
    for (const ok of ['Images', 'Media/Pictures', '.idealize/artefacts', 'Archive']) expect(FOLDER_PATTERN.test(ok)).toBe(true)
    for (const bad of ['', '/abs', '..', '../x', 'x/..', 'x/./y', 'x/', 'x//y', 'a\\b', '.']) expect(FOLDER_PATTERN.test(bad)).toBe(false)
  })

  it('routes each media type to its folder', () => {
    expect(folderFor(ARTEFACT_FOLDER_DEFAULTS, 'image/png')).toBe('Images')
    expect(folderFor(ARTEFACT_FOLDER_DEFAULTS, 'AUDIO/wav')).toBe('Sounds')
    expect(folderFor(ARTEFACT_FOLDER_DEFAULTS, 'video/mp4')).toBe('Video')
    expect(folderFor(ARTEFACT_FOLDER_DEFAULTS, 'application/pdf')).toBe('Artefacts')
  })
})

describe('FoldersRow', () => {
  it('shows the four folders and commits a valid edit on blur, unchanged values excepted', () => {
    const { view, setFolder } = row()
    const images = view.container.querySelector<HTMLInputElement>('[data-artefact-folder="images"]')!
    expect(images.value).toBe('Images')
    expect(view.container.querySelector<HTMLInputElement>('[data-artefact-folder="archive"]')?.value).toBe('Archive')
    fireEvent.blur(images)
    expect(setFolder).not.toHaveBeenCalled()
    fireEvent.change(images, { target: { value: 'Media/Pictures' } })
    fireEvent.blur(images)
    expect(setFolder).toHaveBeenCalledWith('images', 'Media/Pictures')
  })

  it('commits on Enter, marks an invalid value and writes nothing for it', () => {
    const { view, setFolder } = row()
    const sounds = view.container.querySelector<HTMLInputElement>('[data-artefact-folder="sounds"]')!
    fireEvent.change(sounds, { target: { value: '../out' } })
    expect(sounds.getAttribute('aria-invalid')).toBe('true')
    expect(view.getByRole('alert').textContent).toBe('folders.invalid')
    fireEvent.keyDown(sounds, { key: 'Enter' })
    fireEvent.blur(sounds)
    expect(setFolder).not.toHaveBeenCalled()
    fireEvent.change(sounds, { target: { value: 'Audio' } })
    expect(sounds.hasAttribute('aria-invalid')).toBe(false)
    fireEvent.keyDown(sounds, { key: 'Enter' })
    expect(setFolder).toHaveBeenCalledWith('sounds', 'Audio')
  })

  it('follows a stored change from elsewhere', () => {
    const { view, folders } = row()
    act(() => { folders.set({ ...ARTEFACT_FOLDER_DEFAULTS, video: 'Clips' }) })
    expect(view.container.querySelector<HTMLInputElement>('[data-artefact-folder="video"]')?.value).toBe('Clips')
  })
})

describe('the plugin\'s settings row', () => {
  it('seats the row in General settings over the idealize-artefacts scope and writes one field per edit', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    ctx.provide('locale', new LocaleRuntime(ctx))
    ctx.provide('conversationEvents', { register: () => () => {} } as never)
    const stub = stubSettingsScope<ArtefactFolderSettings>()
    const bind = vi.fn(() => stub.scope)
    ctx.provide('settingsScope', { bind } as never)
    const slots = ctx.get('slots') as SlotRegistry
    slots.register({
      name: 'root',
      children: {
        'conversation.chat.node': { kind: 'keyed', scope: 'session' },
        'settings.general.item': { kind: 'list', scope: 'root' },
      },
    } as never, () => null)
    await ctx.plugin({ inject: [...inject], apply }).await()

    expect(bind).toHaveBeenCalledWith({ namespace: 'idealize-artefacts' })
    const entry = slots.entries('settings.general.item').find(candidate => candidate.options.id === 'idealize-artefact-folders')
    expect(entry).toBeDefined()
    const face = (entry!.inject as unknown as () => FoldersRowInjected)()
    expect(face.hooks.folders.getSnapshot()).toEqual(ARTEFACT_FOLDER_DEFAULTS)

    // The Host's document lands: the row's store follows it, defaults filling the rest.
    stub.publish({ status: 'ready', value: { images: 'Pics' } as ArtefactFolderSettings })
    expect(face.hooks.folders.getSnapshot()).toEqual({ ...ARTEFACT_FOLDER_DEFAULTS, images: 'Pics' })

    face.setFolder('archive', 'Old')
    expect(stub.set).toHaveBeenCalledWith('archive', 'Old')
    expect(face.hooks.folders.getSnapshot().archive).toBe('Old')
  })
})
