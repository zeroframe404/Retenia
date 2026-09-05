import type { BloomLevel } from '../entities'
import { hashString, mulberry32, shuffleWithRng } from '../memory/prng'
import type { ActivityOption, HostCapabilities } from './activity-option'
import { V1_CAPABILITIES } from './activity-option'

/**
 * §12: *"**Lesson** = theory … + practice (6–12 activities with family variety, ≤ 2 with
 * media, 1 production activity at the end)"*, with §7's fuller statement of the same block:
 * *"4–8 activities (≥ 3 types, max. 40 % MCQ, ≥ 1 at the 'apply' level)"*.
 *
 * `composeLessonPractice` is pure and seeded: the same lesson and seed always compose the
 * same block, so a regenerated path does not reshuffle a learner's practice under them.
 */

/** The rules the block is checked against; every one is reportable. */
export const LESSON_PRACTICE_RULES = [
  'count',
  'distinct_types',
  'family_variety',
  'mcq_share',
  'media_cap',
  'apply_bloom',
  'increasing_difficulty',
  'production_last',
] as const
export type LessonPracticeRule = (typeof LESSON_PRACTICE_RULES)[number]

/**
 * The two types the spec's own catalogue (§4, rows 15–16) names "MCQ".
 *
 * The rest of the `choice` family — `true_false`, `statement_set`, `complete_the_chat` — is
 * deliberately outside the cap: §7's rule is written as "max. 40 % MCQ", and widening it to
 * every select-an-option type would make the cap unsatisfiable for whole classes of
 * material. One constant, so widening it later is one edit.
 */
export const MCQ_TYPES: readonly string[] = Object.freeze(['mcq_single', 'mcq_multi'])

/** §11's "≥ 1 at the 'apply' level" — Bloom's apply and everything above it. */
const APPLY_OR_ABOVE: readonly BloomLevel[] = Object.freeze([
  'apply',
  'analyze',
  'evaluate',
  'create',
])

export interface LessonPracticeLimits {
  min: number
  max: number
  minDistinctTypes: number
  minDistinctFamilies: number
  maxMcqShare: number
  maxMedia: number
}

export const DEFAULT_LESSON_PRACTICE_LIMITS: LessonPracticeLimits = Object.freeze({
  min: 6,
  max: 12,
  minDistinctTypes: 3,
  minDistinctFamilies: 3,
  maxMcqShare: 0.4,
  maxMedia: 2,
})

export interface LessonPracticeInput {
  /** Every activity authored for this lesson's practice block. */
  pool: readonly ActivityOption[]
  seed: string
  capabilities?: HostCapabilities
  limits?: Partial<LessonPracticeLimits>
}

export interface UnmetRule {
  rule: LessonPracticeRule
  detail: string
}

export interface LessonPractice {
  activities: readonly ActivityOption[]
  /** Rules the pool could not satisfy. Empty on a healthy lesson. */
  unmet: readonly UnmetRule[]
  complete: boolean
}

/** §4's 1–5 scale; an unlabelled activity sits in the middle rather than at an extreme. */
export function difficultyOf(option: ActivityOption): number {
  const raw = option.difficulty ?? 3
  return Math.min(5, Math.max(1, Math.round(raw)))
}

export function isMcq(option: ActivityOption): boolean {
  return MCQ_TYPES.includes(option.type)
}

function isApplyOrAbove(option: ActivityOption): boolean {
  return option.bloom !== null && APPLY_OR_ABOVE.includes(option.bloom)
}

/**
 * Check a composed block against every rule, independently of how it was built.
 *
 * The composer runs this on its own output rather than accumulating failures while it
 * builds, so `unmet` describes the block that was actually produced and cannot drift from
 * it. The property test re-states these rules in its own words and asserts the two agree.
 */
