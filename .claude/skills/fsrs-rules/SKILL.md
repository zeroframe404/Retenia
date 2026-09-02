---
name: fsrs-rules
description: The non-negotiable FSRS scheduler rules for Retenia — field parity with ts-fsrs, what may and may not adjust S/D, how importance and exam mode affect scheduling, and review log invariants. Reference knowledge, auto-invoked whenever scheduler, FSRS, S/D, retention, importance, or review-log code is touched.
---

# FSRS rules

These rules are non-negotiable. Anything touching `cards`, `review_logs`, or the scheduler must respect them exactly.

- **Field parity.** The FSRS fields on `cards` and `review_logs` mirror `ts-fsrs` 1:1. Never rename or reshape them — if `ts-fsrs` calls a field `stability`, the column/property is `stability`, not `s` or `stabilityDays`.
- **S and D are scheduler-owned.** Stability (`S`) and Difficulty (`D`) are only ever changed by the scheduler's own FSRS computation. No other code path — importance changes, exam mode, manual edits — may write to `S` or `D` directly.
- **Importance affects exactly six things**: desired retention, max interval, review order, behaviour under overload (postpone policy), `new_per_day` (the new-item quota) and `leech_action`. All six are columns of the `importance_levels` table — none of them belongs anywhere else. Importance never changes `S` or `D` directly, and it never changes the FSRS algorithm's weights. See `docs/spec/02-memory-system.md` §7.
- **Exam mode is a layer over FSRS, not just an interval cap.** For an exam on date `E` it: clamps the interval to `min(I(DR_exam, S'), (E − buffer_final) − today)` so no review lands after the exam; ramps `DR_exam` linearly 0.92 → 0.95 over the last two weeks and to 0.97 in the last three days; sets a per-day new-item quota with two correct answers required to leave the learning phase; reorders the final window by ascending `R_E` then by the topic's blueprint weight, with "ensure mastery" (an Again requires two consecutive correct); and on catch-up raises the goal for the exam's items while postponing other levels. What it must **not** do is write `S` or `D`: the interval cap is the only intervention on the scheduler, and `review_logs` still stores the real `scheduled_days` so the optimizer is not contaminated. See `docs/spec/02-memory-system.md` §8.
- **`review_logs` are append-only.** A review is recorded by inserting a new row, never by updating or deleting an existing one — this matches the project's no-hard-deletes rule and preserves full review history for FSRS.
- **Rating 0 = Manual.** A rating of `0` denotes a manual/non-FSRS-graded review action (e.g. a manual reschedule), not one of the four FSRS grades (Again/Hard/Good/Easy = 1–4). Code that branches on rating must treat `0` as its own case, never coerce it into the 1–4 range.
