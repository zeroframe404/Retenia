import { Card, Tooltip, TooltipContent, TooltipTrigger } from '@retenia/ui'
import { InfoIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export interface StatCardProps {
  title: string
  /** The one-sentence "why this number means what it means" behind the ⓘ.
   *  `docs/spec/01-decisions.md` §7.2: the scheduler is transparent, so every figure the
   *  app shows says what it is measuring. */
  help: string
  /** The headline figure. */
  value?: ReactNode
  /** A short line under it — the denominator, the window, the caveat. */
  caption?: ReactNode
  testId: string
  children?: ReactNode
}

/** One of the six panels of `docs/spec/02-memory-system.md` §13. */
export function StatCard({ title, help, value, caption, testId, children }: StatCardProps) {
  return (
    <Card className="flex flex-col gap-3 p-5" data-testid={testId}>
      <div className="flex items-start justify-between gap-2">
        <h2 className="font-display text-sm font-semibold">{title}</h2>
        <Tooltip>
          <TooltipTrigger
            // A real button so the explanation is reachable by keyboard, not just by hover.
            type="button"
            aria-label={help}
            className="text-muted hover:text-text focus-visible:ring-brand-500 rounded focus-visible:ring-2 focus-visible:outline-none"
          >
            <InfoIcon aria-hidden="true" className="size-4" />
          </TooltipTrigger>
          <TooltipContent className="max-w-72">{help}</TooltipContent>
        </Tooltip>
      </div>
      {value !== undefined && (
        <p
          className="font-display text-3xl font-semibold tabular-nums"
          data-testid={`${testId}-value`}
        >
          {value}
        </p>
      )}
      {caption !== undefined && <p className="text-muted text-xs">{caption}</p>}
      {children}
    </Card>
  )
}
