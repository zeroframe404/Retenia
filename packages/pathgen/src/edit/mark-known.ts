import type { PathDraft } from '../schemas/path-draft'
import { locateNode } from './locate'
import { PathEditError } from './types'

/**
 * "Ya lo sé" (`docs/spec/04-path-generation.md` §13 step 3), sections and modules only — a
 * lesson id is rejected rather than silently accepted, so the freeze step's "known → completed"
 * mapping (§10) always has a section/module to seed lessons from.
 */
export function markKnown(draft: PathDraft, nodeId: string, known: boolean): PathDraft {
  const location = locateNode(draft, nodeId)
  if (location.kind === 'lesson') {
    throw new PathEditError(
      'wrong_node_kind',
      '"ya lo sé" applies to a section or a module, not a single lesson',
    )
  }
  const withoutId = draft.known_node_ids.filter((id) => id !== nodeId)
  return { ...draft, known_node_ids: known ? [...withoutId, nodeId] : withoutId }
}
