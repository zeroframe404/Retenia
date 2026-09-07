import { describe, expect, it } from 'vitest'
import { selectionToPdfSelection, toFractionalRect } from './pdf-selection'

describe('toFractionalRect', () => {
  it('converts a viewport rect to a fraction of its container', () => {
    const container = { left: 100, top: 50, width: 400, height: 800 }
    const rect = { left: 200, top: 250, width: 100, height: 40 }
    expect(toFractionalRect(rect, container)).toEqual({
      x: 0.25,
      y: 0.25,
      width: 0.25,
      height: 0.05,
    })
  })

  it('is resolution-independent: the same page position at 2x zoom yields the same fraction', () => {
    const container1x = { left: 0, top: 0, width: 400, height: 800 }
    const rect1x = { left: 40, top: 80, width: 40, height: 20 }
    const container2x = { left: 0, top: 0, width: 800, height: 1600 }
    const rect2x = { left: 80, top: 160, width: 80, height: 40 }
    expect(toFractionalRect(rect1x, container1x)).toEqual(toFractionalRect(rect2x, container2x))
  })
})

describe('selectionToPdfSelection', () => {
  const containerRect = { left: 0, top: 0, width: 400, height: 800 }
  const clientRect = { left: 40, top: 80, width: 120, height: 20 }

  function fakeSelection(overrides: Partial<Selection> = {}): Selection {
    return {
      isCollapsed: false,
      rangeCount: 1,
      toString: () => 'texto resaltado',
      getRangeAt: () =>
        ({
          commonAncestorContainer: document.createTextNode('x'),
          getClientRects: () => [clientRect] as unknown as DOMRectList,
        }) as unknown as Range,
      ...overrides,
    } as Selection
  }

  it('builds a selection with page-relative fractional rects and a viewport toolbar position', () => {
    const result = selectionToPdfSelection(fakeSelection(), () => ({
      pageNumber: 3,
      containerRect,
    }))
    expect(result).toEqual({
      page: 3,
      rects: [{ x: 0.1, y: 0.1, width: 0.3, height: 0.025 }],
      quote: 'texto resaltado',
      toolbarPosition: { x: 40 + 120 / 2, y: 80 },
    })
  })

  it('returns null when the selection is collapsed', () => {
    const result = selectionToPdfSelection(fakeSelection({ isCollapsed: true }), () => ({
      pageNumber: 1,
      containerRect,
    }))
    expect(result).toBeNull()
  })

  it('returns null when the selection is null', () => {
    expect(selectionToPdfSelection(null, () => null)).toBeNull()
  })

  it('returns null when the selection text is only whitespace', () => {
    const result = selectionToPdfSelection(fakeSelection({ toString: () => '   ' }), () => ({
      pageNumber: 1,
      containerRect,
    }))
    expect(result).toBeNull()
  })

  it('returns null when the selection is outside any page', () => {
    const result = selectionToPdfSelection(fakeSelection(), () => null)
    expect(result).toBeNull()
  })

  it('returns null when the range reports no client rects', () => {
    const result = selectionToPdfSelection(
      fakeSelection({
        getRangeAt: () =>
          ({
            commonAncestorContainer: document.createTextNode('x'),
            getClientRects: () => [] as unknown as DOMRectList,
          }) as unknown as Range,
      }),
      () => ({ pageNumber: 1, containerRect }),
    )
    expect(result).toBeNull()
  })
})
