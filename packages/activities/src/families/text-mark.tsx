import type { Response } from '@retenia/activity-schema'
import { cn } from '@retenia/ui'
import { useFamilyActivity } from '../host/activity-context'

/**
 * The `text_mark` family (§7): `mark_the_words` — the learner highlights the tokens that match the
 * instruction.
 *
 * Each token is a toggle button with `aria-pressed`, so the passage is walkable with Tab and the
 * marked state is announced; that is also why the payload ships the passage pre-tokenized rather
 * than as prose the renderer would have to split (and split differently from the grader).
 */
export function Renderer() {
  const { activity, response, respond, locked, result } = useFamilyActivity('text_mark')
  const { tokens, correctIds } = activity.payload
  const answer: Response<'text_mark'> = response ?? { markedIds: [] }
  const marked = new Set(answer.markedIds)
  const graded = result !== null
  const correct = new Set(correctIds)

  function toggle(id: string) {
    respond({
      markedIds: marked.has(id)
        ? answer.markedIds.filter((candidate) => candidate !== id)
        : [...answer.markedIds, id],
    })
  }

  return (
    <p className="flex flex-wrap gap-1 text-sm leading-loose" data-testid="renderer-text_mark">
      {tokens.map((token) => {
        const isMarked = marked.has(token.id)
        const isCorrect = correct.has(token.id)
        return (
          <button
            key={token.id}
            type="button"
            disabled={locked}
            aria-pressed={isMarked}
            data-testid={`token-${token.id}`}
            onClick={() => toggle(token.id)}
            className={cn(
              'rounded px-1',
              'focus-visible:ring-brand-500 focus-visible:outline-none focus-visible:ring-2',
              isMarked && !graded && 'bg-brand-100 dark:bg-brand-900',
              graded && isCorrect && 'bg-correct/20 underline decoration-2',
              graded && isMarked && !isCorrect && 'bg-incorrect/20 line-through',
            )}
          >
            {token.text}
          </button>
        )
      })}
    </p>
  )
}
