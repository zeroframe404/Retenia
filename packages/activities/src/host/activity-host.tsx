import { Button, cn } from '@retenia/ui'
import { Suspense } from 'react'
import { FeedbackPanel } from '../components/feedback-panel'
import { HintButton } from '../components/hint-button'
import { RichText } from '../components/rich-text'
import { formatLabel } from '../labels'
import { findActivityType } from '../registry/registry'
import { ActivityProvider, useActivity } from './activity-context'
import { type UseActivityMachineOptions, useActivityMachine } from './use-activity-machine'

/**
 * `<ActivityHost/>` of `docs/spec/03-activities.md` §9.
 *
 * It owns everything §9 lists as the host's responsibility — the state machine, the deterministic
 * shuffle, the timer, attempts, hints with their penalty, per-option feedback, the "Explain"
 * button and the rating through `toRating` — and knows nothing about any single activity type: it
 * looks the renderer up in the registry by `activity.type` and mounts it inside a `<Suspense/>`,
 * because renderers are one lazy chunk per family.
 *
 * `mode` is the one thing that changes the chrome (§4 of the sub-phase brief):
 *
 * | | `study` / `review` | `test` |
 * |---|---|---|
 * | feedback | shown after each check | deferred to the end of the exam |
 * | hints | offered when the activity has them | never |
 * | timer | only with a `timeLimitSec` | always visible |
 * | after submitting | retry or continue | locked, the session moves on |
 */

export interface ActivityHostProps extends UseActivityMachineOptions {
  className?: string
}

export function ActivityHost({ className, ...options }: ActivityHostProps) {
  const value = useActivityMachine(options)
  return (
    <ActivityProvider value={value}>
      <ActivityShell className={className} />
    </ActivityProvider>
  )
}

function ElapsedTime() {
  const { elapsedMs, secondsLeft, labels } = useActivity()
  const seconds = secondsLeft ?? Math.floor(elapsedMs / 1000)
  const minutes = Math.floor(seconds / 60)
  return (
    <span
      role="timer"
      aria-label={labels.elapsed}
      data-testid="activity-timer"
      className={cn('text-muted text-xs tabular-nums', secondsLeft === 0 && 'text-incorrect')}
    >
      {minutes}:{String(seconds % 60).padStart(2, '0')}
    </span>
  )
}

function ActivityBody() {
  const { activity, labels } = useActivity()
  const entry = findActivityType(activity.type)
  if (!entry) {
    return (
      <p role="alert" data-testid="unsupported-type" className="text-muted text-sm">
        {labels.unsupportedType}
      </p>
    )
  }
  const { Renderer } = entry
  return (
    <Suspense
      fallback={
        <p data-testid="renderer-loading" className="text-muted text-sm">
          {labels.loadingRenderer}
        </p>
      }
    >
      <Renderer />
    </Suspense>
  )
}

function ActivityShell({ className }: { className?: string }) {
  const {
    activity,
    status,
    attempts,
    canSubmit,
    submit,
    skip,
    showTimer,
    deferFeedback,
    error,
    labels,
  } = useActivity()

  return (
    <article
      className={cn('flex flex-col gap-5', className)}
      data-testid="activity-host"
      data-status={status}
      data-type={activity.type}
      data-family={activity.family}
    >
      <header className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <RichText>{activity.prompt}</RichText>
          {activity.instructions && (
            <p className="text-muted mt-1 text-xs">{activity.instructions}</p>
          )}
        </div>
        {showTimer && <ElapsedTime />}
      </header>

      <ActivityBody />

      <HintButton />

      {error !== null && (
        <p role="alert" data-testid="grade-error" className="text-incorrect text-sm">
          {labels.gradeFailed}
        </p>
      )}

      {status === 'feedback' && <FeedbackPanel />}

      {status !== 'feedback' && status !== 'completed' && (
        <footer className="flex flex-wrap items-center gap-2">
          <Button onClick={() => submit()} disabled={!canSubmit} data-testid="check-button">
            {status === 'checking' ? labels.grading : labels.check}
          </Button>
          <Button variant="ghost" onClick={skip} data-testid="skip-button">
            {labels.skip}
          </Button>
          {attempts > 0 && (
            <span className="text-muted text-xs" data-testid="attempt-count">
              {formatLabel(labels.attemptsLabel, { attempt: attempts + 1 })}
            </span>
          )}
          {deferFeedback && (
            <span className="text-muted ml-auto text-xs" data-testid="deferred-feedback">
              {labels.deferredFeedback}
            </span>
          )}
        </footer>
      )}
    </article>
  )
}
