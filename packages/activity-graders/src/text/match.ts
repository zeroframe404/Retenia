import { DEFAULT_MAX_RELATIVE_EDIT_DISTANCE } from '../constants'
import { relativeDistance } from './distance'
import { type NormalizeOptions, normalizeText } from './normalize'

/**
 * The FUZ pipeline of `docs/spec/03-activities.md` §10:
 * `normalize → exact → synonyms → regex → relative edit distance (≤ 0.2)`.
 */

export interface MatchOptions extends Pick<NormalizeOptions, 'caseSensitive' | 'ignoreDiacritics'> {
  /** Groups of interchangeable answers (`grading.fuzzy.synonyms`). */
  synonyms?: readonly (readonly string[])[]
  /** Anchored regular expressions an answer may match instead (`answers[].isRegex`). */
  regexes?: readonly string[]
  /** Default `DEFAULT_MAX_RELATIVE_EDIT_DISTANCE`. `0` means exact only. */
  maxRelativeEditDistance?: number
}

export type MatchVia = 'exact' | 'synonym' | 'regex' | 'fuzzy' | 'none'

export interface TextMatch {
  matched: boolean
  /** 1 for an exact, synonym or regex match; `1 − relative distance` otherwise. */
  similarity: number
  via: MatchVia
  /** The expected answer the input came closest to, as written by the author. */
  best?: string
}

function compileAll(sources: readonly string[]): RegExp[] {
  const compiled: RegExp[] = []
  for (const source of sources) {
    try {
      compiled.push(new RegExp(source, 'u'))
    } catch {
      // An invalid pattern is a validation finding (`regex-invalid`), not a grading crash.
    }
  }
  return compiled
}

export function matchText(
  got: string,
  expected: readonly string[],
  options: MatchOptions = {},
): TextMatch {
  const normalize = (text: string) =>
    normalizeText(text, {
      ...(options.caseSensitive === undefined ? {} : { caseSensitive: options.caseSensitive }),
      ...(options.ignoreDiacritics === undefined
        ? {}
        : { ignoreDiacritics: options.ignoreDiacritics }),
    })
  const input = normalize(got)
  const candidates = expected.map((answer) => ({ raw: answer, normalized: normalize(answer) }))

  const exact = candidates.find((candidate) => candidate.normalized === input)
  if (exact !== undefined) return { matched: true, similarity: 1, via: 'exact', best: exact.raw }

  for (const group of options.synonyms ?? []) {
    const members = group.map(normalize)
    const answer = candidates.find((candidate) => members.includes(candidate.normalized))
    if (answer !== undefined && members.includes(input)) {
      return { matched: true, similarity: 1, via: 'synonym', best: answer.raw }
    }
  }

  for (const regex of compileAll(options.regexes ?? [])) {
    if (regex.test(got) || regex.test(input)) {
      return { matched: true, similarity: 1, via: 'regex', best: regex.source }
    }
  }

  if (candidates.length === 0) return { matched: false, similarity: 0, via: 'none' }
  let best = candidates[0] as { raw: string; normalized: string }
  let minimum = Number.POSITIVE_INFINITY
  for (const candidate of candidates) {
    const distance = relativeDistance(input, candidate.normalized)
    if (distance < minimum) {
      minimum = distance
      best = candidate
    }
  }
  const matched = minimum <= (options.maxRelativeEditDistance ?? DEFAULT_MAX_RELATIVE_EDIT_DISTANCE)
  return { matched, similarity: 1 - minimum, via: matched ? 'fuzzy' : 'none', best: best.raw }
}
