import type { OrderingItem, Response } from '@retenia/activity-schema'
import { cn, IconButton } from '@retenia/ui'
import { ChevronDownIcon, ChevronUpIcon, XIcon } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { DragLayer, DropZone, type PlacementContextValue } from '../components/drag-layer'
import { RichText, toPlainText } from '../components/rich-text'
import { type BankToken, TokenBank } from '../components/token-bank'
import { useFamilyActivity } from '../host/activity-context'
import { formatLabel } from '../labels'

/**
 * The `ordering` family (§7): `ordering_sequence` and `sentence_builder` in the MVP, plus
 * `timeline_build`, `anagram`, `parsons_problem`, `image_sequencing` and `listen_reconstruct`.
 *
 * **Two zones, one pool.** The tokens live either in the bank (available) or in the answer, and
 * only the ids in the answer are submitted. That is not cosmetic: `correctOrder` is validated to be
 * a permutation of `items` *alone* (`packages/activity-schema/src/validate/ordering.ts`), so an
 * `order` that still carries a distractor id can never equal a key — and `sentence_builder` and
 * `anagram` are forced to `scoring: 'exact'` by that same file, where `exactScore` starts by
 * comparing lengths. A renderer that submits every token, distractors included, therefore scores 0
 * on a perfectly built sentence. Deciding which tokens belong *is* the exercise when there are
 * distractors, and the answer area is where that decision is recorded.
 *
 * **Every action has a keyboard form and a pointer form.** Placing reuses the select-then-place
 * model of `components/drag-layer.tsx` that `cloze` and `categorize` already use — pick a token up
 * with Enter (or drag it), then the answer area's "place here" button — so this family adds no
 * second interaction idiom. Reordering keeps the Move-up / Move-down buttons, which is the pattern
 * H5P's own Sort-the-Paragraphs falls back to and the one a screen-reader user can actually follow;
 * removing is one more button per row, next to them. The answer is an `<ol>`, so the position is
 * announced without any ARIA of our own.
 *
 * **`item.text` is `RichText`, so it is used in two forms and never in one.** `<RichText>` draws
 * it — in the answer area and, `inline`, on the bank token — and `toPlainText` names it, in the
 * three `aria-label`s and in every announcement. Handing the source to either half is what made
 * the bank show a literal `**She**` next to a properly bolded one in the answer, and made a screen
 * reader read out *"«$H_2O$» picked up"*.
 */

