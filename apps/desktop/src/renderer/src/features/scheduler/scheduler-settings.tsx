import type { EasyDayLevel, ImportanceLevel, Weekday } from '@retenia/core'
import { Badge, Button, Switch } from '@retenia/ui'
import { useState } from 'react'
import { useT } from '../../i18n/use-t'
import { useSetting } from '../../ipc/use-setting'
import { RetentionLevelRow } from './retention-level-row'
import {
  DEFAULT_RETENTION,
  useApplyOptimization,
  useImportanceLevels,
  useSchedulerStatus,
  useSetLevel,
  useStartOptimization,
  useUpdateProfile,
} from './use-scheduler'

/**
 * Settings → Scheduler (`docs/spec/08-ux.md` §2: "DR per level, steps, easy days,
 * optimize").
 *
 * The screen exists to make §7's central promise concrete: the user sees what a retention
 * decision *costs* before making it, in reviews and minutes a day, simulated against the
 * parameters actually in force.
 */

const WEEKDAYS: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 0]
const EASY_DAY_CYCLE: readonly EasyDayLevel[] = ['normal', 'reduced', 'minimum']

/** `review.easyDays` on the wire: JSON turns the weekday numbers into string keys, and
 *  `useSetting` is generic over whatever the key holds. */
type EasyDayMap = Partial<Record<Weekday, EasyDayLevel>>

