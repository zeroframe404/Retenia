import {
  ACTIVITY_FAMILIES,
  type ActivityFamily,
  type ProgressionStage,
  type RatingRule,
} from '@retenia/core'
import type { GradingMethod } from './grading'

/**
 * The closed catalogue of activity types: the 98 rows of `docs/spec/03-activities.md` §4, in
 * table order, with the columns the engine reads — which payload family carries the type
 * (§7), which grader scores it (§2), which M-* rule of §3 (as `@retenia/core`'s `RatingRule`)
 * rates it, and where it sits in the MVP / phase 2 / phase 3 plan of §6.
 *
 * `type` decides the renderer, prompt and rating strategy; `family` decides grader and
 * validation (§7). Both are closed enums from day one so a generated activity with an unknown
 * type fails at the zod layer, not in a renderer.
 *
 * The rating column merges §3 with the finer rows of `docs/spec/02-memory-system.md` §10: a
 * FUZ type is `fuzzy` (the "type the answer" row), `ordering_sequence` is `ordering` (graded on
 * adjacent pairs), `matching_pairs` is `matching`, and the numeric/code/formula types are
 * `objective` (the "numeric / code problem with tests" row). M-bin → `binary`, M-pct →
 * `partial`, M-self → `self`, M-ai → `ai`, M-speech → `speech`; `N` in the review column and
 * M-none are both `none`. `reviewEligible` is derived: exactly the rows whose rule is not `none`.
 *
 * Rows the family table of §7 leaves implicit are assigned here: `summary_builder`,
 * `reading_passage_qs` and `listen_comprehension_qs` are `choice` (sets of statements or
 * questions); `typing_drill` is `text_input`; `image_juxtaposition` is `image_target`;
 * `terminal_task` is `code`; `manipulative`, `software_simulation`, `virtual_tour_360`,
 * `board_puzzle` and `play_notes_rhythm` are `simulation` (the parenthesized 23rd family, which
 * the database CHECK also carries). `phase: 'later'` marks the rows §6 does not name.
 */

export const ACTIVITY_PHASES = ['mvp', 'phase2', 'phase3', 'later'] as const
export type ActivityPhase = (typeof ACTIVITY_PHASES)[number]

export const COMPLEXITY_LEVELS = ['S', 'M', 'L', 'XL'] as const
export type ComplexityLevel = (typeof COMPLEXITY_LEVELS)[number]

export const GENERATION_EASE = ['easy', 'medium', 'hard'] as const
export type GenerationEase = (typeof GENERATION_EASE)[number]

export interface ActivityTypeMeta {
  readonly type: ActivityType
  readonly family: ActivityFamily
  /** The §4 "Category" column, in English. */
  readonly category: string
  readonly grader: GradingMethod
  /** `false` for the nine lesson-only rows of §4. */
  readonly reviewEligible: boolean
  readonly ratingStrategy: RatingRule
  /** §4 "Compl.": renderer + grader + generator. */
  readonly complexity: ComplexityLevel
  readonly phase: ActivityPhase
  /** §4 "Gen. IA": how easily the type is generated from source text alone. */
  readonly generation: GenerationEase
  /** §4 "Media": what has to be generated, or `null`. */
  readonly media: string | null
}

type Row = readonly [
  type: string,
  family: ActivityFamily,
  category: string,
  grader: GradingMethod,
  rule: RatingRule,
  complexity: ComplexityLevel,
  phase: ActivityPhase,
  generation: GenerationEase,
  media: string | null,
]

