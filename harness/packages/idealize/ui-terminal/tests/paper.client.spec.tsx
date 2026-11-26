// @vitest-environment jsdom
/** The blueprint paper under the grid: which layers are drawn. The sheet's side is pinned in grid-styles. */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { TerminalPaperPaint } from '@idealize/appearance/client'
import { paperVariables, TerminalPaper } from '../src/client/TerminalView.tsx'

afterEach(cleanup)

const PAPER: TerminalPaperPaint = {
  ground: 'radial-gradient(red, blue)',
  grain: { opacity: 0.09, size: 540 },
  crease: true,
  grid: { image: 'linear-gradient(red, blue)', size: '50px 50px', blur: 0.7 },
  inkOpacity: 0.69,
  textShadow: '0 0 1px red',
  header: '#102030',
}

const layers = (): (string | null)[] =>
  [...screen.getByTestId('idealize-terminal-paper').children].map(child => child.getAttribute('data-layer'))

describe('TerminalPaper', () => {
  it('draws the ground, then the grid, the grain and the fold, out of the way of the pointer and of readers', () => {
    render(<TerminalPaper paper={PAPER} />)
    const paper = screen.getByTestId('idealize-terminal-paper')
    expect(paper.getAttribute('aria-hidden')).toBe('true')
    expect(paper.style.backgroundImage).toBe('radial-gradient(red, blue)')
    expect(layers()).toEqual(['grid', 'grain', 'crease'])
    const [grid, grain] = [...paper.children] as HTMLElement[]
    expect(grid!.style.backgroundSize).toBe('50px 50px')
    expect(grid!.style.filter).toBe('blur(0.7px)')
    expect(grain!.style.opacity).toBe('0.09')
    expect(grain!.style.backgroundSize).toBe('540px 540px')
  })

  it('leaves out the layers a paper does not have', () => {
    render(<TerminalPaper paper={{ ground: PAPER.ground, crease: false, inkOpacity: 1, textShadow: 'none', header: '#102030' }} />)
    expect(layers()).toEqual([])
  })
})

describe('paperVariables', () => {
  it('hands the ink opacity and the text shadow to the sheet', () => {
    expect(paperVariables(PAPER)).toEqual({ '--idealize-paper-ink-opacity': '0.69', '--idealize-paper-text-shadow': '0 0 1px red' })
    expect(paperVariables({ ...PAPER, blockCover: 'linear-gradient(red, red)' })['--idealize-paper-block-cover']).toBe('linear-gradient(red, red)')
  })
})
