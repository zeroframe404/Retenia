import { describe, expect, it } from 'vitest'
import type { Chunk } from './entities'
import { emptySourceLocator, parseSourceLocator } from './locators'

/** Only the two fields the parser reads; the rest of a `Chunk` is irrelevant to it. */
function chunk(locator: Chunk['locator'], unitId: string | null = null) {
  return { unitId, locator }
}

describe('parseSourceLocator()', () => {
  it('reads a paged locator with its block ids', () => {
    expect(parseSourceLocator(chunk({ page: 112, block_ids: ['b1', 'b2'] }, 'unit-1'))).toEqual({
      unitId: 'unit-1',
      page: 112,
      tStartMs: null,
      tEndMs: null,
      label: null,
      selector: null,
      blockIds: ['b1', 'b2'],
    })
  })

  it('reads a media locator in milliseconds, and its legacy `timestamp` alias', () => {
    expect(parseSourceLocator(chunk({ t_start: 750_000, t_end: 810_000 })).tStartMs).toBe(750_000)
    expect(parseSourceLocator(chunk({ t_start: 750_000, t_end: 810_000 })).tEndMs).toBe(810_000)
    expect(parseSourceLocator(chunk({ timestamp: 90_000 })).tStartMs).toBe(90_000)
    // The canonical key wins when both are present.
    expect(parseSourceLocator(chunk({ t_start: 1, timestamp: 2 })).tStartMs).toBe(1)
  })

  it('keeps the label and the selector when the parser produced them', () => {
    const locator = parseSourceLocator(chunk({ label: 'p. 112', selector: '#h2-3' }))
    expect(locator.label).toBe('p. 112')
    expect(locator.selector).toBe('#h2-3')
  })

  it('is total: a null, malformed or hostile locator becomes the empty one', () => {
    expect(parseSourceLocator(chunk(null, 'unit-9'))).toEqual(emptySourceLocator('unit-9'))
    expect(parseSourceLocator(chunk({ page: 'doce', block_ids: 'b1' }))).toEqual(
      emptySourceLocator(),
    )
    expect(parseSourceLocator(chunk({ page: Number.NaN })).page).toBeNull()
    expect(parseSourceLocator(chunk({ label: '' })).label).toBeNull()
  })

  it('keeps only the string entries of block_ids', () => {
    expect(parseSourceLocator(chunk({ block_ids: ['b1', 3, null, '', 'b2'] })).blockIds).toEqual([
      'b1',
      'b2',
    ])
  })

  it('carries the unit id through, which is what actually opens the source', () => {
    expect(parseSourceLocator(chunk({ page: 4 }, 'unit-4')).unitId).toBe('unit-4')
  })
})