// biome-ignore format: one row per line keeps the table diffable against the spec.
const ROWS = [
  ['flashcard_basic', 'cards', 'recall', 'self', 'self', 'S', 'mvp', 'easy', null],
  ['flashcard_reverse', 'cards', 'recall', 'self', 'self', 'S', 'mvp', 'easy', null],
  ['dialog_cards', 'cards', 'recall', 'self', 'self', 'S', 'mvp', 'easy', null],
  ['cloze_typed', 'cloze', 'recall', 'fuzzy', 'fuzzy', 'S', 'mvp', 'easy', null],
  ['short_answer', 'text_input', 'recall', 'fuzzy', 'fuzzy', 'S', 'mvp', 'easy', null],
  ['numeric_answer', 'text_input', 'recall/math', 'det', 'objective', 'S', 'mvp', 'easy', null],
  ['list_recall', 'long_text', 'recall', 'fuzzy', 'partial', 'M', 'later', 'easy', null],
  ['free_recall', 'long_text', 'recall/production', 'ai', 'ai', 'M', 'mvp', 'easy', null],
  ['self_check_statement', 'long_text', 'recall', 'self', 'self', 'S', 'later', 'easy', null],
  ['image_occlusion', 'image_target', 'recall/visual', 'self', 'self', 'M', 'phase2', 'hard', 'img + coords'],
  ['spell_the_word', 'text_input', 'production', 'det', 'binary', 'S', 'phase2', 'easy', 'TTS'],
  ['dictation', 'text_input', 'listening', 'fuzzy', 'fuzzy', 'M', 'phase2', 'medium', 'TTS'],
  ['speak_repeat', 'speech', 'speaking', 'speech', 'speech', 'L', 'phase2', 'easy', 'TTS model (opt.)'],
  ['pronunciation_word', 'speech', 'speaking', 'speech', 'speech', 'L', 'phase3', 'easy', 'TTS'],
  ['mcq_single', 'choice', 'recognition', 'det', 'binary', 'S', 'mvp', 'easy', null],
  ['mcq_multi', 'choice', 'recognition', 'det', 'partial', 'S', 'mvp', 'easy', null],
  ['true_false', 'choice', 'recognition', 'det', 'binary', 'S', 'mvp', 'easy', null],
  ['statement_set', 'choice', 'recognition', 'det', 'partial', 'S', 'mvp', 'easy', null],
  ['single_choice_set', 'choice', 'recognition', 'det', 'partial', 'S', 'later', 'easy', null],
  ['cloze_dropdown', 'cloze', 'recognition', 'det', 'partial', 'S', 'mvp', 'easy', null],
  ['cloze_wordbank', 'cloze', 'recognition/procedural', 'det', 'partial', 'M', 'mvp', 'easy', null],
  ['image_choice', 'choice', 'recognition/visual', 'det', 'binary', 'S', 'phase2', 'medium', 'img'],
  ['summary_builder', 'choice', 'comprehension', 'det', 'partial', 'S', 'phase2', 'easy', null],
  ['mark_the_words', 'text_mark', 'comprehension', 'det', 'partial', 'M', 'mvp', 'easy', null],
  ['odd_one_out', 'choice', 'recognition', 'det', 'binary', 'S', 'later', 'easy', null],
  ['confidence_mcq', 'choice', 'recognition/metacognition', 'det', 'binary', 'S', 'phase2', 'easy', null],
  ['matching_pairs', 'pairs', 'procedural', 'det', 'matching', 'M', 'mvp', 'easy', null],
  ['matching_dropdown', 'pairs', 'procedural', 'det', 'matching', 'S', 'later', 'easy', null],
  ['tap_pairs_timed', 'pairs', 'game/recognition', 'det', 'partial', 'M', 'phase2', 'easy', null],
  ['ordering_sequence', 'ordering', 'procedural', 'det', 'ordering', 'M', 'mvp', 'easy', null],
  ['timeline_build', 'ordering', 'procedural/visual', 'det', 'partial', 'M', 'later', 'easy', null],
  ['categorize', 'categorize', 'procedural', 'det', 'partial', 'M', 'mvp', 'easy', null],
  ['sentence_builder', 'ordering', 'production', 'det', 'binary', 'M', 'mvp', 'easy', null],
  ['anagram', 'ordering', 'game/production', 'det', 'binary', 'S', 'later', 'easy', null],
  ['table_completion', 'cloze', 'recall', 'det', 'partial', 'M', 'later', 'medium', null],
  ['number_line_place', 'scale', 'math/visual', 'det', 'binary', 'M', 'phase2', 'easy', null],
  ['estimate_slider', 'scale', 'math/recall', 'det', 'partial', 'S', 'phase2', 'easy', null],
  ['hotspot_click', 'image_target', 'visual-spatial', 'det', 'binary', 'M', 'phase2', 'hard', 'img + coords'],
  ['hotspot_multi', 'image_target', 'visual-spatial', 'det', 'partial', 'M', 'later', 'hard', 'img + coords'],
  ['label_image', 'image_target', 'visual/recall', 'det', 'partial', 'M', 'phase2', 'hard', 'img + coords'],
  ['drop_pin', 'image_target', 'visual-spatial', 'det', 'partial', 'M', 'phase2', 'hard', 'img/map'],
  ['drag_drop_zones', 'image_target', 'visual/procedural', 'det', 'partial', 'L', 'later', 'hard', 'img'],
  ['image_sequencing', 'ordering', 'visual/procedural', 'det', 'partial', 'M', 'later', 'medium', 'img'],
  ['image_pairing', 'pairs', 'visual', 'det', 'matching', 'M', 'later', 'medium', 'img'],
  ['image_hotspots_explore', 'image_target', 'theory/visual', 'none', 'none', 'M', 'later', 'hard', 'img'],
  ['image_juxtaposition', 'image_target', 'theory', 'none', 'none', 'S', 'later', 'medium', '2 img'],
  ['character_tracing', 'draw', 'production/visual', 'det', 'binary', 'XL', 'phase3', 'medium', 'strokes'],
  ['freehand_drawing', 'draw', 'production/visual', 'self', 'self', 'L', 'phase3', 'easy', null],
  ['geo_map_click', 'image_target', 'visual-spatial', 'det', 'binary', 'L', 'phase3', 'medium', 'GeoJSON'],
  ['reading_passage_qs', 'choice', 'comprehension', 'det', 'partial', 'S', 'phase2', 'easy', null],
  ['c_test', 'cloze', 'comprehension/production', 'det', 'partial', 'M', 'phase2', 'easy', null],
  ['complete_the_chat', 'choice', 'comprehension', 'det', 'binary', 'S', 'mvp', 'easy', null],
  ['word_in_context', 'choice', 'comprehension', 'det', 'binary', 'S', 'phase2', 'easy', null],
  ['main_idea_title', 'choice', 'comprehension', 'det', 'binary', 'S', 'phase2', 'easy', null],
  ['essay_rubric', 'long_text', 'production', 'ai', 'ai', 'M', 'mvp', 'easy', null],
  ['structure_strip', 'long_text', 'production', 'ai', 'ai', 'M', 'later', 'easy', null],
  ['notes_reflection', 'long_text', 'theory/production', 'none', 'none', 'M', 'later', 'easy', null],
  ['worked_example_steps', 'math', 'procedural/math', 'det', 'partial', 'M', 'phase2', 'medium', null],
  ['listen_select', 'choice', 'listening', 'det', 'binary', 'S', 'phase2', 'medium', 'TTS'],
  ['listen_reconstruct', 'ordering', 'listening', 'det', 'binary', 'M', 'phase2', 'medium', 'TTS'],
  ['listen_comprehension_qs', 'choice', 'listening', 'det', 'partial', 'S', 'later', 'medium', 'TTS'],
  ['minimal_pairs', 'choice', 'listening', 'det', 'binary', 'S', 'later', 'medium', 'TTS ×2'],
  ['listening_cloze', 'cloze', 'listening', 'fuzzy', 'fuzzy', 'M', 'phase2', 'medium', 'TTS'],
  ['speak_free_prompt', 'speech', 'speaking', 'ai', 'ai', 'L', 'phase3', 'easy', 'img opt.'],
  ['roleplay_chat', 'dialogue', 'speaking/production', 'ai', 'ai', 'L', 'phase3', 'medium', 'TTS/ASR'],
  ['shadowing_intonation', 'speech', 'speaking', 'speech', 'speech', 'XL', 'phase3', 'easy', 'model audio'],
  ['expression_input', 'text_input', 'math', 'cas', 'objective', 'L', 'phase3', 'medium', null],
  ['calculated_variant', 'math', 'math', 'det', 'objective', 'M', 'phase2', 'medium', null],
  ['matrix_input', 'math', 'math', 'det', 'partial', 'M', 'phase3', 'medium', null],
  ['interactive_graph', 'graph', 'math', 'det', 'binary', 'XL', 'phase3', 'hard', null],
  ['plotter', 'graph', 'math', 'det', 'partial', 'L', 'phase3', 'medium', null],
  ['arithmetic_sprint', 'grid_game', 'math/game', 'det', 'partial', 'S', 'phase2', 'easy', null],
  ['secret_equation', 'grid_game', 'game/math', 'det', 'partial', 'M', 'later', 'easy', null],
  ['compare_fast', 'choice', 'game/math', 'det', 'partial', 'S', 'later', 'easy', null],
  ['manipulative', 'simulation', 'math/simulation', 'det', 'binary', 'L', 'phase3', 'medium', null],
  ['code_tests', 'code', 'code', 'code', 'objective', 'L', 'phase2', 'medium', null],
  ['fix_the_bug', 'code', 'code', 'code', 'objective', 'L', 'later', 'medium', null],
  ['parsons_problem', 'ordering', 'code/procedural', 'det', 'partial', 'M', 'phase2', 'easy', null],
  ['code_fill_blanks', 'cloze', 'code', 'det', 'partial', 'S', 'phase2', 'easy', null],
  ['predict_output', 'text_input', 'code/comprehension', 'det', 'binary', 'S', 'phase2', 'easy', null],
  ['sql_query', 'code', 'code', 'code', 'objective', 'L', 'later', 'medium', null],
  ['regex_task', 'text_input', 'code', 'det', 'partial', 'S', 'later', 'easy', null],
  ['terminal_task', 'code', 'code/simulation', 'det', 'binary', 'XL', 'later', 'hard', null],
  ['typing_drill', 'text_input', 'procedural', 'det', 'none', 'M', 'later', 'easy', null],
  ['crossword', 'grid_game', 'game/recall', 'det', 'partial', 'L', 'phase2', 'easy', null],
  ['word_search', 'grid_game', 'game/recognition', 'det', 'none', 'M', 'phase2', 'easy', null],
  ['hangman', 'grid_game', 'game/recall', 'det', 'binary', 'S', 'phase2', 'easy', null],
  ['memory_game', 'pairs', 'game/recognition', 'det', 'none', 'M', 'phase2', 'easy', 'img opt.'],
  ['arcade_select', 'arcade', 'game/recognition', 'det', 'partial', 'XL', 'phase3', 'easy', null],
  ['gameshow_ladder', 'arcade', 'game/recognition', 'det', 'partial', 'M', 'phase3', 'easy', null],
  ['branching_scenario', 'branching', 'simulation/comprehension', 'det', 'partial', 'L', 'phase2', 'medium', 'characters/img opt.'],
  ['media_checkpoints', 'media_checkpoints', 'comprehension', 'det', 'partial', 'L', 'phase2', 'hard', 'vid/audio'],
  ['software_simulation', 'simulation', 'simulation/procedural', 'det', 'partial', 'XL', 'phase3', 'hard', 'screenshots'],
  ['virtual_tour_360', 'simulation', 'simulation/visual', 'det', 'none', 'XL', 'phase3', 'hard', '360 img'],
  ['disclosure_block', 'disclosure', 'theory', 'none', 'none', 'S', 'mvp', 'easy', null],
  ['likert_poll', 'scale', 'survey', 'none', 'none', 'S', 'later', 'easy', null],
  ['board_puzzle', 'simulation', 'procedural/game', 'det', 'binary', 'XL', 'phase3', 'hard', null],
  ['play_notes_rhythm', 'simulation', 'procedural/listening', 'det', 'partial', 'XL', 'phase3', 'hard', 'audio synthesis'],
] as const satisfies readonly Row[]

