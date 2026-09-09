import type { ProviderRoleDto, SecretName } from '@retenia/ipc-contract'
import { PROVIDER_ROLE_VALUES } from '@retenia/ipc-contract'
import {
  AiUnavailableNotice,
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Progress,
  ProgressIndicator,
  ProgressTrack,
  SecretInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from '@retenia/ui'
import { HistogramChart } from '@retenia/ui/charts'
import { useState } from 'react'
import { useT } from '../../../i18n/use-t'
import { useIpcEvent, useIpcMutation, useIpcQuery } from '../../../ipc/hooks'
import { useSetting } from '../../../ipc/use-setting'
import { ProviderCard } from './provider-card'

/** Providers `packages/ai` does not have a live profile for yet — the key entry only lets
 *  the user get ready for when 7.4+ wires them up; there is no "Probar" for these. */
const PLACEHOLDER_PROVIDERS: ReadonlyArray<{ id: SecretName; label: string }> = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'openrouter', label: 'OpenRouter' },
  { id: 'azure_speech', label: 'Azure Speech' },
  { id: 'elevenlabs', label: 'ElevenLabs' },
]

/** `embed` is deliberately excluded — `packages/ai/src/roles.ts` never routes it; it is
 *  chosen by the `retrieval.embeddingModel` setting instead. */
const ASSIGNABLE_ROLES = PROVIDER_ROLE_VALUES.filter((role) => role !== 'embed')

function currentMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function formatUsd(usd: number): string {
  return `USD ${usd.toFixed(2)}`
}

function PlaceholderProviderCard({ id, label }: { id: SecretName; label: string }) {
  const t = useT('settings')
  const secret = useIpcQuery('secrets.get', { name: id })
  const setSecret = useIpcMutation('secrets.set')
  const [value, setValue] = useState('')

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{label}</CardTitle>
        <CardDescription>{t('ai.providers.placeholderDescription')}</CardDescription>
      </CardHeader>
      <div className="flex items-end gap-2 p-6 pt-0">
        <div className="flex-1">
          <SecretInput
            preview={secret.data?.preview ?? null}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            revealLabel={t('ai.providers.showKey')}
            hideLabel={t('ai.providers.hideKey')}
            aria-label={`${t('ai.providers.apiKeyLabel')} — ${label}`}
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={value === '' || setSecret.isPending}
          onClick={() => {
            setSecret
              .mutateAsync({ name: id, value })
              .then(() => {
                setValue('')
                void secret.refetch()
              })
              .catch(() => {})
          }}
        >
          {t('ai.providers.saveKey')}
        </Button>
      </div>
    </Card>
  )
}

function RoleAssignmentRow({ role }: { role: ProviderRoleDto }) {
  const t = useT('settings')
  const roles = useIpcQuery('ai.getRoles', {})
  const cards = useIpcQuery('ai.listProviderCards', {})
  const setRoles = useIpcMutation('ai.setRoles')
  const [error, setError] = useState<string | null>(null)

  const assignment = roles.data?.roles.find((r) => r.role === role)
  const value =
    assignment?.primary === null || assignment?.primary === undefined
      ? ''
      : `${assignment.primary.profileId}:${assignment.primary.modelId}`

  const options = (cards.data?.cards ?? []).flatMap((card) =>
    card.models.map((modelId) => ({
      value: `${card.id}:${modelId}`,
      label: `${card.label} — ${modelId}`,
      profileId: card.id,
      modelId,
    })),
  )

  return (
    <div className="flex flex-col gap-1 py-2">
      <div className="flex items-center gap-3">
        <span className="w-20 text-sm font-medium capitalize">{role}</span>
        <Select
          value={value}
          onValueChange={(next) => {
            setError(null)
            const [profileId, modelId] = String(next).split(':')
            const nextAssignment =
              profileId === undefined || modelId === undefined ? null : { profileId, modelId }
            const existing = roles.data?.roles ?? []
            const nextRoles = ASSIGNABLE_ROLES.map((r) => {
              const current = existing.find((a) => a.role === r)
              return r === role
                ? { role: r, primary: nextAssignment, fallbacks: current?.fallbacks ?? [] }
                : {
                    role: r,
                    primary: current?.primary ?? null,
                    fallbacks: current?.fallbacks ?? [],
                  }
            })
            setRoles.mutate(
              { roles: nextRoles },
              {
                onError: (err) => setError(err.message),
                onSuccess: () => void roles.refetch(),
              },
            )
          }}
        >
          <SelectTrigger className="w-72" aria-label={`${t('ai.roles.label')} — ${role}`}>
            <SelectValue placeholder={t('ai.roles.default')} />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {error && <p className="text-red-700 text-xs dark:text-red-300">{error}</p>}
    </div>
  )
}

