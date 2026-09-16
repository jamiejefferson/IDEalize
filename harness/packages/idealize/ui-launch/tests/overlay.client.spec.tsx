// @vitest-environment jsdom
// The launch layer: renders the centred mark while parked or playing (the
// attribute the machine's foreign-occupant count excludes), nothing once done.
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { LAUNCH_LAYER_ATTRIBUTE, type LaunchPhase } from '../src/client/launch-machine.ts'
import { LaunchOverlay, type LaunchOverlayProps } from '../src/client/LaunchOverlay.tsx'
// Type-only: the slot-key merge the props type reads.
import type {} from '../src/client/index.ts'

// The root seat's selector hooks: the layer reads neither list.
const unused = (() => undefined) as unknown as LaunchOverlayProps['useSessions'] & LaunchOverlayProps['useWorkspaces']

afterEach(cleanup)

function layer(phase: LaunchPhase) {
  const phases = createSnapshotStore<LaunchPhase>(phase)
  return render(
    <LaunchOverlay
      useSessions={unused}
      useWorkspaces={unused}
      useLaunch={bindSnapshotSelector(phases)}
    />,
  )
}

describe('LaunchOverlay', () => {
  it('renders the opaque layer with the centred mark while parked', () => {
    const view = layer('parked')
    const root = view.container.querySelector(`[${LAUNCH_LAYER_ATTRIBUTE}]`)
    expect(root).not.toBeNull()
    expect(root?.getAttribute('aria-hidden')).toBe('true')
    expect(root?.querySelector('img')?.src).toContain('data:image/png;base64,')
  })

  it('keeps the layer mounted while playing (the fade is the sheet\'s job)', () => {
    const view = layer('playing')
    expect(view.container.querySelector(`[${LAUNCH_LAYER_ATTRIBUTE}]`)).not.toBeNull()
  })

  it('renders nothing once done', () => {
    const view = layer('done')
    expect(view.container.innerHTML).toBe('')
    expect(view.container.querySelector(`[${LAUNCH_LAYER_ATTRIBUTE}]`)).toBeNull()
  })
})
