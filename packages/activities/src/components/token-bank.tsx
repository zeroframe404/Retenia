import { cn } from '@retenia/ui'
import { useActivity } from '../host/activity-context'
import { DraggableItem } from './drag-layer'

/**
 * The pool of movable tokens a placement family draws from: the word bank of `cloze_wordbank`, the
 * right column of `matching_pairs`, the unsorted items of `categorize`, the token pile of
 * `sentence_builder`.
 *
 * Order comes from the host's deterministic shuffle (§9), so the bank looks the same on a resumed
 * session and a Storybook snapshot; `singleUse` mirrors §7's `singleUseDraggables`, hiding a token
 * once it has been placed instead of letting it fill two gaps.
 */

export interface BankToken {
  id: string
  text: string
}

export interface TokenBankProps {
  tokens: readonly BankToken[]
  /** Ids already placed elsewhere: greyed out, or hidden when `singleUse`. */
  usedIds?: readonly string[]
  singleUse?: boolean
  heading?: string
  className?: string
  'data-testid'?: string
}

export function TokenBank({
  tokens,
  usedIds = [],
  singleUse = false,
  heading,
  className,
  'data-testid': testId = 'token-bank',
}: TokenBankProps) {
  const { labels } = useActivity()
  const used = new Set(usedIds)
  const visible = singleUse ? tokens.filter((token) => !used.has(token.id)) : tokens

  return (
    <div className={cn('flex flex-col gap-2', className)} data-testid={testId}>
      <p className="text-muted text-xs font-medium uppercase tracking-wide">
        {heading ?? labels.unplacedHeading}
      </p>
      <ul className="flex flex-wrap gap-2">
        {visible.map((token) => (
          <li key={token.id}>
            <DraggableItem
              id={token.id}
              className={cn(!singleUse && used.has(token.id) && 'opacity-50')}
            >
              {token.text}
            </DraggableItem>
          </li>
        ))}
      </ul>
      <p className="text-muted text-xs">{labels.dragKeyboardHint}</p>
    </div>
  )
}
