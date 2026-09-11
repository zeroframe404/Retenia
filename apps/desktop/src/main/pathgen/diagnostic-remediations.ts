import type { DiagnosticSession } from '@retenia/core'
import type { RemediationSignal } from '@retenia/pathgen'

/**
 * §10 step 8's `insert_remediation` actions as §11's "confident error" signals (sub-phase 8.6).
 *
 * The diagnostic records an action only for a misconception answered "sure" (§10 step 3), so
 * each becomes a wrong, confident answer on the item's concepts. The stored result is JSON a row
 * carries, so it is read defensively: an action that is not one is skipped, never guessed at.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const stringOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null)

/** The `item_bank` ids the actions name, so their stems can be read before the signals are built. */
export function remediationItemIds(session: Pick<DiagnosticSession, 'result'>): string[] {
  const actions = session.result?.actions
  if (!Array.isArray(actions)) return []
  return actions.flatMap((action) =>
    isRecord(action) && action.kind === 'insert_remediation' && typeof action.itemId === 'string'
      ? [action.itemId]
      : [],
  )
}

export function diagnosticRemediationSignals(
  session: Pick<DiagnosticSession, 'id' | 'pathVersionId' | 'result'>,
  stems: ReadonlyMap<string, string>,
): Extract<RemediationSignal, { kind: 'confident_error' }>[] {
  const actions = session.result?.actions
  if (!Array.isArray(actions)) return []
  return actions.flatMap((action) => {
    if (!isRecord(action) || action.kind !== 'insert_remediation') return []
    const itemId = stringOrNull(action.itemId)
    const stem = itemId === null ? undefined : stems.get(itemId)
    return [
      {
        kind: 'confident_error' as const,
        pathVersionId: session.pathVersionId,
        context: 'diagnostic' as const,
        conceptIds: Array.isArray(action.conceptIds)
          ? action.conceptIds.filter((id): id is string => typeof id === 'string')
          : [],
        misconceptionId: stringOrNull(action.misconceptionId),
        confidence: 'sure' as const,
        correct: false,
        itemId,
        moduleId: stringOrNull(action.moduleId),
        sessionId: session.id,
        error: stem === undefined ? null : { stem, chosen: null, correct: null },
      },
    ]
  })
}
