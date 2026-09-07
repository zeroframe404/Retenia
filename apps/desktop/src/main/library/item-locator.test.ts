import type { SourceLocator } from '@retenia/core'
import { describe, expect, it } from 'vitest'
import { buildItemLocatorFromChunk } from './item-locator'

function locator(overrides: Partial<SourceLocator> = {}): SourceLocator {
  return {
    unitId: null,
    page: null,
    tStartMs: null,
    tEndMs: null,
    label: null,
    selector: null,
    blockIds: [],
    ...overrides,
  }
}

describe('buildItemLocatorFromChunk', () => {
  it('carries a paged locator (page and label, no selector/timestamps)', () => {
    expect(
      buildItemLocatorFromChunk(
        'chunk-1',
        locator({ page: 112, label: 'p. 112', blockIds: ['b-1'] }),
      ),
    ).toEqual({ chunkId: 'chunk-1', page: 112, label: 'p. 112', blockIds: ['b-1'] })
  })

  it('carries a media clip locator, tStartMs and tEndMs both', () => {
    expect(
      buildItemLocatorFromChunk(
        'chunk-2',
        locator({ tStartMs: 30_000, tEndMs: 45_000, label: '0:30', blockIds: [] }),
      ),
    ).toEqual({ chunkId: 'chunk-2', tStartMs: 30_000, tEndMs: 45_000, label: '0:30', blockIds: [] })
  })

  it('carries a web/EPUB locator by its selector alone — no page, no timestamp to fall back on', () => {
    expect(
      buildItemLocatorFromChunk('chunk-3', locator({ selector: '#section-2', blockIds: ['b-3'] })),
    ).toEqual({ chunkId: 'chunk-3', selector: '#section-2', blockIds: ['b-3'] })
  })

  it('omits every null field rather than writing it as null', () => {
    const built = buildItemLocatorFromChunk('chunk-4', locator())
    expect(built).toEqual({ chunkId: 'chunk-4', blockIds: [] })
    expect(Object.keys(built)).not.toContain('page')
    expect(Object.keys(built)).not.toContain('selector')
    expect(Object.keys(built)).not.toContain('tStartMs')
    expect(Object.keys(built)).not.toContain('tEndMs')
    expect(Object.keys(built)).not.toContain('label')
  })

  it('copies blockIds rather than aliasing the SourceLocator array', () => {
    const blockIds = ['b-1', 'b-2']
    const built = buildItemLocatorFromChunk('chunk-5', locator({ blockIds }))
    expect(built.blockIds).toEqual(blockIds)
    expect(built.blockIds).not.toBe(blockIds)
  })
})