/** One of the 98 type ids of §4. */
export type ActivityType = (typeof ROWS)[number][0]

/** The type ids whose payload family is `F`: `ActivityTypeOf<'cards'>` is the three flashcards. */
export type ActivityTypeOf<F extends ActivityFamily> = Extract<
  (typeof ROWS)[number],
  readonly [string, F, ...unknown[]]
>[0]

function toMeta(row: Row): ActivityTypeMeta {
  const [type, family, category, grader, ratingStrategy, complexity, phase, generation, media] = row
  return Object.freeze({
    type: type as ActivityType,
    family,
    category,
    grader,
    reviewEligible: ratingStrategy !== 'none',
    ratingStrategy,
    complexity,
    phase,
    generation,
    media,
  })
}

/** The 98 types in table order: index `n − 1` is row `n` of §4. */
export const ACTIVITY_TYPE_LIST: readonly ActivityTypeMeta[] = Object.freeze(ROWS.map(toMeta))

/** The type ids, in table order — the tuple `z.enum` wants. */
export const ACTIVITY_TYPE_IDS = ROWS.map((row) => row[0]) as unknown as readonly [
  ActivityType,
  ...ActivityType[],
]

export const ACTIVITY_TYPES: Readonly<Record<ActivityType, ActivityTypeMeta>> = Object.freeze(
  Object.fromEntries(ACTIVITY_TYPE_LIST.map((meta) => [meta.type, meta])) as Record<
    ActivityType,
    ActivityTypeMeta
  >,
)

