import { type ActivityCompletion, ActivityHost, emptyResponse } from '@retenia/activities'
import { type Activity, safeParseActivity } from '@retenia/activity-schema'
import {
  type Contract,
  type DiagnosticConfidenceDto,
  type DiagnosticEntryDto,
  type DiagnosticSectionDto,
  type DiagnosticStateDto,
  diagnosticConfidenceDtoSchema,
  type InferInput,
  type ItemBankStatusDto,
  type SelfAssessmentLevelDto,
} from '@retenia/ipc-contract'
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  cn,
  ErrorState,
  Progress,
  ProgressIndicator,
  ProgressTrack,
  Skeleton,
} from '@retenia/ui'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useT } from '../../i18n/use-t'
import { DiagnosticProgressHeader } from './components/diagnostic-progress-header'
import { SelfAssessmentForm, selfAssessmentOf } from './components/self-assessment-form'
import { useDiagnosticActivityLabels } from './diagnostic-labels'
import {
  isItemBankPending,
  useBuildItemBank,
  useDiagnostic,
  useDiagnosticAnswer,
  useDiagnosticFinish,
  useDiagnosticStart,
  useItemBank,
} from './use-pathgen'

/**
 * The prior-knowledge diagnostic (sub-phase 8.5; `docs/spec/04-path-generation.md` §10 and §13
 * step 4): "¿Cómo empezás?" → "Desde cero" or a per-section self-assessment → the adaptive
 * item loop, with a bar of remaining items, confidence per answer, and a way out at any time.
 *
 * Main owns the session. Every write answers with the next state, which this screen renders
 * as-is: which item comes next, when to stop, and what a stop means are all §10's algorithm,
 * not the renderer's. That includes grading — the host grades locally only because that is how
 * it completes; main re-grades from the raw `response` rather than trusting a verdict.
 *
 * Errors are never punished (`docs/spec/08-ux.md` §1): the host runs in `test` mode, so no
 * right/wrong is ever shown, and nothing on this screen counts misses.
 */

export interface DiagnosticPageProps {
  pathVersionId: string
  /** "Desde cero": nothing to summarise, straight on to the completion screen. */
  onDone: () => void
  /** The diagnostic finished — now or on an earlier visit — so its summary is next. */
  onResult: () => void
}

type DiagnosticAnswerInput = InferInput<Contract, 'pathgen.diagnosticAnswer'>

/** `pathgen.diagnosticAnswer`'s ceiling on `timeMs`: an hour on one item is a walk-away. */
const MAX_ITEM_MS = 3_600_000

function toTimeMs(ms: number): number {
  return Math.min(MAX_ITEM_MS, Math.max(0, Math.round(ms)))
}

/** The grade carries the confidence when the grader copied it; the response always does. */
function confidenceOf(completion: ActivityCompletion): DiagnosticConfidenceDto | null {
  const graded = diagnosticConfidenceDtoSchema.safeParse(completion.result?.meta.confidence)
  if (graded.success) return graded.data
  const { response } = completion
  if (typeof response !== 'object' || response === null || !('confidence' in response)) {
    return null
  }
  const answered = diagnosticConfidenceDtoSchema.safeParse(response.confidence)
  return answered.success ? answered.data : null
}

/** One host completion as `pathgen.diagnosticAnswer`'s input — a skip carries no response. */
export function answerFromCompletion(
  sessionId: string,
  attemptId: string,
  completion: ActivityCompletion,
): DiagnosticAnswerInput {
  const timeMs = toTimeMs(completion.durationMs)
  if (completion.outcome === 'skipped' || completion.result === null) {
    return { sessionId, attemptId, skipped: true, confidence: null, timeMs }
  }
  return {
    sessionId,
    attemptId,
    skipped: false,
    // An untouched item was graded by the host as its empty answer; main grades the same one.
    response: (completion.response ??
      emptyResponse(completion.activity)) as DiagnosticAnswerInput['response'],
    confidence: confidenceOf(completion),
    timeMs,
  }
}

