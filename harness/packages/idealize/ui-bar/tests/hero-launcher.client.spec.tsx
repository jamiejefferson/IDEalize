// @vitest-environment jsdom
// The welcome card inside the composer: the project row with the composer live
// beneath it, or the way in when no project is open.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { en } from '../src/client/locales.ts'
import { HeroLauncher } from '../src/client/HeroLauncher.tsx'
import type { HeroLauncherInjected, HeroLauncherProps, LauncherSession } from '../src/client/HeroLauncher.tsx'
// Type-only: the locale-namespace and slot-key merges the props type reads.
import type {} from '../src/client/index.ts'

const t: HeroLauncherProps['t'] = makeTranslate(en, commonEn)
const unused = (() => undefined) as unknown as HeroLauncherProps['useSessions'] & HeroLauncherProps['useWorkspaces']

function mount(projectOpen: boolean, session: LauncherSession = { id: 's1', blank: true }) {
  const injected = { currentSession: () => session, spaces: {} } as unknown as HeroLauncherInjected
  return render(
    <HeroLauncher
      t={t}
      useSessions={unused}
      useWorkspaces={unused}
      {...injected}
      projectRow={<span data-testid="project-row">idealize-v1</span>}
      projectOpen={projectOpen}
      recentProjects={<div data-recent-projects="">recent cards</div>}
      onNewProject={vi.fn()}
      onFindProject={vi.fn()}
    />,
  )
}

afterEach(cleanup)

describe('HeroLauncher', () => {
  it('with a project, is the project row alone, and leaves the composer showing', () => {
    const { container, getByTestId } = mount(true)
    expect(getByTestId('project-row').textContent).toBe('idealize-v1')
    expect(container.querySelector('[data-hero-undecided]')).toBeNull()
  })

  it('without a project, offers recents, New project and Find a folder, with the composer hidden', () => {
    const { container, getByText } = mount(false)
    expect(container.querySelector('[data-hero-undecided]')).not.toBeNull()
    expect(container.querySelector('[data-recent-projects]')).not.toBeNull()
    expect(getByText('New project')).toBeTruthy()
    expect(container.querySelector('[data-project-action="find"]')).not.toBeNull()
  })

  it('a Studio chat renders nothing, with or without a project', () => {
    expect(mount(false, { id: 's1', blank: true, space: 'studio' }).container.textContent).toBe('')
    cleanup()
    expect(mount(true, { id: 's1', blank: true, space: 'studio' }).container.textContent).toBe('')
  })
})
