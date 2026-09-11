import { relativeDistance } from '@retenia/core'

/**
 * §5 gate 2: *"the cited span exists, fuzzy ≥ 0.85"*, over Damerau-Levenshtein on
 * normalised text (§14 pitfall 1: "verify spans, not just ids").
 *
 * The same shape `@retenia/activity-graders`' `coversPhrase` uses for key points — exact
 * containment first, then a token window of the span's width (±1) slid over the haystack —
 * with one addition that matters at chunk scale: a window is only measured when it shares
 * most of the span's tokens. A 6,000-character chunk has thousands of windows and an edit
 * distance is quadratic in the span's length; measuring every window would make one lesson's
 * gate cost seconds, while the token filter leaves a handful of candidates and changes no
 * answer — a window that shares fewer than `MIN_TOKEN_OVERLAP` of the span's tokens cannot
 * be within 0.15 of it.
 */

/** §5 gate 2's threshold, as similarity (`1 − relative distance`). */
export const SPAN_SIMILARITY_THRESHOLD = 0.85
/** A window has to share this share of the span's tokens before its distance is measured. */
export const MIN_TOKEN_OVERLAP = 0.6
/** The quoted spans a block may contain — the same bounds `expand/citations.ts` reads. */
export const QUOTED_SPAN = /[«"“](.{8,300}?)[»"”]/gu

/** NFKC, lower case, no diacritics, letters and digits only, single spaces. */
export function normalizeForMatch(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** The verbatim quotations of a text, longest first. */
export function quotedSpans(text: string): string[] {
  return [...text.matchAll(QUOTED_SPAN)]
    .map((match) => (match[1] as string).trim())
    .filter((span) => span.length > 0)
    .sort((a, b) => b.length - a.length)
}

/**
 * How closely `span` appears anywhere in `haystack`, in `[0, 1]`.
 *
 * `1` for verbatim containment after normalisation; otherwise the best `1 − distance` over
 * the candidate windows; `0` for an empty span or no candidate at all.
 */
export function spanSimilarity(span: string, haystack: string): number {
  const needle = normalizeForMatch(span)
  const hay = normalizeForMatch(haystack)
  if (needle.length === 0 || hay.length === 0) return 0
  if (hay.includes(needle)) return 1

  const needleTokens = needle.split(' ')
  const needleSet = new Set(needleTokens)
  const tokens = hay.split(' ')
  const width = needleTokens.length
  const wanted = Math.ceil(needleSet.size * MIN_TOKEN_OVERLAP)

  let best = 0
  for (const size of [width - 1, width, width + 1]) {
    if (size < 1 || size > tokens.length) continue
    for (let start = 0; start + size <= tokens.length; start += 1) {
      const window = tokens.slice(start, start + size)
      let shared = 0
      for (const token of new Set(window)) if (needleSet.has(token)) shared += 1
      if (shared < wanted) continue
      const similarity = 1 - relativeDistance(window.join(' '), needle)
      if (similarity > best) best = similarity
      if (best === 1) return 1
    }
  }
  return best
}

export function spanMatches(span: string, haystack: string): boolean {
  return spanSimilarity(span, haystack) >= SPAN_SIMILARITY_THRESHOLD
}
