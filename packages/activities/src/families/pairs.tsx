import type { Response } from '@retenia/activity-schema'
import { useMemo } from 'react'
import { DragLayer, DropZone, type PlacementContextValue } from '../components/drag-layer'
import { RichText, toPlainText } from '../components/rich-text'
import { type BankToken, TokenBank } from '../components/token-bank'
import { useFamilyActivity } from '../host/activity-context'

/**
 * The `pairs` family (§7): `matching_pairs` in the MVP, plus `matching_dropdown`, `image_pairing`,
 * `tap_pairs_timed` and `memory_game` later.
 *
 * The left sides are the drop zones and the right sides are the bank, so the grader's contract —
 * `matches[{left, right}]`, where a correct match has `right === left` because a pair's two halves
 * share its id — is what the UI produces directly. Distractors carry their own ids and therefore
 * match nothing, which is exactly how `gradePairs` scores them.
 *
 * Both halves of a pair are `RichText` (`packages/activity-schema/src/families/pairs.ts`), so each
 * is used in two forms: `<RichText>` renders it, and `toPlainText` names it wherever a *string* is
 * required — the drop zone's accessible name, the Remove button's, and the drag layer's
 * announcements. A raw `left` in `DropZone label` also reached the visible "Place here: …" button.
 */
export function Renderer() {
  const { activity, response, respond, locked, shuffled, result, labels } =
    useFamilyActivity('pairs')
  const { pairs, rightDistractors } = activity.payload
  const answer: Response<'pairs'> = response ?? { matches: [] }

  /** Every right side by id, in its `RichText` source form — the one both renderings start from. */
  const rightSides = useMemo(
    () =>
      new Map<string, string>([
        ...pairs.map((pair) => [pair.id, pair.right] as const),
        ...(rightDistractors ?? []).map((distractor) => [distractor.id, distractor.text] as const),
      ]),
    [pairs, rightDistractors],
  )

  const bank = useMemo<BankToken[]>(
    () =>
      [...rightSides].map(([id, source]) => ({
        id,
        text: toPlainText(source),
        label: <RichText inline>{source}</RichText>,
      })),
    [rightSides],
  )
  const shuffledBank = shuffled(bank, 'right')

  function place(rightId: string, leftId: string) {
    const matches = answer.matches.filter(
      (match) => match.left !== leftId && match.right !== rightId,
    )
    respond({ matches: [...matches, { left: leftId, right: rightId }] })
  }

  const sourceOf = (rightId: string) => rightSides.get(rightId) ?? ''
  const nameOf = (rightId: string) => toPlainText(sourceOf(rightId))

  /**
   * Unmatching a left side, the counterpart of `cloze`'s "Remove" and of `categorize`'s clickable
   * placed token. Moving a right side elsewhere already worked; taking it out and leaving the row
   * *empty* did not, so an answer the learner no longer believes in could only be replaced, never
   * withdrawn — and a deliberate blank is a legitimate answer the grader scores as such.
   *
   * It reports through the layer because this button unmounts with the match it removes: focus
   * would land on `<body>` and the live region would be left saying the right side is still placed.
   */
  function clear(leftId: string, rightId: string, placement: PlacementContextValue) {
    respond({ matches: answer.matches.filter((match) => match.left !== leftId) })
    placement.reportRemoval({ itemId: rightId, itemName: nameOf(rightId), zoneId: leftId })
  }

  return (
    <DragLayer onPlace={place}>
      {(placement) => (
        <div className="flex flex-col gap-4" data-testid="renderer-pairs">
          <ul className="flex flex-col gap-2">
            {shuffled(pairs, 'left').map((pair) => {
              const match = answer.matches.find((candidate) => candidate.left === pair.id)
              const perItem = result?.perItem?.find((item) => item.id === pair.id)
              return (
                <li key={pair.id} className="grid grid-cols-2 items-center gap-3">
                  <RichText className="text-sm">{pair.left}</RichText>
                  <DropZone
                    id={pair.id}
                    label={toPlainText(pair.left)}
                    className={
                      perItem === undefined
                        ? undefined
                        : perItem.correct
                          ? 'border-correct bg-correct/10'
                          : 'border-incorrect bg-incorrect/10'
                    }
                  >
                    <div className="flex items-center gap-2">
                      <span data-testid={`match-${pair.id}`} className="text-sm">
                        {match ? <RichText inline>{sourceOf(match.right)}</RichText> : ' '}
                      </span>
                      {match && !locked && (
                        <button
                          type="button"
                          onClick={() => clear(pair.id, match.right, placement)}
                          aria-label={`${labels.removePlacement}: ${nameOf(match.right)}`}
                          data-testid={`clear-${pair.id}`}
                          className="text-muted ml-auto text-xs underline"
                        >
                          {labels.removePlacement}
                        </button>
                      )}
                    </div>
                  </DropZone>
                </li>
              )
            })}
          </ul>
          {/* Not `singleUse`: a matched right side stays in the bank, greyed out, so it can be
              picked back up and moved to another left side without an extra "remove" step. */}
          <TokenBank tokens={shuffledBank} usedIds={answer.matches.map((match) => match.right)} />
        </div>
      )}
    </DragLayer>
  )
}
