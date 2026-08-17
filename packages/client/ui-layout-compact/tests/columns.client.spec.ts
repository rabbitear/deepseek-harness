import { describe, expect, it } from 'vitest'
import {
  CENTER_MIN, clampWidth, computeColumns,
  DETAILS_DEFAULT, DETAILS_MIN, SIDEBAR_COLLAPSED, SIDEBAR_DEFAULT, SIDEBAR_MIN,
} from '@deepseek-ai/dsh-client-ui-layout-compact/src/client/columns.ts'

// Numeric preference form (0 = closed); helpers keep the scenario names readable.
const open = (width: number) => width
const closed = (_width: number) => 0

describe('clampWidth', () => {
  it('clamps into the range and rounds', () => {
    expect(clampWidth(180.4, 180, 320)).toBe(180)
    expect(clampWidth(100, 180, 320)).toBe(180)
    expect(clampWidth(9999, 180, 320)).toBe(320)
  })
})

describe('computeColumns (compact geometry)', () => {
  it('step 1: everything fits at preferred widths on a 1366px viewport', () => {
    const cols = computeColumns(1366, open(SIDEBAR_DEFAULT), open(DETAILS_DEFAULT))
    expect(cols).toEqual({ sidebar: 220, center: 1366 - 220 - 300, details: 300 })
  })

  it('closed sidebar keeps its compact 32px rail while closed details contribute zero width', () => {
    expect(computeColumns(1366, closed(300), closed(300)))
      .toEqual({ sidebar: SIDEBAR_COLLAPSED, center: 1366 - SIDEBAR_COLLAPSED, details: 0 })
  })

  it('preferences beyond the clamp range are clamped before solving', () => {
    const cols = computeColumns(1366, open(9999), open(1))
    expect(cols.sidebar).toBe(320)
    expect(cols.details).toBe(260)
    expect(computeColumns(1366, open(1), open(DETAILS_DEFAULT)).sidebar).toBe(SIDEBAR_MIN)
  })

  it('step 2: details shrinks first, center pinned at min (compact values)', () => {
    // 220 + 300 + 480 = 1000 > 990; details concedes to 990-220-480 = 290.
    const cols = computeColumns(990, open(SIDEBAR_DEFAULT), open(DETAILS_DEFAULT))
    expect(cols).toEqual({ sidebar: 220, center: CENTER_MIN, details: 290 })
  })

  it('boundary: exactly at the step-1/step-2 seam', () => {
    const cols = computeColumns(220 + 300 + CENTER_MIN, open(220), open(300))
    expect(cols).toEqual({ sidebar: 220, center: CENTER_MIN, details: 300 })
    const one = computeColumns(220 + 300 + CENTER_MIN - 1, open(220), open(300))
    expect(one).toEqual({ sidebar: 220, center: CENTER_MIN, details: 299 })
  })

  it('step 3: details auto-closes when its min still starves center — sidebar holds its preference', () => {
    // 220 + 260 + 480 = 960 > 950 → details 0; sidebar untouched: center = 950-220 = 730.
    const cols = computeColumns(950, open(SIDEBAR_DEFAULT), open(DETAILS_DEFAULT))
    expect(cols).toEqual({ sidebar: 220, center: 730, details: 0 })
  })

  it('the sidebar never concedes: center absorbs the deficit below CENTER_MIN', () => {
    // 600 < 220+480: sidebar keeps 220, center takes 380 < CENTER_MIN.
    const cols = computeColumns(600, open(SIDEBAR_DEFAULT), closed(DETAILS_DEFAULT))
    expect(cols).toEqual({ sidebar: SIDEBAR_DEFAULT, center: 380, details: 0 })
  })

  it('sidebar-closed narrow window: details concedes then auto-closes', () => {
    const fits = computeColumns(SIDEBAR_COLLAPSED + DETAILS_MIN + CENTER_MIN, closed(300), open(DETAILS_DEFAULT))
    expect(fits).toEqual({ sidebar: SIDEBAR_COLLAPSED, center: CENTER_MIN, details: DETAILS_MIN })
    const starved = computeColumns(SIDEBAR_COLLAPSED + DETAILS_MIN + CENTER_MIN - 1, closed(300), open(DETAILS_DEFAULT))
    expect(starved).toEqual({
      sidebar: SIDEBAR_COLLAPSED,
      center: DETAILS_MIN + CENTER_MIN - 1,
      details: 0,
    })
  })

  it('tiny viewport: details closes, sidebar holds, center takes the remainder', () => {
    const cols = computeColumns(400, open(SIDEBAR_DEFAULT), open(DETAILS_DEFAULT))
    expect(cols.details).toBe(0)
    expect(cols.sidebar).toBe(SIDEBAR_DEFAULT)
    expect(cols.center).toBe(Math.max(0, 400 - SIDEBAR_DEFAULT))
  })

  it('recovery is pure: re-widening restores preferred widths untouched', () => {
    const squeezed = computeColumns(800, open(SIDEBAR_DEFAULT), open(DETAILS_DEFAULT))
    expect(squeezed.details).toBe(0)
    const restored = computeColumns(1366, open(SIDEBAR_DEFAULT), open(DETAILS_DEFAULT))
    expect(restored.details).toBe(DETAILS_DEFAULT)
    expect(restored.sidebar).toBe(SIDEBAR_DEFAULT)
  })
})

describe('computeColumns — degenerate viewports (compact)', () => {
  it('sidebar closed and viewport below CENTER_MIN: details auto-closes, center takes the rest', () => {
    expect(computeColumns(400, closed(300), open(DETAILS_DEFAULT)))
      .toEqual({ sidebar: SIDEBAR_COLLAPSED, center: 400 - SIDEBAR_COLLAPSED, details: 0 })
  })

  it('1024x768 viewport: sidebar auto-collapses at 768 breakpoint, center has room for details', () => {
    // At 1024px wide: sidebar collapsed (32px), details open at default (300px)
    // Center = 1024 - 32 - 300 = 692 > CENTER_MIN (480) — everything fits.
    const cols = computeColumns(1024, closed(220), open(DETAILS_DEFAULT))
    expect(cols).toEqual({ sidebar: SIDEBAR_COLLAPSED, center: 692, details: 300 })
  })

  it('1024px with sidebar manually re-expanded: details concedes, center squeezed', () => {
    // Manual re-expand passes the sidebar preference (220) — details concedes.
    // 220 + 300 + 480 = 1000 > 1024? No — 1000 <= 1024 fits.
    const cols = computeColumns(1024, open(220), open(DETAILS_DEFAULT))
    expect(cols).toEqual({ sidebar: 220, center: 1024 - 220 - 300, details: 300 })
  })
})
