// @vitest-environment jsdom
/**
 * The three-dot control: it holds the project's access mode alone since the
 * brain chip took the brain, and its panel survives a tool row that scrolls.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { ComposerOverflow, type ComposerOverflowProps } from '../src/client/ComposerOverflow.tsx'
import { en } from '../src/client/locales.ts'

const t = makeTranslate(en, commonEn) as unknown as ComposerOverflowProps['t']

function mount(locked = false) {
  const props = { locked, control: <button type="button" data-access-chip="">Workspace write</button>, t } as unknown as ComposerOverflowProps
  const view = render(<ComposerOverflow {...props} />)
  const trigger = (): HTMLButtonElement => view.container.querySelector('[data-composer-overflow-trigger]')!
  return { view, trigger }
}

const panel = (): Element | null => document.querySelector('[data-composer-overflow-panel]')

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('the three-dot control', () => {
  it('holds the panel shut until it is pressed', () => {
    const { trigger } = mount()
    expect(panel()).toBeNull()
    fireEvent.click(trigger())
    expect(panel()).not.toBeNull()
    fireEvent.click(trigger())
    expect(panel()).toBeNull()
  })

  it('mounts the panel outside the trigger, so a scrolling tool row cannot clip it', () => {
    const { view, trigger } = mount()
    fireEvent.click(trigger())
    expect(view.container.contains(panel())).toBe(false)
  })

  it('places the composer\'s own access chip, and names nothing else', () => {
    const { trigger } = mount()
    fireEvent.click(trigger())
    expect(panel()?.querySelector('[data-access-chip]')).not.toBeNull()
    expect(panel()?.textContent).toContain('Project access')
    expect(panel()?.textContent).not.toContain('Brain')
  })

  it('closes on a pointer landing outside it, and stays open for a menu it opened', () => {
    const { trigger } = mount()
    fireEvent.click(trigger())
    const menu = document.body.appendChild(document.createElement('div'))
    menu.setAttribute('role', 'menu')
    fireEvent.pointerDown(menu)
    expect(panel()).not.toBeNull()
    menu.remove()
    fireEvent.pointerDown(document.body)
    expect(panel()).toBeNull()
  })

  it('a locked seat refuses the trigger', () => {
    expect(mount(true).trigger().disabled).toBe(true)
  })
})
