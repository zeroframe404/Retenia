import type { Entity, JsonObject, JsonValue } from './_common'
import type { DiagnosticEntry, DiagnosticSessionStatus, DiagnosticStopReason } from './enums'

/**
 * One run of the prior-knowledge diagnostic over one frozen path version
 * (`docs/spec/04-path-generation.md` §10, sub-phase 8.5).
 *
 * The engine is a pure function of its configuration and its answer log, so `answers` is the
 * session's whole state and resuming means replaying it. The row is a record of the run — the
 * lessons it marked complete and the cards it seeded live in their own tables, and `applied`
 * says which, so the result can be undone and verified later.
 */
export interface DiagnosticSession extends Entity {
  pathVersionId: string
  status: DiagnosticSessionStatus
  entry: DiagnosticEntry
  /** Section spec id → `never | familiar | know | master` (§10 step 1). */
  selfAssessment: JsonObject
  /** The ordered answer log the engine replays. */
  answers: JsonValue[]
  /** The item currently served — `{ itemBankId, attemptId, difficulty, servedAt }` — so a
   *  session closed mid-question serves the same question again; `null` between items. */
  pending: JsonObject | null
  /** The `DiagnosticResult`, once the session has stopped. */
  result: JsonObject | null
  /** What the result's actions wrote, for undo and deferred verification. */
  applied: JsonObject
  stopReason: DiagnosticStopReason | null
  startedAt: Date
  finishedAt: Date | null
}
