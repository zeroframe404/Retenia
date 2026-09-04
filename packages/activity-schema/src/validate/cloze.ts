import type { Activity } from '../envelope'
import type { ClozeMode } from '../families/cloze'
import { normalizeText } from '../normalize'
import type { ActivityType } from '../registry'
import { type AnswerText, leakIssues, normalizedIncludes } from './common'
import { type Issue, issue } from './types'

/** §11: "every gap referenced" — here, every gap answerable and the bank consistent. */

const MODES: Readonly<Partial<Record<ActivityType, ClozeMode>>> = {
  cloze_typed: 'typed',
  cloze_dropdown: 'dropdown',
  cloze_wordbank: 'wordbank',
}

export function validateCloze(activity: Activity<'cloze'>): Issue[] {
  const issues: Issue[] = []
  const { mode, segments, bankDistractors } = activity.payload

  const expectedMode = MODES[activity.type]
  if (expectedMode !== undefined && mode !== expectedMode) {
    issues.push(
      issue(
        'cloze-mode-mismatch',
        ['payload', 'mode'],
        `"${activity.type}" is mode "${expectedMode}"`,
      ),
    )
  }

  const gaps = segments.flatMap((segment, index) =>
    segment.kind === 'gap' ? [{ gap: segment, index }] : [],
  )
  if (gaps.length === 0) {
    issues.push(issue('cloze-no-gaps', ['payload', 'segments'], 'a cloze needs at least one gap'))
  }

  const answers: AnswerText[] = []
  const allAnswers = new Set<string>()
  for (const { gap, index } of gaps) {
    const path = ['payload', 'segments', index]
    for (const answer of gap.answers) allAnswers.add(normalizeText(answer))
    answers.push({ text: gap.answers[0] as string, path: [...path, 'answers', 0] })

    if (mode === 'dropdown' && (gap.options === undefined || gap.options.length < 2)) {
      issues.push(
        issue(
          'cloze-gap-options-required',
          [...path, 'options'],
          `gap "${gap.id}" needs at least two dropdown options`,
        ),
      )
    }
    if (gap.options !== undefined && mode !== 'typed') {
      const options = gap.options.map((option) => normalizeText(option))
      if (!gap.answers.some((answer) => options.includes(normalizeText(answer)))) {
        issues.push(
          issue(
            'cloze-gap-answer-not-in-options',
            [...path, 'options'],
            `no answer of gap "${gap.id}" is among its options`,
          ),
        )
      }
    }

    const previous = segments[index - 1]
    const next = segments[index + 1]
    if (previous?.kind === 'gap') {
      issues.push(
        issue(
          'cloze-adjacent-gaps',
          [...path],
          `gap "${gap.id}" follows another gap with no text between`,
          'warning',
        ),
      )
    }
    for (const neighbour of [previous, next]) {
      if (
        neighbour?.kind === 'text' &&
        gap.answers.some((answer) => normalizedIncludes(neighbour.text, answer))
      ) {
        issues.push(
          issue(
            'cloze-gap-answer-leak',
            [...path],
            `the text next to gap "${gap.id}" contains its answer`,
            'warning',
          ),
        )
        break
      }
    }
  }

  ;(bankDistractors ?? []).forEach((distractor, index) => {
    if (allAnswers.has(normalizeText(distractor))) {
      issues.push(
        issue(
          'cloze-distractor-is-answer',
          ['payload', 'bankDistractors', index],
          `distractor "${distractor}" fills a gap`,
        ),
      )
    }
  })

  issues.push(...leakIssues(activity, answers))
  return issues
}