export function checkLessonPractice(
  activities: readonly ActivityOption[],
  limits: LessonPracticeLimits,
): readonly UnmetRule[] {
  const unmet: UnmetRule[] = []
  const count = activities.length

  if (count < limits.min || count > limits.max) {
    unmet.push({ rule: 'count', detail: `${count} activities, wanted ${limits.min}–${limits.max}` })
  }

  const types = new Set(activities.map((option) => option.type))
  if (types.size < limits.minDistinctTypes) {
    unmet.push({
      rule: 'distinct_types',
      detail: `${types.size} distinct types, wanted ${limits.minDistinctTypes}`,
    })
  }

  const families = new Set(activities.map((option) => option.family))
  if (families.size < limits.minDistinctFamilies) {
    unmet.push({
      rule: 'family_variety',
      detail: `${families.size} distinct families, wanted ${limits.minDistinctFamilies}`,
    })
  }

  const mcq = activities.filter(isMcq).length
  if (count > 0 && mcq / count > limits.maxMcqShare) {
    unmet.push({
      rule: 'mcq_share',
      detail: `${mcq}/${count} MCQ, over ${Math.round(limits.maxMcqShare * 100)} %`,
    })
  }

  const media = activities.filter((option) => option.hasMedia).length
  if (media > limits.maxMedia) {
    unmet.push({ rule: 'media_cap', detail: `${media} with media, wanted ≤ ${limits.maxMedia}` })
  }

  if (!activities.some(isApplyOrAbove)) {
    unmet.push({ rule: 'apply_bloom', detail: 'no activity at the apply level or above' })
  }

  // Non-decreasing, not strictly increasing: twelve activities cannot strictly increase on a
  // five-point scale, so "increasing difficulty" can only mean "never gets easier". The tail
  // is included — a block that ramps up and then ends on its easiest item has not ramped.
  for (let index = 1; index < count; index++) {
    const previous = difficultyOf(activities[index - 1] as ActivityOption)
    if (difficultyOf(activities[index] as ActivityOption) < previous) {
      unmet.push({ rule: 'increasing_difficulty', detail: `difficulty drops at position ${index}` })
      break
    }
  }

  const last = activities[count - 1]
  if (last === undefined || last.progression !== 'production') {
    unmet.push({
      rule: 'production_last',
      detail: 'the block does not end on a production activity',
    })
  }

  return unmet
}

/**
 * Compose a lesson's practice block.
 *
 * It **reports rather than throws**. A pool of eight MCQs cannot satisfy the 40 % cap, and
 * the honest answer is the best block that pool allows plus a note saying which rules it
 * broke — the same "return diagnostics" idiom as `validateActivity`'s `Issue[]` and
 * `SessionPlan.postponements`. Throwing would let one thin lesson abort a whole path
 * generation; silently dropping the rule would hide a content problem the author can fix.
 *
 * Unlike the review selector, this does **not** filter on `eligible`: §4's nine lesson-only
 * types exist precisely to be lesson content, and excluding them here would bar
 * `disclosure_block` from the block it was written for.
 */
