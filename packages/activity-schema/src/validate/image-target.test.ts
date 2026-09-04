import { describe, expect, it } from 'vitest'
import type { Activity } from '../envelope'
import { sampleChoice } from '../testing/samples'
import { validateImageTarget } from './image-target'

const imageTarget = (payload: Record<string, unknown>): Activity<'image_target'> => ({
  ...sampleChoice(),
  family: 'image_target',
  type: 'label_image',
  review: { eligible: true, ratingStrategy: 'partial' },
  payload: { family: 'image_target', ...payload },
})

/** §11: "`targetShapeIds` exist" — checked on the placeholder payload when the fields are present. */
describe('validateImageTarget()', () => {
  it('flags a draggable pointing at a shape that does not exist', () => {
    const issues = validateImageTarget(
      imageTarget({
        shapes: [{ id: 's1' }, 'junk'],
        draggables: [{ targetShapeIds: ['s1', 's2', 3] }, null, { targetShapeIds: 'no' }],
      }),
    )
    expect(issues.map((issue) => issue.path.join('.'))).toEqual([
      'payload.draggables.0.targetShapeIds.1',
      'payload.draggables.0.targetShapeIds.2',
    ])
    expect(issues.every((issue) => issue.code === 'shape-unknown')).toBe(true)
  })

  it('says nothing about a payload that has no shapes yet', () => {
    expect(validateImageTarget(imageTarget({}))).toEqual([])
  })
})
