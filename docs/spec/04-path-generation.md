Source: Retenia research PDF v1.0 (Sep 2026), sections 7 and 4

# Learning path generation

The "Generate with AI" button: how to turn a book, a video course and a few links into a
fixed path — with theory and practice lessons, reinforcements, a final exam and a
prior-knowledge diagnostic — without hallucinating and for a few dollars. Section 4 (applied
learning science) is included here because it supplies the rules the generator and its
validators must respect, including the 20 Wozniak flashcard rules.

## Table of contents

- [1. Applied learning science (section 4)](#1-applied-learning-science-section-4)
  - [1.1 What the evidence says](#11-what-the-evidence-says)
  - [1.2 The 20 Wozniak rules as generator rules](#12-the-20-wozniak-rules-as-generator-rules)
  - [1.3 When NOT to use flashcards](#13-when-not-to-use-flashcards)
  - [1.4 Instructional design frameworks encoded in the prompts](#14-instructional-design-frameworks-encoded-in-the-prompts)
  - [1.5 Content type → activities → memory items](#15-content-type--activities--memory-items)
- [2. What the reference products teach](#2-what-the-reference-products-teach)
- [3. The pipeline in 10 stages](#3-the-pipeline-in-10-stages)
- [4. Anatomy of a lesson (Gagné + Merrill + CLT)](#4-anatomy-of-a-lesson-gagné--merrill--clt)
- [5. QA gates](#5-qa-gates)
- [6. Cost of generating a path from a 300-page book](#6-cost-of-generating-a-path-from-a-300-page-book)
- [7. Determinism, versioning, idempotency and multi-source](#7-determinism-versioning-idempotency-and-multi-source)
- [8. Schemas](#8-schemas)
- [9. The 11 prompts of the pipeline](#9-the-11-prompts-of-the-pipeline)
- [10. Prior-knowledge diagnostic](#10-prior-knowledge-diagnostic)
- [11. Remediation policy](#11-remediation-policy)
- [12. Grading free-text answers](#12-grading-free-text-answers)
- [13. UX of the "Generate with AI" flow](#13-ux-of-the-generate-with-ai-flow)
- [14. Twenty known pitfalls](#14-twenty-known-pitfalls)

---

## 1. Applied learning science (section 4)

The rules the app and the AI must respect, with their evidence. Each principle later appears
as a concrete constraint in prompts, validators or UX.

### 1.1 What the evidence says

| Principle | Evidence | Design implication in Retenia |
|---|---|---|
| **Retrieval practice (testing effect)** | Dunlosky et al. (2013): practice testing and distributed practice are the only "high utility" techniques; re-reading, highlighting and summarizing are low utility. Roediger & Karpicke (2006): ~60 % retention at one week with a test vs ~40 % with restudy. Feedback + test beats test alone. | Every lesson ends in active retrieval; the correct answer is always shown after the attempt; reinforcements are self-tests, not re-readings. |
| **Spacing** | Cepeda et al. (2006): spaced > massed in 259 of 271 comparisons; the optimal gap ≈ 10–20 % of the retention interval (2008). | The scheduler does it by itself. In exams, the final review window in the last days replicates the optimal gap. |
| **Desirable difficulties (Bjork)** | Spacing, interleaving, testing, generation and variability "appear to impede training but produce long-term benefits"; storage strength vs retrieval strength. | Review when R ≈ 0.85–0.90, not earlier; no hints before the attempt; vary the question format ("switch template"). |
| **Interleaving** | Rohrer & Taylor: mixing problem types tripled exam performance vs blocked practice; helps discriminate similar categories. | The daily session mixes topics and formats; reinforcements interleave previous lessons; mock exams mix modules. |
| **Generation effect** | Slamecka & Graf (1978): what is generated is remembered better than what is read; weakens with unfamiliar material. | Cloze and "write the answer" > recognition; MCQ only for new material (as in RemNote's Learn Mode), then production. |
| **Elaboration / self-explanation** | Moderate utility (Dunlosky); improves transfer. | A "why?" button (Flashcard Insights), an "explain it to a novice" activity with a rubric. |
| **Dual coding** | Paivio: verbal + non-verbal channel; picture superiority effect. Wozniak, rule 6: "use imagery". | Image occlusion, diagrams-as-code in the lesson, the source's figure attached to the card when one exists. |
| **Metacognition** | Brainscape (confidence-based repetition), Moodle CBM: calibrate confidence vs performance. | Confidence in the diagnostic and in mock exams; show "predicted readiness vs real score". |
| **Cramming** | Wozniak: useful for passing, harmful long-term ("toxic memory"); Anki: retention > 0.97 = massed practice. | Urgent mode explicitly temporary (DR 0.97 only the last week); never as the default. |
| **Cognitive load (Sweller)** | Worked-example effect, split-attention, redundancy, expertise reversal. | Text and diagram together; do not narrate what is written; worked example → completion problem → problem; fewer examples in "partial" modules. |
| **Mastery learning (Bloom 2-sigma)** | The average tutored student outperformed 98 % of the control group; mastery requires ≥ 80–90 % before advancing. | Soft gate: the module's reinforcement must reach ≥ 80 %; if not, optional remediation; never block on frustration. |
| **Microlearning and embedded questions** | Kinnu (10,000 people): pathways per concept, introductory questions and "collapsing questions" +59–70 %; the loose chatbot had no effect. Learn Your Way: +11 pp of retention with per-section questions. | Lessons of 5–15 min with 1–3 objectives; knowledge checks inside the theory; the tutor is a complement, not the centre. |

### 1.2 The 20 Wozniak rules as generator rules

Reformulated as verifiable instructions for the `P5_make_flashcards` prompt and its
validator:

1. **Do not memorize without understanding:** each card is linked to the theory section that
   explains it; the path introduces it only afterwards.
2. **Learn before memorizing:** cards are born in "Need to Learn" and are scheduled when the
   lesson is completed.
3. **Build on the basics:** order by prerequisites.
4. **Minimum information:** one atomic answer (≤ ~7 words or one datum); if it has several
   parts, split it.
5. **Cloze by default for facts and definitions:** one deletion per card, sufficient context,
   a hint when there is ambiguity, do not hide trivial words.
6. **Images:** the source's figure; image occlusion for anatomy, maps and diagrams.
7. **Mnemonics only in 1–5 % of items,** as an on-demand insight.
8. **Visual cloze** (graphic deletion).
9. **Avoid sets:** "which countries founded the EEC?" → individual cards with context, or
   overlapping clozes.
10. **Avoid enumerations:** overlapping clozes (A…E, B…F); if order matters, an ordering
    exercise, not a flashcard.
11. **Fight interference:** detect pairs with similar answers (embeddings) and generate a
    contrast card.
12. **Optimal wording:** question ≤ ~25 words.
13. **Refer to other memories:** use as context items the user already masters (high S).
14. **Personalize:** a "my example" field.
15. **Emotional states:** vivid examples when the source has them.
16. **Context cues:** prefixes such as `[CSS Grid]` instead of periphrasis.
17. **Acceptable redundancy:** active/passive pairs, derivation steps as separate items.
18. **Sources:** each card stores `source_id` + a locator (page, timestamp, URL).
19. **Date stamping** for volatile knowledge (field `as_of`).
20. **Prioritize:** the AI proposes an initial importance (core = Alta; anecdotal =
    Mantenimiento) and the user confirms.

**Guideline ratio:** 3–8 cards per lesson, maximum 12 (RemNote warns that "lists are among
the hardest things to remember… memory works by connections, not by linear sequences").
Dedupe by embeddings (**cosine > 0.92 → merge**).

### 1.3 When NOT to use flashcards

- **Procedural and motor skills:** "what are the steps for X?" violates rules 9–10. Use
  ordering steps, completing a procedure with gaps, solving a problem with automatic
  verification, simulation, "worked example → analogous problem".
- **Comprehension and transfer:** application questions ("what would happen if…?"),
  comparison, classification with interleaving, short answer with a rubric.
- **Knowledge that is looked up, not memorized:** gwern's 5-minute rule — if looking it up
  will cost less than ~5 minutes over a whole lifetime, it does not deserve a card; the app
  offers "save as reference".
- **Material not understood:** rule 1 — go back to the theory, not to the queue.

### 1.4 Instructional design frameworks encoded in the prompts

| Framework | How it is used |
|---|---|
| **Revised Bloom** | Every objective carries a verb (define, explain, apply, analyse, evaluate, create); every activity declares its level; QA rejects lessons without ≥ 1 activity at the "apply" level or above. |
| **Gagné (9 events)** | It is the literal lesson template: attention → objectives → activation → content → guidance (examples and non-examples) → practice → feedback → assessment → retention/transfer. |
| **Merrill (First Principles)** | Every module opens with a real problem from the source; cycle activate → demonstrate → apply → integrate ("explain it to a novice", "apply it to your case"). |
| **ABCD objectives** | Audience, behaviour, condition, degree, stored structured so as to generate aligned items. |
| **CEFR can-do** | Module objectives in language paths; per-skill diagnostic (reading, listening, writing, speaking) with an independent Elo. |
| **PRIMM / Parsons** | Programming: Predict → Run → Investigate → Modify → Make; Parsons problems are solved in much less time than writing code with similar learning (Ericson 2017); the "code with gaps" pattern of Claude Code's Learning mode. |
| **Medicine / law / history** | NBME clinical vignettes (one-best-answer, homogeneous options, no "all of the above"); case briefs and IRAC with a rubric; timelines and maps as graphical questions. |

### 1.5 Content type → activities → memory items

| Content type | Bloom | Best activities | Memory items |
|---|---|---|---|
| Facts, dates, figures, terminology | remember | cloze, matching, fast MCQ, concept lookup | cloze (1 datum), basic Q→A, reverse only for vocabulary |
| Definitions and concepts | understand | explain in your own words (rubric), classify examples/non-examples, compare | basic (concept → short definition), contrast, example → concept |
| Procedures (algorithms, protocols, grammar) | apply | worked example → completion → full problem; Parsons; predict output; sentence transformation | cloze of steps (one per card), "what is the next step?" |
| Principles and causal models | analyze | case analysis, error-spotting, "what would happen if…?", diagrams to complete | Q→A cause-effect; contrast |
| Criteria, trade-offs, norms | evaluate | judge solutions with a rubric, justified ranking, debate of two positions | "when is X preferable to Y?" |
| Production (code, essay, design, L2) | create | guided project, `code_exercise` with tests, essay with a rubric, speaking prompt | few cards: only reusable patterns |
| Visual content (anatomy, maps, diagrams) | remember / understand | image occlusion, label a diagram, timeline | `image_occlusion` |
| L2 vocabulary | remember / apply | cloze in a sentence, matching, guided production, dictation | cloze in context; limited reverse |

## 2. What the reference products teach

- **Nobody generates "complete fixed paths" from sources:** Gemini Notebook produces loose
  artifacts; the course builders (Mindsmith, Coursebox, Thinkific, LearnWorlds) generate
  outlines and drafts for creators, with complaints of generic content, "recall-only" and
  hallucinations; Oboe generates a course from a prompt but is shallow and repeats the quiz
  questions in the exam.
- **Learn Your Way** (Google Research) is the best evidence: same source, multiple formats,
  per-section comprehension check → **+9 % immediate and +11 pp of retention at 3–5 days**
  (RCT, N = 60).
- **Duolingo** generates exercises with a "Mad Libs" prompt (fixed rules + level/topic/type
  variables), asks for 10 and the designers pick 3: **generate more and filter**. It
  estimates item difficulty with ML aligned to CEFR without piloting (Settles 2020).
- **LearnLM** (Google) documents the two obstacles that affect us: "difficulty verbalizing
  pedagogical intuitions in prompts" and "lack of good evaluation practices" → explicit
  rubrics and judges with anchors.
- **Sana Learn** is the only enterprise product with a placement test for "don't study what
  you already know"; **Kinnu** (10,000 people) shows that embedded questions and per-concept
  pathways work and a loose chatbot does not.
- **Khanmigo** has the teacher review the MCQ items before assigning them:
  human-in-the-loop before publishing — our "editable preview".

## 3. The pipeline in 10 stages

| # | Stage | Detail |
|---|---|---|
| **1** | **Ingestion and normalization (local, free)** | PDF (pdf.js + heading heuristics; OCR if scanned), DOCX/EPUB/MD (native headings), web (Readability/Defuddle), images (OCR + description), audio (local Whisper), video/courses (ASR + keyframes at scene changes + slide OCR). Everything ends in a `SourceDoc` with a tree of sections and blocks with a `locator` (page, timestamp, anchor) and a hash. |
| **2** | **Chunking with structure + context** | Never cut by fixed size if there is structure: chunk = section; if > ~1,200 tokens, split by paragraphs with 10–15 % overlap; if < ~150, merge. Transcripts in 60–90 s windows. "Contextual retrieval" (Anthropic): 50–100 tokens of context per chunk with a cheap model (−35/−49/−67 % retrieval failures with embeddings / +BM25 / +reranker). |
| **3** | **Extraction per chunk (map, cheap, batch)** | Haiku 4.5 or Gemini Flash-Lite with a strict schema: `concepts[]` (canonical name, aliases, definition, type `concept/procedure/fact/principle/example/misconception`), citable `claims[]` with `block_ids`, candidate objectives (Bloom verb), mentioned prerequisites, difficulty 1–5, examples, figures, exercises. |
| **4** | **Graph and outline synthesis (reduce, strong)** | Sonnet 5 (or Opus 5) with the TOC + concepts deduplicated by embeddings (cosine > 0.9): `KnowledgeGraph` (nodes with `bloom_target`, `difficulty`, `importance`, `source_refs`; edges `PREREQ_OF` with confidence, `RELATED_TO`, `PART_OF`) and `Outline` (sections → modules → lessons with 1–3 objectives). It must be a DAG; `misconceptions[]` are requested per concept (distractors and remediation). "Outline first, then expand" (Skeleton-of-Thought). |
| **5** | **Deterministic sequencing (code)** | Stable topological sort over prerequisites, tie-broken by order in the primary source and by importance (keeping the book's narrative); spiral: important concepts reappear as a "retrieval warm-up"; lesson = 600–1,200 words of theory (3–6 min) + 4–8 activities (4–8 min) = 1–3 objectives, 2–5 concepts; module = 3–7 lessons + reinforcement (10–15 items, interleaving); every 3–4 modules a cumulative reinforcement; final exam by blueprint. |
| **6** | **Editable preview → PathSpec v1** | Tree section → module → lesson with minutes, concepts, sources and warnings ("chapter 9 was not included: appendix"). Rename, reorder (warning if it breaks prerequisites), merge/split, exclude, "go deeper", mark "I already know this", fix the primary source. On confirmation, **ids and order are frozen**. |
| **7** | **Batch expansion (mid) + 2 lessons in real time** | Per lesson: system prompt (role, principles, fidelity contract, format), `LessonSpec`, relevant chunks (mapped + top-k by retrieval), summary of previous lessons, glossary, cached few-shots. Sonnet 5 via the Batch API (−50 %) with prompt caching; the first two lessons are synchronous so the user starts in < 1 min. |
| **8** | **QA gates** | See [§5](#5-qa-gates). |
| **9** | **Item bank** | Items with module, concepts, Bloom, `difficulty_logit`, `usage[]` (`diagnostic`, `reinforcement`, `final_exam_A/B`, `remediation`, `mock`), exposure and statistics; NBME rules for MCQ; parallel forms A/B deduplicated against the lesson quizzes. |
| **10** | **Persistence + memory** | `LearningPath v1` with a `GenerationManifest` (source hashes, prompt and schema versions, models, temperature, tokens, cost, warnings); flashcards to "Need to Learn" with an initial importance; items of "known" modules seeded with a state equivalent to a Good and low priority. |

## 4. Anatomy of a lesson (Gagné + Merrill + CLT)

1. **Hook and objectives** in the learner's language ("by the end you will be able to…").
2. **Activation:** 1–2 retrieval questions from previous lessons.
3. **Explanation with citations** `[S3 p.112]` on every non-trivial claim; one paragraph per
   idea; one analogy or concrete example per concept.
4. **Complete worked example** and, if applicable, a completion problem.
5. **Diagram as code** (Mermaid flowchart/sequence/mindmap, table) next to the text that
   explains it (no split-attention).
6. **Frequent misconceptions** ("Typical error: … Why it is wrong: …").
7. **Summary of 3–5 bullets** + bilingual glossary.
8. **Practice:** ≥ 3 different types, **maximum 40 % MCQ**, ≥ 1 activity at the "apply" level
   or above, increasing difficulty; MCQ with 4 options, one unambiguously correct,
   distractors derived from misconceptions (generate 6–8 and keep 3 after the critic: "good"
   distractors run at 47–59 %, Bitew 2023), per-option feedback, no "all of the above".
9. **Flashcards:** 3–8 per lesson following the 20 rules (§1.2), with `importance`,
   `context_cue`, `interference_group` and `source_refs`.

**Fidelity contract in the system prompt:** "only assert what is in `<sources>`; every
substantive claim carries `[cite:id]`; if you need general knowledge, wrap it in a
`general_knowledge` block" — QA subjects it to question-based verification
(Chain-of-Verification).

### Activity constraints (summary)

| Constraint | Value |
|---|---|
| Activities per lesson | 4–8 (practice block 6–12 in the activity engine session) |
| Distinct activity types per lesson | ≥ 3 |
| Maximum share of MCQ | 40 % |
| Minimum Bloom level present | ≥ 1 activity at "apply" or above |
| MCQ options | 4, one unambiguously correct, no "all of the above" |
| MCQ distractors | generate 6–8 from misconceptions, keep 3 after the critic |
| Flashcards per lesson | 3–8, maximum 12 |
| Theory length | 600–1,200 words (3–6 min) |
| Objectives per lesson | 1–3 |
| Concepts per lesson | 2–5 |
| Lessons per module | 3–7 + reinforcement (10–15 items) |
| Cumulative reinforcement | every 3–4 modules |

## 5. QA gates

Applied in order at stage 8; each gate has an explicit threshold.

| # | Gate | Threshold / rule |
|---|---|---|
| 1 | Schema | Must validate. |
| 2 | Valid citations | The cited span exists, **fuzzy ≥ 0.85**. |
| 3 | Faithfulness per claims | FActScore/RAGAS with a cheap model: **≥ 0.9 passes**; **0.7–0.9 → critic-editor**; **< 0.7 → regenerate**. |
| 4 | Coverage | Concepts with **importance ≥ 0.5** must be covered. |
| 5 | Duplicates | **cosine > 0.92** → duplicate. |
| 6 | Variety and Bloom | Type variety and Bloom-level constraints (see §4). |
| 7 | Length | Within the lesson budget. |
| 8 | Language / glossary | Consistent language and glossary terms. |
| 9 | Pedagogy judge | Rubric 1–5 with anchors, **a model different from the generator**, **temperature 0**. |
| 10 | Self-critique | **Maximum 1 iteration.** |

## 6. Cost of generating a path from a 300-page book

≈ 120,000 words ≈ 160k tokens in English (≈ 200k with the Claude 4.7+ tokenizer, which
produces ~30 % more tokens); output in Spanish. Official prices of 1-Sep-2026.

| Stage | Model | Tokens in / out | Real time | Batch |
|---|---|---|---|---|
| Extraction per chunk (≈ 180 chunks) | Haiku 4.5 | 220k / 60k | USD 0.52 | USD 0.26 |
| Chunk contextualization | Haiku 4.5 + cache | ≈ 200k | 0.20 | 0.10 |
| Graph + outline synthesis (1–2 calls) | Opus 5 (Sonnet 5) | 80k / 20k | 0.90 (0.36) | — (synchronous) |
| Lessons (≈ 40 × 14k in, 5k cached / 4k out) | Sonnet 5 | 560k / 160k | 2.36 | 1.18 |
| Faithfulness + dedupe + variety | Haiku 4.5 | 340k / 40k | 0.54 | 0.27 |
| Critic-editor on ≈ 30 % of lessons | Sonnet 5 | 170k / 50k | 0.84 | 0.42 |
| Item bank (≈ 150 items: diagnostic, reinforcements, exam A/B) | Sonnet 5 | 100k / 40k | 0.60 | 0.30 |
| **Total** | | **≈ 1.7M / 0.37M** | **≈ USD 6.0** | **≈ USD 3.4** |

With Opus 5 also on the lessons: ≈ USD 10–12 in real time, 6–7 in batch. With Gemini
Flash-Lite or GPT-5.6 Luna on the cheap stages, those rows drop 3–5×. A 20 h video course
(transcript ≈ 240k tokens + OCR of ≈ 800 keyframes ≈ 100k) lands in the same order
(USD 4–8) plus the ASR (free, local). The alternative "single-shot 1M + cache" pipeline on
Sonnet 5 (writing a 1 h cache of the book and reading it in 31 calls) costs ≈ **USD 3.46**
and gives a better global view for the outline.

## 7. Determinism, versioning, idempotency and multi-source

- **Manifest per path:** source hashes, prompt and schema versions, model and version,
  temperature (**0** in extraction, judges and grading; **0.5–0.7** in writing), seed if it
  exists, tokens and cost, warnings.
- **LLMs are not deterministic, not even at temperature 0:** reproducibility comes from
  persisting outputs and from the sequencing being pure code. Regenerating = a new
  `PathSpec.version` with a per-lesson diff; progress migrates by `concept_id`, not by
  position.
- **Idempotency:** every call has `custom_id = hash(stage, input_ids, prompt_version)`; if a
  result exists, it is not repeated (key with the Batch API and for resuming after closing
  the app).
- **Multi-source:** the graph is the union; the primary source (the most structured one, or
  the chosen one) fixes the narrative; the others contribute examples, videos and exercises
  ("see also: lesson 4 of the course, 12:30"); contradictions between sources are detected in
  the claims QA and are shown ("the sources differ…").
- **Language:** generate directly in Spanish from English sources, with a bilingual glossary
  and verbatim citations in the original language + translation; to learn English, the lesson
  goes in Spanish and the items in English with a CEFR can-do.

## 8. Schemas

```
LearningPath.v1  { id, version, title, language (BCP-47), level, goal, target_date?, sources[],
                   knowledge_graph,
                   sections[{ id, title, modules[{ id, title, objectives[], lessons[LessonRef],
                              reinforcement: AssessmentRef, diagnostic_items[] }] }],
                   final_exam: AssessmentRef, manifest: GenerationManifest }

Lesson.v1        { id ("L07" | "L07.r1"), module_id, kind: core|remediation, title,
                   objectives[{ text, bloom, abcd{audience,behavior,condition,degree} }],
                   concept_ids[], prerequisite_lesson_ids[], estimated_minutes,
                   theory: { blocks[{ type: hook|activation_question|explanation|example|
                             worked_example|diagram|misconception|summary|glossary|general_knowledge,
                             content (Markdown), citations[] }] },
                   activities[Activity.v1], flashcards[Flashcard.v1],
                   citations[{ id, source_id, block_ids[], locator, quote }],
                   qa: { faithfulness, pedagogy_score, coverage_ok, warnings[] } }

Activity.v1      { id, type, bloom, difficulty 1–5, concept_ids[], misconception_ids[], prompt,
                   options[{ id, text, correct, feedback, misconception_id }],
                   answer, grading: { mode: exact|numeric_tolerance|symbolic|regex|tests|
                                      rubric_llm|reference_llm,
                                      rubric[], reference_answer, tests[], partial_credit },
                   hints[], explanation, source_refs[], estimated_seconds,
                   memory_item: { create, importance } }

Flashcard.v1     { id, type: basic|reverse|cloze|image_occlusion|example_to_concept|contrast,
                   front, back, cloze_text, context_cue,
                   concept_ids[], importance 0–1, interference_group, source_refs[], lesson_id }

ItemBankItem.v1  { id, activity,
                   usage[diagnostic|reinforcement|final_exam_A|final_exam_B|remediation|mock],
                   module_id,
                   difficulty_logit ((difficulty−3)·0.8, adjusted by Elo), discrimination_hint,
                   exposure, stats{ n, p_correct } }

GenerationManifest.v1 { created_at, source_hashes, prompt_versions, schema_versions,
                   models{ stage: { provider, model, temperature, seed } },
                   cost{ input_tokens, output_tokens, cached_tokens, usd }, warnings[] }
```

**Claude structured outputs:** `output_config.format = json_schema` and `strict: true` in
tools; it does not accept `min/max`, `pattern` or recursive references (the SDK passes them
into descriptions); limits ≤ 20 strict tools, ≤ 24 optional parameters, ≤ 16 unions;
incompatible with the citations feature → citations travel as ids inside the JSON and are
verified in code. Compatible with Batch (−50 %).

## 9. The 11 prompts of the pipeline

| Prompt | Model · temp. | Inputs → output |
|---|---|---|
| **P1_extract_chunk** | cheap · 0 | chunk + context → concepts, claims, objectives, misconceptions, difficulty |
| **P2_synthesize_outline** | strong · 0.3 | TOC + consolidated concepts + config → KnowledgeGraph + Outline + warnings (DAG, lesson size, spiral, coverage, exclude front-matter) |
| **P3_write_lesson** | mid · 0.6 | LessonSpec + chunks + previous summary + glossary → Lesson (pedagogical principles + fidelity contract + budget) |
| **P4_make_activities** | mid · 0.7 | lesson + misconceptions → 2–3× activities, then filter; variety constraints |
| **P5_make_flashcards** | mid · 0.3 | 20 operational rules → `Flashcard[]` |
| **P6_faithfulness** | cheap · 0 | claims + chunks → supported / not supported / contradicts, with a citation |
| **P7_pedagogy_judge** | mid (different) · 0 | rubric 1–5 with anchors → score + concrete edits |
| **P8_edit** | mid | applies only the edits without touching verified citations |
| **P9_items** | mid · 0.7 | blueprint → items per cell, forms A/B, estimated difficulty, NBME rules |
| **P10_grade** | mid · 0 | rubric + reference + sources → score per criterion, evidence, feedback, `uncertain` |
| **P11_remediation** | mid | concept + misconception + errors + chunks → 3–5 min mini-lesson with 1 worked example + 3 items |

## 10. Prior-knowledge diagnostic

**Figure 7.1** — "Outline-driven adaptive quiz": Elo-lite per module with propagation through
prerequisites. The flow runs: *How do you start?* → **From scratch** (everything `unknown`)
or **I already know part** → per-section self-assessment (*never seen it / sounds familiar /
I know it / I master it*) → start at the mid-depth module with its mid item → answer +
confidence (*sure / unsure / guessed*) → `θ += K(n)·w·(y − P)` → propagation (correct →
ancestors +0.5Δ; wrong → descendants +0.5Δ) → next item (most uncertain module, difficulty ≈
θ, no repeated concept) → stop check (all classified / 25–30 items / 15 min?) →
classification (`known ≥ 0.8` · `partial 0.4–0.8` · `unknown < 0.4`) → `known` → lessons
marked completed and flashcards seeded (low priority); `partial` → "quick review";
`unknown` → the lesson that uses the concept; plus anticipated per-concept remediation. FSRS
then re-opens the module if 2 lapses occur in 14 days.

### What each approach contributes

| Approach | What it contributes | What is discarded |
|---|---|---|
| **CAT + IRT (1PL/2PL/3PL)** | Adaptive selection by information, stop criteria, mid start, exposure control; reduces length by ~50 % | Calibration with ~1,000 examinees per item: impossible with freshly generated items |
| **Knowledge Space Theory / ALEKS** | The prerequisite DAG infers: a correct answer → evidence about ancestors; a failure → about descendants; 25–30 questions locate the state among millions | Building the structure with data from thousands of students |
| **BKT** | Formalizes guess/slip: a "sure" answer weighs more than a "guessed" one | Estimating parameters per skill without data |
| **DKT / SAKT** | Nothing in v1 | Everything (overkill without data) |
| **Elo (Pelánek 2016)** | `θ ← θ + K·(y − P)`, `P = σ(θ − d)`, K by uncertainty `U(n) = a/(1 + b·n)`; performs like IRT under adaptive selection and works online; initial difficulty = the LLM's estimate (viable per DET) | With a single user, item difficulty calibrates slowly: accept the noise |
| **Duolingo / Sana / self-assessment** | The UX "do I start from scratch or take the test?"; skipping modules; not asking about what the user says they do not know | Trusting self-assessment alone (overconfidence) |

### Algorithm

1. **"From scratch"** → everything `unknown`; **"I already know part"** → per-section
   self-assessment in 4 levels; what is marked "never seen it" is not asked.
2. **Start** at the mid-depth module of the DAG with its mid item.
3. **Answer + confidence** → weight `w = 1.0 / 0.6 / 0.3`; `θ_m += K(n)·w·(y − P)` with
   `K(n) = 1/(1 + 0.05·n)` scaled to ≈ **0.8** on the first item; a "sure" error is recorded
   as a **confident misconception**.
4. **Propagation:** ancestors `+0.5·Δθ` if `Δθ > 0`; descendants `+0.5·Δθ` if `Δθ < 0`;
   maximum two levels.
5. **Next item:** the most uncertain module weighted by importance; difficulty ≈ θ; no
   repeated concept; **maximum 3 per module**.
6. **Classification:** `P = σ(θ)`; **known ≥ 0.8 with n ≥ 2** (or one "apply" item answered
   correctly and confidently with `known` ancestors); **partial 0.4–0.8**; **unknown < 0.4**.
7. **Stop rules:** all classified, **25–30 items**, **12–15 min**, or abandonment (partial
   state saved).
8. **`DiagnosticResult`** with actions: `mark_completed`, `seed_memory` (state
   `reviewed_good`, low priority), `insert_remediation`.

**Deferred verification:** 2 lapses in 14 days over items of the same module, or a mean
R < 0.7, re-open the module.

## 11. Remediation policy

- **Triggers:** module reinforcement < 70 % on a concept; ≥ 2 lapses in 14 days or mean
  R < 0.7 on the concept's cards; a confident error in the diagnostic or in an exam; the same
  `misconception_id` failed twice; the user asks "I don't understand this".
- **Action:** a `Lesson(kind = remediation)` anchored to the concept, with a derived id
  `Lxx.rN`, optional, immediately after the current lesson (or before the first lesson that
  depends on the concept); it reuses flashcards (it only adds a contrast card); 3–5 min.
- **Limits:** 1 active remediation per module and 3 per week; dedupe by `concept_id`; at the
  third remediation of a concept, suggest returning to the core lesson and lower the module's
  mastery estimate.
- **Traceability:** every remediation records its trigger and its effect (subsequent correct
  answers) in order to tune thresholds.

## 12. Grading free-text answers

GPT-4 with few-shot reached **κ = 0.70 vs 0.75 human** on short answers (Henkel 2024):
adequate for formative assessment with feedback; in the final exam the mark is shown as
"provisional" and the user can request re-evaluation with another model.

**Rules**

- Rubric per activity (2–4 criteria with anchors 0/1/2), reference answer, `must_include[]`
  and `must_not[]`, `source_refs`.
- The judge returns a score per criterion, evidence cited from the answer, and 2–3 lines of
  feedback; **temperature 0**; evaluate twice with the criteria permuted and average if they
  differ.
- "Explain my answer" for each error (why it is wrong, which misconception it activates,
  citation).
- **Code:** deterministic tests first, then the LLM explains failures.
- **Mathematics:** symbolic/numeric verification (math.js; SymPy via Pyodide).
- **Speaking:** STT → visible transcript → CEFR rubric.
- **Guards:** the grader only uses the reference, the rubric and the chunks; when in doubt it
  declares `uncertain` (which affects neither Elo nor FSRS); injection detection in the
  student's answer.

## 13. UX of the "Generate with AI" flow

1. **Generation panel** with template-like fields: goal in one sentence, level, lesson
   language, is it for an exam? date, pace (hours/week), primary source, scope (everything /
   chapters). Live estimate of time and cost ("≈ 6 min and USD 3.40").
2. **Progress by stage** with streaming: "Reading 14 sources (9/14)", "Detecting 212
   concepts", "Building the prerequisite map", "Proposing a path". Cancellable and resumable.
3. **Editable outline preview (mandatory):** edit, exclude, mark "I already know this", fix
   the primary source; button "Do I start from scratch or take the diagnostic?".
4. **Diagnostic** (12–15 min, a bar of remaining items, confidence per answer, skippable) →
   summary of what is marked completed, reversible.
5. **Expansion:** lessons appear progressively; the first is ready in < 1 min; each lesson
   with "Regenerate", "More examples", "Report an error" (opens the citation) and QA
   indicators (fidelity, sources).
6. **Completion:** summary (n lessons, minutes, items created in memory, plan up to date X);
   version 1 frozen; "Regenerate path" creates v2 with a diff.

## 14. Twenty known pitfalls

1. Fidelity (verify spans, not just ids).
2. Recall-only without Bloom constraints.
3. An exam that repeats the quizzes.
4. Over-generation of flashcards (30 per lesson sinks memory).
5. Chunking by size that breaks tables and lists.
6. Front/back matter that contaminates the outline.
7. Cycles and invented prerequisites.
8. Difficulty estimated by the LLM (a prior, not truth).
9. A long or punitive diagnostic.
10. Overconfident self-assessment (confirm with ≥ 1 apply item).
11. Non-determinism and model drift.
12. Hidden costs (retries, critic loops, 1M of context per lesson).
13. Mixing languages in terms.
14. ASR errors on technical terms (post-correct with the glossary).
15. Structured outputs without `pattern` / `min/max`, and JSON truncated by `max_tokens`.
16. Biased judges (different model, anchors, temperature 0).
17. Local-first privacy (the sources leave to the API; offer "provider X only" and PII
    redaction).
18. Batch latency (up to 24 h: generate the first lessons synchronously).
19. Fixed path vs reality (offer "regenerate the affected ones").
20. Medical/legal content (warning: it derives from your sources and may contain errors).
