import { sql } from 'drizzle-orm'
import { check, index, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import {
  auditColumns,
  idColumn,
  inTextList,
  inTextListOrNull,
  type JsonObject,
  jsonColumn,
  jsonObject,
  standardChecks,
  timestampColumn,
} from './_common'
import { lessons, modules, pathVersions } from './paths'

/**
 * The remediation log (docs/spec/04-path-generation.md §11; sub-phase 8.6): every trigger that
 * fired on a concept, what the limits made of it, the `L07.r1` detour it became, and its
 * measured effect. Mirrors `REMEDIATION_*` in `@retenia/core`; a test pins the lists together.
 */

/** §11 "Triggers"; the lapses and the low-R rule are two values so each can be tuned. */
export const REMEDIATION_TRIGGERS = [
  'reinforcement_low',
  'memory_lapses',
  'memory_retention',
  'confident_error',
  'repeated_misconception',
  'user_request',
] as const
export type RemediationTrigger = (typeof REMEDIATION_TRIGGERS)[number]

export const REMEDIATION_STATUSES = [
  'active',
  'completed',
  'dismissed',
  'refused',
  'failed',
] as const
export type RemediationStatus = (typeof REMEDIATION_STATUSES)[number]

/** §11 "Limits"; `revisit_core` is the third remediation of one concept. */
export const REMEDIATION_REFUSALS = [
  'duplicate_concept',
  'module_active',
  'weekly_limit',
  'revisit_core',
  'no_anchor',
] as const
export type RemediationRefusal = (typeof REMEDIATION_REFUSALS)[number]

export const remediations = sqliteTable(
  'remediations',
  {
    id: idColumn(),
    pathVersionId: text('path_version_id')
      .notNull()
      .references(() => pathVersions.id),
    /** The module the detour sits in; NULL when nothing could anchor it. */
    moduleId: text('module_id').references(() => modules.id),
    /** The knowledge-graph concept — §11's dedupe key. */
    conceptId: text('concept_id').notNull(),
    misconceptionId: text('misconception_id'),
    trigger: text('trigger', { enum: REMEDIATION_TRIGGERS }).notNull(),
    status: text('status', { enum: REMEDIATION_STATUSES }).notNull(),
    refusal: text('refusal', { enum: REMEDIATION_REFUSALS }),
    /** The core lesson the detour hangs off (`L07` of `L07.r1`). */
    anchorLessonId: text('anchor_lesson_id').references(() => lessons.id),
    /** The `kind = 'remediation'` lesson, once written. */
    lessonId: text('lesson_id').references(() => lessons.id),
    /** `L07.r1`; never reused, so it outlives a dismissal. */
    specId: text('spec_id'),
    evidence: jsonColumn('evidence').$type<JsonObject>().notNull().default(sql`'{}'`),
    /** `{ card_ids, expires_at, clean, cleared }` — the temporary raise to `high`. */
    boost: jsonColumn('boost').$type<JsonObject>().notNull().default(sql`'{}'`),
    /** Subsequent accuracy on the concept, for threshold tuning. */
    outcome: jsonColumn('outcome').$type<JsonObject>(),
    resolvedAt: timestampColumn('resolved_at'),
    ...auditColumns(),
  },
  (t) => [
    index('remediations_version_status').on(t.pathVersionId, t.status),
    index('remediations_concept').on(t.conceptId),
    index('remediations_lesson').on(t.lessonId),
    // The weekly limit reads the newest rows of every path.
    index('remediations_created').on(t.createdAt),
    check('remediations_trigger', inTextList(t.trigger, REMEDIATION_TRIGGERS)),
    check('remediations_status', inTextList(t.status, REMEDIATION_STATUSES)),
    check('remediations_refusal', inTextListOrNull(t.refusal, REMEDIATION_REFUSALS)),
    // A refusal says why; nothing else carries one.
    check(
      'remediations_refusal_iff_refused',
      sql`(${t.status} = 'refused') = (${t.refusal} IS NOT NULL)`,
    ),
    check('remediations_evidence_json', jsonObject(t.evidence)),
    check('remediations_boost_json', jsonObject(t.boost)),
    check('remediations_outcome_json', jsonObject(t.outcome)),
    ...standardChecks('remediations', t),
  ],
)
