import { describe, expect, it } from 'vitest'
import {
  CENTER_MIN, clampWidth, computeColumns,
  DETAILS_DEFAULT, DETAILS_MIN, DRAWER_DEFAULT, SIDEBAR_COLLAPSED, SIDEBAR_DEFAULT, SIDEBAR_MIN,
} from '@deepseek-ai/dsh-client-ui-layout/src/client/columns.ts'

// Numeric preference form (0 = closed); helpers keep the scenario names readable.
const open = (width: number) => width
const closed = (_width: number) => 0

describe('clampWidth', () => {
  it('clamps into the range and rounds', () => {
    expect(clampWidth(250.4, 240, 420)).toBe(250)
    expect(clampWidth(100, 240, 420)).toBe(240)
    expect(clampWidth(9999, 240, 420)).toBe(420)
  })
})

describe('computeColumns', () => {
  it('step 1: everything fits at preferred widths', () => {
    const cols = computeColumns(1920, open(SIDEBAR_DEFAULT), open(DETAILS_DEFAULT))
    expect(cols).toEqual({ sidebar: 280, center: 1920 - 280 - 360, details: 360, deck: 0, drawer: 0 })
  })

  it('closed sidebar keeps its compact rail while closed details contribute zero width', () => {
    expect(computeColumns(1920, closed(300), closed(360)))
      .toEqual({ sidebar: SIDEBAR_COLLAPSED, center: 1920 - SIDEBAR_COLLAPSED, details: 0, deck: 0, drawer: 0 })
  })

  it('preferences beyond the clamp range are clamped before solving', () => {
    const cols = computeColumns(1920, open(9999), open(1))
    expect(cols.sidebar).toBe(420)
    expect(cols.details).toBe(300)
    expect(computeColumns(1920, open(1), open(DETAILS_DEFAULT)).sidebar).toBe(SIDEBAR_MIN)
  })

  it('step 2: details shrinks first, center pinned at min', () => {
    // 30px short of a full fit: details concedes to 360 - 30 = 330.
    const cols = computeColumns(280 + 360 + CENTER_MIN - 30, open(SIDEBAR_DEFAULT), open(DETAILS_DEFAULT))
    expect(cols).toEqual({ sidebar: 280, center: CENTER_MIN, details: 330, deck: 0, drawer: 0 })
  })

  it('boundary: exactly at the step-1/step-2 seam', () => {
    const cols = computeColumns(300 + 360 + CENTER_MIN, open(300), open(360))
    expect(cols).toEqual({ sidebar: 300, center: CENTER_MIN, details: 360, deck: 0, drawer: 0 })
    const one = computeColumns(300 + 360 + CENTER_MIN - 1, open(300), open(360))
    expect(one).toEqual({ sidebar: 300, center: CENTER_MIN, details: 359, deck: 0, drawer: 0 })
  })

  it('step 3: details auto-closes when its min still starves center — sidebar holds its preference', () => {
    // 10px short of details' floor fitting → details 0; sidebar untouched: center = viewport - 280.
    const viewport = 280 + DETAILS_MIN + CENTER_MIN - 10
    const cols = computeColumns(viewport, open(SIDEBAR_DEFAULT), open(DETAILS_DEFAULT))
    expect(cols).toEqual({ sidebar: 280, center: viewport - 280, details: 0, deck: 0, drawer: 0 })
  })

  it('the sidebar never concedes: center absorbs the deficit below CENTER_MIN', () => {
    // 700 < 280+CENTER_MIN: sidebar keeps 280, center takes 420 < CENTER_MIN.
    const cols = computeColumns(700, open(SIDEBAR_DEFAULT), closed(DETAILS_DEFAULT))
    expect(cols).toEqual({ sidebar: SIDEBAR_DEFAULT, center: 420, details: 0, deck: 0, drawer: 0 })
  })

  it('sidebar-closed narrow window: details concedes then auto-closes', () => {
    const fits = computeColumns(SIDEBAR_COLLAPSED + DETAILS_MIN + CENTER_MIN, closed(300), open(DETAILS_DEFAULT))
    expect(fits).toEqual({ sidebar: SIDEBAR_COLLAPSED, center: CENTER_MIN, details: DETAILS_MIN, deck: 0, drawer: 0 })
    const starved = computeColumns(SIDEBAR_COLLAPSED + DETAILS_MIN + CENTER_MIN - 1, closed(300), open(DETAILS_DEFAULT))
    expect(starved).toEqual({
      sidebar: SIDEBAR_COLLAPSED,
      center: DETAILS_MIN + CENTER_MIN - 1,
      details: 0,
      deck: 0, drawer: 0,
    })
  })

  it('tiny viewport: details closes, sidebar holds, center takes the remainder', () => {
    const cols = computeColumns(400, open(SIDEBAR_DEFAULT), open(DETAILS_DEFAULT))
    expect(cols.details).toBe(0)
    expect(cols.sidebar).toBe(SIDEBAR_DEFAULT)
    expect(cols.center).toBe(Math.max(0, 400 - SIDEBAR_DEFAULT))
  })

  it('recovery is pure: re-widening restores preferred widths untouched', () => {
    const squeezed = computeColumns(280 + DETAILS_MIN + CENTER_MIN - 10, open(SIDEBAR_DEFAULT), open(DETAILS_DEFAULT))
    expect(squeezed.details).toBe(0)
    const restored = computeColumns(1920, open(SIDEBAR_DEFAULT), open(DETAILS_DEFAULT))
    expect(restored.details).toBe(DETAILS_DEFAULT)
    expect(restored.sidebar).toBe(SIDEBAR_DEFAULT)
  })
})

