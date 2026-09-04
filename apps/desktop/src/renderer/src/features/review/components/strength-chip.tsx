import { MemoryStrengthBar, Tooltip, TooltipContent, TooltipTrigger } from '@retenia/ui'
import { useT } from '../../../i18n/use-t'
import type { ReviewEntryDto } from '../use-review-session'

export interface StrengthChipProps {
  entry: Extract<ReviewEntryDto, { kind: 'exam' | 'due' | 'relearning' | 'new' }>
}

/** §1.3's strength chip: "R 82 % · S 31 d" with a popover explaining why the card is here
 *  today (`docs/spec/02-memory-system.md` §7 rule 6, "the scheduler is transparent"). */
export function StrengthChip({ entry }: StrengthChipProps) {
  const t = useT('review')
  const bandLabels = {
    critical: t('strength.bands.critical'),
    weak: t('strength.bands.weak'),
    good: t('strength.bands.good'),
    strong: t('strength.bands.strong'),
  }
  const why =
    entry.kind === 'new'
      ? t('screen.why.new')
      : entry.kind === 'relearning'
        ? t('screen.why.relearning')
        : entry.kind === 'exam'
          ? t('screen.why.exam')
          : t('screen.why.due', { stability: Math.round(entry.card.stability) })

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            data-testid="strength-chip"
            className="focus-visible:outline-brand-500 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2"
          />
        }
      >
        <MemoryStrengthBar
          retrievability={entry.retrievability}
          stability={entry.card.stability}
          bandLabels={bandLabels}
          className="min-w-40"
        />
      </TooltipTrigger>
      <TooltipContent data-testid="strength-chip-popover">{why}</TooltipContent>
    </Tooltip>
  )
}
