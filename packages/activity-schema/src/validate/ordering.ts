import type { Activity } from '../envelope'
import { normalizeText } from '../normalize'
import { type Issue, type IssuePath, issue } from './types'

/** §11: "`correctOrder` is a permutation" of the item ids — no distractor, nothing missing, nothing twice. */

function isPermutation(order: readonly string[], ids: ReadonlySet<string>): boolean {
  return (
    order.length === ids.size &&
    new Set(order).size === order.length &&
    order.every((id) => ids.has(id))
  )
}

export function validateOrdering(activity: Activity<'ordering'>): Issue[] {
  const issues: Issue[] = []
  const { items, correctOrder, alternativeOrders, distractors, scoring, checkIndentation } =
    activity.payload
  const ids = new Set(items.map((item) => item.id))

  const check = (
    order: readonly string[],
    path: IssuePath,
    code: 'order-not-permutation' | 'alt-order-not-permutation',
  ) => {
    if (!isPermutation(order, ids)) {
      issues.push(
        issue(
          code,
          path,
          `[${order.join(', ')}] is not a permutation of the item ids [${[...ids].join(', ')}]`,
        ),
      )
    }
  }
  check(correctOrder, ['payload', 'correctOrder'], 'order-not-permutation')
  ;(alternativeOrders ?? []).forEach((order, index) => {
    const path = ['payload', 'alternativeOrders', index]
    check(order, path, 'alt-order-not-permutation')
    if (order.length === correctOrder.length && order.every((id, i) => id === correctOrder[i])) {
      issues.push(
        issue(
          'alt-order-equals-correct',
          path,
          'an alternative order that equals correctOrder adds nothing',
          'warning',
        ),
      )
    }
  })

  if (
    (activity.type === 'sentence_builder' || activity.type === 'anagram') &&
    scoring !== 'exact'
  ) {
    issues.push(
      issue(
        'ordering-scoring-mismatch',
        ['payload', 'scoring'],
        `"${activity.type}" is graded exact: the sentence is right or it is not`,
      ),
    )
  }
  if (checkIndentation === true && !items.some((item) => item.indent !== undefined)) {
    issues.push(
      issue(
        'ordering-indent-missing',
        ['payload', 'checkIndentation'],
        'checkIndentation needs items with an indent',
      ),
    )
  }

  const texts = new Set(items.map((item) => normalizeText(item.text)))
  ;(distractors ?? []).forEach((distractor, index) => {
    if (texts.has(normalizeText(distractor.text))) {
      issues.push(
        issue(
          'ordering-distractor-is-item',
          ['payload', 'distractors', index],
          `distractor "${distractor.text}" duplicates an item`,
        ),
      )
    }
  })
  return issues
}
