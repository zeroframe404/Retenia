/**
 * The stages the wizard shows (`docs/spec/04-path-generation.md` §13 step 2: "Reading 14
 * sources (9/14)", "Detecting 212 concepts", "Building the prerequisite map", "Proposing a
 * path"), as the keys `packages/i18n`'s `path.generation.stage.*` renders.
 *
 * The three `expanding_*` stages are stage 7 (sub-phase 8.3), which the completion screen
 * shows rather than the wizard: expansion starts after the user freezes the path. They are
 * three stages rather than one with a `phase` detail because `createThrottledReporter` lets
 * the first event of a *stage* through unthrottled — with one stage, the moment the run moved
 * from theory to practice could be swallowed by the 250 ms window and the bar would look
 * stuck on the wrong label.
 */
export const GENERATION_STAGES = [
  'reading_sources',
  'extracting',
  'consolidating',
  'synthesizing',
  'synthesizing_modules',
  'sequencing',
  'persisting',
  'expanding_theory',
  'expanding_practice',
  'expanding_flashcards',
] as const

export type GenerationStage = (typeof GENERATION_STAGES)[number]
