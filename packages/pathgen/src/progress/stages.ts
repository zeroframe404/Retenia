/**
 * The stages the wizard shows (`docs/spec/04-path-generation.md` §13 step 2: "Reading 14
 * sources (9/14)", "Detecting 212 concepts", "Building the prerequisite map", "Proposing a
 * path"), as the keys `packages/i18n`'s `path.generation.stage.*` renders.
 */
export const GENERATION_STAGES = [
  'reading_sources',
  'extracting',
  'consolidating',
  'synthesizing',
  'synthesizing_modules',
  'sequencing',
  'persisting',
] as const

export type GenerationStage = (typeof GENERATION_STAGES)[number]
