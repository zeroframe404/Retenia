import { CheckIcon } from 'lucide-react'
import { cn } from '../lib/cn'

export interface StepperStep {
  id: string
  label: string
}

export interface StepperProps {
  steps: StepperStep[]
  /** Index of the current step (0-based). */
  currentIndex: number
  /** Called when a completed or the current step's control is activated — steppers are
   * usually one-way-forward, so wire this up only if going back is allowed. */
  onStepClick?: (index: number) => void
  className?: string
}

/** A linear wizard progress indicator — the "Generate with AI" wizard
 * (docs/spec/04-path-generation.md), onboarding, and multi-step forms. */
export function Stepper({ steps, currentIndex, onStepClick, className }: StepperProps) {
  return (
    <ol className={cn('flex w-full items-center', className)}>
      {steps.map((step, index) => {
        const status =
          index < currentIndex ? 'complete' : index === currentIndex ? 'current' : 'upcoming'
        const clickable = onStepClick && status !== 'upcoming'

        return (
          <li key={step.id} className="flex flex-1 items-center last:flex-none">
            <div className="flex flex-col items-center gap-1.5">
              <button
                type="button"
                disabled={!clickable}
                aria-current={status === 'current' ? 'step' : undefined}
                onClick={() => onStepClick?.(index)}
                className={cn(
                  'flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-medium',
                  'transition-colors duration-fast ease-standard disabled:cursor-default',
                  status === 'complete' && 'bg-brand-600 text-white',
                  status === 'current' && 'border-brand-600 text-brand-600 border-2',
                  status === 'upcoming' && 'bg-neutral-100 text-muted dark:bg-neutral-800',
                )}
              >
                {status === 'complete' ? (
                  <CheckIcon className="size-4" aria-hidden="true" />
                ) : (
                  index + 1
                )}
              </button>
              <span
                className={cn(
                  'w-max max-w-24 truncate text-xs font-medium',
                  status === 'upcoming' ? 'text-muted' : 'text-text',
                )}
              >
                {step.label}
              </span>
            </div>
            {index < steps.length - 1 && (
              <div
                aria-hidden="true"
                className={cn(
                  'mx-2 h-0.5 flex-1',
                  status === 'complete' ? 'bg-brand-600' : 'bg-neutral-200 dark:bg-neutral-800',
                )}
              />
            )}
          </li>
        )
      })}
    </ol>
  )
}
