import type { Activity, ExamForm, ItemBankEntry, ItemCellKind, ItemUsage } from '@retenia/core'

/**
 * Small readers shared by the build and the reconcile: what question an activity asks, what
 * P9 recorded about a bank item, and which usages a cell's items carry.
 */

/**
 * The question as the learner reads it — a choice set's own stem when it has one, else the
 * prompt. The QA dedupe gate compares prompts; the bank compares stems, because a bank item's
 * prompt is often the generic instruction and its stem is the actual question.
 */
export function activityStem(activity: Pick<Activity, 'config'>): string {
  const config = activity.config as {
    prompt?: unknown
    payload?: { sets?: readonly { stem?: unknown }[] }
  }
  const stem = config.payload?.sets?.[0]?.stem
  if (typeof stem === 'string' && stem.trim() !== '') return stem
  return typeof config.prompt === 'string' ? config.prompt : ''
}

/** `item_bank.authoring`, read defensively: it is JSON a row carries, not a typed column. */
export interface ItemAuthoring {
  readonly cellKey: string | null
  readonly stem: string | null
  readonly conceptIds: readonly string[]
  readonly misconceptionByOption: Readonly<Record<string, string>>
}

export function readAuthoring(entry: Pick<ItemBankEntry, 'authoring'>): ItemAuthoring {
  const raw = entry.authoring as {
    cell_key?: unknown
    stem?: unknown
    concept_ids?: unknown
    misconception_by_option?: unknown
  }
  const map: Record<string, string> = {}
  if (raw.misconception_by_option !== null && typeof raw.misconception_by_option === 'object') {
    for (const [option, misconception] of Object.entries(
      raw.misconception_by_option as Record<string, unknown>,
    )) {
      if (typeof misconception === 'string') map[option] = misconception
    }
  }
  return {
    cellKey: typeof raw.cell_key === 'string' ? raw.cell_key : null,
    stem: typeof raw.stem === 'string' ? raw.stem : null,
    conceptIds: Array.isArray(raw.concept_ids)
      ? raw.concept_ids.filter((id): id is string => typeof id === 'string')
      : [],
    misconceptionByOption: map,
  }
}

/**
 * `ItemBankItem.v1.usage` from the cell (§8), decided by code and never by the model:
 * diagnostic items serve the diagnostic; reinforcement items serve reinforcements and the
 * remediations of 8.6; form A serves the final exam's A form and the mock exams, form B the
 * final exam's B form (`docs/spec/02-memory-system.md` §9: "the mock exam uses A, the final
 * exam B").
 */
export function usageFor(kind: ItemCellKind, form: ExamForm | null): ItemUsage[] {
  if (kind === 'diagnostic') return ['diagnostic']
  if (kind === 'reinforcement') return ['reinforcement', 'remediation']
  return form === 'B' ? ['final_exam_B'] : ['final_exam_A', 'mock']
}
