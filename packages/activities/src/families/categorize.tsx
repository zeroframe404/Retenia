import type { Response } from '@retenia/activity-schema'
import { cn } from '@retenia/ui'
import { useMemo } from 'react'
import { DragLayer, DropZone } from '../components/drag-layer'
import { RichText } from '../components/rich-text'
import { TokenBank } from '../components/token-bank'
import { useFamilyActivity } from '../host/activity-context'

/**
 * The `categorize` family (§7): items dropped into the categories they belong to.
 *
 * The response is `placements[itemId] = categoryIds[]`, which is what makes the grader's Jaccard
 * overlap possible: an item that honestly belongs in two categories can be placed in both, and a
 * partly right placement keeps partly right credit rather than failing outright.
 */
export function Renderer() {
  const { activity, response, respond, shuffled, result, labels } = useFamilyActivity('categorize')
  const { categories, items } = activity.payload
  const answer: Response<'categorize'> = response ?? { placements: {} }

  const tokens = useMemo(() => items.map((item) => ({ id: item.id, text: item.text })), [items])
  const shuffledTokens = shuffled(tokens, 'items')
  const placedIds = items
    .filter((item) => (answer.placements[item.id] ?? []).length > 0)
    .map((item) => item.id)

  function place(itemId: string, categoryId: string) {
    const current = answer.placements[itemId] ?? []
    if (current.includes(categoryId)) return
    respond({ placements: { ...answer.placements, [itemId]: [...current, categoryId] } })
  }

  function remove(itemId: string, categoryId: string) {
    const next = (answer.placements[itemId] ?? []).filter((id) => id !== categoryId)
    const placements = { ...answer.placements, [itemId]: next }
    if (next.length === 0) delete placements[itemId]
    respond({ placements })
  }

  return (
    <DragLayer onPlace={place}>
      <div className="flex flex-col gap-4" data-testid="renderer-categorize">
        {/* Not `singleUse`: a placed item stays in the bank, greyed out, so an item that honestly
            belongs in two categories can be picked back up and placed in the other one too. */}
        <TokenBank tokens={shuffledTokens} usedIds={placedIds} />
        <div className="grid gap-3 sm:grid-cols-2">
          {categories.map((category) => {
            const placed = items.filter((item) =>
              (answer.placements[item.id] ?? []).includes(category.id),
            )
            return (
              <section key={category.id} className="flex flex-col gap-2">
                <h3 className="text-sm font-medium">
                  <RichText>{category.label}</RichText>
                </h3>
                <DropZone id={category.id} label={category.label} className="min-h-16">
                  <ul className="flex flex-wrap gap-2">
                    {placed.map((item) => {
                      const perItem = result?.perItem?.find((entry) => entry.id === item.id)
                      return (
                        <li key={item.id}>
                          <button
                            type="button"
                            disabled={result !== null}
                            onClick={() => remove(item.id, category.id)}
                            aria-label={`${labels.removePlacement}: ${item.text}`}
                            data-testid={`placed-${item.id}-${category.id}`}
                            className={cn(
                              'border-border bg-surface rounded-md border px-2 py-1 text-xs',
                              perItem?.correct === true && 'border-correct bg-correct/10',
                              perItem?.correct === false && 'border-incorrect bg-incorrect/10',
                            )}
                          >
                            {item.text}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </DropZone>
              </section>
            )
          })}
        </div>
      </div>
    </DragLayer>
  )
}
