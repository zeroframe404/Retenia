import type { Activity } from '../envelope'
import { type Issue, issue } from './types'

/**
 * §11: "`targetShapeIds` exist". The `image_target` payload is still a placeholder, so the check
 * reads the loose object defensively and only speaks when `shapes` and `draggables` are there.
 */
export function validateImageTarget(activity: Activity<'image_target'>): Issue[] {
  const issues: Issue[] = []
  const payload: Record<string, unknown> = activity.payload
  const shapes = Array.isArray(payload.shapes) ? payload.shapes : []
  const known = new Set(
    shapes.flatMap((shape: unknown) =>
      shape !== null &&
      typeof shape === 'object' &&
      typeof (shape as { id?: unknown }).id === 'string'
        ? [(shape as { id: string }).id]
        : [],
    ),
  )
  const draggables = Array.isArray(payload.draggables) ? payload.draggables : []
  draggables.forEach((draggable: unknown, d) => {
    const targets = (draggable as { targetShapeIds?: unknown } | null)?.targetShapeIds
    if (!Array.isArray(targets)) return
    targets.forEach((id, t) => {
      if (typeof id !== 'string' || !known.has(id)) {
        issues.push(
          issue(
            'shape-unknown',
            ['payload', 'draggables', d, 'targetShapeIds', t],
            `shape "${String(id)}" does not exist`,
          ),
        )
      }
    })
  })
  return issues
}
