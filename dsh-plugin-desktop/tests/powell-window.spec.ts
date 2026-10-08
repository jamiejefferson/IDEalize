// Where Powell sits: bottom centre by default, where it was left when that
// display is still attached, and only the owl itself is kept on screen.
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: {}, BrowserWindow: class {}, ipcMain: { on: vi.fn(), off: vi.fn() }, nativeImage: {}, screen: {} }))

const { CENTRED_LAYOUT, OWL_HEIGHT, OWL_WIDTH, powellFrame, powellPlacement, storedOf, POWELL_HEIGHT, POWELL_WIDTH } = await import('../src/powell-window.ts')

const main = { id: 1, workArea: { x: 0, y: 25, width: 1728, height: 1055 } }
const side = { id: 2, workArea: { x: 1728, y: 0, width: 1920, height: 1080 } }

describe('powellPlacement', () => {
  it('sits bottom centre on the display under the cursor', () => {
    const frame = powellPlacement(undefined, [main, side], side)
    expect(frame.owl).toEqual({ x: 1728 + (1920 - OWL_WIDTH) / 2, y: 1080 - OWL_HEIGHT - 8 })
    expect(frame.layout).toEqual(CENTRED_LAYOUT)
    expect(frame.bounds).toEqual({ x: 1728 + (1920 - POWELL_WIDTH) / 2, y: 1080 - 8 - POWELL_HEIGHT, width: POWELL_WIDTH, height: POWELL_HEIGHT })
  })

  it('returns to where it was left, reading positions stored before 2.0.1 unchanged', () => {
    expect(powellPlacement({ displayId: 1, x: 200, y: 400 }, [main, side], side).bounds).toEqual({ x: 200, y: 400, width: POWELL_WIDTH, height: POWELL_HEIGHT })
    const owl = { x: 640, y: 500 }
    expect(powellPlacement({ displayId: 1, ...storedOf(owl) }, [main], main).owl).toEqual(owl)
  })

  it('forgets a detached display', () => {
    expect(powellPlacement({ displayId: 9, x: 5, y: 5 }, [main], main).owl.x).toBe((1728 - OWL_WIDTH) / 2)
  })
})

describe('powellFrame', () => {
  it('lets the owl reach every edge of the work area', () => {
    const area = main.workArea
    expect(powellFrame({ x: -50, y: 2000 }, area).owl).toEqual({ x: 0, y: 25 + 1055 - OWL_HEIGHT })
    expect(powellFrame({ x: 5000, y: -50 }, area).owl).toEqual({ x: 1728 - OWL_WIDTH, y: 25 })
  })

  it('keeps the box on screen sideways and moves the owl inside it', () => {
    const left = powellFrame({ x: 0, y: 600 }, main.workArea)
    expect(left.bounds.x).toBe(0)
    expect(left.layout.owlX).toBe(0)
    const right = powellFrame({ x: 1728 - OWL_WIDTH, y: 600 }, main.workArea)
    expect(right.bounds.x + POWELL_WIDTH).toBe(1728)
    expect(right.layout.owlX).toBe(POWELL_WIDTH - OWL_WIDTH)
  })

  it('flips the bubble below the owl when there is no room above it', () => {
    const top = powellFrame({ x: 700, y: 25 }, main.workArea)
    expect(top.layout.flip).toBe(true)
    expect(top.bounds.y).toBe(25)
    const low = powellFrame({ x: 700, y: 25 + POWELL_HEIGHT - OWL_HEIGHT }, main.workArea)
    expect(low.layout.flip).toBe(false)
    expect(low.bounds.y).toBe(25)
  })

  it('mid-drag keeps the box centred on the owl so the owl never shifts inside it', () => {
    const frame = powellFrame({ x: 0, y: 600 }, main.workArea, false)
    expect(frame.layout.owlX).toBe(CENTRED_LAYOUT.owlX)
    expect(frame.bounds.x).toBe(-CENTRED_LAYOUT.owlX)
  })
})
