import { sampleCategorize } from '@retenia/activity-schema/testing'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import '../index'
import type { useDraggable as UseDraggable } from '@dnd-kit/core'
import { ActivityHost } from '../host/activity-host'

/**
 * The pointer half of the layer, which no keyboard test can reach: jsdom reports every rect as
 * 0×0, so dnd-kit's sensors never start a real drag. What *is* checkable here is the one thing
 * the layer was not doing — turning dnd-kit's `transform` into movement.
 *
 * Only `useDraggable` is faked; the rest of `@dnd-kit/core` is the real module, so the draggable
 * is wired up exactly as it is in the app.
 */
const dragging = { x: 24, y: -8, scaleX: 1, scaleY: 1 }

vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>()
  const useDraggable: typeof UseDraggable = (options) => {
    const draggable = actual.useDraggable(options)
    if (options.id !== 'i1') return draggable
    return { ...draggable, isDragging: true, transform: dragging }
  }
  return { ...actual, useDraggable }
})

describe('DraggableItem under a pointer drag', () => {
  it('follows the pointer instead of waiting for the drop', async () => {
    render(<ActivityHost activity={sampleCategorize()} seed="drag-seed" />)
    await screen.findByTestId('renderer-categorize')

    // dnd-kit tracks the pointer and hands back a delta, but moves nothing itself. Dropping that
    // delta left the token sitting still for the whole drag and teleporting on release — no
    // feedback at all from the affordance the layer is named for.
    const token = screen.getByTestId('draggable-i1')
    expect(token.style.transform).toBe('translate3d(24px, -8px, 0)')

    // A token that is not being dragged carries no transform of its own.
    expect(screen.getByTestId('draggable-i2').style.transform).toBe('')
  })
})
