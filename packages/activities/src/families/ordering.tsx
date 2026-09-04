import type { OrderingItem, Response } from '@retenia/activity-schema'
import { cn, IconButton } from '@retenia/ui'
import { ChevronDownIcon, ChevronUpIcon } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { RichText } from '../components/rich-text'
import { useFamilyActivity } from '../host/activity-context'

/**
 * The `ordering` family (§7): `ordering_sequence` and `sentence_builder` in the MVP, plus
 * `timeline_build`, `anagram`, `parsons_problem`, `image_sequencing` and `listen_reconstruct`.
 *
 * Reordering is the one "drag-and-drop" that has an obvious, *better* keyboard form, so this
 * renderer leads with it: every item carries Move-up / Move-down buttons, which is the pattern
 * H5P's own Sort-the-Paragraphs falls back to and the one a screen-reader user can actually
 * follow. The list is a `<ol>`, so the position is announced without any ARIA of our own.
 */

function move<T>(items: readonly T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length) return [...items]
  const next = [...items]
  const [moved] = next.splice(from, 1)
  if (moved !== undefined) next.splice(to, 0, moved)
  return next
}

export function Renderer() {
  const { activity, response, respond, seedResponse, locked, shuffled, result, labels } =
    useFamilyActivity('ordering')
  const { items, distractors } = activity.payload

  // Distractors sit in the same list as the items: §7 calls them "items that belong nowhere", and
  // the grader treats an id it does not know in `correctOrder` as wrong wherever it is put.
  const all = useMemo<OrderingItem[]>(
    () => [...items, ...(distractors ?? []).map((distractor) => ({ ...distractor }))],
    [distractors, items],
  )
  const initial = shuffled(all, 'items')

  // A list is already in *an* order the moment it is drawn, so that order is the answer until the
  // user changes it — including when they submit without touching anything.
  useEffect(() => {
    seedResponse({ order: initial.map((item) => item.id) })
  }, [initial, seedResponse])

  const answer: Response<'ordering'> = response ?? { order: initial.map((item) => item.id) }
  const ordered = answer.order
    .map((id) => all.find((item) => item.id === id))
    .filter((item): item is OrderingItem => item !== undefined)

  function reorder(from: number, to: number) {
    respond({ order: move(ordered, from, to).map((item) => item.id) })
  }

  return (
    <ol className="flex flex-col gap-2" data-testid="renderer-ordering">
      {ordered.map((item, index) => {
        const perItem = result?.perItem?.find((entry) => entry.id === item.id)
        return (
          <li
            key={item.id}
            data-testid={`ordering-item-${item.id}`}
            className={cn(
              'border-border flex items-center gap-2 rounded-md border p-2',
              perItem?.correct === true && 'border-correct bg-correct/10',
              perItem?.correct === false && 'border-incorrect bg-incorrect/10',
            )}
          >
            <span className="text-muted w-6 shrink-0 text-center text-xs tabular-nums">
              {index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <RichText className="text-sm">{item.text}</RichText>
              {item.date && <span className="text-muted text-xs">{item.date}</span>}
            </div>
            <IconButton
              variant="ghost"
              size="sm"
              disabled={locked || index === 0}
              aria-label={`${labels.moveUp}: ${item.text}`}
              data-testid={`move-up-${item.id}`}
              onClick={() => reorder(index, index - 1)}
            >
              <ChevronUpIcon />
            </IconButton>
            <IconButton
              variant="ghost"
              size="sm"
              disabled={locked || index === ordered.length - 1}
              aria-label={`${labels.moveDown}: ${item.text}`}
              data-testid={`move-down-${item.id}`}
              onClick={() => reorder(index, index + 1)}
            >
              <ChevronDownIcon />
            </IconButton>
          </li>
        )
      })}
    </ol>
  )
}
