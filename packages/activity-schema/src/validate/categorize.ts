import type { Activity } from '../envelope'
import { type Issue, issue } from './types'

export function validateCategorize(activity: Activity<'categorize'>): Issue[] {
  const issues: Issue[] = []
  const { categories, items } = activity.payload
  const known = new Set(categories.map((category) => category.id))
  const used = new Set<string>()

  items.forEach((item, i) => {
    item.categoryIds.forEach((id, c) => {
      if (known.has(id)) used.add(id)
      else
        issues.push(
          issue(
            'category-unknown',
            ['payload', 'items', i, 'categoryIds', c],
            `category "${id}" does not exist`,
          ),
        )
    })
    if (
      categories.length > 1 &&
      categories.every((category) => item.categoryIds.includes(category.id))
    ) {
      issues.push(
        issue(
          'categorize-item-all-categories',
          ['payload', 'items', i],
          `"${item.text}" belongs to every category: nothing to decide`,
          'warning',
        ),
      )
    }
  })
  categories.forEach((category, c) => {
    if (!used.has(category.id)) {
      issues.push(
        issue(
          'category-unused',
          ['payload', 'categories', c],
          `category "${category.label}" has no item`,
          'warning',
        ),
      )
    }
  })
  return issues
}