export function isActivityType(value: unknown): value is ActivityType {
  return typeof value === 'string' && Object.hasOwn(ACTIVITY_TYPES, value)
}

export function familyOf(type: ActivityType): ActivityFamily {
  return ACTIVITY_TYPES[type].family
}

const TYPES_BY_FAMILY: Readonly<Record<ActivityFamily, readonly ActivityType[]>> = Object.freeze(
  Object.fromEntries(
    ACTIVITY_FAMILIES.map((family) => [
      family,
      Object.freeze(
        ACTIVITY_TYPE_LIST.filter((meta) => meta.family === family).map((meta) => meta.type),
      ),
    ]),
  ) as Record<ActivityFamily, readonly ActivityType[]>,
)

/** The types a family's payload schema serves, in table order. */
export function typesOfFamily<F extends ActivityFamily>(family: F): readonly ActivityTypeOf<F>[] {
  return TYPES_BY_FAMILY[family] as readonly ActivityTypeOf<F>[]
}

/** The 21 types of §6's MVP. */
export const MVP_TYPES: readonly ActivityType[] = Object.freeze(
  ACTIVITY_TYPE_LIST.filter((meta) => meta.phase === 'mvp').map((meta) => meta.type),
)

/** The 10 families with a real payload schema in this sub-phase. */
export const MVP_FAMILIES: readonly ActivityFamily[] = Object.freeze(
  ACTIVITY_FAMILIES.filter((family) => MVP_TYPES.some((type) => familyOf(type) === family)),
)