/**
 * The served envelope, parsed, with §10 step 3's confidence switched on for a `choice` item —
 * a copy, so the cached DTO is never mutated. `null` when the stored activity does not parse.
 */
function prepareActivity(json: unknown): Activity | null {
  const parsed = safeParseActivity(json)
  if (!parsed.success) return null
  const activity = parsed.data
  if (activity.family !== 'choice') return activity
  return { ...activity, payload: { ...activity.payload, askConfidence: true } }
}

/** Time on the current item, restarted whenever a new one is served. Ticks once a second. */
function useItemClock(key: string | null): number {
  const [clock, setClock] = useState(() => {
    const now = Date.now()
    return { key, start: now, now }
  })
  useEffect(() => {
    const start = Date.now()
    setClock({ key, start, now: start })
    if (key === null) return
    const id = setInterval(() => setClock((current) => ({ ...current, now: Date.now() })), 1_000)
    return () => clearInterval(id)
  }, [key])
  return clock.key === key ? Math.max(0, clock.now - clock.start) : 0
}

function EntryChoice({
  title,
  hint,
  onClick,
  disabled,
  testId,
}: {
  title: string
  hint: string
  onClick: () => void
  disabled: boolean
  testId: string
}) {
  const titleId = useId()
  const hintId = useId()
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-labelledby={titleId}
      aria-describedby={hintId}
      data-testid={testId}
      className={cn(
        'bg-surface border-border shadow-soft flex flex-col items-start gap-2 rounded-lg border p-6 text-left',
        'duration-fast ease-standard hover:border-brand-500 transition-colors',
        'focus-visible:outline-brand-500 focus-visible:outline-2 focus-visible:outline-offset-2',
        'disabled:pointer-events-none disabled:opacity-50',
      )}
    >
      <span id={titleId} className="font-display text-lg font-semibold">
        {title}
      </span>
      <span id={hintId} className="text-muted text-sm">
        {hint}
      </span>
    </button>
  )
}