function BudgetPanel() {
  const t = useT('settings')
  const monthlyUsd = useSetting<number>('ai.budget.monthlyUsd')
  const hardBlock = useSetting<boolean>('ai.budget.hardBlock')
  const summary = useIpcQuery('ai.getUsageSummary', { month: currentMonth() })
  const [alert, setAlert] = useState<{ threshold: number; spentUsd: number } | null>(null)

  useIpcEvent('ai.budgetAlert', (payload) => {
    setAlert({ threshold: payload.threshold, spentUsd: payload.spentUsd })
  })

  const cap = monthlyUsd.value ?? 0
  const spent = summary.data?.totalUsd ?? 0
  const ratio = cap > 0 ? Math.min(100, (spent / cap) * 100) : 0

  return (
    <section data-testid="settings-ai-budget" className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold">{t('ai.budget.label')}</h3>

      {alert && (
        <p className="border-border bg-surface rounded-md border p-2 text-sm" role="status">
          {t('ai.budget.alert', { threshold: alert.threshold, spent: formatUsd(alert.spentUsd) })}
        </p>
      )}

      <div className="flex items-center gap-3">
        <label htmlFor="ai-budget-cap" className="text-muted text-xs">
          {t('ai.budget.monthlyCap')}
        </label>
        <Input
          id="ai-budget-cap"
          type="number"
          min={0}
          step={1}
          className="w-28"
          defaultValue={cap}
          onBlur={(e) => {
            const next = Number(e.target.value)
            if (Number.isFinite(next) && next >= 0) monthlyUsd.set(next)
          }}
        />
        <span className="text-muted text-xs">
          ({formatUsd(spent)} {t('ai.budget.spentThisMonth')})
        </span>
      </div>

      {cap > 0 && (
        <div className="max-w-sm">
          <Progress value={ratio} aria-label={t('ai.budget.label')}>
            <ProgressTrack>
              <ProgressIndicator />
            </ProgressTrack>
          </Progress>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Switch
          id="ai-budget-hard-block"
          checked={hardBlock.value ?? true}
          onCheckedChange={(checked) => hardBlock.set(checked)}
          aria-label={t('ai.budget.hardBlock')}
        />
        <span className="text-sm">{t('ai.budget.hardBlock')}</span>
      </div>
    </section>
  )
}

function AllowlistPanel() {
  const t = useT('settings')
  const cards = useIpcQuery('ai.listProviderCards', {})
  const allowlist = useSetting<string[]>('ai.providers.allowlist')
  const selected = allowlist.value ?? []

  return (
    <section data-testid="settings-ai-allowlist" className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">{t('ai.allowlist.label')}</h3>
      <p className="text-muted text-xs">{t('ai.allowlist.description')}</p>
      <div className="flex flex-col gap-1.5">
        {(cards.data?.cards ?? []).map((card) => {
          const checked = selected.length === 0 || selected.includes(card.id)
          return (
            <div key={card.id} className="flex items-center gap-2">
              <Switch
                checked={checked}
                onCheckedChange={(next) => {
                  const base =
                    selected.length === 0 ? (cards.data?.cards ?? []).map((c) => c.id) : selected
                  const nextSelected = next
                    ? [...new Set([...base, card.id])]
                    : base.filter((id) => id !== card.id)
                  allowlist.set(nextSelected)
                }}
                aria-label={card.label}
              />
              <span className="text-sm">{card.label}</span>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function PricingEditorPanel() {
  const t = useT('settings')
  const pricing = useIpcQuery('ai.getPricingOverlay', {})
  const setOverlay = useIpcMutation('ai.setPricingOverlay')
  const restore = useIpcMutation('ai.restorePricing')

  return (
    <section data-testid="settings-ai-pricing" className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{t('ai.pricing.label')}</h3>
        <Button
          variant="outline"
          size="sm"
          disabled={restore.isPending}
          onClick={() => {
            restore.mutate({}, { onSuccess: () => void pricing.refetch() })
          }}
        >
          {t('ai.pricing.restore')}
        </Button>
      </div>
      <p className="text-muted text-xs">
        {t('ai.pricing.revision', { revision: pricing.data?.revision ?? '' })}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-muted">
              <th className="py-1 pr-3 font-medium">{t('ai.pricing.model')}</th>
              <th className="py-1 pr-3 font-medium">{t('ai.pricing.input')}</th>
              <th className="py-1 pr-3 font-medium">{t('ai.pricing.output')}</th>
            </tr>
          </thead>
          <tbody>
            {(pricing.data?.rows ?? []).map((row) => (
              <PricingRow
                key={row.modelKey}
                modelKey={row.modelKey}
                label={row.label}
                input={row.overlay?.input ?? row.resolved.input}
                output={row.overlay?.output ?? row.resolved.output}
                inputLabel={`${t('ai.pricing.input')} — ${row.label}`}
                outputLabel={`${t('ai.pricing.output')} — ${row.label}`}
                onSave={(input, output) => {
                  const entries = (pricing.data?.rows ?? []).map((r) =>
                    r.modelKey === row.modelKey
                      ? {
                          modelKey: r.modelKey,
                          input,
                          output,
                          cacheRead: r.overlay?.cacheRead ?? null,
                          cacheWrite5m: r.overlay?.cacheWrite5m ?? null,
                          cacheWrite1h: r.overlay?.cacheWrite1h ?? null,
                          batchDiscount: r.overlay?.batchDiscount ?? null,
                          asOf: new Date().toISOString().slice(0, 10),
                        }
                      : r.overlay,
                  )
                  const existing = (pricing.data?.rows ?? [])
                    .filter((r) => r.modelKey !== row.modelKey && r.overlay !== null)
                    .map((r) => r.overlay)
                  setOverlay.mutate(
                    {
                      entries: [
                        ...existing,
                        entries.find((e) => e !== null && e.modelKey === row.modelKey),
                      ].filter((e): e is NonNullable<typeof e> => e !== null && e !== undefined),
                    },
                    { onSuccess: () => void pricing.refetch() },
                  )
                }}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function PricingRow({
  modelKey,
  label,
  input,
  output,
  inputLabel,
  outputLabel,
  onSave,
}: {
  modelKey: string
  label: string
  input: number
  output: number
  inputLabel: string
  outputLabel: string
  onSave: (input: number, output: number) => void
}) {
  const [localInput, setLocalInput] = useState(String(input))
  const [localOutput, setLocalOutput] = useState(String(output))

  return (
    <tr className="border-border border-t">
      <td className="py-1.5 pr-3">
        <div className="font-medium">{label}</div>
        <div className="text-muted font-mono text-[10px]">{modelKey}</div>
      </td>
      <td className="py-1.5 pr-3">
        <Input
          type="number"
          step="0.01"
          className="w-24"
          aria-label={inputLabel}
          value={localInput}
          onChange={(e) => setLocalInput(e.target.value)}
          onBlur={() => {
            const value = Number(localInput)
            if (Number.isFinite(value) && value >= 0) onSave(value, Number(localOutput))
          }}
        />
      </td>
      <td className="py-1.5 pr-3">
        <Input
          type="number"
          step="0.01"
          className="w-24"
          aria-label={outputLabel}
          value={localOutput}
          onChange={(e) => setLocalOutput(e.target.value)}
          onBlur={() => {
            const value = Number(localOutput)
            if (Number.isFinite(value) && value >= 0) onSave(Number(localInput), value)
          }}
        />
      </td>
    </tr>
  )
}

function UsageDashboardPanel() {
  const t = useT('settings')
  const month = currentMonth()
  const summary = useIpcQuery('ai.getUsageSummary', { month })
  const recent = useIpcQuery('ai.listRecentCalls', { limit: 100 })
  const exportCsv = useIpcMutation('ai.exportUsageCsv')

  const byPurpose = (summary.data?.byPurpose ?? []).map((row) => ({
    label: `${row.purpose} (${row.provider})`,
    value: row.costUsd,
  }))
  const byProvider = Object.values(
    (summary.data?.byModel ?? []).reduce<Record<string, { label: string; value: number }>>(
      (acc, row) => {
        acc[row.provider] = {
          label: row.provider,
          value: (acc[row.provider]?.value ?? 0) + row.costUsd,
        }
        return acc
      },
      {},
    ),
  )

  return (
    <section data-testid="settings-ai-usage" className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{t('ai.usage.label')}</h3>
        <Button
          variant="outline"
          size="sm"
          disabled={exportCsv.isPending}
          onClick={() => {
            exportCsv.mutate({ month })
          }}
        >
          {t('ai.usage.exportCsv')}
        </Button>
      </div>
      <p className="text-sm font-medium">
        {t('ai.usage.total', { total: formatUsd(summary.data?.totalUsd ?? 0) })}
      </p>

      {byPurpose.length > 0 && (
        <HistogramChart
          data={byPurpose}
          caption={t('ai.usage.byPurpose')}
          valueHeading={t('ai.usage.cost')}
          format={(v: number) => formatUsd(v)}
        />
      )}
      {byProvider.length > 0 && (
        <HistogramChart
          data={byProvider}
          caption={t('ai.usage.byProvider')}
          valueHeading={t('ai.usage.cost')}
          format={(v: number) => formatUsd(v)}
        />
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-muted">
              <th className="py-1 pr-3 font-medium">{t('ai.usage.provider')}</th>
              <th className="py-1 pr-3 font-medium">{t('ai.usage.model')}</th>
              <th className="py-1 pr-3 font-medium">{t('ai.usage.purpose')}</th>
              <th className="py-1 pr-3 font-medium">{t('ai.usage.status')}</th>
              <th className="py-1 pr-3 font-medium">{t('ai.usage.cost')}</th>
            </tr>
          </thead>
          <tbody>
            {(recent.data?.calls ?? []).map((call) => (
              <tr key={call.id} className="border-border border-t">
                <td className="py-1 pr-3">{call.provider}</td>
                <td className="py-1 pr-3">{call.model}</td>
                <td className="py-1 pr-3">{call.purpose}</td>
                <td className="py-1 pr-3">{call.status}</td>
                <td className="py-1 pr-3">{formatUsd(call.costUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export interface AiSettingsSectionProps {
  focused?: boolean
}

/**
 * "Inteligencia artificial" (`docs/spec/08-ux.md` §1): providers, role assignment, budget,
 * privacy allow-list, the "Precios" editor and the usage dashboard. The app works with none
 * of this configured — `AiUnavailableNotice` is this screen's own empty state, shown when
 * no provider has a key yet (the same "Probar sin IA" principle §2 asks every AI-triggering
 * control elsewhere in the app to follow, see `source-chunks.tsx`/`card-view.tsx`).
 */
export function AiSettingsSection({ focused }: AiSettingsSectionProps) {
  const t = useT('settings')
  const cards = useIpcQuery('ai.listProviderCards', {})
  const anyConfigured = (cards.data?.cards ?? []).some((card) => card.hasKey)

  return (
    <section data-testid="settings-ai" data-focused={focused} className="flex flex-col gap-6">
      <div>
        <h2 className="text-sm font-semibold">{t('ai.title')}</h2>
        {!anyConfigured && <AiUnavailableNotice reason={t('ai.unavailable')} />}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {(cards.data?.cards ?? []).map((card) => (
          <ProviderCard key={card.id} card={card} onSaved={() => void cards.refetch()} />
        ))}
        {PLACEHOLDER_PROVIDERS.map((provider) => (
          <PlaceholderProviderCard key={provider.id} id={provider.id} label={provider.label} />
        ))}
      </div>

      <section data-testid="settings-ai-roles" className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold">{t('ai.roles.label')}</h3>
        {ASSIGNABLE_ROLES.map((role) => (
          <RoleAssignmentRow key={role} role={role} />
        ))}
      </section>

      <BudgetPanel />
      <AllowlistPanel />
      <PricingEditorPanel />
      <UsageDashboardPanel />
    </section>
  )
}
