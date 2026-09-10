import type { PathDraft } from '../schemas/path-draft'
import type { GenerationWarning } from '../schemas/warnings'

/**
 * The editable preview's write vocabulary (`docs/spec/04-path-generation.md` §13 step 3): one
 * op per user action, applied by pure functions over a `PathDraft` — the AI proposed it, this
 * is the code that lets a human correct it (`docs/spec/01-decisions.md` §7.7).
 *
 * `nodeId` addresses a section, module or core lesson by its positional id (`S01`, `M03`,
 * `L07`) — ids are unique across the whole draft, so an op never needs to say which section a
 * module lives in. Reinforcement (`M03.reinf`), checkpoint and the final exam are not
 * user-editable nodes: they are recomputed from the lessons around them.
 */
export type PathEditOp =
  | { readonly kind: 'rename'; readonly nodeId: string; readonly title: string }
  /** Moves the node to `toIndex` within its own parent's array (a section within the path, a
   *  module within its section, a lesson within its module). */
  | { readonly kind: 'reorder'; readonly nodeId: string; readonly toIndex: number }
  | { readonly kind: 'exclude'; readonly nodeId: string }
  /** Sections and modules only — "ya lo sé" (§13 step 3). */
  | { readonly kind: 'markKnown'; readonly nodeId: string }
  | { readonly kind: 'unmarkKnown'; readonly nodeId: string }
  | { readonly kind: 'mergeLessons'; readonly lessonIds: readonly [string, string, ...string[]] }
  | { readonly kind: 'splitLesson'; readonly lessonId: string; readonly parts: 2 | 3 }
  /** "Profundizar": the same structural split as `splitLesson`, named separately because the
   *  UI shows it with a projected cost delta rather than as a plain edit. */
  | { readonly kind: 'deepenLesson'; readonly lessonId: string; readonly parts: 2 | 3 }
  | { readonly kind: 'setPrimarySource'; readonly sourceId: string }
  /** Undo/redo: replaces the whole draft with a client-held snapshot. Still re-validated and
   *  still rejected once the version is frozen, exactly like every other op — the renderer
   *  never gets a way to write `path_versions.spec` outside this module. */
  | { readonly kind: 'replace'; readonly draft: PathDraft }

export interface PathEditResult {
  readonly draft: PathDraft
  readonly warnings: readonly GenerationWarning[]
  /** `reorder` only: a prerequisite now reads after the lesson that depends on it. The
   *  caller/UI decides whether to keep the move or offer "cancelar". */
  readonly breaksPrerequisite: boolean
  /** `deepenLesson`/`splitLesson` only: the projected extra expansion cost the added lessons
   *  would add at stage 7 (`(newCount - oldCount) * perLessonUsd`) — never a charge that
   *  happened now, since no AI call is made here. */
  readonly projectedCostDeltaUsd?: number
}

export const PATH_EDIT_ERROR_CODES = [
  /** No section, module or core lesson has this id. */
  'node_not_found',
  /** The op requires a different kind of node than the one it was given. */
  'wrong_node_kind',
  /** A rename to an empty (or whitespace-only) title. */
  'invalid_title',
  /** `mergeLessons` needs every id in the same module. */
  'lessons_not_in_same_module',
  /** `splitLesson`/`deepenLesson` need at least as many concepts as parts. */
  'too_few_concepts_to_split',
  /** `setPrimarySource` was given an id absent from `draft.sources`. */
  'unknown_source',
] as const

export type PathEditErrorCode = (typeof PATH_EDIT_ERROR_CODES)[number]

export class PathEditError extends Error {
  override readonly name = 'PathEditError'
  readonly code: PathEditErrorCode

  constructor(code: PathEditErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

export function isPathEditError(error: unknown): error is PathEditError {
  return error instanceof Error && error.name === 'PathEditError' && 'code' in error
}