export function composeLessonPractice(input: LessonPracticeInput): LessonPractice {
  const limits: LessonPracticeLimits = { ...DEFAULT_LESSON_PRACTICE_LIMITS, ...input.limits }
  const capabilities = input.capabilities ?? V1_CAPABILITIES

  const feasible = input.pool.filter(
    (option) =>
      (!option.needsMic || capabilities.mic) &&
      (!option.needsSandbox || capabilities.sandbox) &&
      (!option.hasMedia || capabilities.media),
  )

  if (feasible.length === 0) {
    return { activities: [], unmet: checkLessonPractice([], limits), complete: false }
  }

  // A seeded ordering up front, so every "first of the best-scoring" tie-break below is
  // deterministic without each one needing its own draw.
  const shuffled = shuffleWithRng(feasible, mulberry32(hashString(input.seed)))
  const target = Math.min(limits.max, Math.max(limits.min, feasible.length))

  // The tail first: §12 puts one production activity at the end, so it is chosen before the
  // body competes for the same items. Hardest production activity available.
  const production = shuffled.filter((option) => option.progression === 'production')
  const tailPool = production.length > 0 ? production : shuffled
  let tail = tailPool[0] as ActivityOption
  for (const option of tailPool) {
    if (difficultyOf(option) > difficultyOf(tail)) tail = option
  }

  const remaining = shuffled.filter((option) => option.activityId !== tail.activityId)
  const chosen: ActivityOption[] = []
  const seenTypes = new Set<string>()
  const seenFamilies = new Set<string>()
  let mcqUsed = isMcq(tail) ? 1 : 0
  let mediaUsed = tail.hasMedia ? 1 : 0
  seenTypes.add(tail.type)
  seenFamilies.add(tail.family)

  const mcqBudget = Math.floor(limits.maxMcqShare * target)

  /**
   * How much a candidate would add to the block.
   *
   * A new family is worth more than a new type (§12 asks for "family variety", and §7 for
   * "≥ 3 types … preferably from different families"); the first apply-level item is worth
   * as much as a new family because §11 requires one at all; a production item is penalised
   * so the tail keeps the only one where the pool allows it.
   *
   * Difficulty is not scored here: it is a *filter* in `bestCandidate`, because no amount of
   * variety is worth breaking the ramp — that trade would put "increasing difficulty" and
   * "production last" in direct conflict, and §12 states the tail rule the more concretely.
   */
  const scoreCandidate = (option: ActivityOption): number =>
    (seenFamilies.has(option.family) ? 0 : 2) +
    (seenTypes.has(option.type) ? 0 : 1) +
    (option.progression === 'production' ? -1 : 0) +
    (isApplyOrAbove(option) && !chosen.some(isApplyOrAbove) ? 2 : 0)

  const take = (index: number): void => {
    const picked = remaining.splice(index, 1)[0] as ActivityOption
    chosen.push(picked)
    seenTypes.add(picked.type)
    seenFamilies.add(picked.family)
    if (isMcq(picked)) mcqUsed++
    if (picked.hasMedia) mediaUsed++
  }

  /**
   * The best-scoring candidate the given budgets allow, or `-1`.
   *
   * Items no harder than the tail come first, so the ramp holds whenever the pool makes that
   * possible at all; a single scored pass would let a big variety bonus buy a ramp break the
   * pool never forced.
   *
   * Harder items are considered **only** while the block is still short of the minimum
   * (`allowRampBreak`). Past that point a shorter block is the better answer: §12 gives the
   * size as a range but the ramp as a property, so filling twelve slots by putting the
   * hardest item in the middle trades a rule for a preference — the same reasoning as the
   * MCQ shrink below.
   */
  const bestCandidate = (mcqCapped: boolean, allowRampBreak: boolean): number => {
    for (const rampSafe of allowRampBreak ? [true, false] : [true]) {
      let bestIndex = -1
      let bestScore = Number.NEGATIVE_INFINITY
      for (let index = 0; index < remaining.length; index++) {
        const option = remaining[index] as ActivityOption
        if (rampSafe && difficultyOf(option) > difficultyOf(tail)) continue
        if (mcqCapped && isMcq(option) && mcqUsed >= mcqBudget) continue
        if (option.hasMedia && mediaUsed >= limits.maxMedia) continue
        const score = scoreCandidate(option)
        if (score > bestScore) {
          bestScore = score
          bestIndex = index
        }
      }
      if (bestIndex !== -1) return bestIndex
    }
    return -1
  }

  while (chosen.length < target - 1 && remaining.length > 0) {
    const bestIndex = bestCandidate(true, chosen.length + 1 < limits.min)
    if (bestIndex === -1) break
    take(bestIndex)
  }

  // Top up to the minimum, spending the MCQ budget if that is the only way.
  //
  // §12 states the block's size as a range ("6–12 activities") and the MCQ ceiling as a
  // proportion; when a thin pool puts them in conflict, size wins. A four-activity lesson is
  // a worse lesson than a six-activity one that leans on multiple choice — and the shortfall
  // would be invisible, whereas the MCQ share is reported. The media cap is *not* spent
  // here: it guards what the host can actually present, which is not a preference.
  while (chosen.length + 1 < limits.min) {
    // The same scoring as the fill, only with the MCQ ceiling lifted: a top-up that grabbed
    // the first survivor would throw away the variety the pool could still have given, and
    // then report a shortfall that was self-inflicted rather than the pool's fault.
    const index = bestCandidate(false, true)
    if (index === -1) break
    take(index)
  }

  chosen.sort((a, b) => {
    const byDifficulty = difficultyOf(a) - difficultyOf(b)
    if (byDifficulty !== 0) return byDifficulty
    return a.activityId < b.activityId ? -1 : 1
  })

  // Repair: shrink toward the minimum before declaring the MCQ cap unsatisfiable.
  //
  // A smaller block can satisfy 40 % where a larger one cannot — four non-MCQ activities and
  // twenty MCQs are 55 % MCQ at twelve items but 33 % at six. Dropping from the end of the
  // body keeps the difficulty ramp intact and never touches the production tail, and both
  // numerator and denominator fall, so each drop strictly improves the ratio. Without this,
  // the block would report a rule unmet that the pool could in fact have met.
  const mcqCeiling = (count: number): number => Math.floor(limits.maxMcqShare * count)
  const mcqTotal = () => chosen.filter(isMcq).length + (isMcq(tail) ? 1 : 0)
  const brokenRules = (body: readonly ActivityOption[]): Set<LessonPracticeRule> =>
    new Set(checkLessonPractice([...body, tail], limits).map((entry) => entry.rule))

  /*
   * Repair by swap, before repair by shrink.
   *
   * The fill's MCQ ceiling is computed against the block's *target* size, but the block can
   * end up smaller — the ramp filter may run out of items no harder than the tail. A block
   * of six carrying a ceiling meant for twelve is then over its share with no room to
   * shrink, while the pool still holds non-MCQ activities the fill never reached. Trading
   * one for one fixes the share without touching the count.
   *
   * Every swap is checked against `brokenRules`: a repair that fixes one rule by breaking
   * another is not a repair, so a candidate introducing a new failure is skipped.
   */
  for (let guard = chosen.length; guard > 0; guard--) {
    const before = brokenRules(chosen)
    if (!before.has('mcq_share')) break
    let swapped = false
    for (let index = chosen.length - 1; index >= 0 && !swapped; index--) {
      if (!isMcq(chosen[index] as ActivityOption)) continue
      for (let candidate = 0; candidate < remaining.length; candidate++) {
        const option = remaining[candidate] as ActivityOption
        if (isMcq(option)) continue
        const next = [...chosen]
        next[index] = option
        // No separate media guard: `brokenRules` already rejects a swap that would push the
        // block over `media_cap`, and a second check could only disagree with it.
        if ([...brokenRules(next)].some((rule) => !before.has(rule))) continue
        const removed = chosen[index] as ActivityOption
        chosen[index] = option
        remaining.splice(candidate, 1)
        remaining.push(removed)
        swapped = true
        break
      }
    }
    if (!swapped) break
  }

  while (chosen.length + 1 > limits.min && mcqTotal() > mcqCeiling(chosen.length + 1)) {
    const before = brokenRules(chosen)
    // Only a drop that is a strict improvement. Removing the block's last MCQ can also
    // remove its only apply-level item or its only member of a third family, which would
    // trade an `mcq_share` failure for a worse one — a repair that makes the report longer
    // is not a repair.
    let dropped = false
    for (let index = chosen.length - 1; index >= 0; index--) {
      if (!isMcq(chosen[index] as ActivityOption)) continue
      const candidate = [...chosen.slice(0, index), ...chosen.slice(index + 1)]
      const after = brokenRules(candidate)
      /* c8 ignore next -- defensive: the swap repair above has already exhausted the cases
         where an MCQ is load-bearing, so no drop reaching here has been observed to break a
         rule. Kept because the swap is not guaranteed to have run (it stops as soon as the
         share is met), and a drop that costs another rule must never be taken silently. */
      if ([...after].some((rule) => rule !== 'count' && !before.has(rule))) continue
      chosen.splice(index, 1)
      dropped = true
      break
    }
    /* c8 ignore next -- same: with the swap ahead of it, no block reaching this loop has had
       every one of its MCQs refused. The loop must still terminate if one ever does. */
    if (!dropped) break
  }

  // The swap can disturb the ramp order, so the body is sorted once more before it is fixed.
  chosen.sort((a, b) => {
    const byDifficulty = difficultyOf(a) - difficultyOf(b)
    if (byDifficulty !== 0) return byDifficulty
    return a.activityId < b.activityId ? -1 : 1
  })

  const activities = [...chosen, tail]
  const unmet = checkLessonPractice(activities, limits)
  return { activities, unmet, complete: unmet.length === 0 }
}
