import type { Activity } from '../envelope'
import { type Issue, issue } from './types'

export function validateTextMark(activity: Activity<'text_mark'>): Issue[] {
  const issues: Issue[] = []
  const { tokens, correctIds } = activity.payload
  const known = new Set(tokens.map((token) => token.id))
  const seen = new Set<string>()

  correctIds.forEach((id, index) => {
    if (!known.has(id))
      issues.push(
        issue('token-unknown', ['payload', 'correctIds', index], `token "${id}" does not exist`),
      )
    if (seen.has(id))
      issues.push(
        issue(
          'text-mark-correct-duplicate',
          ['payload', 'correctIds', index],
          `token "${id}" is listed twice`,
        ),
      )
    seen.add(id)
  })
  if (seen.size >= known.size && tokens.every((token) => seen.has(token.id))) {
    issues.push(
      issue(
        'text-mark-all-correct',
        ['payload', 'correctIds'],
        'every token is a target: nothing to discriminate',
      ),
    )
  }
  return issues
}