/** The other 13 families: `family` is a closed enum, their payload is a placeholder. */
export const PLACEHOLDER_FAMILIES: readonly ActivityFamily[] = Object.freeze(
  ACTIVITY_FAMILIES.filter((family) => !MVP_FAMILIES.includes(family)),
)

export function isMvpFamily(family: ActivityFamily): boolean {
  return MVP_FAMILIES.includes(family)
}

/**
 * Rating strategies a type may declare besides its registry default, where §4 itself hedges
 * ("M-bin/pct") or §10 of `02-memory-system.md` offers a second row that fits.
 */
export const REVIEW_ALTERNATES: Readonly<
  Partial<
    Record<ActivityType, { ratingStrategy?: readonly RatingRule[]; eligible?: readonly boolean[] }>
  >
> = Object.freeze({
  cloze_typed: { ratingStrategy: ['binary', 'partial'] },
  short_answer: { ratingStrategy: ['binary'] },
  dictation: { ratingStrategy: ['binary'] },
  listening_cloze: { ratingStrategy: ['partial'] },
  list_recall: { ratingStrategy: ['fuzzy'] },
  matching_pairs: { ratingStrategy: ['partial'] },
  matching_dropdown: { ratingStrategy: ['partial'] },
  image_pairing: { ratingStrategy: ['partial'] },
  timeline_build: { ratingStrategy: ['ordering'] },
  image_sequencing: { ratingStrategy: ['ordering'] },
  parsons_problem: { ratingStrategy: ['ordering'] },
  ordering_sequence: { ratingStrategy: ['partial'] },
  code_tests: { ratingStrategy: ['partial'] },
  fix_the_bug: { ratingStrategy: ['partial'] },
  sql_query: { ratingStrategy: ['binary'] },
  expression_input: { ratingStrategy: ['binary'] },
  calculated_variant: { ratingStrategy: ['binary'] },
  numeric_answer: { ratingStrategy: ['binary'] },
  predict_output: { ratingStrategy: ['objective'] },
  speak_free_prompt: { ratingStrategy: ['speech'] },
  freehand_drawing: { ratingStrategy: ['ai'] },
  // §4 row 56 is "N/S · M-ai": eligible or not, and self-assessed when it is not.
  structure_strip: { ratingStrategy: ['self'], eligible: [false] },
})

