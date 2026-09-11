import type { RemediationDto } from '@retenia/ipc-contract'
import { describe, expect, it } from 'vitest'
import { detourNodes, upsertRemediation } from './use-pathgen'

/** The path map's detour list as `pathgen.remediation` pushes keep it (sub-phase 8.6). */

function dto(overrides: Partial<RemediationDto> = {}): RemediationDto {
  return {
    id: '019213cd-0000-7000-8000-0000000000a1',
    pathVersionId: '019213cd-0000-7000-8000-000000000010',
    moduleId: '019213cd-0000-7000-8000-000000000020',
    conceptId: 'c1',
    conceptName: 'Velocidad',
    misconceptionId: null,
    trigger: 'reinforcement_low',
    status: 'active',
    refusal: null,
    lessonId: '019213cd-0000-7000-8000-000000000030',
    specId: 'L01.r1',
    anchorLessonId: '019213cd-0000-7000-8000-000000000031',
    anchorSpecId: 'L01',
    position: 'after',
    title: 'Velocidad, de otra manera',
    lessonStatus: 'ready',
    estimatedMinutes: 4,
    reasons: { accuracy: 0.4, lapses: null, meanR: null, failures: null, context: null },
    revisitLessonId: null,
    boostedCards: 3,
    boostExpiresAt: '2026-09-25T12:00:00.000Z',
    createdAt: '2026-09-11T12:00:00.000Z',
    resolvedAt: null,
    ...overrides,
  }
}

describe('upsertRemediation', () => {
  it('replaces the row with the same id in place', () => {
    const first = dto()
    const second = dto({ id: '019213cd-0000-7000-8000-0000000000a2', conceptId: 'c2' })
    const updated = upsertRemediation([first, second], { ...first, status: 'completed' })
    expect(updated.map((row) => row.status)).toEqual(['completed', 'active'])
    expect(updated[1]).toBe(second)
  })

  it('appends a row it has not seen', () => {
    const first = dto()
    const next = dto({ id: '019213cd-0000-7000-8000-0000000000a3' })
    expect(upsertRemediation([first], next)).toEqual([first, next])
  })
})

describe('detourNodes', () => {
  it('keeps live detours with a lesson and drops everything the map does not draw', () => {
    const rows = [
      dto({ id: '019213cd-0000-7000-8000-0000000000b1', status: 'active' }),
      dto({ id: '019213cd-0000-7000-8000-0000000000b2', status: 'completed' }),
      dto({ id: '019213cd-0000-7000-8000-0000000000b3', status: 'dismissed' }),
      dto({
        id: '019213cd-0000-7000-8000-0000000000b4',
        status: 'refused',
        refusal: 'weekly_limit',
        lessonId: null,
      }),
      dto({ id: '019213cd-0000-7000-8000-0000000000b5', status: 'failed' }),
      dto({ id: '019213cd-0000-7000-8000-0000000000b6', status: 'active', lessonId: null }),
    ]
    expect(detourNodes(rows).map((row) => row.id)).toEqual([
      '019213cd-0000-7000-8000-0000000000b1',
      '019213cd-0000-7000-8000-0000000000b2',
    ])
  })
})
