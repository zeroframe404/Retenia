/**
 * `@retenia/activity-ai` — the `activity-ai/` package of `docs/spec/03-activities.md` §8:
 * *"prompts per type, generation with structured outputs, validation + repair, AI graders,
 * 'blind solve', media jobs"*.
 *
 * Sub-phase 5.5 lands the first slice: the P10 free-text grader of
 * `docs/spec/04-path-generation.md` §12 and its companion "Explain my answer", both behind
 * `@retenia/core`'s ports and both driven by a `TextGenerator` that sub-phase 7.2 implements.
 * Generation (P1–P9, P11) arrives with phase 8.
 *
 * Everything exported here is pure: the prompt *files* are read through the separate
 * `@retenia/activity-ai/prompts` entry point, so nothing in a renderer bundle needs `node:fs`.
 */

export type { ExplainAnswerOptions } from './explain-answer'
export {
  buildExplainAnswerTask,
  createExplainAnswer,
  EXPLAIN_ANSWER_TEMPERATURE,
} from './explain-answer'
export type { AiLongTextGraderOptions } from './grade-long-text/grader'
export {
  AGREEMENT_EPSILON,
  createAiLongTextGrader,
  DISAGREEMENT_UNCERTAIN,
  GRADE_LONG_TEXT_TEMPERATURE,
  ratingForScore,
} from './grade-long-text/grader'
export type { GradeLongTextOutput } from './grade-long-text/output'
export {
  extractJsonObject,
  GRADE_LONG_TEXT_JSON_SCHEMA,
  GRADE_LONG_TEXT_SCHEMA_NAME,
  gradeCriterionOutputSchema,
  gradeLongTextOutputSchema,
  parseGradeLongTextOutput,
} from './grade-long-text/output'
export {
  buildGradeLongTextTask,
  escapeForPrompt,
  permuteRubric,
} from './grade-long-text/task'
