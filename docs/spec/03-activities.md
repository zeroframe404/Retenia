Source: Retenia research PDF v1.0 (Sep 2026), section 6

# Interactive activity catalogue

Everything that exists in Articulate Storyline/Rise, Adobe Captivate, Moodle (core +
plugins + H5P), Duolingo, Khan Academy Perseus, Wordwall, Educaplay, LearningApps, Quizizz,
Kahoot and the language apps, reduced to a unified taxonomy of **98 types** with grading,
memory mapping and complexity.

## Table of contents

- [1. What was learned from each catalogue](#1-what-was-learned-from-each-catalogue)
- [2. Primitives, wrappers and graders](#2-primitives-wrappers-and-graders)
- [3. Rating strategies (mapping to the scheduler's 1–4 scale)](#3-rating-strategies-mapping-to-the-schedulers-14-scale)
- [4. Master table: 98 types](#4-master-table-98-types)
- [5. Rules for spaced review](#5-rules-for-spaced-review)
- [6. Prioritization: MVP / Phase 2 / Phase 3](#6-prioritization-mvp--phase-2--phase-3)
- [7. JSON schema: common envelope + 22 payload families](#7-json-schema-common-envelope--22-payload-families)
- [8. Activity engine architecture (React)](#8-activity-engine-architecture-react)
- [9. Type registry and ActivityHost](#9-type-registry-and-activityhost)
- [10. Grader rules](#10-grader-rules)
- [11. Generation from sources and validation pipeline](#11-generation-from-sources-and-validation-pipeline)
- [12. Sessions: lesson and review](#12-sessions-lesson-and-review)
- [13. Decisions to take now](#13-decisions-to-take-now)

---

## 1. What was learned from each catalogue

| Source | Verified contribution |
|---|---|
| **Storyline 360** | 11 graded question types (T/F, MC, multiple response, fill-in-the-blank, word bank, matching drag-and-drop / drop-down, sequence drag-and-drop / drop-down, numeric, hotspot), 9 survey types (Likert, pick one/many, which word, short answer, essay, ranking ×2, how many) and 6 freeform (drag and drop, pick one/many, text entry, hotspot, shortcut key). Mechanics: sliders, dials, markers, states, triggers, variables, layers, lightbox, question banks, result slides, software simulations, 360° images with exploration variables. |
| **Rise 360** | Microlearning blocks: accordion, tabs, labeled graphic, process, scenario (branched with characters), sorting activity, timeline, flashcards (grid/stack), button stack; 4 knowledge checks (MC, multiple response, fill in the blank, matching); quiz with expanded feedback and retries. Proves that 8 interactive blocks + 4 checks are enough for a leading microlearning product. |
| **Adobe Captivate** | Classic: 8 question types + pretest/knowledge check/random; ~40 learning interactions including 7 games (Hangman, Jigsaw, Memory, Millionaire, Word Search, Catch AlphaNums, Jeopardy) whose score is "binary for playing" — **games are engagement, not assessment**; interactive video with overlay slides and bookmarks (branching inside the video); VR/360 with gradable hotspots; demo/training/assessment simulations. All-new Captivate 13: components + widgets (Click to Reveal, Carousel, Hotspot, Drag-and-Drop, Timeline, Slider, Stack Card) and GenAI. |
| **Moodle** | 17 core types (calculated ×3, drag and drop into text / markers / onto image, description, essay, matching, embedded Cloze, MC, numerical, ordering, random short-answer matching, select missing words, short answer, T/F) + behaviours (deferred, adaptive, interactive with multiple tries, immediate, certainty-based marking); ~35 third-party types (STACK with CAS Maxima, CodeRunner, Formulas, Gapfill, Kprime, Pattern-match, Wordselect, Freehand drawing, GeoGebra, PoodLL recording…); modules (branched Lesson, Workshop, Game with 8 games, VPL, Poodll ReadAloud/Solo/MiniLessons, Mootyper, Level Up XP, Stash, Board). |
| **H5P** | 53 official content types (Interactive Video, Course Presentation, Branching Scenario, Drag and Drop, Drag the Words, Fill in the Blanks, Mark the Words, Memory Game, Image Hotspots, Find the Hotspot, Image Sequencing/Pairing/Juxtaposition, Flashcards, Dialog Cards, Speak the Words, Audio Recorder, Dictation, Essay, Interactive Book, Timeline, Virtual Tour 360, Arithmetic Quiz, Crossword, Sort the Paragraphs, Summary, Single Choice Set, Game Map…). Reproducible in Electron with `h5p-standalone` (MIT) capturing xAPI events; editing with Lumi's library drags in GPL-3.0. "H5P" is a registered trademark. |
| **Duolingo** | ~18 language exercise types (translate with a word bank or keyboard, select image, mark the meaning, missing word, tap/type what you hear, speak, match pairs, arrange words, read and respond, complete the chat, character tracing), 9 types in Stories, Math with manipulatives and puzzles (Cash Dash, Secret Equation, Magic Squares), Music with an on-screen keyboard, Chess with puzzles; principles: Birdbrain + Session Generator, HLR, exercise generation with an LLM "Mad Lib" style + human review. |
| **Perseus (Khan)** | 30 MIT widgets in TypeScript/React with a public schema (expression, grapher, interactive-graph, number-line, numeric-input, orderer, matcher, categorizer, sorter, plotter, matrix, label-image, radio, dropdown…), with render and scoring separated (`@khanacademy/perseus` / `perseus-score`): reusable as a library for mathematics. |
| **Wordwall / Educaplay / LearningApps / Quizizz / Kahoot** | 34 / 20 / 21 templates and ~20 question types (draw, hotspot, labeling, graphing, math response, audio/video response, slider, drop pin…). Key lesson from Wordwall: the same content (term-definition pairs) is re-rendered in dozens of templates — **content ≠ presentation**. |
| **Code and voice** | Exercism/Boot.dev/Codecademy/DataCamp: hidden tests, fix-the-bug, Parsons, fill-in code, predict output; ELSA/Speak/Praktika/BoldVoice: repeat after me per phoneme, stress and intonation, minimal pairs, roleplay, read aloud with WPM (Poodll); Duolingo English Test: c-test, highlight the answer, interactive listening. |

## 2. Primitives, wrappers and graders

All types decompose into **25 primitives** (what the user does) × **8 wrappers** ×
**7 graders**.

**25 primitives** — choose one/several, T/F, write short text/number/expression/long text,
fill gaps, order, match, categorize, point at an image, label, drag to zones, mark segments,
build a sentence with tokens, continuous value, speak, listen-and-X, trace/draw, manipulate
a mathematical object, write/order code, decide in a branch, explore-and-complete, recall
freely.

**8 wrappers** — loose question, cloze in a passage, card, game with time/lives, media with
checkpoints, branched scenario, presentation/book, game map.

**7 graders**

| Grader | Definition |
|---|---|
| **DET** | Deterministic |
| **FUZ** | Fuzzy (Unicode normalization, relative Damerau-Levenshtein distance ≤ 0.2, synonyms, regex) |
| **CAS** | Numeric/symbolic with tolerance |
| **CODE** | Tests |
| **SPEECH** | ASR / pronunciation |
| **AI** | Rubric |
| **SELF** | Self-assessment |

**Common properties (not new types):** shuffling, partial credit, negative scoring, maximum
attempts with progressive hints, typo tolerance, certainty-based marking, time limit, "no
hints" (Legendary), per-option feedback, "Explain my answer", adaptive jump depending on the
answer, switch template.

## 3. Rating strategies (mapping to the scheduler's 1–4 scale)

| Strategy | Rule |
|---|---|
| **M-bin** | 1 = failure; 2 = correct after a hint, on the 2nd attempt, or in > 2× the expected time; 3 = clean correct; 4 = clean in < 50 % of the time or marked "easy". |
| **M-pct** | `p < 0.5` → 1; `0.5–0.8` → 2; `0.8–1` → 3; `1` with no hints → 4. |
| **M-self** | The user chooses. |
| **M-ai** | The rubric returns a rating and the user can correct it. |
| **M-speech** | `≥ 0.9` → 4; `≥ 0.75` → 3; `≥ 0.5` → 2. |
| **M-none** | Does not feed memory. |

## 4. Master table: 98 types

**Calif.:** DET / FUZ / AI / SELF / SPEECH / CODE / CAS / none.
**Repaso:** `S` = eligible for the memory system (with its M-* rule), `N` = lesson only.
**Gen. IA:** ease of generating from source text alone.
**Media:** what has to be generated (TTS, img, vid).
**Compl.:** S/M/L/XL of implementation (renderer + grader + generator).

| # | Type (id) | Category | Calif. | Repaso | Gen. IA | Media | Compl. |
|---|---|---|---|---|---|---|---|
| 1 | `flashcard_basic` (front → back) | recall | SELF | S · M-self | fácil | no | S |
| 2 | `flashcard_reverse` | recall | SELF | S · M-self | fácil | no | S |
| 3 | `dialog_cards` ("I knew it / no") | recall | SELF | S · M-self | fácil | no | S |
| 4 | `cloze_typed` (typed gap) | recall | FUZ | S · M-bin/pct | fácil | no | S |
| 5 | `short_answer` | recall | FUZ (+AI backup) | S · M-bin | fácil | no | S |
| 6 | `numeric_answer` (tolerance, units) | recall/math | DET | S · M-bin | fácil | no | S |
| 7 | `list_recall` (list the N) | recall | FUZ set-match | S · M-pct | fácil | no | M |
| 8 | `free_recall` (explain in your own words) | recall/production | AI | S · M-ai | fácil | no | M |
| 9 | `self_check_statement` (write, compare, score yourself) | recall | SELF | S · M-self | fácil | no | S |
| 10 | `image_occlusion` (hide labels) | recall/visual | SELF | S · M-self | difícil | img + coords | M |
| 11 | `spell_the_word` (listen and spell) | production | DET | S · M-bin | fácil | TTS | S |
| 12 | `dictation` / `listen_type` | listening | FUZ | S · M-bin | medio | TTS | M |
| 13 | `speak_repeat` (read aloud / repeat after me) | speaking | SPEECH | S · M-speech | fácil | TTS model (opt.) | L |
| 14 | `pronunciation_word` (phoneme/word with score) | speaking | SPEECH (API) | S · M-speech | fácil | TTS | L |
| 15 | `mcq_single` | recognition | DET | S · M-bin | fácil | no | S |
| 16 | `mcq_multi` (multiple response) | recognition | DET (partial / all-or-nothing) | S · M-pct | fácil | no | S |
| 17 | `true_false` | recognition | DET | S · M-bin | fácil | no | S |
| 18 | `statement_set` (Kprime / multiple T-F) | recognition | DET partial | S · M-pct | fácil | no | S |
| 19 | `single_choice_set` (1-of-N burst) | recognition | DET | S · M-pct | fácil | no | S |
| 20 | `cloze_dropdown` (select missing words) | recognition | DET | S · M-pct | fácil | no | S |
| 21 | `cloze_wordbank` (word bank / drag the words) | recognition/procedural | DET | S · M-pct | fácil | no | M |
| 22 | `image_choice` (choose the image) | recognition/visual | DET | S · M-bin | medio | img | S |
| 23 | `summary_builder` (correct statement per block; H5P Summary) | comprehension | DET | S · M-pct | fácil | no | S |
| 24 | `mark_the_words` / highlight | comprehension | DET partial | S · M-pct | fácil | no | M |
| 25 | `odd_one_out` | recognition | DET | S · M-bin | fácil | no | S |
| 26 | `confidence_mcq` (MCQ + certainty; CBM) | recognition/metacog. | DET weighted | S · M-bin adjusted | fácil | no | S |
| 27 | `matching_pairs` (drag / join with lines) | procedural | DET partial | S · M-pct | fácil | no | M |
| 28 | `matching_dropdown` | procedural | DET partial | S · M-pct | fácil | no | S |
| 29 | `tap_pairs_timed` (Match Madness) | game/recognition | DET + time | S · M-pct | fácil | no | M |
| 30 | `ordering_sequence` (steps, paragraphs, chronology) | procedural | DET (exact / adjacent / Kendall) | S · M-pct | fácil | no | M |
| 31 | `timeline_build` (events on a timeline) | procedural/visual | DET | S · M-pct | fácil | no | M |
| 32 | `categorize` (group sort) | procedural | DET partial | S · M-pct | fácil | no | M |
| 33 | `sentence_builder` (tokens + distractors) | production | DET (several valid) | S · M-bin | fácil | no | M |
| 34 | `anagram` / `unscramble` | game/production | DET | S · M-bin | fácil | no | S |
| 35 | `table_completion` (cells with gaps) | recall | DET/FUZ per cell | S · M-pct | medio | no | M |
| 36 | `number_line_place` | math/visual | DET tolerance | S · M-bin | fácil | no | M |
| 37 | `estimate_slider` (slider / dial) | math/recall | DET gradual | S · M-pct | fácil | no | S |
| 38 | `hotspot_click` (find the hotspot) | visual-spatial | DET zone | S · M-bin | difícil | img + coords | M |
| 39 | `hotspot_multi` | visual-spatial | DET partial | S · M-pct | difícil | img + coords | M |
| 40 | `label_image` (labelled diagram) | visual/recall | DET partial | S · M-pct | difícil | img + coords | M |
| 41 | `drop_pin` (markers / map) | visual-spatial | DET distance | S · M-pct | difícil | img/map | M |
| 42 | `drag_drop_zones` (objects → zones, N:M) | visual/procedural | DET | S · M-pct | difícil | img | L |
| 43 | `image_sequencing` | visual/procedural | DET | S · M-pct | medio | img | M |
| 44 | `image_pairing` (image ↔ image/text) | visual | DET | S · M-pct | medio | img | M |
| 45 | `image_hotspots_explore` (informative labeled graphic) | teoría/visual | none | N | difícil | img | M |
| 46 | `image_juxtaposition` (before/after) | teoría | none | N | medio | 2 img | S |
| 47 | `character_tracing` (stroke order) | production/visual | DET tolerant | S · M-bin | medio | strokes | XL |
| 48 | `freehand_drawing` (draw the schema) | production/visual | SELF / AI-vision | S · M-self/ai | fácil | no | L |
| 49 | `geo_map_click` (region on a vector map) | visual-spatial | DET | S · M-bin | medio | GeoJSON | L |
| 50 | `reading_passage_qs` (passage + questions) | comprehension | DET/FUZ | S · M-pct | fácil | no | S |
| 51 | `c_test` / read-and-complete (missing letters) | comprehension/production | DET | S · M-pct | fácil | no | M |
| 52 | `complete_the_chat` (best reply) | comprehension | DET | S · M-bin | fácil | no | S |
| 53 | `word_in_context` (meaning of the highlighted word) | comprehension | DET | S · M-bin | fácil | no | S |
| 54 | `main_idea_title` (title / main idea / evidence) | comprehension | DET | S · M-bin | fácil | no | S |
| 55 | `essay_rubric` (short answer with a rubric) | production | AI | S · M-ai | fácil | no | M |
| 56 | `structure_strip` (scaffolded writing) | production | SELF/AI | N/S · M-ai | fácil | no | M |
| 57 | `notes_reflection` (Cornell / documentation tool) | teoría/production | none | N | fácil | no | M |
| 58 | `worked_example_steps` (step by step with a decision) | procedural/math | DET per step | S · M-pct | medio | no | M |
| 59 | `listen_select` (what do you hear?) | listening | DET | S · M-bin | medio | TTS | S |
| 60 | `listen_reconstruct` (tap what you hear) | listening | DET | S · M-bin | medio | TTS | M |
| 61 | `listen_comprehension_qs` (audio + questions) | listening | DET | S · M-pct | medio | TTS | S |
| 62 | `minimal_pairs` | listening | DET | S · M-bin | medio | TTS ×2 | S |
| 63 | `listening_cloze` | listening | FUZ | S · M-pct | medio | TTS | M |
| 64 | `speak_free_prompt` (talk about the topic/photo) | speaking | SPEECH + AI | S · M-ai | fácil | img opt. | L |
| 65 | `roleplay_chat` (conversation with a goal; text or voice) | speaking/production | AI (goal, accuracy, complexity) | S · M-ai (limited) | medio | TTS/ASR | L |
| 66 | `shadowing_intonation` (intonation curve) | speaking | SPEECH (pitch) | S · M-speech | fácil | model audio | XL |
| 67 | `expression_input` (algebraic expression) | math | CAS | S · M-bin | medio | no | L |
| 68 | `calculated_variant` (random parameters + formula) | math | DET formula + tolerance | S · M-bin | medio | no | M |
| 69 | `matrix_input` | math | DET | S · M-pct | medio | no | M |
| 70 | `interactive_graph` (point/line/function) | math | DET geometric | S · M-bin | difícil | no | XL |
| 71 | `plotter` (histogram / dot plot / bars) | math | DET | S · M-pct | medio | no | L |
| 72 | `arithmetic_sprint` (mental arithmetic against the clock) | math/game | DET + time | S · M-pct | fácil | no | S |
| 73 | `secret_equation` (mathematical Wordle) | game/math | DET | S · M-pct | fácil | no | M |
| 74 | `compare_fast` (timed binary comparison) | game/math | DET | S · M-pct | fácil | no | S |
| 75 | `manipulative` (clock, ruler, protractor, fractions) | math/simulation | DET | S · M-bin | medio | no | L |
| 76 | `code_tests` (function with visible/hidden tests) | code | CODE | S · M-pct | medio | no | L |
| 77 | `fix_the_bug` | code | CODE | S · M-pct | medio | no | L |
| 78 | `parsons_problem` (order / indent blocks) | code/procedural | DET | S · M-pct | fácil | no | M |
| 79 | `code_fill_blanks` | code | DET/regex | S · M-pct | fácil | no | S |
| 80 | `predict_output` | code/comprehension | DET (exact stdout) | S · M-bin | fácil | no | S |
| 81 | `sql_query` (embedded SQLite; compare result-set) | code | CODE | S · M-bin | medio | no | L |
| 82 | `regex_task` | code | DET | S · M-pct | fácil | no | S |
| 83 | `terminal_task` (simulated CLI) | code/simulation | DET state | S · M-bin | difícil | no | XL |
| 84 | `typing_drill` (WPM / accuracy) | procedural | DET | N | fácil | no | M |
| 85 | `crossword` | game/recall | DET | S · M-pct | fácil | no | L |
| 86 | `word_search` | game/recognition | DET | N | fácil | no | M |
| 87 | `hangman` | game/recall | DET (≤ k failures) | S · M-bin | fácil | no | S |
| 88 | `memory_game` (concentration) | game/recognition | DET | N | fácil | img opt. | M |
| 89 | `arcade_select` (whack-a-mole, balloon pop, maze chase, shooter) | game/recognition | DET | S · M-pct (no chance) | fácil | no | L–XL |
| 90 | `gameshow_ladder` (Millionaire with lifelines) | game/recognition | DET | S · M-pct | fácil | no | M |
| 91 | `branching_scenario` (decision tree with endings) | simulation/comprehension | DET (path score) + AI opt. | S limited · M-pct | medio | characters/img opt. | L |
| 92 | `media_checkpoints` (video/audio with questions and jumps) | comprehension | per sub-activity | S (sub-items) | difícil | vid/audio | L |
| 93 | `software_simulation` (click/type over screenshots) | simulation/procedural | DET (zones + sequence) | S · M-pct | difícil | screenshots | XL |
| 94 | `virtual_tour_360` | simulation/visual | DET/completeness | N | difícil | 360 img | XL |
| 95 | `disclosure_block` (accordion / tabs / process / timeline / flip / stack) | teoría | none (completeness) | N | fácil | no | S |
| 96 | `likert_poll` (survey) | survey | none | N | fácil | no | S |
| 97 | `board_puzzle` (chess: best move) | procedural/game | DET (engine) | S · M-bin | difícil | no | XL |
| 98 | `play_notes_rhythm` (musical keyboard, rhythm) | procedural/listening | DET (pitch + time) | S · M-pct | difícil | audio synthesis | XL |

Of the 98 rows, **89 are eligible for memory review**; the remaining **9** (theory blocks,
survey, typing and games with chance or with no reliable recall signal) are part of the
lesson catalogue.

## 5. Rules for spaced review

- **Review core** (high value per second, generable from text, no media): types
  **1–9, 15–21, 24, 27–28, 30, 32–33, 50, 52–55, 58, 68, 78–80**. About 30 types allow the
  same skill to be reviewed with format variety and avoid memorizing the question's shape.
- **Progression per skill** (Quizlet Learn + Duolingo Legendary): 1st exposure →
  recognition (`mcq` / `true_false` / `cloze_dropdown`); medium stability → assisted
  production (`cloze_wordbank`, `sentence_builder`, `matching`); high stability → free
  production (`cloze_typed`, `short_answer`, `free_recall`) and "no hints" variants.
- **A memory item ≠ an activity.** The scheduler schedules **skills**; the session
  generator chooses at run time which type to render according to stability and available
  modality (microphone? image?), and the rating is computed with that type's M-* rule.
- **Types with chance or noise** (memory game, word search, arcade with moving distractors,
  board) **do not feed the scheduler**; they serve as reward and variety, as Captivate and
  Blooket do.

## 6. Prioritization: MVP / Phase 2 / Phase 3

### MVP · 21 types · 10 families — text only, no generated media

| Family | Types |
|---|---|
| `choice` | `mcq_single`, `mcq_multi`, `true_false`, `statement_set`, `complete_the_chat` |
| `cloze` | `cloze_typed`, `cloze_dropdown`, `cloze_wordbank` |
| `text_input` | `short_answer`, `numeric_answer` |
| `cards` | `flashcard_basic`, `flashcard_reverse`, `dialog_cards` |
| `long_text` | `free_recall`, `essay_rubric` (AI) |
| `pairs` | `matching_pairs` |
| `ordering` | `ordering_sequence`, `sentence_builder` |
| `categorize` | `categorize` |
| `text_mark` | `mark_the_words` |
| `disclosure` | `disclosure_block` for the theory |

**Infrastructure:** dnd, Markdown + KaTeX, DET/FUZ graders, one AI grader, FSRS, one schema
per family per call.

### Phase 2 · Modalities and media — audio, image, code, simple games

`listen_select`, `listen_reconstruct`, `dictation`, `spell_the_word`, `listening_cloze`
(TTS); `speak_repeat` (local ASR); `image_choice`, `hotspot_click`, `label_image`,
`drop_pin`, `image_occlusion` (images from the document or uploaded; vision-assisted
coordinates); `code_fill_blanks`, `parsons`, `predict_output`, `code_tests` (JS / Pyodide);
`tap_pairs_timed`, `arithmetic_sprint`, `hangman`, `crossword`; `memory`, `word_search`;
`worked_example_steps`, `calculated_variant`, `estimate_slider`, `number_line`;
`branching_scenario` in text; `media_checkpoints` over the user's videos; `confidence_mcq`;
`reading_passage_qs`, `c_test`, `word_in_context`, `main_idea_title`, `summary_builder`.

### Phase 3 · Rich mathematics, advanced voice, bridges — Perseus, pronunciation, simulations, H5P

`expression_input` (CAS by sampling with math.js), `interactive_graph` and `plotter`
(reusing `@khanacademy/perseus`, MIT), `matrix_input`; `roleplay_chat`,
`speak_free_prompt`, `pronunciation_word`, `shadowing_intonation`; `freehand_drawing`,
`character_tracing`, `geo_map_click`; `arcade`, `gameshow`, `software_simulation`,
`virtual_tour_360`, `manipulative`; `h5p-bridge` (`h5p-standalone` in a sandboxed iframe,
xAPI → rating); `board_puzzle` and `play_notes` only if the product enters those domains.

## 7. JSON schema: common envelope + 22 payload families

A `oneOf` of 90 branches is fragile and expensive in tokens. `type` (the concrete type,
which decides the renderer, prompt and rating strategy) is separated from `payload.family`
(22 data families, which decide grader and validation), just as in Perseus
(`WidgetOptions<Type, Options>`) and H5P (`library` + `params`). On each LLM call only the
schema of the family to be generated is passed, with the `enum` of `type` reduced to the
allowed types.

```ts
interface ActivityBase<T, P> {
  id: string /*ULID*/; schemaVersion: 1; type: T; family: P['family']; lang: string /*BCP-47*/;
  prompt: RichText /*Markdown + $TeX$ + [[media:ID]] + ```code```*/; instructions?: string;
  media?: MediaRef[] /*{id, kind, src?, alt?, generate?: {by:'tts'|'image'|'user-upload', …}}*/;
  hints?: RichText[]; explanation?: RichText /*static "Explain my answer"*/;
  sources?: SourceRef[] /*{docId, span, quote}*/;
  skills: string[] /*concepts the scheduler schedules*/; difficulty: 1|2|3|4|5; tags?: string[];
  grading: { method: 'det'|'fuzzy'|'ai'|'self'|'speech'|'code'|'cas'|'none'; partialCredit?;
             negativeScoring?; maxAttempts?; hintPenalty?; timeLimitSec?; shuffle?;
             fuzzy?: { caseSensitive?; ignoreDiacritics?; maxRelativeEditDistance?; synonyms?: string[][] };
             numeric?: { absTol?; relTol?; units? } };
  review: { eligible: boolean; ratingStrategy: 'bin'|'pct'|'self'|'ai'|'speech'|'none';
            expectedSeconds?: number };
  payload: P;
}

// Families: choice · text_input · cloze · long_text · pairs · ordering · categorize ·
//           image_target · text_mark · scale · speech
//           dialogue · branching · media_checkpoints · code · math · graph · grid_game ·
//           arcade · cards · disclosure · draw · (simulation)

interface GradeResult { score: number /*0..1*/; correct: boolean;
  perItem?: {id, correct, expected?, got?}[]; feedback: RichText;
  rating: 1|2|3|4|null; meta: { timeMs; attempts; hintsUsed; confidence?; engine? } }
```

### The 22 payload families

| Family | Types that use it | Key payload fields |
|---|---|---|
| `choice` | `mcq_single/multi`, `true_false`, `statement_set`, `single_choice_set`, `image_choice`, `odd_one_out`, `complete_the_chat`, `word_in_context`, `main_idea_title`, `listen_select`, `minimal_pairs`, `confidence_mcq`, `compare_fast` | `sets[{stem, options[{id,text,media,correct,feedback}], multiple, min/maxSelect}]`, `layout`, `askConfidence` |
| `text_input` | `short_answer`, `numeric_answer`, `spell_the_word`, `dictation`, `predict_output`, `expression_input`, `regex_task` | `inputKind` (text/number/math/letters/regex), `answers[{value, isRegex, feedback}]`, `numeric{value, tol, unit}`, `regexCases` |
| `cloze` | `cloze_typed/dropdown/wordbank`, `listening_cloze`, `code_fill_blanks`, `c_test`, `table_completion` | `mode`, `layout` (inline/table/code), `segments[text | gap{id, answers, options, visiblePrefix}]`, `bankDistractors`, `singleUseDraggables` |
| `long_text` | `free_recall`, `essay_rubric`, `structure_strip`, `self_check_statement`, `list_recall`, `notes_reflection` | `min/maxWords`, `sections`, `modelAnswer`, `keyPoints[{text, weight, aliases}]`, `rubric[{criterion, weight, levels}]` |
| `pairs` | `matching_pairs/dropdown`, `tap_pairs_timed`, `image_pairing`, `memory_game` | `presentation` (drag/dropdown/lines/tap-timed/memory), `pairs[{left, right}]`, `rightDistractors`, `timeLimitSec` |
| `ordering` | `ordering_sequence`, `timeline_build`, `image_sequencing`, `sentence_builder`, `anagram`, `parsons_problem`, `listen_reconstruct` | `items[{id, text, media, date, indent}]`, `correctOrder`, `alternativeOrders`, `distractors`, `scoring` (exact/adjacent-pairs/kendall/position), `axis`, `checkIndentation` |
| `categorize` | `categorize`, `group_sort` | `categories[]`, `items[{categoryIds}]` |
| `image_target` | `hotspot_click/multi`, `label_image`, `drop_pin`, `drag_drop_zones`, `image_hotspots_explore`, `image_occlusion`, `geo_map_click` | `image`, `mode`, `shapes[{kind rect/circle/polygon/region, coords, correct, label, info}]`, `draggables[{targetShapeIds}]`, `tolerancePx` |
| `text_mark` | `mark_the_words` | `tokens`/`correctIds` |
| `scale` | `estimate_slider`, `number_line`, `likert` | `min`/`max`/`correct{value, tolerances}` |
| `speech` | `speak_*`, `pronunciation`, `shadowing` | `mode` + `targetText` + `engine` + `thresholds` |
| `dialogue` | `roleplay_chat` | `persona` + `scenario` + `goal` + `rubric` + `mustUse` |
| `branching` | `branching_scenario` | `nodes`/`choices`/`endings` + `scoring` |
| `media_checkpoints` | video/audio with checkpoints | `media` + `checkpoints[{atSec, activity, onWrong}]` |
| `code` | `code_tests`, `fix_the_bug`, `sql_query` | `language` + `runner` + `starterCode` + `tests[{code, expectedStdout, hidden, weight}]` + `limits` |
| `math` | `calculated_variant`, `matrix`, `worked_example_steps` | `variables` + `answerFormula` + `tolerance` |
| `graph` | `interactive_graph`, `plotter` | `range` + `correct{type, coords}` (compatible with Perseus) |
| `grid_game` | `crossword`, `word_search`, `hangman`, `secret_equation`, `sprint` | `entries[{answer, clue}]` + `settings` |
| `arcade` | `arcade`/`gameshow` | `questions[]` + `lives`/`lifelines` |
| `cards` | `flashcards` | `cards[{front, back, media}]` |
| `disclosure` | `accordion`/`tabs`/`process`/`timeline` | `items[{title, body}]` |
| `draw` | `freehand`/`tracing` | `strokes` + `evaluation` |

> A 23rd entry, `simulation`, appears parenthesized in the family list in the source
> (`… · draw · (simulation)`), i.e. it is not counted among the 22.

## 8. Activity engine architecture (React)

```
packages/
  activity-schema/   zod per family → JSON Schema (zod-to-json-schema); schemaVersion migrations; fixtures
  activity-graders/  pure graders per family + utilities: Unicode normalization, Damerau-Levenshtein,
                     set-match, order metrics (exact/adjacent/Kendall), zone geometry,
                     math.js equivalence by sampling
  activity-ui/       React: <ActivityHost/>, one Renderer per family, shared components (DragLayer,
                     TokenBank, MathField, AudioButton, ImageStage, CodeEditor)
  activity-ai/       prompts per type, generation with structured outputs, validation + repair,
                     AI graders, "blind solve", media jobs
  activity-speech/   local ASR or Web Speech; pronunciation scoring (pluggable provider); TTS
  activity-code/     runners: JS in an isolated worker / QuickJS-WASM, Python with Pyodide,
                     SQL with sql.js, native regex
  memory-core/       FSRS (ts-fsrs); rating adapter; skill ↔ activities relationship
  h5p-bridge/        (phase 3) h5p-standalone in a sandboxed iframe; xAPI → GradeResult
```

## 9. Type registry and ActivityHost

**Type registry:** each type is a file (`types/mcq_single.ts`) that declares:

```ts
{ type, family, Renderer, grader, validate,
  generator: { promptTemplate, schemaRef, needsMedia, itemsPerCall, sourceMode },
  review: { strategy, expectedSeconds, progression },
  capabilities: { offline, needsMic, needsSandbox } }
```

**Adding a type = one file + one prompt + fixtures.**

**`<ActivityHost/>` state machine:**

```
idle → presenting → answering → (hinting)* → checking → feedback → (retry | completed)
```

(XState or a reducer); it exposes `useActivity()`; it emits xAPI-like events
(`activity.presented / answered / graded / completed / skipped`, with `verb`, `object.id`,
`result.score/success/duration`, `context.skills`) — which additionally makes it trivial to
map H5P events onto the same bus.

**Responsibilities:** deterministic shuffling (seed per session), timer, attempts, hints
with penalty, a keyboard alternative for every drag-and-drop (as Rise/H5P require),
per-option feedback, an "Explain" button (calls the AI with the activity + answer +
explanation), and rating computation with `toRating(result, review)`.

## 10. Grader rules

| Grader | Rule |
|---|---|
| **DET** | Pure and testable with fixtures. |
| **FUZ** | `normalize → exact → synonyms → regex → relative edit distance (≤ 0.2) → (optional) AI fallback`. |
| **CAS** | math.js evaluating both expressions at N random points + basic simplification (STACK/Maxima is out of scope for desktop). |
| **CODE** | In an isolated process with limits, **never in the renderer**. |
| **SPEECH** | `asr-match` viable offline with whisper; per-phoneme scoring via API. |
| **AI** | Rubric with JSON output `{score, rating, feedback, evidence[]}`, always showing the model answer and allowing the rating to be overridden. |

## 11. Generation from sources and validation pipeline

Ingestion → chunks with anchors → **skill extraction** (concepts, definitions, processes,
term-definition pairs, lists, formulas, code) → **skill-kind × type matrix**:

| Skill kind | Types |
|---|---|
| definition | flashcard / cloze / mcq |
| process | ordering / worked_example |
| classification | categorize / matching |
| formula | numeric / calculated |
| code | code_fill / parsons / predict_output |
| language | sentence_builder / complete_the_chat / dictation |

→ **generation** with the family schema + fixed rules (number of options, length, "the answer
cannot appear in the stem", plausible distractors) → **validation in three layers**:

1. **zod** (shape).
2. **Per-type rules** — exactly 1 correct answer in `mcq_single`, unique ids, every gap
   referenced, `correctOrder` is a permutation, `targetShapeIds` exist.
3. **"Blind solve"** — another model solves the item without seeing the key; if it disagrees,
   `needsReview`.

→ **repair loop** (max. 2) → **asynchronous media** (`pending-media` does not enter a
session) → **SQLite**.

## 12. Sessions: lesson and review

- **Lesson** = theory (disclosure, cards, informative hotspots, text) + practice (6–12
  activities with family variety, ≤ 2 with media, 1 production activity at the end).
- **Review** = the scheduler returns due skills and the generator chooses a type according
  to progression and modality, interleaves, avoids repeating the shape, and applies M-*.
- **"Mistakes review"** and **"Legendary"** (no hints and no word bank) are **policies, not
  new types**.

## 13. Decisions to take now

1. Adopt "content ≠ presentation": skills are generated with raw data (pairs, lists, steps)
   and activities are derived by template, in addition to direct generation.
2. Rating by explicit rules from day 1, recording `timeMs / attempts / hintsUsed` on every
   attempt in order to recalibrate.
3. One schema per family per LLM call and "blind solve" validation.
4. An open type registry so that phase 3 and H5P content do not force changes to the core.
