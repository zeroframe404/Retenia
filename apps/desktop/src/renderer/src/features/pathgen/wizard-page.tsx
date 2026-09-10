import {
  Button,
  CostBadge,
  EmptyState,
  Input,
  Progress,
  ProgressIndicator,
  ProgressTrack,
  Stepper,
} from '@retenia/ui'
import { useEffect, useMemo, useState } from 'react'
import { useT } from '../../i18n/use-t'
import { useSources } from '../library/use-library'
import {
  useCancelGeneration,
  useGenerationProgress,
  useQuote,
  useStartGeneration,
} from './use-pathgen'

/**
 * "Generate with AI" step 1–2: the template panel and the live estimate, then progress by
 * stage (`docs/spec/04-path-generation.md` §13 steps 1–2).
 */

export interface WizardPageProps {
  /** Called once a run finishes with a frozen-eligible draft, so the shell can move to the
   *  preview. */
  onGenerated: (input: { runId: string; pathVersionId: string }) => void
}

const STEP_IDS = ['configure', 'generating'] as const

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return debounced
}

export function WizardPage({ onGenerated }: WizardPageProps) {
  const t = useT('path')
  const sources = useSources()
  const quote = useQuote()
  const start = useStartGeneration()
  const cancel = useCancelGeneration()

  const [goal, setGoal] = useState('')
  const [level, setLevel] = useState('')
  const [paceHoursPerWeek, setPaceHoursPerWeek] = useState(3)
  const [primarySourceId, setPrimarySourceId] = useState('')
  const [forExamDate, setForExamDate] = useState('')
  const [runId, setRunId] = useState<string | undefined>(undefined)

  const progress = useGenerationProgress(runId)
  const ready = sources.data?.sources.filter((source) => source.status === 'ready') ?? []

  // The wizard generates from one primary source for now; picking additional sources and a
  // per-chapter scope (§13 step 1's "scope: everything / chapters") is left for a follow-up —
  // `generationConfigInputSchema` already accepts more `sourceIds` when that UI lands.
  const sourceIds = useMemo(
    () => (primarySourceId === '' ? [] : [primarySourceId]),
    [primarySourceId],
  )

  const config = useMemo(
    () =>
      goal.trim() === '' || level.trim() === '' || primarySourceId === ''
        ? null
        : {
            goal,
            level,
            paceHoursPerWeek,
            primarySourceId,
            sourceIds,
            ...(forExamDate === '' ? {} : { forExam: { date: forExamDate } }),
          },
    [goal, level, paceHoursPerWeek, primarySourceId, sourceIds, forExamDate],
  )
  const debouncedConfig = useDebounced(config, 400)

  const { mutate: runQuote } = quote
  useEffect(() => {
    if (debouncedConfig === null) return
    runQuote({ config: debouncedConfig })
  }, [debouncedConfig, runQuote])

  const estimate = quote.data?.estimate
  const currentStepIndex = runId === undefined ? 0 : 1

  const handleGenerate = (): void => {
    if (config === null) return
    start.mutate(
      { config },
      {
        onSuccess: (result) => {
          setRunId(result.runId)
          if (result.status === 'completed' && result.pathVersionId !== null) {
            onGenerated({ runId: result.runId, pathVersionId: result.pathVersionId })
          }
        },
      },
    )
  }

  if (sources.isLoading) return null
  if (ready.length === 0) {
    return (
      <EmptyState
        title={t('wizard.noSources.title')}
        description={t('wizard.noSources.description')}
      />
    )
  }

  return (
    <div className="flex h-full flex-col gap-6 p-6" data-testid="pathgen-wizard">
      <Stepper
        steps={STEP_IDS.map((id) => ({ id, label: t(`wizard.step.${id}`) }))}
        currentIndex={currentStepIndex}
      />

      {runId === undefined ? (
        <div className="flex max-w-xl flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm" htmlFor="wizard-goal-input">
            {t('wizard.goal')}
            <Input
              id="wizard-goal-input"
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              placeholder={t('wizard.goalPlaceholder')}
              data-testid="wizard-goal"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm" htmlFor="wizard-level-input">
            {t('wizard.level')}
            <Input
              id="wizard-level-input"
              value={level}
              onChange={(event) => setLevel(event.target.value)}
              placeholder={t('wizard.levelPlaceholder')}
              data-testid="wizard-level"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm" htmlFor="wizard-primary-source-input">
            {t('wizard.primarySource')}
            <select
              id="wizard-primary-source-input"
              value={primarySourceId}
              onChange={(event) => setPrimarySourceId(event.target.value)}
              data-testid="wizard-primary-source"
              className="border-border bg-surface text-text h-10 rounded-md border px-3 text-sm"
            >
              <option value="">{t('wizard.selectSource')}</option>
              {ready.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.title}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm" htmlFor="wizard-pace-input">
            {t('wizard.pace')}
            <Input
              id="wizard-pace-input"
              type="number"
              min={0.5}
              max={60}
              step={0.5}
              value={paceHoursPerWeek}
              onChange={(event) => setPaceHoursPerWeek(Number(event.target.value))}
              data-testid="wizard-pace"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm" htmlFor="wizard-exam-date-input">
            {t('wizard.examDate')}
            <Input
              id="wizard-exam-date-input"
              type="date"
              value={forExamDate}
              onChange={(event) => setForExamDate(event.target.value)}
              data-testid="wizard-exam-date"
            />
          </label>

          <div className="flex items-center gap-3">
            {estimate && (
              <CostBadge
                amountUsd={estimate.usd}
                data-testid="wizard-estimate"
                aria-label={t('generation.estimate.summary', {
                  minutes: estimate.minutes.high,
                  usd: estimate.usd.toFixed(2),
                })}
              />
            )}
            {estimate && estimate.dispatch === 'batch' && (
              <span className="text-muted text-xs">{t('generation.estimate.batchLatency')}</span>
            )}
          </div>

          <Button
            onClick={handleGenerate}
            disabled={config === null || start.isPending}
            data-testid="wizard-generate"
          >
            {t('wizard.generate')}
          </Button>
        </div>
      ) : (
        <div className="flex max-w-xl flex-col gap-4" data-testid="pathgen-progress">
          <p className="text-sm">
            {progress
              ? t(`generation.stage.${progress.stage}`, progress)
              : t('generation.status.queued')}
          </p>
          <Progress
            value={progress ? (progress.total > 0 ? (progress.done / progress.total) * 100 : 0) : 0}
          >
            <ProgressTrack>
              <ProgressIndicator />
            </ProgressTrack>
          </Progress>
          <Button
            variant="outline"
            onClick={() => runId !== undefined && cancel.mutate({ runId })}
            data-testid="wizard-cancel"
          >
            {t('wizard.cancel')}
          </Button>
        </div>
      )}
    </div>
  )
}
