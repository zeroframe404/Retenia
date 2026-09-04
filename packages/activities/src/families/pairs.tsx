import type { Response } from '@retenia/activity-schema'
import { useMemo } from 'react'
import { DragLayer, DropZone } from '../components/drag-layer'
import { RichText } from '../components/rich-text'
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
 */
export function Renderer() {
  const { activity, response, respond, shuffled, result } = useFamilyActivity('pairs')
  const { pairs, rightDistractors } = activity.payload
  const answer: Response<'pairs'> = response ?? { matches: [] }

  const bank = useMemo<BankToken[]>(
    () => [
      ...pairs.map((pair) => ({ id: pair.id, text: pair.right })),
      ...(rightDistractors ?? []).map((distractor) => ({
        id: distractor.id,
        text: distractor.text,
      })),
    ],
    [pairs, rightDistractors],
  )
  const shuffledBank = shuffled(bank, 'right')

  function place(rightId: string, leftId: string) {
    const matches = answer.matches.filter(
      (match) => match.left !== leftId && match.right !== rightId,
    )
    respond({ matches: [...matches, { left: leftId, right: rightId }] })
  }

  const textOf = (rightId: string) => bank.find((token) => token.id === rightId)?.text ?? ''

  return (
    <DragLayer onPlace={place}>
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
                  label={pair.left}
                  className={
                    perItem === undefined
                      ? undefined
                      : perItem.correct
                        ? 'border-correct bg-correct/10'
                        : 'border-incorrect bg-incorrect/10'
                  }
                >
                  <span data-testid={`match-${pair.id}`} className="text-sm">
                    {match ? textOf(match.right) : ' '}
                  </span>
                </DropZone>
              </li>
            )
          })}
        </ul>
        {/* Not `singleUse`: a matched right side stays in the bank, greyed out, so it can be
            picked back up and moved to another left side without an extra "remove" step. */}
        <TokenBank tokens={shuffledBank} usedIds={answer.matches.map((match) => match.right)} />
      </div>
    </DragLayer>
  )
}
