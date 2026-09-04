import type { Activity } from '../envelope'
import type { PairPresentation } from '../families/pairs'
import { normalizeText } from '../normalize'
import type { ActivityType } from '../registry'
import { type Issue, issue } from './types'

const PRESENTATIONS: Readonly<Partial<Record<ActivityType, readonly PairPresentation[]>>> = {
  matching_pairs: ['drag', 'lines'],
  matching_dropdown: ['dropdown'],
  tap_pairs_timed: ['tap-timed'],
  memory_game: ['memory'],
}

export function validatePairs(activity: Activity<'pairs'>): Issue[] {
  const issues: Issue[] = []
  const { pairs, rightDistractors, presentation, timeLimitSec } = activity.payload

  const allowed = PRESENTATIONS[activity.type]
  if (allowed !== undefined && !allowed.includes(presentation)) {
    issues.push(
      issue(
        'pairs-presentation-mismatch',
        ['payload', 'presentation'],
        `"${activity.type}" is presented as ${allowed.join(' | ')}`,
      ),
    )
  }
  if (activity.type === 'tap_pairs_timed' && timeLimitSec === undefined) {
    issues.push(
      issue(
        'pairs-time-limit-required',
        ['payload', 'timeLimitSec'],
        'a timed match needs a time limit',
      ),
    )
  }

  const lefts = new Set<string>()
  const rights = new Set<string>()
  pairs.forEach((pair, index) => {
    const left = normalizeText(pair.left)
    const right = normalizeText(pair.right)
    if (lefts.has(left))
      issues.push(
        issue(
          'pairs-left-duplicate',
          ['payload', 'pairs', index, 'left'],
          `"${pair.left}" appears twice on the left`,
        ),
      )
    if (rights.has(right))
      issues.push(
        issue(
          'pairs-right-duplicate',
          ['payload', 'pairs', index, 'right'],
          `"${pair.right}" appears twice on the right: the match is ambiguous`,
        ),
      )
    lefts.add(left)
    rights.add(right)
  })
  ;(rightDistractors ?? []).forEach((distractor, index) => {
    if (rights.has(normalizeText(distractor.text))) {
      issues.push(
        issue(
          'pairs-distractor-is-answer',
          ['payload', 'rightDistractors', index],
          `distractor "${distractor.text}" is a right-hand answer`,
        ),
      )
    }
  })
  return issues
}