/** Grading methods a type may declare besides its registry default (§4's "FUZ (+AI backup)" etc.). */
export const GRADING_ALTERNATES: Readonly<Partial<Record<ActivityType, readonly GradingMethod[]>>> =
  Object.freeze({
    short_answer: ['ai'],
    cloze_typed: ['det'],
    table_completion: ['fuzzy'],
    reading_passage_qs: ['fuzzy'],
    structure_strip: ['self'],
    freehand_drawing: ['ai'],
    speak_free_prompt: ['speech'],
    branching_scenario: ['ai'],
  })

/** Whether `strategy` is the registry default or a documented alternate for `type`. */
export function allowedRatingStrategies(type: ActivityType): readonly RatingRule[] {
  const extra = REVIEW_ALTERNATES[type]?.ratingStrategy ?? []
  return [ACTIVITY_TYPES[type].ratingStrategy, ...extra]
}

export function allowedEligibility(type: ActivityType): readonly boolean[] {
  const extra = REVIEW_ALTERNATES[type]?.eligible ?? []
  return [ACTIVITY_TYPES[type].reviewEligible, ...extra]
}

export function allowedGradingMethods(type: ActivityType): readonly GradingMethod[] {
  return [ACTIVITY_TYPES[type].grader, ...(GRADING_ALTERNATES[type] ?? [])]
}

/**
 * §5's progression stage for every one of the 98 types: how much help the type gives the
 * learner, which is what the session generator reads to decide what a due skill is asked.
 *
 * It lives here rather than in `packages/activities`' registry because it is a property of
 * the **type**, like its family and its rating rule — and because the main process needs it
 * to serve a review, while `packages/activities` is a React package main must not import.
 * `defineActivityType` fills a registry entry from this map, exactly as it already fills the
 * rating strategy from the table above.
 *
 * The four rungs, as §5 states them:
 *
 * - `recognition` — the screen supplies the options and the learner picks (`mcq_single`,
 *   `true_false`, `cloze_dropdown`).
 * - `assisted` — the parts are supplied and the learner assembles them (`cloze_wordbank`,
 *   `sentence_builder`, `matching_pairs`).
 * - `production` — nothing is supplied (`cloze_typed`, `short_answer`, `free_recall`), which
 *   is also where the self-rated flashcards sit: recalling a card's back is free recall.
 * - `theory` — not a rung at all, but the marker for lesson-only content. It is exactly the
 *   nine rows of §4 whose review column is `N`, and no ladder ever reaches it.
 */