/** Stage 9 is still writing the questions, or failed to. Silent once the bank is usable. */
function ItemBankNotice({
  bank,
  onRetry,
  retrying,
}: {
  bank: ItemBankStatusDto
  onRetry: () => void
  retrying: boolean
}) {
  const t = useT('path')

  if (isItemBankPending(bank)) {
    const { total, built, short, failed } = bank.cells
    const settled = built + short + failed
    return (
      <Card data-testid="diagnostic-bank-waiting">
        <CardHeader>
          <CardTitle>{t('diagnostic.bank.building')}</CardTitle>
          <CardDescription>{t('diagnostic.bank.hint')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Progress
            value={total > 0 ? Math.round((settled / total) * 100) : null}
            aria-label={t('diagnostic.bank.building')}
          >
            <ProgressTrack>
              <ProgressIndicator />
            </ProgressTrack>
          </Progress>
          <p aria-live="polite" className="text-muted text-xs tabular-nums">
            {t('diagnostic.bank.progress', {
              done: settled,
              total,
              count: bank.diagnosticItems,
            })}
          </p>
        </CardContent>
      </Card>
    )
  }

  if (bank.state === 'failed') {
    return (
      <ErrorState
        data-testid="diagnostic-bank-failed"
        title={t('diagnostic.bank.failed')}
        description={t('diagnostic.bank.failedHint')}
        retryLabel={t('diagnostic.bank.retry')}
        {...(retrying ? {} : { onRetry })}
      />
    )
  }

  if (bank.diagnosticItems === 0) {
    return (
      <p className="text-muted text-sm" data-testid="diagnostic-bank-no-items">
        {t('diagnostic.bank.noItems')}
      </p>
    )
  }

  return null
}

interface DiagnosticEntryProps {
  pathVersionId: string
  sections: readonly DiagnosticSectionDto[]
  /** The bank as `diagnosticGet` saw it; superseded by the poll once that has answered. */
  seededBank: ItemBankStatusDto
  starting: boolean
  startFailed: boolean
  onScratch: () => void
  onPartial: (selfAssessment: Record<string, SelfAssessmentLevelDto>) => void
}

/** "¿Cómo empezás?" and the self-assessment — everything before the first item. */
function DiagnosticEntry({
  pathVersionId,
  sections,
  seededBank,
  starting,
  startFailed,
  onScratch,
  onPartial,
}: DiagnosticEntryProps) {
  const t = useT('path')
  const [step, setStep] = useState<'choose' | 'self'>('choose')
  const [levels, setLevels] = useState<Record<string, SelfAssessmentLevelDto>>({})
  const [rebuilt, setRebuilt] = useState(false)
  const polled = useItemBank(pathVersionId, {
    enabled: isItemBankPending(seededBank) || rebuilt,
  })
  const build = useBuildItemBank(pathVersionId)
  const bank = polled.data ?? seededBank
  // "Desde cero" never needs the bank; only the adaptive loop waits for its questions.
  const canBegin = bank.state === 'ready' || bank.state === 'partial'

  // A step change replaces the whole screen, so keyboard focus moves to its heading rather
  // than being left on a button that no longer exists.
  const headingRef = useRef<HTMLHeadingElement>(null)
  const firstStep = useRef(true)
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false
      return
    }
    if (step === 'choose' || step === 'self') headingRef.current?.focus()
  }, [step])

  const notice = (
    <ItemBankNotice
      bank={bank}
      retrying={build.isPending}
      onRetry={() => {
        setRebuilt(true)
        build.mutate({ pathVersionId })
      }}
    />
  )

  return (
    <div
      className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6"
      data-testid="diagnostic-entry"
    >
      {step === 'choose' ? (
        <>
          <header className="flex flex-col gap-1">
            <h1
              ref={headingRef}
              tabIndex={-1}
              className="font-display text-2xl font-semibold focus:outline-none"
            >
              {t('diagnostic.title')}
            </h1>
            <p className="text-muted text-sm">{t('diagnostic.subtitle')}</p>
          </header>
          <div className="grid gap-4 sm:grid-cols-2">
            <EntryChoice
              testId="diagnostic-scratch"
              title={t('diagnostic.entry.scratch')}
              hint={t('diagnostic.entry.scratchHint')}
              onClick={onScratch}
              disabled={starting}
            />
            <EntryChoice
              testId="diagnostic-partial"
              title={t('diagnostic.entry.partial')}
              hint={t('diagnostic.entry.partialHint')}
              onClick={() => setStep('self')}
              disabled={starting}
            />
          </div>
          {notice}
        </>
      ) : (
        <>
          <header className="flex flex-col gap-1">
            <h1
              ref={headingRef}
              tabIndex={-1}
              className="font-display text-2xl font-semibold focus:outline-none"
            >
              {t('diagnostic.self.title')}
            </h1>
            <p className="text-muted text-sm">{t('diagnostic.self.hint')}</p>
          </header>
          {notice}
          <SelfAssessmentForm
            sections={sections}
            levels={levels}
            onChange={(sectionId, level) =>
              setLevels((previous) => ({ ...previous, [sectionId]: level }))
            }
            disabled={starting}
          />
          <footer className="flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={() => setStep('choose')} disabled={starting}>
              {t('diagnostic.self.back')}
            </Button>
            <Button
              onClick={() => onPartial(selfAssessmentOf(sections, levels))}
              disabled={!canBegin || starting}
              data-testid="diagnostic-begin"
            >
              {t('diagnostic.self.begin')}
            </Button>
            {isItemBankPending(bank) && (
              <span className="text-muted text-sm">{t('diagnostic.self.waiting')}</span>
            )}
          </footer>
        </>
      )}
      {startFailed && (
        <p role="alert" className="text-incorrect text-sm">
          {t('diagnostic.startError')}
        </p>
      )}
    </div>
  )
}

