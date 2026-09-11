import { cn } from '../lib/cn'
import { Badge, type BadgeProps } from './badge'

/**
 * The QA indicators of one generated lesson (`docs/spec/04-path-generation.md` §13 step 5:
 * *"each lesson with … QA indicators (fidelity, sources)"*, sub-phase 8.4): the fidelity
 * percentage, the number of sources it cites, and whether the gates are done with it.
 *
 * Presentational only — every string comes in as a prop, so the copy lives in
 * `packages/i18n` like the rest of the app's — and the colour bands are §5 gate 3's own
 * thresholds: ≥ 0.9 passed, 0.7–0.9 was sent to the editor, < 0.7 was regenerated.
 */

export type QaVerdict = 'pass' | 'fixed' | 'regenerated' | 'flagged'

/** §5 gate 3's thresholds, as the bands the fidelity badge colours by. */
export const FIDELITY_BANDS = Object.freeze({ pass: 0.9, edit: 0.7 })

export function fidelityVariant(faithfulness: number): NonNullable<BadgeProps['variant']> {
  if (faithfulness >= FIDELITY_BANDS.pass) return 'correct'
  if (faithfulness >= FIDELITY_BANDS.edit) return 'brand'
  return 'incorrect'
}

export interface QaBadgesLabels {
  /** `72 % fiel`. */
  fidelity: (percent: number) => string
  /** `3 fuentes`. */
  sources: (count: number) => string
  /** The gates ran and the lesson passed (possibly after an edit or a regeneration). */
  reviewed: string
  /** The gates ran and the lesson is below a threshold the user has to look at. */
  review: string
  /** The gates could not finish for this lesson. */
  unreviewed: string
}

export interface QaBadgesProps {
  /** 0–1, or `null` when the lesson made no cited claim. */
  faithfulness: number | null
  sourcesCount: number
  verdict: QaVerdict
  reviewed: boolean
  labels: QaBadgesLabels
  className?: string
}

export function QaBadges({
  faithfulness,
  sourcesCount,
  verdict,
  reviewed,
  labels,
  className,
}: QaBadgesProps) {
  const status: { variant: NonNullable<BadgeProps['variant']>; label: string } = !reviewed
    ? { variant: 'neutral', label: labels.unreviewed }
    : verdict === 'flagged'
      ? { variant: 'incorrect', label: labels.review }
      : { variant: 'correct', label: labels.reviewed }

  return (
    <span
      className={cn('inline-flex flex-wrap items-center gap-1', className)}
      data-testid="qa-badges"
    >
      {faithfulness !== null && (
        <Badge variant={fidelityVariant(faithfulness)} data-testid="qa-fidelity">
          {labels.fidelity(Math.round(faithfulness * 100))}
        </Badge>
      )}
      <Badge variant="outline" data-testid="qa-sources">
        {labels.sources(sourcesCount)}
      </Badge>
      <Badge variant={status.variant} data-testid="qa-status">
        {status.label}
      </Badge>
    </span>
  )
}