export const PROGRESSION_BY_TYPE: Readonly<Record<ActivityType, ProgressionStage>> = Object.freeze({
  // theory
  image_hotspots_explore: 'theory',
  image_juxtaposition: 'theory',
  notes_reflection: 'theory',
  typing_drill: 'theory',
  word_search: 'theory',
  memory_game: 'theory',
  virtual_tour_360: 'theory',
  disclosure_block: 'theory',
  likert_poll: 'theory',
  // recognition
  dialog_cards: 'recognition',
  mcq_single: 'recognition',
  mcq_multi: 'recognition',
  true_false: 'recognition',
  statement_set: 'recognition',
  single_choice_set: 'recognition',
  cloze_dropdown: 'recognition',
  image_choice: 'recognition',
  summary_builder: 'recognition',
  mark_the_words: 'recognition',
  odd_one_out: 'recognition',
  confidence_mcq: 'recognition',
  matching_dropdown: 'recognition',
  number_line_place: 'recognition',
  estimate_slider: 'recognition',
  hotspot_click: 'recognition',
  hotspot_multi: 'recognition',
  drop_pin: 'recognition',
  geo_map_click: 'recognition',
  reading_passage_qs: 'recognition',
  complete_the_chat: 'recognition',
  word_in_context: 'recognition',
  main_idea_title: 'recognition',
  listen_select: 'recognition',
  listen_comprehension_qs: 'recognition',
  minimal_pairs: 'recognition',
  compare_fast: 'recognition',
  arcade_select: 'recognition',
  gameshow_ladder: 'recognition',
  branching_scenario: 'recognition',
  media_checkpoints: 'recognition',
  board_puzzle: 'recognition',
  // assisted
  image_occlusion: 'assisted',
  cloze_wordbank: 'assisted',
  matching_pairs: 'assisted',
  tap_pairs_timed: 'assisted',
  ordering_sequence: 'assisted',
  timeline_build: 'assisted',
  categorize: 'assisted',
  sentence_builder: 'assisted',
  anagram: 'assisted',
  table_completion: 'assisted',
  label_image: 'assisted',
  drag_drop_zones: 'assisted',
  image_sequencing: 'assisted',
  image_pairing: 'assisted',
  c_test: 'assisted',
  structure_strip: 'assisted',
  worked_example_steps: 'assisted',
  listen_reconstruct: 'assisted',
  matrix_input: 'assisted',
  interactive_graph: 'assisted',
  plotter: 'assisted',
  secret_equation: 'assisted',
  manipulative: 'assisted',
  parsons_problem: 'assisted',
  code_fill_blanks: 'assisted',
  crossword: 'assisted',
  software_simulation: 'assisted',
  play_notes_rhythm: 'assisted',
  // production
  flashcard_basic: 'production',
  flashcard_reverse: 'production',
  cloze_typed: 'production',
  short_answer: 'production',
  numeric_answer: 'production',
  list_recall: 'production',
  free_recall: 'production',
  self_check_statement: 'production',
  spell_the_word: 'production',
  dictation: 'production',
  speak_repeat: 'production',
  pronunciation_word: 'production',
  character_tracing: 'production',
  freehand_drawing: 'production',
  essay_rubric: 'production',
  listening_cloze: 'production',
  speak_free_prompt: 'production',
  roleplay_chat: 'production',
  shadowing_intonation: 'production',
  expression_input: 'production',
  calculated_variant: 'production',
  arithmetic_sprint: 'production',
  code_tests: 'production',
  fix_the_bug: 'production',
  predict_output: 'production',
  sql_query: 'production',
  regex_task: 'production',
  terminal_task: 'production',
  hangman: 'production',
})

/** §5's *"available modality (microphone? image?)"*, as a property of the type. */
export function capabilitiesOf(type: ActivityType): {
  needsMic: boolean
  needsSandbox: boolean
} {
  const family = familyOf(type)
  return { needsMic: family === 'speech', needsSandbox: family === 'code' }
}

export function progressionOf(type: ActivityType): ProgressionStage {
  return PROGRESSION_BY_TYPE[type]
}