export function SchedulerSettings({ focused }: { focused: boolean }) {
  const t = useT('settings')
  const status = useSchedulerStatus()
  const levels = useImportanceLevels()
  const setLevel = useSetLevel()
  const updateProfile = useUpdateProfile()
  const startOptimization = useStartOptimization()
  const applyOptimization = useApplyOptimization()
  const loadBalance = useSetting<boolean>('review.loadBalance')
  const easyDays = useSetting<EasyDayMap>('review.easyDays')

  const [retentions, setRetentions] = useState<Partial<Record<ImportanceLevel, number>>>({})
  const [jobId, setJobId] = useState<string | null>(null)

  const profile = status.data?.profile
  const outcome = applyOptimization.data

  const retentionFor = (level: ImportanceLevel, stored: number | null): number =>
    retentions[level] ?? stored ?? DEFAULT_RETENTION

  const cycleEasyDay = (day: Weekday): void => {
    const current: EasyDayLevel = easyDays.value?.[day] ?? 'normal'
    const next = EASY_DAY_CYCLE[
      (EASY_DAY_CYCLE.indexOf(current) + 1) % EASY_DAY_CYCLE.length
    ] as EasyDayLevel
    const updated: EasyDayMap = { ...easyDays.value }
    if (next === 'normal') delete updated[day]
    else updated[day] = next
    void easyDays.set(updated)
  }

  return (
    <section
      data-testid="settings-scheduler"
      data-focused={focused}
      className="flex flex-col gap-5"
    >
      <h2 className="text-sm font-semibold">{t('scheduler.label')}</h2>

      {/* --- the model in force, and the optimizer (§6, §16) --- */}
      <div className="border-border flex flex-col gap-2 rounded-lg border p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">{t('scheduler.model.label')}</span>
          {status.data?.offer.offered === true ? (
            <Badge variant="brand">{t('scheduler.model.dueForOptimization')}</Badge>
          ) : null}
        </div>
        <p className="text-muted text-xs tabular-nums" data-testid="scheduler-model-quality">
          {profile?.trainedAt == null
            ? t('scheduler.model.never', { reviews: status.data?.nReviews ?? 0 })
            : t('scheduler.model.trained', {
                date: new Date(profile.trainedAt).toLocaleDateString(),
                reviews: profile.nReviews ?? 0,
                logLoss: (profile.logLoss ?? 0).toFixed(4),
                rmse: (profile.rmse ?? 0).toFixed(4),
              })}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={startOptimization.isPending || (status.data?.nReviews ?? 0) === 0}
            onClick={() => {
              startOptimization.mutate(undefined, {
                onSuccess: (result) => setJobId(result.job.id),
              })
            }}
          >
            {t('scheduler.model.optimizeNow')}
          </Button>
          {jobId !== null && outcome === undefined ? (
            <Button
              size="sm"
              variant="outline"
              disabled={applyOptimization.isPending}
              onClick={() => applyOptimization.mutate({ jobId, confirm: true })}
            >
              {t('scheduler.model.reviewResult')}
            </Button>
          ) : null}
        </div>

        {/* The results dialog of §16: log loss and RMSE before vs after, and whether the
         * health check kept the model. */}
        {outcome !== undefined ? (
          <div
            className="border-border mt-1 flex flex-col gap-1 rounded-md border p-3"
            data-testid="scheduler-optimizer-result"
            role="status"
          >
            <span className="text-sm font-medium">
              {outcome.applied ? t('scheduler.result.applied') : t('scheduler.result.rejected')}
            </span>
            <p className="text-muted text-xs tabular-nums">
              {t('scheduler.result.numbers', {
                beforeLogLoss: outcome.before.logLoss.toFixed(4),
                afterLogLoss: outcome.after.logLoss.toFixed(4),
                beforeRmse: outcome.before.rmse.toFixed(4),
                afterRmse: outcome.after.rmse.toFixed(4),
              })}
            </p>
            {/* §16 and §7 rule 2: applying changes the model, never the queue. */}
            <p className="text-muted text-xs">{t('scheduler.result.noReschedule')}</p>
          </div>
        ) : null}
      </div>

      {/* --- desired retention per importance level (§7) --- */}
      <div className="flex flex-col gap-4">
        <span className="text-sm font-medium">{t('scheduler.retention.label')}</span>
        {levels
          .filter((entry) => entry.desiredRetention !== null)
          .map((entry) => (
            <RetentionLevelRow
              key={entry.level}
              level={entry.level}
              retention={retentionFor(entry.level, entry.desiredRetention)}
              w={profile?.w}
              onChange={(value) => {
                setRetentions((previous) => ({ ...previous, [entry.level]: value }))
                setLevel.mutate({ level: entry.level, desiredRetention: value })
              }}
            />
          ))}
      </div>

      {/* --- steps, fuzz and the load balancer (§4, §15) --- */}
      <div className="flex flex-col gap-3">
        <span className="text-sm font-medium">{t('scheduler.steps.label')}</span>
        <p className="text-muted text-xs">
          {t('scheduler.steps.value', {
            learning: (profile?.learningSteps ?? []).join(' '),
            relearning: (profile?.relearningSteps ?? []).join(' '),
          })}
        </p>
        <div className="flex items-center justify-between gap-4 text-sm">
          <span id="scheduler-fuzz-label">{t('scheduler.fuzz.label')}</span>
          <Switch
            checked={profile?.enableFuzz ?? true}
            onCheckedChange={(checked) => updateProfile.mutate({ enableFuzz: checked })}
            aria-labelledby="scheduler-fuzz-label"
          />
        </div>
        <div className="flex items-center justify-between gap-4 text-sm">
          <span id="scheduler-load-balance-label">{t('scheduler.loadBalance.label')}</span>
          <Switch
            checked={loadBalance.value ?? true}
            onCheckedChange={(checked) => void loadBalance.set(checked)}
            aria-labelledby="scheduler-load-balance-label"
          />
        </div>
        <p className="text-muted text-xs">{t('scheduler.loadBalance.help')}</p>
      </div>

      {/* --- easy days (§4) --- */}
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">{t('scheduler.easyDays.label')}</span>
        <p className="text-muted text-xs">{t('scheduler.easyDays.help')}</p>
        <div className="flex flex-wrap gap-2">
          {WEEKDAYS.map((day) => {
            const level: EasyDayLevel = easyDays.value?.[day] ?? 'normal'
            return (
              <Button
                key={day}
                size="sm"
                variant={level === 'normal' ? 'outline' : 'primary'}
                onClick={() => cycleEasyDay(day)}
                aria-label={`${t(`scheduler.weekdays.${day}`)}: ${t(`scheduler.easyDays.${level}`)}`}
              >
                {t(`scheduler.weekdays.${day}`)}
                {level === 'normal' ? '' : ` · ${t(`scheduler.easyDays.${level}`)}`}
              </Button>
            )
          })}
        </div>
      </div>
    </section>
  )
}
