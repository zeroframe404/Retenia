import type { ImportanceLevel } from '@retenia/core'
import { Slider, SliderControl, SliderIndicator, SliderThumb, SliderTrack } from '@retenia/ui'
import { useT } from '../../i18n/use-t'
import { useLevelWorkload } from './use-scheduler'

/**
 * One importance level's target-retention slider, with what it costs beside it.
 *
 * This is where §7's central promise is kept — "how much this will cost me in reviews"
 * accompanies every importance decision. The figure is not read off §7's table of interval
 * ratios: that table divides two intervals at a fixed stability, while this simulates the
 * user's own parameters over a real horizon, so it accounts for the lapses a low retention
 * causes and the stability all those extra reviews accumulate at a high one.
 *
 * The simulation runs in the renderer, on every drag frame, because §6's simulator is pure
 * TypeScript in `@retenia/core`.
 */

function formatRetention(value: number): string {
  return `${(value * 100).toFixed(0)}%`
}

export interface RetentionLevelRowProps {
  level: ImportanceLevel
  retention: number
  /** The 21 parameters in force, so the cost is quoted against the user's own model. */
  w: readonly number[] | undefined
  onChange: (value: number) => void
}

export function RetentionLevelRow({ level, retention, w, onChange }: RetentionLevelRowProps) {
  const t = useT('settings')
  const workload = useLevelWorkload(w, retention)
  const label = t(`scheduler.levels.${level}`)

  return (
    <div className="flex flex-col gap-1.5" data-testid={`scheduler-level-${level}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-muted text-sm tabular-nums">{formatRetention(retention)}</span>
      </div>
      <Slider
        value={Math.round(retention * 100)}
        onValueChange={(value) => onChange((value as number) / 100)}
        min={70}
        max={99}
        step={1}
      >
        <SliderControl>
          <SliderTrack>
            <SliderIndicator />
            {/* The accessible name has to reach the hidden `<input type="range">` Base UI
             * renders inside the thumb; `aria-label` on `Slider.Root` lands on its outer
             * `<div>`, which axe-core's `aria-input-field-name` rule flags. */}
            <SliderThumb getAriaLabel={() => label} />
          </SliderTrack>
        </SliderControl>
      </Slider>
      {/* §7: "how much this will cost me in reviews" accompanies every importance
       * decision. Simulated against the profile in force, not read off a table. */}
      <p className="text-muted text-xs tabular-nums">
        {t('scheduler.cost', {
          reviews: workload.reviewsPerDay.toFixed(1),
          minutes: workload.minutesPerDay.toFixed(1),
          ratio: workload.ratio.toFixed(2),
        })}
      </p>
    </div>
  )
}