/** §10 steps 2–7: one item at a time until main says stop, or the learner does. */
function DiagnosticLoop({
  pathVersionId,
  state,
}: {
  pathVersionId: string
  state: DiagnosticStateDto
}) {
  const t = useT('path')
  const labels = useDiagnosticActivityLabels()
  const answer = useDiagnosticAnswer(pathVersionId)
  const finish = useDiagnosticFinish(pathVersionId)
  const [confirmingFinish, setConfirmingFinish] = useState(false)
  const lastAnswer = useRef<DiagnosticAnswerInput | null>(null)

  const { item, progress } = state
  const sessionId = state.session.id
  const attemptId = item?.attemptId ?? null
  const itemMs = useItemClock(attemptId)
  const activity = useMemo(() => (item === null ? null : prepareActivity(item.activity)), [item])

  function send(input: DiagnosticAnswerInput) {
    lastAnswer.current = input
    answer.mutate(input)
  }

  // Each new item takes keyboard focus, so answering with the keyboard never means tabbing
  // back up from wherever the previous item's check button was.
  const itemRef = useRef<HTMLElement>(null)
  const firstItem = useRef(true)
  useEffect(() => {
    if (attemptId === null) return
    if (firstItem.current) {
      firstItem.current = false
      return
    }
    itemRef.current?.focus()
  }, [attemptId])

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6" data-testid="diagnostic-loop">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-display text-2xl font-semibold">{t('diagnostic.loop.title')}</h1>
          <Button
            variant="outline"
            size="sm"
            // Not while an answer is in flight: "Terminar ahora" must finish after it, never
            // race it.
            disabled={answer.isPending}
            onClick={() => setConfirmingFinish(true)}
            data-testid="diagnostic-finish"
          >
            {t('diagnostic.loop.finish')}
          </Button>
        </div>
        <DiagnosticProgressHeader
          asked={progress.asked}
          remaining={progress.remaining}
          elapsedMs={progress.elapsedMs + itemMs}
        />
      </header>

      <section
        ref={itemRef}
        tabIndex={-1}
        aria-label={t('diagnostic.loop.itemLabel', { number: progress.asked + 1 })}
        className="focus:outline-none"
        data-testid="diagnostic-item"
      >
        {item === null ? (
          <p className="text-muted text-sm">{t('diagnostic.loop.noItem')}</p>
        ) : activity === null ? (
          // A stored item that no longer parses is a content bug; skipping it is always a
          // valid answer, so the learner is never stuck behind it.
          <Card>
            <CardHeader>
              <CardTitle>{t('diagnostic.loop.unparseable')}</CardTitle>
            </CardHeader>
            <CardFooterSkip
              label={t('diagnostic.loop.skipItem')}
              disabled={answer.isPending}
              onSkip={() =>
                send({
                  sessionId,
                  attemptId: item.attemptId,
                  skipped: true,
                  confidence: null,
                  timeMs: toTimeMs(itemMs),
                })
              }
            />
          </Card>
        ) : (
          <ActivityHost
            // A new attempt is a new machine: the previous item's `completed` state must not
            // carry over, and `onComplete` fires once per mount.
            key={item.attemptId}
            activity={activity}
            mode="test"
            seed={item.seed}
            labels={labels}
            // The header's clock covers the whole diagnostic; a second one per item is noise.
            showTimer={false}
            onComplete={(completion) =>
              send(answerFromCompletion(sessionId, item.attemptId, completion))
            }
          />
        )}
      </section>

      <p
        aria-live="polite"
        className="text-muted min-h-5 text-sm"
        data-testid="diagnostic-answer-status"
      >
        {answer.isPending
          ? t('diagnostic.loop.saving')
          : answer.isSuccess
            ? t('diagnostic.loop.saved')
            : ''}
      </p>

      {answer.isError && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-incorrect">{t('diagnostic.loop.saveError')}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (lastAnswer.current !== null) answer.mutate(lastAnswer.current)
            }}
          >
            {t('diagnostic.loop.retry')}
          </Button>
        </div>
      )}

      {finish.isError && (
        <p role="alert" className="text-incorrect text-sm">
          {t('diagnostic.loop.finishError')}
        </p>
      )}

      <ConfirmDialog
        open={confirmingFinish}
        onOpenChange={setConfirmingFinish}
        title={t('diagnostic.loop.finishTitle')}
        description={t('diagnostic.loop.finishDescription')}
        confirmLabel={t('diagnostic.loop.finishConfirm')}
        cancelLabel={t('diagnostic.loop.finishCancel')}
        confirming={finish.isPending}
        onConfirm={() =>
          finish.mutate({ sessionId }, { onError: () => setConfirmingFinish(false) })
        }
      />
    </div>
  )
}

