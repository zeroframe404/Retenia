import { describe, expect, it } from 'vitest'
import { buildDraft, lesson, module, section } from '../testing/edit-fixtures'
import { recomputeStats } from './recompute-stats'

describe('recomputeStats()', () => {
  it('counts sections, modules, lessons, concepts and minutes across lessons and reinforcement', () => {
    const draft = buildDraft()
    const stats = recomputeStats(draft)
    expect(stats).toMatchObject({ sections: 2, modules: 2, lessons: 4, checkpoints: 0 })
    // 4 lessons * 10 min + 2 reinforcements * 8 min.
    expect(stats.minutes).toBe(56)
    expect(stats.concepts).toBe(10)
  })

  it('counts a checkpoint when a module has one', () => {
    const draft = buildDraft({
      sections: [
        section('S01', {
          modules: [
            module('S01M1', {
              checkpoint: {
                id: 'C01',
                kind: 'checkpoint',
                module_ids: ['S01M1'],
                concept_ids: ['c_extra'],
                item_count: 5,
                estimated_minutes: 15,
              },
            }),
          ],
        }),
      ],
    })
    const stats = recomputeStats(draft)
    expect(stats.checkpoints).toBe(1)
    expect(stats.concepts).toBeGreaterThanOrEqual(1)
  })

  it('scales weeks_estimate proportionally to the change in total minutes', () => {
    const draft = buildDraft({
      sections: [section('S01', { modules: [module('S01M1', { lessons: [lesson('S01M1L1')] })] })],
      stats: {
        sections: 1,
        modules: 1,
        lessons: 1,
        checkpoints: 0,
        concepts: 2,
        minutes: 10,
        weeks_estimate: 2,
      },
    })
    // The single lesson (10 min) plus its reinforcement (8 min) = 18 min, 1.8x the previous 10.
    const stats = recomputeStats(draft)
    expect(stats.minutes).toBe(18)
    expect(stats.weeks_estimate).toBe(Math.round(2 * 1.8))
  })

  it('leaves weeks_estimate null when there was nothing to scale from', () => {
    const draft = buildDraft({ stats: { ...buildDraft().stats, minutes: 0, weeks_estimate: null } })
    expect(recomputeStats(draft).weeks_estimate).toBeNull()
  })
})
