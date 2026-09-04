import { Button, Kbd } from '@retenia/ui'
import { useT } from '../../../i18n/use-t'
import type { ReviewGrade, ReviewPreviewDto } from '../use-review-session'

export interface GradeButtonsProps {
  preview: ReviewPreviewDto
  /** Two-button mode: Forgot/Remembered → Again/Good (§6 "Mochi"), a `review.simpleGrading`
   *  setting. */
  simple: boolean
  disabled?: boolean
  onGrade: (grade: ReviewGrade) => void
}

const GRADE_STYLES: Record<
  ReviewGrade,
  { variant: 'destructive' | 'outline' | 'secondary' | 'primary' }
> = {
  1: { variant: 'destructive' },
  2: { variant: 'outline' },
  3: { variant: 'secondary' },
  4: { variant: 'primary' },
}

function intervalFor(preview: ReviewPreviewDto, grade: ReviewGrade): number | null {
  return preview?.find((entry) => entry.grade === grade)?.scheduledDays ?? null
}

/** The four FSRS buttons (or the two-button simple mode), each showing `Scheduler.preview`'s
 *  next interval under it (`docs/spec/02-memory-system.md` §1.3, §7 rule 6). */
export function GradeButtons({ preview, simple, disabled, onGrade }: GradeButtonsProps) {
  const t = useT('review')

  function interval(grade: ReviewGrade): string {
    const days = intervalFor(preview, grade)
    return days === null ? '' : t('screen.nextIntervalDays', { days })
  }

  if (simple) {
    return (
      <div className="grid grid-cols-2 gap-3" data-testid="grade-buttons-simple">
        <Button
          variant="destructive"
          size="lg"
          disabled={disabled}
          onClick={() => onGrade(1)}
          data-testid="grade-again-simple"
          className="flex-col gap-1 py-3"
        >
          <span>{t('screen.simpleGrades.again')}</span>
          <span className="text-xs font-normal opacity-80">{interval(1)}</span>
        </Button>
        <Button
          variant="primary"
          size="lg"
          disabled={disabled}
          onClick={() => onGrade(3)}
          data-testid="grade-good-simple"
          className="flex-col gap-1 py-3"
        >
          <span>{t('screen.simpleGrades.good')}</span>
          <span className="text-xs font-normal opacity-80">{interval(3)}</span>
        </Button>
      </div>
    )
  }

  const grades: ReviewGrade[] = [1, 2, 3, 4]
  return (
    <div className="grid grid-cols-4 gap-3" data-testid="grade-buttons">
      {grades.map((grade) => (
        <Button
          key={grade}
          variant={GRADE_STYLES[grade].variant}
          size="lg"
          disabled={disabled}
          onClick={() => onGrade(grade)}
          data-testid={`grade-${grade}`}
          className="flex-col gap-1 py-3"
        >
          <span className="flex items-center gap-1.5">
            {t(`screen.grades.${grade}`)}
            <Kbd>{grade}</Kbd>
          </span>
          <span className="text-xs font-normal opacity-80">{interval(grade)}</span>
        </Button>
      ))}
    </div>
  )
}
