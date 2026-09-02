---
name: fsrs-rules
description: The non-negotiable FSRS scheduler rules for Retenia — field parity with ts-fsrs, what may and may not adjust S/D, how importance and exam mode affect scheduling, and review log invariants. Reference knowledge, auto-invoked whenever scheduler, FSRS, S/D, retention, importance, or review-log code is touched.
---

# FSRS rules

These rules are non-negotiable. Anything touching `cards`, `review_logs`, or the scheduler must respect them exactly.

- **Field parity.** The FSRS fields on `cards` and `review_logs` mirror `ts-fsrs` 1:1. Never rename or reshape them — if `ts-fsrs` calls a field `stability`, the column/property is `stability`, not `s` or `stabilityDays`.
- **S and D are scheduler-owned.** Stability (`S`) and Difficulty (`D`) are only ever changed by the scheduler's own FSRS computation. No other code path — importance changes, exam mode, manual edits — may write to `S` or `D` directly.
- **Importance only affects four things**: desired retention, max interval, review order, and postpone policy. It never changes `S` or `D` directly, and it never changes the FSRS algorithm's weights.
- **Exam mode only caps intervals.** It clamps the maximum interval a card can be scheduled at; it does not alter `S`, `D`, desired retention, or ordering logic beyond that cap.
- **`review_logs` are append-only.** A review is recorded by inserting a new row, never by updating or deleting an existing one — this matches the project's no-hard-deletes rule and preserves full review history for FSRS.
- **Rating 0 = Manual.** A rating of `0` denotes a manual/non-FSRS-graded review action (e.g. a manual reschedule), not one of the four FSRS grades (Again/Hard/Good/Easy = 1–4). Code that branches on rating must treat `0` as its own case, never coerce it into the 1–4 range.
