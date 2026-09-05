import { cn } from '@retenia/ui'
import type { ReactNode } from 'react'
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
 *
 * A token carries its two forms separately — see {@link BankToken}. `ordering`, `pairs` and
 * `categorize` draw from `RichText` payload fields, so a bank that rendered `token.text` as a
 * bare string showed `**She**` and `$H_2O$` as source next to the same items rendered properly in
 * the answer area, and read the source out loud as well.
 */

export interface BankToken {
  id: string
  /**
   * The token as *text*: what a screen reader is given for it, in the `aria-label` of the
   * controls that act on it and in the drag layer's live region.
   *
   * A family whose payload field is `RichText` passes `toPlainText(source)` here and the rendered
   * form in `label`. Passing Markdown source would put it in an accessible name — *"Remove:
   * \*\*She\*\*"* — which is what `toPlainText` exists to prevent.
   */
  text: string
  /**
   * The rendered form, when it differs from `text` — `<RichText inline>` for a `RichText` field.
   * Left out by a family whose tokens are plain strings (`cloze`'s word bank), where running them
   * through Markdown would only risk mangling a literal `*` or `_`.
   */
  label?: ReactNode
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
              // Only when the two differ: a plain token's visible text *is* its name, and an
              // `aria-label` repeating it would be one more string to keep in step for nothing.
              {...(token.label === undefined ? {} : { ariaLabel: token.text })}
              className={cn(!singleUse && used.has(token.id) && 'opacity-50')}
            >
              {token.label ?? token.text}
            </DraggableItem>
          </li>
        ))}
      </ul>
      <p className="text-muted text-xs">{labels.dragKeyboardHint}</p>
    </div>
  )
}
