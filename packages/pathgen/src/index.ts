/**
 * `@retenia/pathgen` — learning-path generation, stages 3–5 of
 * `docs/spec/04-path-generation.md` §3 (sub-phase 8.1).
 *
 * P1 extraction per chunk (cheap role, batch, idempotent custom ids), concept consolidation
 * in code, P2 knowledge-graph and outline synthesis (smart role, skeleton first), validation,
 * deterministic sequencing in pure code, the `GenerationManifest.v1`, a `PathDraft.v1`
 * persisted as an unfrozen path version, the wizard's cost estimator and the progress
 * reporter. Pure orchestration over ports: nothing here reads a file, a database or a key —
 * the main process wires those in (sub-phase 8.2); `@retenia/pathgen/node` loads the prompts.
 */

export { type BudgetGuard, createBudgetGuard, UNLIMITED_BUDGET } from './budget'
export type {
  GenerationConfig,
  GenerationConfigInput,
  GenerationScope,
  GenerationScopeLike,
} from './config/generation-config'
export {
  configHash,
  generationConfigSchema,
  generationScopeSchema,
  HEADING_PATH_SEPARATOR,
  isChunkInScope,
  orderedSourceIds,
  parseGenerationConfig,
} from './config/generation-config'
export * from './consolidate'
export * from './edit'
export {
  GENERATION_ERROR_CODES,
  GenerationError,
  type GenerationErrorCode,
  isGenerationError,
} from './errors'
export * from './estimate'
export * from './expand'
export * from './extract'
export * from './freeze'
export type { PathgenLogger } from './logger'
export { silentLogger } from './logger'
export * from './manifest'
export * from './progress'
export {
  assertPathgenPrompts,
  PATHGEN_PROMPT_IDS,
  type PathgenPrompt,
  PathgenPromptError,
  type PathgenPrompts,
  systemFor,
} from './prompts'
export * from './run'
export {
  EMPTY_EXTRACTION,
  EXERCISE_KINDS,
  EXTRACT_CHUNK_SCHEMA_ID,
  EXTRACT_CHUNK_SCHEMA_NAME,
  EXTRACT_CHUNK_SCHEMA_VERSION,
  type ExtractChunkOutput,
  type ExtractedConcept,
  extractChunkOutputSchema,
  extractedConceptSchema,
} from './schemas/extraction'
export {
  FLASHCARD_TYPES,
  type Flashcard,
  flashcardSchema,
  MAKE_FLASHCARDS_SCHEMA_ID,
  MAKE_FLASHCARDS_SCHEMA_NAME,
  MAKE_FLASHCARDS_SCHEMA_VERSION,
  type MakeFlashcardsOutput,
  makeFlashcardsOutputSchema,
  PROPOSABLE_IMPORTANCE,
} from './schemas/flashcards'
export {
  KNOWLEDGE_GRAPH_SCHEMA_ID,
  KNOWLEDGE_GRAPH_VERSION,
  type KnowledgeGraphDocument,
  knowledgeGraphDocumentSchema,
  toKnowledgeGraphDocument,
} from './schemas/knowledge-graph'
export {
  DIAGRAM_KINDS,
  isSubstantive,
  type LessonCitation,
  type LessonTheory,
  lessonCitationSchema,
  lessonTheorySchema,
  SUBSTANTIVE_BLOCK_TYPES,
  THEORY_BLOCK_TYPES,
  type TheoryBlock,
  theoryBlockSchema,
  WRITE_LESSON_SCHEMA_ID,
  WRITE_LESSON_SCHEMA_NAME,
  WRITE_LESSON_SCHEMA_VERSION,
  type WriteLessonOutput,
  writeLessonOutputSchema,
} from './schemas/lesson'
export {
  type GenerationManifest,
  generationManifestSchema,
  MANIFEST_SCHEMA_ID,
  MANIFEST_VERSION,
  type ManifestCost,
  type ManifestModel,
  type ManifestStats,
  manifestCostSchema,
  manifestModelSchema,
  manifestStatsSchema,
} from './schemas/manifest'
export {
  objectiveSchema,
  SYNTHESIZE_MODULE_SCHEMA_ID,
  SYNTHESIZE_MODULE_SCHEMA_NAME,
  SYNTHESIZE_MODULE_SCHEMA_VERSION,
  SYNTHESIZE_OUTLINE_SCHEMA_ID,
  SYNTHESIZE_OUTLINE_SCHEMA_NAME,
  SYNTHESIZE_OUTLINE_SCHEMA_VERSION,
  type SynthesizeModuleOutput,
  type SynthesizeOutlineOutput,
  synthesizeModuleOutputSchema,
  synthesizeOutlineOutputSchema,
} from './schemas/outline'
export {
  type CheckpointNode,
  type CoreLessonNode,
  checkpointNodeSchema,
  coreLessonNodeSchema,
  type DraftMisconception,
  draftMisconceptionSchema,
  type FinalExamNode,
  finalExamNodeSchema,
  type ModuleNode,
  moduleNodeSchema,
  PATH_DRAFT_SCHEMA_ID,
  PATH_DRAFT_VERSION,
  type PathDraft,
  type PathStats,
  pathDraftSchema,
  pathStatsSchema,
  type ReinforcementNode,
  reinforcementNodeSchema,
  type SectionNode,
  type SourceRef,
  sectionNodeSchema,
  sourceRefSchema,
} from './schemas/path-draft'
export {
  dedupeWarnings,
  type GenerationWarning,
  generationWarningSchema,
  WARNING_CODES,
  WARNING_STAGE_OF,
  WARNING_STAGES,
  type WarningCode,
  type WarningParam,
  type WarningStage,
  warning,
} from './schemas/warnings'
export * from './sequencing'
export * from './synthesize'
export { addUsage, type StageUsage, usageOf, wasProviderCall, ZERO_USAGE } from './usage'
export * from './validate'