/** The answer area's single drop target: a token placed there is appended to the order. */
const ANSWER_ZONE = 'answer'

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

  // Items and distractors are one pool of tokens — §7 calls a distractor an item "that belongs
  // nowhere", and nothing on screen may give it away — so they are shuffled together, under the
  // key the family has always used.
  const pool = useMemo<OrderingItem[]>(
    () => [...items, ...(distractors ?? [])],
    [distractors, items],
  )
  const shuffledPool = shuffled(pool, 'items')

  /**
   * Whether the answer area starts full or empty — the one decision this renderer has to take.
   *
   * **No distractors:** every token belongs in the answer, so the list is pre-seeded in the
   * shuffled order. A list is already in *an* order the moment it is drawn, so that order is the
   * answer until the user changes it — including when they submit without touching anything. That
   * is the behaviour `ordering_sequence` has always had and the graders' near-miss metrics
   * (adjacent pairs, Kendall τ, position) are written for.
   *
   * **With distractors:** it starts empty, and pre-seeding would be wrong twice over. It would
   * seed an answer that no key can match (see the note at the top), and it would hand the learner
   * the answer to the question the distractors ask — *which* of these tokens belong at all.
   */
  const preSeeded = (distractors ?? []).length === 0
  const initialOrder = useMemo(
    () => (preSeeded ? shuffledPool.map((item) => item.id) : []),
    [preSeeded, shuffledPool],
  )

  useEffect(() => {
    seedResponse({ order: initialOrder })
  }, [initialOrder, seedResponse])

  const answer: Response<'ordering'> = response ?? { order: initialOrder }
  const ordered = answer.order
    .map((id) => pool.find((item) => item.id === id))
    .filter((item): item is OrderingItem => item !== undefined)

  const placed = new Set(ordered.map((item) => item.id))
  const available: BankToken[] = shuffledPool
    .filter((item) => !placed.has(item.id))
    .map((item) => ({
      id: item.id,
      text: toPlainText(item.text),
      label: <RichText inline>{item.text}</RichText>,
    }))

  /**
   * A reorder is a change to the answer that nothing else reports: the row does not move focus and
   * the live region would otherwise still be describing the placement before it. The button that
   * was pressed is also disabled at the ends of the list, which drops focus to `<body>`, so the
   * request names both directions and the layer takes the first one that is still enabled.
   */
  function reorder(item: OrderingItem, from: number, to: number, placement: PlacementContextValue) {
    const next = move(ordered, from, to)
    respond({ order: next.map((entry) => entry.id) })
    placement.announce(
      formatLabel(labels.movedAnnouncement, {
        item: toPlainText(item.text),
        position: to + 1,
        total: next.length,
      }),
    )
    const up = `[data-testid="move-up-${item.id}"]`
    const down = `[data-testid="move-down-${item.id}"]`
    placement.focusAfterUpdate(to < from ? [up, down] : [down, up])
  }

  // Appended, not inserted at a cursor: the answer is built left to right and then tuned with the
  // move buttons, which keeps one reordering control instead of two competing ones.
  function placeToken(itemId: string) {
    if (placed.has(itemId)) return
    respond({ order: [...answer.order, itemId] })
  }

  function removeToken(item: OrderingItem, placement: PlacementContextValue) {
    respond({ order: answer.order.filter((id) => id !== item.id) })
    placement.reportRemoval({
      itemId: item.id,
      itemName: toPlainText(item.text),
      zoneId: ANSWER_ZONE,
    })
  }

  return (
    <DragLayer onPlace={placeToken}>
      {(placement) => (
        <div className="flex flex-col gap-4" data-testid="renderer-ordering">
          <div className="flex flex-col gap-2">
            <p className="text-muted text-xs font-medium uppercase tracking-wide">
              {labels.answerAreaHeading}
            </p>
            <DropZone id={ANSWER_ZONE} label={labels.answerAreaHeading} className="min-h-14">
              <ol className="flex flex-col gap-2" data-testid="ordering-answer">
                {ordered.map((item, index) => {
                  const perItem = result?.perItem?.find((entry) => entry.id === item.id)
                  const name = toPlainText(item.text)
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
                        aria-label={`${labels.moveUp}: ${name}`}
                        data-testid={`move-up-${item.id}`}
                        onClick={() => reorder(item, index, index - 1, placement)}
                      >
                        <ChevronUpIcon />
                      </IconButton>
                      <IconButton
                        variant="ghost"
                        size="sm"
                        disabled={locked || index === ordered.length - 1}
                        aria-label={`${labels.moveDown}: ${name}`}
                        data-testid={`move-down-${item.id}`}
                        onClick={() => reorder(item, index, index + 1, placement)}
                      >
                        <ChevronDownIcon />
                      </IconButton>
                      <IconButton
                        variant="ghost"
                        size="sm"
                        disabled={locked}
                        aria-label={`${labels.removePlacement}: ${name}`}
                        data-testid={`clear-${item.id}`}
                        onClick={() => removeToken(item, placement)}
                      >
                        <XIcon />
                      </IconButton>
                    </li>
                  )
                })}
              </ol>
            </DropZone>
          </div>
          {/* The bank is hidden while it is empty — which is every `ordering_sequence` until the
            learner takes a token back out — so a pure reordering keeps the screen it always had. */}
          {available.length > 0 && <TokenBank tokens={available} data-testid="ordering-bank" />}
        </div>
      )}
    </DragLayer>
  )
}
