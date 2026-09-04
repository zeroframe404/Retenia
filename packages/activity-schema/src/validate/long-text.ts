import type { Activity } from '../envelope'
import { type AnswerText, leakIssues } from './common'
import { type Issue, issue } from './types'

/** What the graders of §10 need present: key points for FUZ set-match, a rubric and model answer for AI. */

export function validateLongText(activity: Activity<'long_text'>): Issue[] {
  const issues: Issue[] = []
  const { minWords, maxWords, keyPoints, rubric, modelAnswer } = activity.payload

  if (minWords !== undefined && maxWords !== undefined && minWords > maxWords) {
    issues.push(
      issue(
        'word-range-inverted',
        ['payload', 'minWords'],
        `minWords (${minWords}) exceeds maxWords (${maxWords})`,
      ),
    )
  }
  if (
    (activity.type === 'free_recall' || activity.type === 'list_recall') &&
    (keyPoints?.length ?? 0) === 0
  ) {
    issues.push(
      issue(
        'key-points-required',
        ['payload', 'keyPoints'],
        `"${activity.type}" is graded on key points`,
      ),
    )
  }
  if (activity.type === 'essay_rubric') {
    if ((rubric?.length ?? 0) === 0) {
      issues.push(issue('rubric-required', ['payload', 'rubric'], 'essay_rubric needs a rubric'))
    }
    if (modelAnswer === undefined) {
      issues.push(
        issue(
          'model-answer-required',
          ['payload', 'modelAnswer'],
          'the AI grader always shows the model answer (§10)',
        ),
      )
    }
  }
  ;(rubric ?? []).forEach((criterion, c) => {
    const scores = criterion.levels.map((level) => level.score)
    if (new Set(scores).size !== scores.length) {
      issues.push(
        issue(
          'rubric-level-scores-duplicate',
          ['payload', 'rubric', c, 'levels'],
          `criterion "${criterion.criterion}" repeats a level score`,
        ),
      )
    }
  })

  const answers: AnswerText[] = []
  ;(keyPoints ?? []).forEach((point, k) => {
    answers.push({ text: point.text, path: ['payload', 'keyPoints', k, 'text'] })
    for (const [a, alias] of (point.aliases ?? []).entries()) {
      answers.push({ text: alias, path: ['payload', 'keyPoints', k, 'aliases', a] })
    }
  })
  issues.push(...leakIssues(activity, answers))
  return issues
}
