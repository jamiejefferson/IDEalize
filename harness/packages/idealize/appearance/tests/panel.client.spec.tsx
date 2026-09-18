// @vitest-environment jsdom
/** AppearancePanel behavior: hidden until open, tabs, and every control routing through the face. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { AppearancePanel, themeCustomised } from '../src/client/AppearancePanel.tsx'
import type { AppearancePanelComponentProps } from '../src/client/AppearancePanel.tsx'
import { createAppearanceStore, type AppearanceState } from '../src/client/store.ts'
import { en } from '../src/client/locales.ts'
import { APPEARANCE_DEFAULTS, EMPTY_ACTION, EMPTY_SURFACE } from '../src/appearance-settings.ts'

afterEach(cleanup)

const t = (key: string, params?: Record<string, unknown>): string =>
  (en[key as keyof typeof en] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = params?.[name]
    return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
  })

function mount(prepare?: (draft: AppearanceState) => void) {
  const store = createAppearanceStore()
  store.update((draft) => {
    draft.open = true
    draft.fonts = ['Avenir Next', 'Georgia']
    prepare?.(draft)
  })
  const face = {
    close: vi.fn(),
    setSection: vi.fn(),
    setMode: vi.fn(),
    choosePreset: vi.fn(),
    setGround: vi.fn(),
    setAction: vi.fn(),
    setUiFont: vi.fn(),
    setUiSize: vi.fn(),
    setSurface: vi.fn(),
    setScalars: vi.fn(),
    setTerminal: vi.fn(),
    resetSection: vi.fn(),
  }
  const props: AppearancePanelComponentProps = { useAppearance: bindSnapshotSelector(store), t, ...face }
  render(<AppearancePanel {...props} />)
  return { store, face }
}

const pressed = (name: RegExp): string | null =>
  screen.getByRole('button', { name }).getAttribute('aria-pressed')

describe('AppearancePanel', () => {
  it('renders nothing while closed', () => {
    mount((draft) => { draft.open = false })
    expect(screen.queryByRole('complementary')).toBeNull()
  })

  it('shows six tabs, the status row and the Theme tab by default', () => {
    const { face } = mount()
    expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Theme', 'Projects', 'Panels', 'Chat', 'Document', 'Terminal'])
    // The panel is exempt from the surface it sits in, so editing the drawer's type never garbles the editor.
    expect(screen.getByRole('complementary').hasAttribute('data-idealize-surface-exempt')).toBe(true)
    expect(screen.getByText('Following IDEalize')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Reset' })).toBeNull()
    expect(pressed(/^System$/)).toBe('true')
    expect(pressed(/^IDEalize/)).toBe('true')
    fireEvent.click(screen.getByRole('tab', { name: 'Chat' }))
    expect(face.setSection).toHaveBeenCalledWith('chat')
  })

  it('routes the Theme tab controls through the face', () => {
    const { face } = mount()
    fireEvent.click(screen.getByRole('button', { name: /^Light$/ }))
    expect(face.setMode).toHaveBeenCalledWith('light')
    fireEvent.click(screen.getByRole('button', { name: /^Linen/ }))
    expect(face.choosePreset).toHaveBeenCalledWith('linen')
    fireEvent.click(screen.getByRole('button', { name: 'Interface font' }))
    fireEvent.click(screen.getByRole('option', { name: 'Georgia' }))
    expect(face.setUiFont).toHaveBeenCalledWith('Georgia')
    expect(screen.queryByRole('listbox')).toBeNull()
    // The interface size commits on release: a per-move commit rescales the
    // panel under the pointer. The readout follows the drag at once.
    const size = screen.getByLabelText('Interface size')
    fireEvent.change(size, { target: { value: '16' } })
    expect(face.setUiSize).not.toHaveBeenCalled()
    expect(size.parentElement?.textContent).toContain('16')
    fireEvent.pointerUp(size)
    expect(face.setUiSize).toHaveBeenCalledExactlyOnceWith(16)
    fireEvent.change(screen.getByLabelText('Opacity'), { target: { value: '0.5' } })
    expect(face.setAction).toHaveBeenCalledWith({ opacity: 0.5 })
    fireEvent.click(screen.getByRole('button', { name: /^Gradient$/ }))
    expect(face.setAction).toHaveBeenCalledWith({ mode: 'gradient' })
    fireEvent.click(screen.getByRole('button', { name: 'Close the appearance panel' }))
    expect(face.close).toHaveBeenCalled()
  })

  it('commits a hex only once it parses, clears on empty, and reads out the deepening', () => {
    const { face, store } = mount()
    const ground = screen.getByLabelText('Ground') as HTMLInputElement
    fireEvent.change(ground, { target: { value: '#FDE' } })
    expect(face.setGround).not.toHaveBeenCalled()
    expect(ground.getAttribute('aria-invalid')).toBe('true')
    fireEvent.change(ground, { target: { value: 'fde2f3' } })
    expect(face.setGround).toHaveBeenCalledWith('#FDE2F3')
    fireEvent.change(screen.getByLabelText('Ground colour'), { target: { value: '#abcdef' } })
    expect(face.setGround).toHaveBeenCalledWith('#ABCDEF')
    const colour = screen.getByLabelText('Colour') as HTMLInputElement
    fireEvent.change(colour, { target: { value: '#FF74E7' } })
    expect(face.setAction).toHaveBeenCalledWith({ colorHex: '#FF74E7' })
    act(() => {
      store.update((draft) => {
        draft.settings = { ...APPEARANCE_DEFAULTS, groundHex: '#FFFFFF', action: { ...EMPTY_ACTION, colorHex: '#FFB3E6' } }
      })
    })
    expect(screen.getByRole('button', { name: /^Dark$/ })).toHaveProperty('disabled', true)
    expect(screen.getByText('Your ground colour decides the mode. Clear it to switch.')).toBeDefined()
    expect(screen.getByText(/deepen it along its hue to 3\.0:1; buttons keep your colour/)).toBeDefined()
    expect(screen.getByText('Customised')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(face.resetSection).toHaveBeenCalledWith('theme')
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear' })[0] as HTMLElement)
    expect(face.setGround).toHaveBeenCalledWith('')
    fireEvent.change(colour, { target: { value: '' } })
    expect(face.setAction).toHaveBeenCalledWith({ colorHex: '' })
    expect(themeCustomised(APPEARANCE_DEFAULTS)).toBe(false)
    expect(themeCustomised({ ...APPEARANCE_DEFAULTS, uiSize: 14 })).toBe(true)
  })

  it('edits a gradient: type, angle, rotate, reverse, stop add/edit/remove', () => {
    const { face } = mount((draft) => {
      draft.settings = { ...APPEARANCE_DEFAULTS, action: { ...EMPTY_ACTION, mode: 'gradient', colorHex: '#FF0000' } }
    })
    fireEvent.click(screen.getByRole('button', { name: /^Radial$/ }))
    expect(face.setAction).toHaveBeenCalledWith({ gradientType: 'radial' })
    fireEvent.change(screen.getByLabelText('Angle'), { target: { value: '120' } })
    expect(face.setAction).toHaveBeenCalledWith({ angle: 120 })
    fireEvent.click(screen.getByRole('button', { name: 'Rotate 45°' }))
    expect(face.setAction).toHaveBeenCalledWith({ angle: 135 })
    fireEvent.click(screen.getByRole('button', { name: 'Reverse stops' }))
    expect(face.setAction).toHaveBeenCalledWith({ gradientStops: [{ colorHex: '#FF0000', location: 1 }, { colorHex: '#FF0000', location: 0 }] })
    fireEvent.click(screen.getByRole('button', { name: 'Add a stop' }))
    expect(face.setAction).toHaveBeenCalledWith({ gradientStops: [
      { colorHex: '#FF0000', location: 0 }, { colorHex: '#FF0000', location: 1 }, { colorHex: '#FF0000', location: 0.5 },
    ] })
    fireEvent.change(screen.getByLabelText('Stop 2 position'), { target: { value: '80' } })
    expect(face.setAction).toHaveBeenCalledWith({ gradientStops: [{ colorHex: '#FF0000', location: 0 }, { colorHex: '#FF0000', location: 0.8 }] })
    fireEvent.change(screen.getByLabelText('Stop 1 colour'), { target: { value: '#00ff00' } })
    expect(face.setAction).toHaveBeenCalledWith({ gradientStops: [{ colorHex: '#00FF00', location: 0 }, { colorHex: '#FF0000', location: 1 }] })
    fireEvent.change(screen.getByLabelText('Stop 1 hex'), { target: { value: '00ff00' } })
    expect(face.setAction).toHaveBeenCalledWith({ gradientStops: [{ colorHex: '#00FF00', location: 0 }, { colorHex: '#FF0000', location: 1 }] })
    fireEvent.click(screen.getByRole('button', { name: 'Remove stop 1' }))
    expect(face.setAction).toHaveBeenCalledWith({ gradientStops: [{ colorHex: '#FF0000', location: 1 }] })
  })

  it('disables removing the last stop, hides the angle for radial, and adds into the trailing gap', () => {
    const { face } = mount((draft) => {
      draft.settings = {
        ...APPEARANCE_DEFAULTS,
        action: { ...EMPTY_ACTION, mode: 'gradient', gradientType: 'radial', gradientStops: [{ colorHex: 'zz', location: 0.3 }] },
      }
    })
    expect(screen.getByRole('button', { name: 'Remove stop 1' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Rotate 45°' })).toHaveProperty('disabled', true)
    expect(screen.queryByLabelText('Angle')).toBeNull()
    expect(screen.getByLabelText('Stop 1 colour')).toHaveProperty('value', '#0969da')
    fireEvent.change(screen.getByLabelText('Stop 1 hex'), { target: { value: 'zzz' } })
    expect(face.setAction).toHaveBeenCalledWith({ gradientStops: [{ colorHex: 'zzz', location: 0.3 }] })
    fireEvent.click(screen.getByRole('button', { name: 'Add a stop' }))
    expect(face.setAction).toHaveBeenCalledWith({ gradientStops: [{ colorHex: 'zz', location: 0.3 }, { colorHex: 'zz', location: 0.65 }] })
  })

  it('adds a stop into the largest inner gap, mixing its neighbours', () => {
    const { face } = mount((draft) => {
      draft.settings = {
        ...APPEARANCE_DEFAULTS,
        action: {
          ...EMPTY_ACTION,
          mode: 'gradient',
          gradientStops: [{ colorHex: '#000000', location: 0 }, { colorHex: 'bad', location: 0.1 }, { colorHex: 'nope', location: 0.7 }, { colorHex: '#FFFFFF', location: 1 }],
        },
      }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add a stop' }))
    expect(face.setAction).toHaveBeenCalledWith({ gradientStops: [
      { colorHex: '#000000', location: 0 }, { colorHex: 'bad', location: 0.1 }, { colorHex: 'nope', location: 0.7 }, { colorHex: '#FFFFFF', location: 1 },
      { colorHex: '#888888', location: 0.4 },
    ] })
  })

  it('routes a surface tab through setSurface and shows its dot, status and override notice', () => {
    const { face, store } = mount((draft) => { draft.section = 'files' })
    expect(screen.getByText('Following IDEalize')).toBeDefined()
    // The drawer column hosts every rail pane, and the tab says so.
    expect(screen.getByText('The side panels: Files, Brains, Schedule and the rest.')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Font' }))
    fireEvent.click(screen.getByRole('option', { name: 'Avenir Next' }))
    expect(face.setSurface).toHaveBeenCalledWith('files', { fontName: 'Avenir Next' })
    fireEvent.change(screen.getByLabelText('Weight'), { target: { value: '600' } })
    expect(face.setSurface).toHaveBeenCalledWith('files', { fontWeight: 6 })
    fireEvent.change(screen.getByLabelText('Size'), { target: { value: '14.5' } })
    expect(face.setSurface).toHaveBeenCalledWith('files', { fontSize: 14.5 })
    fireEvent.change(screen.getByLabelText('Letter-spacing'), { target: { value: '0.3' } })
    expect(face.setSurface).toHaveBeenCalledWith('files', { tracking: 0.3 })
    fireEvent.change(screen.getByLabelText('Line-spacing'), { target: { value: '2' } })
    expect(face.setSurface).toHaveBeenCalledWith('files', { lineSpacing: 2 })
    fireEvent.change(screen.getByLabelText('Text colour'), { target: { value: '#112233' } })
    expect(face.setSurface).toHaveBeenCalledWith('files', { textColorHex: '#112233' })
    fireEvent.click(screen.getByRole('button', { name: /^Solid$/ }))
    expect(face.setSurface).toHaveBeenCalledWith('files', { bgMode: 'solid' })
    expect(screen.getByText('Auto')).toBeDefined()
    act(() => {
      store.update((draft) => {
        draft.settings = {
          ...APPEARANCE_DEFAULTS,
          surfaces: { ...APPEARANCE_DEFAULTS.surfaces, files: { ...EMPTY_SURFACE, bgMode: 'solid' } },
        }
      })
    })
    fireEvent.change(screen.getByLabelText('Colour'), { target: { value: '#FAFAFA' } })
    expect(face.setSurface).toHaveBeenCalledWith('files', { bgColorHex: '#FAFAFA' })
    act(() => {
      store.update((draft) => {
        draft.settings = {
          ...APPEARANCE_DEFAULTS,
          surfaces: { ...APPEARANCE_DEFAULTS.surfaces, files: { ...EMPTY_SURFACE, bgMode: 'gradient', bgOpacity: 0.5, fontSize: 14 } },
        }
      })
    })
    expect(screen.getByText('Customised')).toBeDefined()
    expect(screen.getByText('14')).toBeDefined()
    fireEvent.change(screen.getByLabelText('Angle'), { target: { value: '45' } })
    expect(face.setSurface).toHaveBeenCalledWith('files', { gradientAngle: 45 })
    fireEvent.click(screen.getByRole('button', { name: 'Reverse stops' }))
    expect(face.setSurface).toHaveBeenCalledWith('files', { bgGradientStops: [{ colorHex: '#FFFFFF', location: 1 }, { colorHex: '#FFFFFF', location: 0 }] })
    expect(screen.getByRole('tab', { name: 'Panels' }).querySelector('span')).not.toBeNull()
    expect(screen.getByRole('tab', { name: 'Document' }).querySelector('span')).toBeNull()
    fireEvent.change(screen.getByLabelText('Opacity'), { target: { value: '0.7' } })
    expect(face.setSurface).toHaveBeenCalledWith('files', { bgOpacity: 0.7 })
    fireEvent.click(screen.getByRole('button', { name: /^Angular$/ }))
    expect(face.setSurface).toHaveBeenCalledWith('files', { bgGradientType: 'angular' })
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(face.resetSection).toHaveBeenCalledWith('files')
    act(() => { store.update((draft) => { draft.section = 'theme' }) })
    expect(screen.getByText('Panels have colours of their own in Light mode, over the theme. Reset here clears them too.')).toBeDefined()
    // A panel's colours alone put the Theme tab's Reset up, and it says it clears them.
    expect(screen.getByText('Customised')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Reset' }).getAttribute('title')).toBe('Reset the theme, the action colour, the interface font and size, and every panel’s colours')
    const typeOnly = { ...APPEARANCE_DEFAULTS.surfaces, doc: { ...EMPTY_SURFACE, fontSize: 18 } }
    expect(themeCustomised({ ...APPEARANCE_DEFAULTS, surfaces: typeOnly })).toBe(false)
  })

  it('names the panels whose colours wait for the other scheme, on the Theme tab and on their own', () => {
    const { store } = mount((draft) => {
      draft.scheme = 'dark'
      draft.section = 'theme'
      draft.settings = {
        ...APPEARANCE_DEFAULTS,
        surfaces: {
          ...APPEARANCE_DEFAULTS.surfaces,
          chat: { ...EMPTY_SURFACE, textColorHex: '#000000', bgMode: 'solid', bgColorHex: '#FAFAFA' },
          doc: { ...EMPTY_SURFACE, bgMode: 'solid', bgColorHex: '#101014', scheme: 'dark' },
        },
      }
    })
    expect(screen.getByText('Document have colours of their own in Dark mode, over the theme. Reset here clears them too.')).toBeDefined()
    expect(screen.getByText('Chat keep colours for Light mode; they return when you switch.')).toBeDefined()
    act(() => { store.update((draft) => { draft.section = 'chat' }) })
    expect(screen.getByText('These colours were chosen in Light mode and show there. Changing one here moves them to Dark.')).toBeDefined()
    act(() => { store.update((draft) => { draft.section = 'doc' }) })
    expect(screen.queryByText(/were chosen in/)).toBeNull()
  })

  it('reads out how the text sits on a panel\'s own background, and says when it was deepened', () => {
    // Feedback cb68f5d5: a background chosen alone left the inherited ink and icons unchecked.
    const withChat = (chat: Partial<typeof EMPTY_SURFACE>) => (draft: AppearanceState): void => {
      draft.section = 'chat'
      draft.settings = { ...APPEARANCE_DEFAULTS, surfaces: { ...APPEARANCE_DEFAULTS.surfaces, chat: { ...EMPTY_SURFACE, ...chat } } }
    }
    const { store } = mount(withChat({}))
    // No background of its own: the theme's ground and ink stand, and nothing is read out.
    expect(screen.queryByText(/Text reads at/)).toBeNull()
    // The theme's dark ink on a dark ground picked in Light mode: deepened, and said so.
    act(() => { store.update(withChat({ bgMode: 'solid', bgColorHex: '#14233B', scheme: 'light' })) })
    expect(screen.getByText('Text reads at 1.1:1 on this background. Text and icons deepen along their own hue to stay readable: text to 4.5:1, icons to 3.0:1.')).toBeDefined()
    // A text colour that reads with every token clear of its floor is reported alone.
    act(() => { store.update(withChat({ bgMode: 'solid', bgColorHex: '#FFFFFF', textColorHex: '#000000', scheme: 'light' })) })
    expect(screen.getByText(/^Text reads at 21\.0:1 on this background\./)).toBeDefined()
    // A gradient through black, grey and white leaves no shade that reads across it.
    const stops = [{ colorHex: '#000000', location: 0 }, { colorHex: '#777777', location: 0.5 }, { colorHex: '#FFFFFF', location: 1 }]
    act(() => { store.update(withChat({ bgMode: 'gradient', bgGradientStops: stops, scheme: 'light' })) })
    expect(screen.getByText(/No shade of this text colour reaches 4\.5:1 across the whole background\. It reads at \d\.\d:1\.$/))
      .toBeDefined()
  })

  it('the Chat tab adds the chat panel card', () => {
    const { face } = mount((draft) => { draft.section = 'chat' })
    fireEvent.change(screen.getByLabelText('Input opacity'), { target: { value: '0.5' } })
    expect(face.setScalars).toHaveBeenCalledWith({ chatInputOpacity: 0.5 })
    fireEvent.change(screen.getByLabelText('Shadow'), { target: { value: '0.2' } })
    expect(face.setScalars).toHaveBeenCalledWith({ chatShadowOpacity: 0.2 })
    fireEvent.change(screen.getByLabelText('Margins'), { target: { value: '30' } })
    expect(face.setScalars).toHaveBeenCalledWith({ chatMargin: 30 })
    // Send on Return lives in the composer strip alone (ui-conversation's ReturnToggle).
    expect(screen.queryByRole('switch', { name: 'Send on Return' })).toBeNull()
  })

  it('the Document tab adds a margin of its own', () => {
    // JJ, 10 Sep 2026: the document view needs a margin setting, the way the
    // chat panel has one.
    const { face } = mount((draft) => { draft.section = 'doc' })
    fireEvent.change(screen.getByLabelText('Margins'), { target: { value: '40' } })
    expect(face.setScalars).toHaveBeenCalledWith({ docMargin: 40 })
    // The composer card's scalars belong to the Chat tab alone.
    expect(screen.queryByLabelText('Input opacity')).toBeNull()
  })

  it('the Terminal tab routes themes, ground, and type through setTerminal, monospaced families first', () => {
    const { face } = mount((draft) => {
      draft.section = 'terminal'
      draft.monospaced = ['Georgia']
    })
    expect(screen.getByText('Default terminal settings')).toBeDefined()
    // V0's terminal theme rows, in Theme.terminalThemes order, Linen selected.
    const themes = ['Linen', 'Ink', 'Y2K', 'IDEalize Dark', 'IDEalize Light', 'Solarized Dark', 'Classic Dark', 'Classic Light']
    for (const name of themes) expect(screen.getByRole('button', { name: new RegExp(`^${name}`) })).toBeDefined()
    expect(pressed(/^Linen/)).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: /^Ink/ }))
    expect(face.setTerminal).toHaveBeenCalledWith({ theme: 'ink' })
    fireEvent.change(screen.getByLabelText('Background'), { target: { value: '#102030' } })
    expect(face.setTerminal).toHaveBeenCalledWith({ bgHex: '#102030' })
    // The picker lists the monospaced family before the rest.
    fireEvent.click(screen.getByRole('button', { name: 'Font' }))
    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['System', 'DM Mono', 'Georgia', 'Avenir Next'])
    fireEvent.click(screen.getByRole('option', { name: 'Georgia' }))
    expect(face.setTerminal).toHaveBeenCalledWith({ fontName: 'Georgia' })
    fireEvent.change(screen.getByLabelText('Font size'), { target: { value: '18' } })
    expect(face.setTerminal).toHaveBeenCalledWith({ fontSize: 18 })
    fireEvent.change(screen.getByLabelText('Line-spacing'), { target: { value: '1.4' } })
    expect(face.setTerminal).toHaveBeenCalledWith({ lineSpacing: 1.4 })
    fireEvent.change(screen.getByLabelText('Margins'), { target: { value: '20' } })
    expect(face.setTerminal).toHaveBeenCalledWith({ margin: 20 })
  })

  it('marks the Terminal tab customised on a non-theme change and offers its reset', () => {
    const { face } = mount((draft) => {
      draft.section = 'terminal'
      draft.settings = { ...APPEARANCE_DEFAULTS, terminal: { ...APPEARANCE_DEFAULTS.terminal, fontSize: 20 } }
    })
    expect(screen.getByText('Customised')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(face.resetSection).toHaveBeenCalledWith('terminal')
  })

  it('keeps an unknown family selectable and shows the loading row before the Host answers', () => {
    mount((draft) => {
      draft.fonts = undefined
      draft.settings = { ...APPEARANCE_DEFAULTS, uiFont: 'Mystery Sans' }
    })
    const trigger = screen.getByRole('button', { name: 'Interface font' })
    expect(trigger.textContent).toContain('Mystery Sans')
    fireEvent.click(trigger)
    expect(screen.getByText('Reading installed fonts…')).toBeDefined()
    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['System', 'Mystery Sans'])
  })

  it('finds a family by typing, and Enter picks the first match', () => {
    const { face } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Interface font' }))
    const find = screen.getByRole('searchbox', { name: 'Type to find a font…' })
    expect(document.activeElement).toBe(find)
    fireEvent.change(find, { target: { value: 'geo' } })
    // The empty pick stays listed; the families narrow to the match.
    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['System', 'Georgia'])
    fireEvent.keyDown(find, { key: 'Enter' })
    expect(face.setUiFont).toHaveBeenCalledWith('Georgia')
    expect(screen.queryByRole('listbox')).toBeNull()
    // Reopening starts with the full list again.
    fireEvent.click(screen.getByRole('button', { name: 'Interface font' }))
    expect(screen.getAllByRole('option').length).toBeGreaterThan(2)
  })

  it('renders every family option in its own face and closes on Escape or the empty pick', () => {
    const { face } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Interface font' }))
    const georgia = screen.getByRole('option', { name: 'Georgia' })
    expect(georgia.style.fontFamily).toContain('"Georgia"')
    fireEvent.keyDown(georgia, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Interface font' }))
    fireEvent.click(screen.getByRole('option', { name: 'System' }))
    expect(face.setUiFont).toHaveBeenCalledWith('')
  })
})
