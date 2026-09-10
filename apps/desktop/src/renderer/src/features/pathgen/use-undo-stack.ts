import type { PathDraftDto } from '@retenia/ipc-contract'
import { useState } from 'react'

/**
 * A client-side history of drafts, for the preview's undo/redo (`docs/spec/04-path-generation.md`
 * §13 step 3). Every edit that lands (from `pathgen.editDraft`) pushes the draft that was
 * current *before* the edit; undo/redo pop the stack and hand the caller the draft to restore
 * — which it does by sending a `{ kind: 'replace' }` op back through `pathgen.editDraft`, so a
 * restore is re-validated and persisted exactly like any other edit, never a client-only write.
 */
export function useUndoStack(current: PathDraftDto | undefined) {
  const [past, setPast] = useState<PathDraftDto[]>([])
  const [future, setFuture] = useState<PathDraftDto[]>([])

  // Any edit that was not itself an undo/redo (tracked via `record`) extends `past` and
  // clears `future` — the conventional "new edit forks off the undo branch" rule.
  function record(previous: PathDraftDto): void {
    setPast((stack) => [...stack, previous])
    setFuture([])
  }

  function undo(): PathDraftDto | null {
    const previous = past.at(-1)
    if (previous === undefined || current === undefined) return null
    setPast((stack) => stack.slice(0, -1))
    setFuture((stack) => [...stack, current])
    return previous
  }

  function redo(): PathDraftDto | null {
    const next = future.at(-1)
    if (next === undefined) return null
    setFuture((stack) => stack.slice(0, -1))
    if (current !== undefined) setPast((stack) => [...stack, current])
    return next
  }

  return {
    record,
    undo,
    redo,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
  }
}