function CardFooterSkip({
  label,
  disabled,
  onSkip,
}: {
  label: string
  disabled: boolean
  onSkip: () => void
}) {
  return (
    <CardContent>
      <Button variant="outline" onClick={onSkip} disabled={disabled}>
        {label}
      </Button>
    </CardContent>
  )
}

export function DiagnosticPage({ pathVersionId, onDone, onResult }: DiagnosticPageProps) {
  const t = useT('path')
  const diagnostic = useDiagnostic(pathVersionId)
  const start = useDiagnosticStart(pathVersionId)

  // Refs rather than effect dependencies: the route passes fresh arrow functions on every
  // render, and the hand-over must happen exactly once.
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone
  const onResultRef = useRef(onResult)
  onResultRef.current = onResult
  const entryRef = useRef<DiagnosticEntryDto | null>(null)
  const handedOver = useRef(false)

  const state = diagnostic.data?.state ?? null
  const finished =
    state !== null &&
    (state.session.status === 'completed' || (state.item === null && state.result !== null))

  // The one way into the summary: a session found finished on arrival, the last answer, or
  // "Terminar ahora" all land here. "Desde cero" also finishes at once, but it has nothing to
  // summarise and hands over through `onDone` instead.
  useEffect(() => {
    if (!finished || handedOver.current || entryRef.current === 'scratch') return
    handedOver.current = true
    onResultRef.current()
  }, [finished])

  function startScratch() {
    entryRef.current = 'scratch'
    start.mutate(
      { pathVersionId, entry: 'scratch', selfAssessment: {} },
      {
        onSuccess: () => {
          handedOver.current = true
          onDoneRef.current()
        },
        onError: () => {
          entryRef.current = null
        },
      },
    )
  }

  function startPartial(selfAssessment: Record<string, SelfAssessmentLevelDto>) {
    entryRef.current = 'partial'
    start.mutate({ pathVersionId, entry: 'partial', selfAssessment })
  }

  let content: React.ReactNode
  if (diagnostic.isLoading || finished) {
    content = <Skeleton className="m-6 h-64" data-testid="diagnostic-loading" />
  } else if (diagnostic.error || !diagnostic.data) {
    content = (
      <ErrorState
        className="m-6"
        title={t('diagnostic.loadError')}
        retryLabel={t('diagnostic.retry')}
        onRetry={() => void diagnostic.refetch()}
      />
    )
  } else if (state !== null) {
    content = <DiagnosticLoop pathVersionId={pathVersionId} state={state} />
  } else {
    content = (
      <DiagnosticEntry
        pathVersionId={pathVersionId}
        sections={diagnostic.data.sections}
        seededBank={diagnostic.data.itemBank}
        starting={start.isPending}
        startFailed={start.isError}
        onScratch={startScratch}
        onPartial={startPartial}
      />
    )
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto" data-testid="diagnostic-page">
      {content}
    </div>
  )
}
