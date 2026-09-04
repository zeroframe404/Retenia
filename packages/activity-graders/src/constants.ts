/**
 * `correct` is the grader's verdict; `score` is its measurement. Where a family has no
 * verdict of its own (a matching grid, a categorization), the verdict is the score reaching
 * this floor — the bottom of M-pct's Good band (`docs/spec/03-activities.md` §3) and the
 * similarity a FUZ match of ≤ 0.2 relative distance amounts to. Keeping the two aligned is what
 * lets `@retenia/core`'s `toRating` treat "correct" and "in the Good band" as the same thing.
 */
export const PASS_SCORE = 0.8

/** §2 FUZ: "relative Damerau-Levenshtein distance ≤ 0.2". */
export const DEFAULT_MAX_RELATIVE_EDIT_DISTANCE = 0.2