describe('computeColumns — the drawer column', () => {
  it('step 1: an open drawer takes its clamped preference beside details', () => {
    const cols = computeColumns(1920, open(SIDEBAR_DEFAULT), open(DETAILS_DEFAULT), DRAWER_DEFAULT)
    expect(cols).toEqual({ sidebar: 280, center: 1920 - 280 - 360 - 420, details: 360, deck: 0, drawer: 420 })
  })

  it('details concedes and closes before the drawer gives anything up', () => {
    // 280 + 360 + 420 + CENTER_MIN = 1540; at 1340 details shrinks to 1340-280-420-480 = 160 < DETAILS_MIN → closes.
    const cols = computeColumns(1340, open(SIDEBAR_DEFAULT), open(DETAILS_DEFAULT), DRAWER_DEFAULT)
    expect(cols).toEqual({ sidebar: 280, center: 1340 - 280 - 420, details: 0, deck: 0, drawer: 420 })
  })

  it('the sidebar concedes to its rail before the drawer gives anything up', () => {
    // 280 + 420 + 480 = 1180 > 1050: the sidebar rails (56) and the drawer keeps its 420.
    const squeezed = computeColumns(1050, open(SIDEBAR_DEFAULT), closed(DETAILS_DEFAULT), DRAWER_DEFAULT)
    expect(squeezed).toEqual({ sidebar: SIDEBAR_COLLAPSED, center: 1050 - SIDEBAR_COLLAPSED - 420, details: 0, deck: 0, drawer: 420 })
  })

  it('the drawer shrinks toward its floor and stays visible when center starves past the rail', () => {
    // 56 + 420 + 480 = 956 > 800: the drawer concedes to max(320, 800-56-480) = 320.
    const starved = computeColumns(800, open(SIDEBAR_DEFAULT), closed(DETAILS_DEFAULT), DRAWER_DEFAULT)
    expect(starved).toEqual({ sidebar: SIDEBAR_COLLAPSED, center: 800 - SIDEBAR_COLLAPSED - 320, details: 0, deck: 0, drawer: 320 })
  })

  it('the rail concession is derived: closing the drawer restores the full sidebar', () => {
    const conceded = computeColumns(1050, open(SIDEBAR_DEFAULT), closed(DETAILS_DEFAULT), DRAWER_DEFAULT)
    expect(conceded.sidebar).toBe(SIDEBAR_COLLAPSED)
    const restored = computeColumns(1050, open(SIDEBAR_DEFAULT), closed(DETAILS_DEFAULT), 0)
    expect(restored.sidebar).toBe(SIDEBAR_DEFAULT)
  })
})

describe('computeColumns — the desktop app\'s default window', () => {
  it('at 1280 wide (1232 beside the rail) the open drawer drags 320 up to 696: the sidebar rails past 472', () => {
    const viewport = 1280 - 48
    expect(computeColumns(viewport, open(SIDEBAR_DEFAULT), closed(DETAILS_DEFAULT), DRAWER_DEFAULT).drawer).toBe(420)
    expect(computeColumns(viewport, open(SIDEBAR_DEFAULT), closed(DETAILS_DEFAULT), 320).drawer).toBe(320)
    // Up to 472 the full sidebar still fits beside the drawer.
    const atCap = computeColumns(viewport, open(SIDEBAR_DEFAULT), closed(DETAILS_DEFAULT), 472)
    expect(atCap).toMatchObject({ sidebar: SIDEBAR_DEFAULT, drawer: 472 })
    // One pixel past it the sidebar concedes to the rail and the drag continues.
    const past = computeColumns(viewport, open(SIDEBAR_DEFAULT), closed(DETAILS_DEFAULT), 473)
    expect(past).toMatchObject({ sidebar: SIDEBAR_COLLAPSED, drawer: 473 })
    const wide = computeColumns(viewport, open(SIDEBAR_DEFAULT), closed(DETAILS_DEFAULT), 720)
    expect(wide).toMatchObject({ sidebar: SIDEBAR_COLLAPSED, drawer: viewport - SIDEBAR_COLLAPSED - CENTER_MIN })
  })
})

describe('computeColumns — degenerate viewports', () => {
  it('sidebar closed and viewport below CENTER_MIN: details auto-closes, center takes the rest', () => {
    // Reaches step 3's auto-close with the compact rail sidebar.
    expect(computeColumns(500, closed(300), open(DETAILS_DEFAULT)))
      .toEqual({ sidebar: SIDEBAR_COLLAPSED, center: 500 - SIDEBAR_COLLAPSED, details: 0, deck: 0, drawer: 0 })
  })
})
