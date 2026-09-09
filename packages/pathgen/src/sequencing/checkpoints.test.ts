import { describe, expect, it } from 'vitest'
import { buildCheckpoints, checkpointSpans } from './checkpoints'
import { DEFAULT_SEQUENCING_LIMITS } from './types'

const limits = DEFAULT_SEQUENCING_LIMITS

function modules(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `M${String(index + 1).padStart(2, '0')}`,
    concept_ids: [`c${index}a`, `c${index}b`],
  }))
}

describe('checkpointSpans()', () => {
  it('cuts modules into spans of 3–4, folding a short tail into the span before it', () => {
    const expected: Record<number, number[]> = {
      0: [],
      1: [],
      2: [],
      3: [3],
      4: [4],
      5: [4],
      6: [3, 3],
      7: [4, 3],
      8: [4, 4],
      9: [3, 3, 3],
      10: [4, 3, 3],
      11: [4, 4, 3],
      12: [4, 4, 4],
      13: [4, 3, 3, 3],
    }
    for (const [count, spans] of Object.entries(expected)) {
      expect(checkpointSpans(Number(count), limits.checkpoint), count).toEqual(spans)
    }
  })
})

describe('buildCheckpoints()', () => {
  it('attaches one checkpoint to the last module of each span, cumulative over the span', () => {
    const placements = buildCheckpoints(modules(7), limits)
    expect(placements.map((placement) => placement.moduleIndex)).toEqual([3, 6])
    expect(placements[0]?.node).toEqual({
      id: 'C01',
      kind: 'checkpoint',
      module_ids: ['M01', 'M02', 'M03', 'M04'],
      concept_ids: ['c0a', 'c0b', 'c1a', 'c1b', 'c2a', 'c2b', 'c3a', 'c3b'],
      item_count: 16,
      estimated_minutes: 16,
    })
    expect(placements[1]?.node).toMatchObject({
      id: 'C02',
      module_ids: ['M05', 'M06', 'M07'],
      item_count: 12,
    })
  })

  it('clamps the item count to the band', () => {
    expect(buildCheckpoints(modules(4), limits)[0]?.node.item_count).toBe(16)
    expect(buildCheckpoints(modules(3), limits)[0]?.node.item_count).toBe(12)
    // The band's ceiling is reached only with a wider span than the default allows.
    const wide = { ...limits, checkpoint: { ...limits.checkpoint, spanMax: 6 } }
    expect(buildCheckpoints(modules(6), wide)[0]?.node.item_count).toBe(20)
  })

  it('leaves a fifth module without a checkpoint rather than stretching a span to five', () => {
    const placements = buildCheckpoints(modules(5), limits)
    expect(placements).toHaveLength(1)
    expect(placements[0]?.moduleIndex).toBe(3)
    expect(placements[0]?.node.module_ids).toEqual(['M01', 'M02', 'M03', 'M04'])
  })

  it('places nothing under three modules', () => {
    expect(buildCheckpoints(modules(2), limits)).toEqual([])
  })
})
