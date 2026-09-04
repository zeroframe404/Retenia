import { MEDIA_TOKEN_PATTERN } from '../common'
import type { Activity } from '../envelope'
import { normalizeText } from '../normalize'
import { allowedEligibility, allowedGradingMethods, allowedRatingStrategies } from '../registry'
import { type Issue, type IssuePath, issue } from './types'

/** Rules every family shares (`docs/spec/03-activities.md` §11: "unique ids", and the envelope's own consistency). */

type Visitor = (value: unknown, path: IssuePath) => void

/** Depth-first over arrays and plain objects, calling `visit` on every value including containers. */
export function walk(value: unknown, path: IssuePath, visit: Visitor): void {
  visit(value, path)
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) walk(item, [...path, index], visit)
  } else if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) walk(child, [...path, key], visit)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Every `id` string inside the payload and the media list, with its path. */
export function shortIds(activity: Activity): { id: string; path: IssuePath }[] {
  const found: { id: string; path: IssuePath }[] = []
  const collect: Visitor = (value, path) => {
    if (isRecord(value) && typeof value.id === 'string')
      found.push({ id: value.id, path: [...path, 'id'] })
  }
  walk(activity.payload, ['payload'], collect)
  walk(activity.media ?? [], ['media'], collect)
  return found
}

export function duplicateIdIssues(activity: Activity): Issue[] {
  const seen = new Map<string, IssuePath>()
  const issues: Issue[] = []
  for (const { id, path } of shortIds(activity)) {
    const first = seen.get(id)
    if (first === undefined) {
      seen.set(id, path)
    } else {
      issues.push(issue('duplicate-id', path, `id "${id}" is already used at ${first.join('.')}`))
    }
  }
  return issues
}

/** Every string of the activity that may carry `[[media:ID]]`, plus payload `media` id fields. */
export function mediaIssues(activity: Activity): Issue[] {
  const declared = new Set((activity.media ?? []).map((ref) => ref.id))
  const issues: Issue[] = []
  const check = (id: string, path: IssuePath) => {
    if (!declared.has(id))
      issues.push(issue('media-ref-unknown', path, `media "${id}" is not declared in media[]`))
  }
  const { media: _declaredList, ...rest } = activity
  walk(rest, [], (value, path) => {
    if (typeof value === 'string') {
      for (const match of value.matchAll(MEDIA_TOKEN_PATTERN)) check(match[1] as string, path)
    }
    if (isRecord(value) && path[0] === 'payload') {
      const media = value.media
      if (typeof media === 'string') check(media, [...path, 'media'])
      if (Array.isArray(media)) {
        media.forEach((id, index) => {
          if (typeof id === 'string') check(id, [...path, 'media', index])
        })
      }
    }
  })
  ;(activity.media ?? []).forEach((ref, index) => {
    if (ref.src === undefined && ref.generate === undefined) {
      issues.push(
        issue(
          'media-unresolvable',
          ['media', index],
          `media "${ref.id}" has neither src nor generate`,
        ),
      )
    }
  })
  return issues
}

export function sourceIssues(activity: Activity): Issue[] {
  const issues: Issue[] = []
  ;(activity.sources ?? []).forEach((source, index) => {
    if (typeof source.span === 'object' && source.span.end < source.span.start) {
      issues.push(
        issue(
          'source-span-inverted',
          ['sources', index, 'span'],
          `span ends (${source.span.end}) before it starts (${source.span.start})`,
        ),
      )
    }
  })
  return issues
}

/** The envelope agrees with the registry row of its type (§4 columns Calif. and Repaso). */
export function registryIssues(activity: Activity): Issue[] {
  const issues: Issue[] = []
  const strategies = allowedRatingStrategies(activity.type)
  if (!strategies.includes(activity.review.ratingStrategy)) {
    issues.push(
      issue(
        'review-mismatch',
        ['review', 'ratingStrategy'],
        `"${activity.type}" rates by ${strategies.join(' | ')}, not "${activity.review.ratingStrategy}"`,
      ),
    )
  }
  const eligibility = allowedEligibility(activity.type)
  if (!eligibility.includes(activity.review.eligible)) {
    issues.push(
      issue(
        'review-mismatch',
        ['review', 'eligible'],
        `"${activity.type}" is ${eligibility[0] ? '' : 'not '}review-eligible`,
      ),
    )
  }
  const methods = allowedGradingMethods(activity.type)
  if (!methods.includes(activity.grading.method)) {
    issues.push(
      issue(
        'grading-method-mismatch',
        ['grading', 'method'],
        `"${activity.type}" is graded by ${methods.join(' | ')}, not "${activity.grading.method}"`,
      ),
    )
  }
  if (activity.review.eligible && activity.skills.length === 0) {
    issues.push(
      issue(
        'skills-required',
        ['skills'],
        'a review-eligible activity must name the skills it schedules',
      ),
    )
  }
  return issues
}

/** Shorter answers ("a", "no") appear in almost any prompt by accident; §11's rule is about real leaks. */
export const MIN_LEAK_LENGTH = 3

export function normalizedIncludes(haystack: string, needle: string): boolean {
  const n = normalizeText(needle)
  return n.length >= MIN_LEAK_LENGTH && normalizeText(haystack).includes(n)
}

export interface AnswerText {
  text: string
  path: IssuePath
}

/**
 * §11: "the answer cannot appear in the stem". Warnings, because a stem that mentions the word
 * is sometimes legitimate (a definition being asked for its term); the QA gate decides.
 */
export function leakIssues(
  activity: Activity,
  answers: readonly AnswerText[],
  stems: readonly AnswerText[] = [],
): Issue[] {
  const issues: Issue[] = []
  const haystacks: AnswerText[] = [{ text: activity.prompt, path: ['prompt'] }, ...stems]
  for (const answer of answers) {
    for (const stem of haystacks) {
      if (normalizedIncludes(stem.text, answer.text)) {
        issues.push(
          issue(
            'answer-in-prompt',
            answer.path,
            `"${answer.text}" appears in ${stem.path.join('.')}`,
            'warning',
          ),
        )
      }
    }
    ;(activity.hints ?? []).forEach((hint, index) => {
      if (normalizedIncludes(hint, answer.text)) {
        issues.push(
          issue(
            'hint-reveals-answer',
            ['hints', index],
            `hint reveals "${answer.text}"`,
            'warning',
          ),
        )
      }
    })
  }
  return issues
}

export function commonIssues(activity: Activity): Issue[] {
  return [
    ...duplicateIdIssues(activity),
    ...mediaIssues(activity),
    ...sourceIssues(activity),
    ...registryIssues(activity),
  ]
}
