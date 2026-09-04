Source: Retenia research PDF v1.0 (Sep 2026), section 5

# Memory system

The heart of the product: FSRS-6 with formulas ready to implement, importance levels that
modulate the target retention, dated exams as a layer over the scheduler, mock exams,
metrics, and the mapping of any interactive exercise to the 1–4 scale.

## Table of contents

- [1. Decisions](#1-decisions)
- [2. Fundamentals: forgetting curve and the two-component model](#2-fundamentals-forgetting-curve-and-the-two-component-model)
- [3. FSRS-6: complete formulas](#3-fsrs-6-complete-formulas)
  - [3.1 Default parameters](#31-default-parameters)
  - [3.2 The formulas](#32-the-formulas)
  - [3.3 Parameter clamping ranges](#33-parameter-clamping-ranges)
- [4. States, learning steps, leeches and siblings](#4-states-learning-steps-leeches-and-siblings)
- [5. ts-fsrs types copied into the data model](#5-ts-fsrs-types-copied-into-the-data-model)
- [6. Optimizer, desired retention and benchmarks](#6-optimizer-desired-retention-and-benchmarks)
- [7. Per-item importance: design](#7-per-item-importance-design)
- [8. Dated exams](#8-dated-exams)
- [9. Mock exams](#9-mock-exams)
- [10. Interactive exercises in the same scheduler](#10-interactive-exercises-in-the-same-scheduler)
- [11. From the learning path to the memory system](#11-from-the-learning-path-to-the-memory-system)
- [12. Daily session composition](#12-daily-session-composition)
- [13. Metrics the app must show](#13-metrics-the-app-must-show)
- [14. Data model](#14-data-model)
- [15. Scheduler interface (pluggable)](#15-scheduler-interface-pluggable)
- [16. Notifications and optimizer lifecycle](#16-notifications-and-optimizer-lifecycle)
- [17. Risks and open decisions](#17-risks-and-open-decisions)

---

## 1. Decisions

| Axis | Decision | Rationale |
|---|---|---|
| **Algorithm** | FSRS-6 via `ts-fsrs` 5.4.x (MIT) | Best public calibration: log loss 0.346 vs 0.469 for HLR (Duolingo) and 99.6 % "superiority" over SM-2 across ~350 M reviews. Used by Anki, RemNote and Mochi. SuperMemo's SM-20 converged on the same parametric approach. |
| **Mental model** | DSR: Difficulty · Stability · Retrievability | Everything the app shows (strength, decay, forecast, readiness) is derived from S and R. Any activity that produces evidence of recall is converted into a **rating 1–4**. |
| **Importance** | Desired retention per level + interval cap + order + postpone | Combines SuperMemo's priority queue with RemNote's priorities. Importance does not change the memory model: it changes what is asked of the scheduler and what is sacrificed under overload. |
| **Exams** | A layer over FSRS (not a separate algorithm) | Interval cap `min(I, date − margin)`, rising DR, final window ordered by ascending R, "ensure mastery", `readiness = Σ R` on the exam day. FSRS has no native exam mode (open issue); RemNote is the reference. |

**Figure 5.1** — Memory system flow: from the lesson to the daily session, with importance
and exams as inputs to the scheduler. The flow chains: Lesson completed → items
(`Need to Learn` → New) → Scheduler FSRS-6 (`ts-fsrs`: D · S · R · due · rating
1–4 · Again/Hard/Good/Easy) ← Importance (5 levels: Urgente 0.95–0.97 · Alta 0.92 ·
Normal 0.90 · Mantenimiento 0.80–0.85) and ← Exams (theory + practice, interval
= `I(DR, S)`, readiness) → Daily session (1 exams · 2 due by level · 3 relearning ·
4 new interleaved · 5 path reinforcement · 6 final drill) → Metrics (retention · R
forecast · heatmap · readiness).

## 2. Fundamentals: forgetting curve and the two-component model

After learning something, the probability of recalling it decays with time; each successful
review reduces the future decay rate. The **two-component model** (Wozniak & Gorzelańczyk,
1990/1995; equivalent to Bjork's storage/retrieval strength) describes a memory with:

- **Stability (S)** — how long it lasts if undisturbed.
- **Retrievability (R)** — the probability of retrieving it now.

Operationally, **S is the interval after which R falls to 0.9**. **Difficulty (D)** (1–10 in
FSRS) determines how much S can grow at each review. The spacing effect appears explicitly:
the increase in S is larger when R is low ("the best moment to review is when you almost
forgot it").

## 3. FSRS-6: complete formulas

Current version: **FSRS-6, 21 parameters (w0…w20)**, implemented in `ts-fsrs` (TypeScript),
`py-fsrs`, and `fsrs-rs` (Rust, used by Anki).

### 3.1 Default parameters

Defaults (`ts-fsrs` 5.4.2 = `py-fsrs`):

```
w = [0.212, 1.2931, 2.3065, 8.2956,   // w0..w3  initial S0 for Again/Hard/Good/Easy
     6.4133, 0.8334,                   // w4,w5   initial difficulty
     3.0194, 0.001,                    // w6,w7   Δ difficulty and mean reversion
     1.8722, 0.1666, 0.796,            // w8..w10 growth of S after a success
     1.4835, 0.0614, 0.2629, 1.6483,   // w11..w14 S after a lapse
     0.6014, 1.8729,                   // w15 hard penalty, w16 easy bonus
     0.5425, 0.0912, 0.0658,           // w17..w19 short-term (same-day) memory
     0.1542]                           // w20 decay of the forgetting curve (FSRS-6)
```

### 3.2 The formulas

> The PDF labels the components **(a)–(g)** and **(i)**. There are no components labelled
> (h) or (j) in the source; nothing has been invented to fill those letters.

| Component | Formula | Intuition |
|---|---|---|
| **(a) Forgetting curve** | `decay = −w20`; `factor = 0.9^(1/decay) − 1`; `R(t,S) = (1 + factor·t/S)^decay` | Power law (heterogeneous material); guarantees `R(S,S) = 0.9`. FSRS-4.5/5 used a fixed decay of −0.5; FSRS-6 optimizes it per user. |
| **(b) Interval for retention r** | `I(r,S) = S·(r^(1/decay) − 1)/factor` → `I(0.9,S) = S`; `interval = clamp(round(I), 1, max_interval) + fuzz` | Closed form: makes it possible to know in O(1) whether an item "arrives" at the exam date with R ≥ target. |
| **(c) Initial state (grade G ∈ 1..4)** | `S0(G) = w[G−1]`; `D0(G) = w4 − e^(w5·(G−1)) + 1`, clamp `[1,10]` | Four initial stabilities depending on the first button. |
| **(d) Difficulty** | `ΔD = −w6·(G−3)`; `D' = D + ΔD·(10−D)/9`; `D'' = w7·D0(4) + (1−w7)·D'`; clamp `[1,10]` | Linear damping (D never reaches 10 "in one go") + mean reversion toward `D0(Easy)`. |
| **(e) S after a success (t ≥ 1 day)** | `S' = S·(1 + e^w8·(11−D)·S^(−w9)·(e^(w10·(1−R)) − 1)·w15^[G=Hard]·w16^[G=Easy])` | `(11−D)`: hard material stabilizes less; `S^(−w9)`: diminishing returns; `e^(w10(1−R))−1`: spacing effect; `w15<1` penalizes Hard, `w16>1` rewards Easy. |
| **(f) S after a lapse (Again)** | `S'f = w11·D^(−w12)·((S+1)^w13 − 1)·e^(w14·(1−R))`; `S' = min(S'f, S/e^(w17·w18))` | A lapse never increases stability. |
| **(g) Same day (t = 0)** | `SInc = S^(−w19)·e^(w17·(G−3+w18))`; `SInc = max(SInc, 1)` if `G ≥ Hard`; `S' = S·SInc` | Short-term memory: grows fast when S is small, slowly when it is large. |
| **(i) Fuzz** | Only if interval ≥ 2.5 days: ±15 % in `[2.5,7)`, ±10 % in `[7,20)`, ±5 % in `[20,∞)`; PRNG seeded per card; `min_ivl ≥ elapsed_days + 1` | Prevents cards created together from becoming due together. Anki 24.11 added a **load balancer**: within the fuzz range it picks the day with fewest reviews. |

### 3.3 Parameter clamping ranges

Clamping ranges of the parameters (`ts-fsrs`):

| Parameter | Range |
|---|---|
| w0–w3 | `[0.001, 100]` |
| w4 | `[1, 10]` |
| w5, w6 | `[0.001, 4]` |
| w7 | `[0.001, 0.75]` |
| w8 | `[0, 4.5]` |
| w9 | `[0, 0.8]` |
| w10 | `[0.001, 3.5]` |
| w11 | `[0.001, 5]` |
| w12 | `[0.001, 0.25]` |
| w13 | `[0.001, 0.9]` |
| w14 | `[0, 4]` |
| w15 | `[0, 1]` |
| w16 | `[1, 6]` |
| w17, w18 | `[0, 2]` |
| w19 | `[0.01, 0.8]` |
| w20 | `[0.1, 0.8]` |

## 4. States, learning steps, leeches and siblings

**States:** `New = 0`, `Learning = 1`, `Review = 2`, `Relearning = 3`.
**Ratings:** `Manual = 0`, `Again = 1`, `Hard = 2`, `Good = 3`, `Easy = 4`.

- Default learning steps `['1m','10m']`, relearning `['10m']`. Again → step 0; Hard → 1.5×
  the step (or the average of the first two); Good → next step, or graduates to Review with
  `I(r,S)`; Easy → graduates directly.
- Anki's and Expertium's recommendation: short steps (10–30 min), **never ≥ 1 day with
  FSRS**.
- Minimum interval 1 day after relearning; maximum **36,500 days** by default (Expertium
  uses 5 years in general and 365 days on difficult material).
- **Leeches:** Anki tags and suspends at **8 lapses** (warnings every half of the
  threshold); RemNote interrupts the queue at **4** with Disable / Ignore / Edit Later.
  Ours: threshold **per importance level** + an AI rewrite suggestion.
- **Sibling bury:** cards of the same note (reverses, other clozes) are postponed to the
  next day so one does not reveal another; "disperse siblings" separates their dates.
- **Easy days:** per weekday (Normal / Reducido / Mínimo) and specific dates; adjusts the
  due date "within a small margin".

## 5. ts-fsrs types copied into the data model

```ts
interface Card { due: Date; stability: number; difficulty: number; scheduled_days: number;
  learning_steps: number; reps: number; lapses: number; state: State; last_review?: Date; }

interface ReviewLog { rating: Rating; state: State; due: Date; stability: number; difficulty: number;
  elapsed_days: number; scheduled_days: number; learning_steps: number; review: Date; }

interface FSRSParameters { request_retention: number /*0.9*/; maximum_interval: number /*36500*/;
  w: number[] /*21*/; enable_fuzz: boolean; enable_short_term: boolean; learning_steps: Steps;
  relearning_steps: Steps; }

// API: fsrs(params) · createEmptyCard(now) · f.repeat(card, now) (preview of the 4 buttons)
//      f.next(card, now, Rating.Good) · f.get_retrievability(card, now) · f.rollback · f.forget ·
//      f.reschedule(card, history)
```

**Note:** `ts-fsrs@6.0.0-beta` removes `elapsed_days` from `Card`; do not depend on that
field. Fix `ts-fsrs` as the reference and cover it with regression tests against `py-fsrs`
(there are minor discrepancies: S0 clamp 0.1 vs 0.001; mask ≥ 1 on same-day Hard).

## 6. Optimizer, desired retention and benchmarks

**Training:** log-loss (every review is binary); the first 4 parameters are estimated from
the retention curves after the 1st and 2nd review; then gradient descent. Anki 24.06+ does
not require a review minimum; RemNote recommends ≥ 1,000. Re-optimize every 2ⁿ reviews
(512, 1,024, 2,048…) or monthly. In Node: `@open-spaced-repetition/binding` (napi over
`fsrs-rs`) in a worker, with its own `wasm32-wasi` build as the fallback where no prebuild
exists — implemented in sub-phase 4.6 as the `fsrsOptimize` job.

> Two properties of that binding, measured rather than documented, that its callers depend
> on: its `progress` callback never fires (so the job reports stages, not epochs), and its
> `timeout` is a wall-clock budget the call always consumes rather than a quality knob —
> 200 ms, 2 s and 15 s return byte-identical parameters on the same input.

**Desired retention:** "the most important setting"; allowed 0.70–0.99; recommended
0.80–0.95; **0.90 by default**; above 0.97 it "turns spaced repetition into massed
repetition". Changing it does not require re-optimizing.

**Simulator** (`fsrs-rs SimulatorConfig`): projects reviews/day, minutes/day, memorized and
cost over a year for a given DR; Anki exposes it in the deck options. We use it to explain
the cost of "Urgente" before applying it.

**DR vs mean retention:** with DR 0.90 you recall ≈ **94.7 %** of all cards today (most are
not due). The app shows both.

### Public benchmark (srs-benchmark, 9,999 Anki collections, ~350 M reviews)

| Algorithm | Log loss | RMSE(bins) | AUC | Parameters |
|---|---|---|---|---|
| RWKV-Instant (neural net) | 0.2773 | 0.0250 | 0.833 | 2,762,884 |
| GRU / LSTM | 0.333 | 0.054 | 0.73 | 503 / 8,869 |
| FSRS-6 (fsrs-rs) | 0.3443 | 0.0635 | 0.707 | 21 |
| FSRS-5 / FSRS-4.5 | 0.3561 / 0.3625 | 0.074 / 0.076 | 0.70 / 0.69 | 19 / 17 |
| DASH / ACT-R | 0.3682 / 0.4033 | 0.084 / 0.107 | 0.63 / 0.52 | 9 / 5 |
| HLR (Duolingo) | 0.4694 | 0.1275 | 0.637 | 3 |
| Ebisu v2 | 0.4989 | 0.1627 | 0.605 | 0 |

Neural networks win with five orders of magnitude more parameters and no interpretability;
for a local-first app with ~10⁴ cards per user, **FSRS-6 is the optimum**. Compared with
SM-17 (fsrs-vs-sm17, 19 users, 687,662 repetitions): log loss 0.367 vs 0.432, "83.3 %
superiority".

### Other algorithms and what is reused from each

| Algorithm | Model | What it contributes to Retenia |
|---|---|---|
| SM-2 / Anki SM-2 | EF × interval; ease floor 130 % ("ease hell") | Only a deterministic fallback and an interchange format on import (`.apkg` carries ease/interval; `memory_state_from_sm2` of `fsrs-rs` converts them). |
| SM-17/18/20 (SuperMemo) | S, R, D with SInc/Recall matrices; SM-20 moves to ~40 parameters with ML | The design of priorities, auto-postpone, final drill and "memory lability" (S can fall on very difficult items). |
| Ebisu (Bayesian) | Beta(α,β) over p at time t; no due dates | The idea of a queue "without a due date" ordered by R (a "review whatever you want today" mode and the final exam window), which FSRS allows with `get_retrievability`. |
| HLR (Duolingo) | `p = 2^(−Δ/h)`, `h = 2^(Θ·x)` | The "strength meter" UI per skill, fed with FSRS's R. |
| Brainscape CBR | Confidence 1–5 → interval | The metacognitive value: declared confidence in diagnostics and mock exams; mapping 1–2 ≈ Again, 3 ≈ Hard, 4 ≈ Good, 5 ≈ Easy. |
| Mochi (2 buttons) | Remembered / Forgot → Good / Again | Demonstrates that a 2-button UI is compatible with FSRS (optional simple mode). |

## 7. Per-item importance: design

**Principle:** importance does **not** change S, D or R (they are properties of the
item-user pair); it changes **what is asked of the scheduler** (desired retention, interval
cap), **what is sacrificed under overload** (order and postpone) and **how much of the
daily budget it consumes**.

### Cost of the target retention

Derived from `I(r,S)` with `w20 = 0.1542`; frequency relative to 0.90.

| DR | 0.70 | 0.80 | 0.85 | 0.90 | 0.93 | 0.95 | 0.97 | 0.98 | 0.99 |
|---|---|---|---|---|---|---|---|---|---|
| Interval (× S) | 9.29 | 3.32 | 1.91 | 1.00 | 0.61 | 0.40 | 0.22 | 0.14 | 0.07 |
| Review frequency | 0.11× | 0.30× | 0.52× | 1.00× | 1.63× | 2.48× | 4.49× | 7.0× | 14.6× |

Two second-order corrections make the extremes worse: with a high DR you review with high R
and S grows more slowly (real workload is larger); with a low DR there are more lapses and
relearnings. Hence the U-curve that the "optimal retention" function used to minimize
(workload/knowledge). **Conclusion: 0.97 is the ceiling of urgent mode and 0.80–0.85 the
floor of maintenance; below 0.80 the user perceives "it is making me forget".**

### Importance levels

| Level (UI) | Semantics | DR | Max interval | Order | Under overload | New/day | Leech |
|---|---|---|---|---|---|---|---|
| **Urgente / Examen** | "always have it present" until a date | 0.95 (0.97 last week) | `min(180 d, exam − today − margin)` | 1st, by ascending R | never postponed; may exceed the daily limit (catch-up) | no cap (by date) | warn, never suspend |
| **Alta** | core material of the current path | 0.92 | 1 year | 2nd | only if backlog > 2 days | introduction priority | warn + suggest rewrite |
| **Normal** | default | 0.90 | 5 years | 3rd | factor 1.1 over the most stable first | standard quota (10–20) | threshold 8 → edit; option to suspend |
| **Mantenimiento** | "so it is not lost, without loading the day" | 0.80–0.85 | 10 years | 4th | postponed first (Mercy) | 0 (review only) | suspend after 8 lapses |
| **Pausado** | out of the queue; the clock keeps running | — | — | does not appear | — | — | — |

### Implementation rules

1. **DR per item, not per deck:** `effective_retention(item) = level.dr` with an override
   per item and per exam (the exam wins); instantiating one `fsrs()` per level is cheap.
2. **Changing level does not reschedule en masse** (like Anki's "Reschedule cards on change
   = off"): the new DR applies from the next review; "reschedule now" is an explicit action
   that shows the simulated impact.
3. **Overload protection:** if `due_today × median_time > capacity`, postpone with factor
   1.1 starting with Mantenimiento and with the highest-S items (least damage); never
   Urgente; log every postpone with `rating = Manual`.
4. **Priority bias:** show the percentage per level and limit Urgente + Alta to ~30 % ("if
   everything is urgent, nothing is").
5. **Urgent mode of 48–72 h:** DR 0.97 + final drill + same-day steps `10m 1h`, explicitly
   temporary.
6. **Visible decay:** "today you recall this at ~82 %".

## 8. Dated exams

### How others solve it

- **Anki** has no exam mode: it is composed with filtered decks, custom study (review ahead,
  review forgotten), "Set due date" and the helper with Advance ("brings reviews forward
  minimizing the deviation from the original schedule"); there is an open feature request
  for a "deadline option in FSRS".
- **SuperMemo:** subset review (Learn / Review all over a branch), Add to outstanding and
  Final drill; SM 20 adds "Active Final Drill" for exams.
- **RemNote Exam Scheduler V2** is the most complete reference: learning period (each new
  card leaves after 2 correct answers), catch-up (raises the daily goal instead of silently
  rescheduling), final review period ("every flashcard is shown one last time"), ensure
  mastery (after a failure, 2 consecutive correct), calculated daily goal, notifications if
  you fall behind.

### Proposed algorithm: "study toward date X"

**Objective:** for the set C of the exam's items, maximize `Σ Rᵢ(E)` subject to a daily
budget and reach `Rᵢ(E) ≥ r_target` (0.95) without destroying long-term memory. Implemented
as a layer over FSRS using `R(t,S)` and `I(r,S)`:

```
Input: E (date), C (items), r_target = 0.95, buffer_final = 1–3 days, study_days (weekly
mask), daily_capacity_minutes

Phase 0 – Diagnostic: R_E = R(E − last_review, S) if Review; 0 if New. readiness = Σ R_E / |C|
(shown as "estimated preparation")

Phase 1 – Learning period (until E − buffer_final − k):
  new_quota/day = ceil(pending_new / remaining_study_days); each new item requires 2 correct
answers to leave the phase; scope DR = 0.92

Phase 2 – Consolidation (the whole period):
  interval = min( I(DR_exam, S'), (E − buffer_final) − today )   → no review lands after the
exam
  DR_exam rises linearly 0.92 → 0.95 in the last 2 weeks and to 0.97 in the last 3 days
  if I(r_target, S') ≥ (E − today): the item "arrives" with R ≥ r_target → do not force more
reviews (avoids massed practice)

Phase 3 – Final review window (E − buffer_final … E − 1):
  queue = items by ascending R_E, then by the topic's weight in the blueprint; "ensure
mastery": an Again requires 2 consecutive correct answers

Catch-up: if backlog(C) > capacity → raise the daily goal for C and postpone items of other
levels

Post-exam (E + 1): remove the override; offer "move to Mantenimiento" (DR 0.85) or
"archive"; S and D are left intact
```

The cap `min(I, E − buffer)` is **the only intervention on the scheduler**: the S and D
updates remain FSRS's, and the `review_log` stores the real `scheduled_days` so as not to
contaminate the optimizer. The "readiness" (`Σ R_E` weighted by blueprint) is the product
metric. If the user arrives 2 days before with 500 new cards, the app says so (total
estimated time, like RemNote) and offers urgent mode. The policy should be validated with
the `fsrs-rs` simulator before launch.

## 9. Mock exams

- **Blueprint:** table topic → weight % (importable from a syllabus or generated from the
  sources) × Bloom level × difficulty (**30/50/20**); the mock exam samples proportionally,
  prioritizing items with low R but including ≥ 20 % of "safe" items to measure
  overconfidence.
- **Formats:** MCQ with plausible distractors (the "near misses" are the best source), T/F,
  cloze, short answer with an AI rubric, ordering steps, matching, image occlusion, cases.
- **Time and scoring:** total and per-item limit (MCQ 60–90 s, short answer 3–4 min);
  `time_ms` per question; raw, per-topic and weighted score; pass threshold.
- **Item analysis:** difficulty p, discrimination (point-biserial), distractor analysis,
  mean time; items with p > 0.95 or discrimination < 0.1 are flagged for AI review.
- **Feedback to the scheduler:** every answer is a review with `context = 'exam_sim'`:
  correct → Good (Hard if it took > 2× its median); incorrect → Again; a "do not affect my
  scheduling" option (preview mode).
- **Parallel forms:** two forms A/B per blueprint cell, deduplicated against the lesson
  quizzes (Oboe's failure); the mock exam uses A, the final exam B.
- **Post-exam:** score vs predicted readiness (calibration), weak topics, failed items with
  their sources, fatigue curve by position; < 60 % correct in a module → priority ×1.5 and
  remediation; confident error → contrast card; fast and confident correct → priority ×0.8.

## 10. Interactive exercises in the same scheduler

Every activity produces `{ correct, partial ∈ [0,1], time_ms, hints_used, attempts }` and a
**deterministic mapping to a rating**:

| Exercise type | Again (1) | Hard (2) | Good (3) | Easy (4) |
|---|---|---|---|---|
| Flashcard / cloze (self-assessed) | the user chooses (4 buttons with a preview of the next interval) | | | |
| Type the answer (fuzzy) | similarity < 0.6 | 0.6–0.85 or with a hint | ≥ 0.85 | ≥ 0.85 and time < personal median × 0.6 |
| Multiple choice | incorrect | correct on the 2nd attempt or time > 2× median | correct on the 1st | correct, fast and with high declared confidence |
| Order steps | > 1 pair out of order | 1 pair out of order | correct | correct and fast |
| Matching (n pairs) | < 70 % | 70–99 % | 100 % | 100 % with no previous errors and fast |
| Numeric / code problem with tests | fails | passes with a hint or > 2 attempts | passes | passes on the first try and fast |
| Short answer with an AI rubric | < 0.5 | 0.5–0.79 | 0.8–0.94 | ≥ 0.95 |
| Pronunciation (score API) | < 0.5 | 0.5–0.75 | 0.75–0.9 | ≥ 0.9 |
| Mock exam | incorrect | correct but slow | correct | — (do not use Easy in an exam) |

**Rules**

- Hard is never assigned to an incorrect answer ("if you press Hard when you failed, the
  intervals will be unreasonably high").
- Easy only with strong signals (`w16` accelerates a lot).
- The continuous `exercise_score` is stored in the log for future analysis.
- A composite exercise generates reviews for the skills it uses.
- Exercises have their **own D/S** (a procedure can be hard even if its facts are easy).
- Games with chance (memory, word search, arcade with moving distractors) **do not feed the
  scheduler**.

## 11. From the learning path to the memory system

1. **Generation:** per lesson, the AI produces theory, 4–8 activities and 3–8 candidate
   items that stay in **"Need to Learn"** (not scheduled), as in RemNote.
2. **Completing the lesson = immediate practice** → the items become New with `due = now`,
   respecting the level's new quota; if the practice was a valid exercise, it is recorded as
   the first review (context `lesson`).
3. **Initial importance:** proposed by the AI + the path's level (a path "for an exam"
   inherits Urgente); the user adjusts it with one gesture.
4. **Reinforcements in the path:** every 3–5 lessons, a node that composes (a) due items of
   the path, (b) items of previous lessons with R < 0.8 even if not due (Advance), (c) 2–3
   interleaved application exercises, (d) a mini-quiz with feedback.
5. **Unlocking:** do not block on forgetting; do show "this lesson relies on 4 items you
   recall today at 60 %; review them (3 min)".
6. **End of path:** final exam by blueprint and automatic transition to Normal or
   Mantenimiento depending on the result, with an explanation of the cost.

## 12. Daily session composition

```
budget = target_minutes (user); streak_goal = 10 cards (minimum not to break the streak)

1. Active exams: queue by ascending R_E, then topic weight            ← always first
2. Due by level: Urgente → Alta → Normal → Mantenimiento; within the level, "relative
   overdueness"
   or ascending R (Anki 24.11: "descending retrievability… better when there is a backlog"),
   siblings dispersed
3. Relearning interleaved according to its steps (10 min)
4. New: quota per level; 1 new every 3–5 reviews; if backlog > 1.5 days of capacity → 0 new
   except Urgente
5. Path reinforcement module if it is due today
6. Final drill (optional / urgent mode): everything graded Again/Hard today comes back at the
   end

Overload: if due × median_time > budget → auto-postpone starting with Mantenimiento and the
highest S;
   show "today you did 80 %, I postponed 40 maintenance cards".
```

**Presentation:** "today: 35 reviews (~12 min) + 8 new + reinforcement" and the streak goal
for bad days.

## 13. Metrics the app must show

| Metric | Operational definition | Precedent |
|---|---|---|
| True retention | % correct on the first review of the day for cards in Review with interval ≥ 1 d; young (< 21 d) vs mature; day/week/month/year windows | Anki |
| Desired vs true retention | Comparison per level; alert if they differ by > 5 pp (re-optimize or adjust DR) | fsrs4anki |
| Mean retention today | `mean(Rᵢ(today))` over Review: "today you would recall X % of all your cards" | Expertium |
| Memorized knowledge | `Σ Rᵢ(today)` and its time series, per topic/path | FSRS Helper |
| Distribution of S and D | Histograms; % with S > 21 d and > 365 d; average D per topic | Anki |
| Forecast | Cards and minutes per day at 30/90 days, per level, with and without new | Anki / RemNote |
| Workload simulation | reviews/day and minutes/day over 1 year for a given DR | fsrs-rs |
| Heatmap and streaks | Days with a review; colour by goal (streak / daily / stretch); current and maximum streak | RemNote, Review Heatmap |
| Time per card and per hour | Median and p90 per type; correct answers by hour of day | Anki |
| Answer buttons | % Again/Hard/Good/Easy per state; alert if Again > 20 % or Hard is used as a failure | Anki |
| Knowledge decay forecast | `Σ Rᵢ(today + k)` for k = 7, 30, 90 if nothing is reviewed: "if you stop today, in a month you will recall X %" | derived from `R(t,S)` |
| Mastery per topic / lesson | Stages New · Acquiring · Growing · Solidifying · Retaining · Stale, defined by S and R (Retaining: S ≥ 90 d and R ≥ 0.85; Stale: R < 0.7) | RemNote |
| Exam readiness | `Σ w_topic · mean R_E` and projection; comparison with the mock exam's real score (calibration) | own |
| Leeches and model quality | Lapses ≥ threshold, pairs with interference, anomalous time; log loss / RMSE of the optimizer and the date of the last optimization | Anki |

## 14. Data model

Every table below carries the four audit columns required by
[`00-conventions.md`](00-conventions.md) — `created_at`, `updated_at`, `deleted_at`
(soft delete, never a hard `DELETE`) and `version` — and every `id` is a **UUIDv7 string**,
never an autoincrement rowid, because the schema is born sync-ready.

```sql
-- Knowledge unit (≈ Anki's "note" / RemNote's Rem)
CREATE TABLE items (id TEXT PK /*UUIDv7*/, lesson_id TEXT, topic_id TEXT, kind TEXT /*fact, concept, procedure…*/,
  fields JSON, source_id TEXT, locator JSON /*page, timestamp, selector*/, as_of TEXT,
  importance TEXT CHECK(importance IN ('urgent','high','normal','maintenance','paused')),
  created_by TEXT,
  created_at INT, updated_at INT, deleted_at INT, version INT NOT NULL DEFAULT 1);

-- Schedulable unit: every card/exercise has its own FSRS state
CREATE TABLE cards (id TEXT PK /*UUIDv7*/, item_id TEXT, template TEXT /*basic, reverse, cloze:c1, occlusion:3, mcq, order_steps…*/,
  payload JSON, state INT DEFAULT 0, due INT, stability REAL DEFAULT 0, difficulty REAL DEFAULT 0,
  scheduled_days INT DEFAULT 0, learning_steps INT DEFAULT 0, reps INT DEFAULT 0, lapses INT DEFAULT 0,
  last_review INT, suspended INT DEFAULT 0, buried_until INT, leech INT DEFAULT 0,
  importance_override TEXT, exam_id TEXT,
  created_at INT, updated_at INT, deleted_at INT, version INT NOT NULL DEFAULT 1);
CREATE INDEX cards_due ON cards(due) WHERE suspended = 0 AND deleted_at IS NULL;

-- Immutable history: source of truth for the optimizer, stats, rollback and sync.
-- Append-only: rows are inserted and never updated, so `updated_at` always equals
-- `created_at` and `version` stays 1. They exist for uniformity with the sync outbox.
-- `deleted_at` is only ever set when the parent card is soft-deleted.
CREATE TABLE review_logs (id TEXT PK /*UUIDv7*/, card_id TEXT, reviewed_at INT, rating INT /*0 Manual,1..4*/,
  state_before INT, due_before INT, stability_before REAL, difficulty_before REAL, elapsed_days INT,
  scheduled_days INT, learning_steps INT, duration_ms INT,
  context TEXT /*daily, lesson, reinforcement, exam_sim, cram, manual_postpone*/, exercise_score REAL, device TEXT,
  created_at INT, updated_at INT, deleted_at INT, version INT NOT NULL DEFAULT 1);

CREATE TABLE scheduler_profiles (id TEXT PK /*UUIDv7*/, scope TEXT, w JSON, decay REAL, trained_at INT,
  n_reviews INT, log_loss REAL, rmse REAL,
  created_at INT, updated_at INT, deleted_at INT, version INT NOT NULL DEFAULT 1);

-- `name` is the natural key used by the code ('urgent' | 'high' | …); the UUIDv7 `id`
-- is what sync and the outbox address, like every other table.
CREATE TABLE importance_levels (id TEXT PK /*UUIDv7*/, name TEXT NOT NULL UNIQUE,
  desired_retention REAL, max_interval_days INT, order_rank INT,
  postpone_allowed INT, new_per_day INT, leech_action TEXT,
  created_at INT, updated_at INT, deleted_at INT, version INT NOT NULL DEFAULT 1);

CREATE TABLE exams (id TEXT PK /*UUIDv7*/, title TEXT, date TEXT, scope JSON, blueprint JSON, target_retention REAL,
  final_window_days INT, study_days_mask INT, status TEXT,
  created_at INT, updated_at INT, deleted_at INT, version INT NOT NULL DEFAULT 1);

CREATE TABLE exam_attempts (id TEXT PK /*UUIDv7*/, exam_id TEXT, started_at INT, finished_at INT, score REAL,
  by_topic JSON, items JSON, readiness_predicted REAL,
  created_at INT, updated_at INT, deleted_at INT, version INT NOT NULL DEFAULT 1);
```

Store `reviewed_at` in UTC plus a `day_start_hour` (Anki and `fsrs-optimizer` use 4 a.m.) so
that "same day" is consistent. `review_logs` + `cards` are enough to reconstruct the state
with `f.reschedule(card, history)` after changing parameters or importing.

## 15. Scheduler interface (pluggable)

```ts
interface SchedulingOptions { desiredRetention: number; maxIntervalDays: number; learningSteps: StepUnit[];
  relearningSteps: StepUnit[];
  fuzz: boolean; loadBalance?: (candidates: Date[]) => Date;
  easyDays?: Record<0|1|2|3|4|5|6, 'normal'|'reduced'|'minimum'>; }

interface Scheduler { id: 'fsrs6' | 'sm2' | string;
  preview(card, now, opts): Record<Grade, { card; log }>;  apply(card, now, grade, opts): { card; log };
  retrievability(card, at): number;  intervalFor(retention, state): number;
  reschedule(card, history, opts): Card;
  rollback(card, log): Card;  forget(card, now, resetCounts): Card; }

interface Optimizer { train(logs, opts): Promise<{ w: number[]; logLoss: number; rmse: number }>;
  simulate(cfg): SimulationResult; }
```

The load balancer and easy days are applied **after** the interval (as in Anki): within the
fuzz's `[min_ivl, max_ivl]` the day with the fewest due cards is chosen, avoiding the user's
"minimum" days.

## 16. Notifications and optimizer lifecycle

**Notifications.** Daily reminder at the preferred hour with the due count and estimated
time (Windows toast, respecting Focus Assist): "12 cards from the Physiology exam (3 min) —
keep your streak". Exam alerts (behind vs daily goal, start of the final window, readiness
below threshold), backlog alerts (> 2× the 30-day average) and streak-at-risk alerts. Never
more than 2 per day; easy days apply to notifications too.

**Optimizer.** Start with the default parameters; from ~400–1,000 reviews on, offer
"optimize" in a worker showing log loss/RMSE before and after (accept only if it improves,
like Anki's "health check"); re-optimize every 2ⁿ reviews or monthly; parameters per user
(optionally per domain with ≥ 1,000 reviews); never reschedule en masse except by explicit
action; export/import the history in the `fsrs-optimizer` CSV and in `.apkg`.

## 17. Risks and open decisions

1. The FSRS maintainers announced they will slow down changes and explore variants ("-S" for
   same-day reviews, "-F" with fatigue) instead of FSRS-7: abstract the scheduler and store
   `algorithm_version`.
2. The exam mode is our own synthesis (RemNote + the Advance helper + the closed formula):
   validate it with the simulator.
3. The Hard/Easy thresholds of the automatic exercises are heuristic: measure true retention
   per type and adjust.
4. ~~Verify win32-x64 support of the optimizer binding before deciding between napi and
   WASM.~~ **Resolved in sub-phase 4.6:** `@open-spaced-repetition/binding` publishes a
   win32-x64 N-API prebuild *and* a `wasm32-wasi` build behind the same API, so the choice
   is not either/or — the napi path is the default and WASM is its fallback. See
   `docs/spec/07-architecture.md` §13.4.
