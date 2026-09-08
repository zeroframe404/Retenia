import type { AiBatchSummary } from '@retenia/ipc-contract'
import { describe, expect, it } from 'vitest'
import { toProcessingBatch } from './use-ai-batches'

/**
 * The tray row sub-phase 7.3 asks for, in words:
 * **"Lote 12/40 lecciones · ~USD 1.10 · esperando"**.
 *
 * `toProcessingBatch` is the only part of the hook that is a decision rather than plumbing —
 * which number to show, when to show a bar at all, and when the `~` comes off the cost — so
 * it is exported and tested here while the query/event wiring is exercised by the app.
 */

/** A minimal `t` that renders the real keys' shape without loading i18next. */
const t = (key: string, options: Record<string, unknown> = {}): string => {
  if (key === 'aiBatches.label') return `Lote ${options.done}/${options.total} ${options.what}`
  if (key === 'aiBatches.costEstimate') return `~USD ${options.usd}`
  if (key === 'aiBatches.cost') return `USD ${options.usd}`
  if (key === 'aiBatches.purpose.expand_lesson') return 'lecciones'
  if (key === 'aiBatches.status.submitted') return 'esperando'
  if (key === 'aiBatches.status.in_progress') return 'en curso'
  if (key === 'aiBatches.status.completed') return 'terminado'
  if (key === 'aiBatches.status.failed') return 'con errores'
  return String(options.defaultValue ?? key)
}

const batch: AiBatchSummary = {
  id: '019213cd-0000-7000-8000-000000000001',
  provider: 'anthropic',
  model: 'claude-sonnet-5',
  purpose: 'expand_lesson',
  status: 'in_progress',
  requestCount: 40,
  succeededCount: 12,
  failedCount: 0,
  costEstimateUsd: 1.1,
  costUsd: 0.34,
  submittedAt: '2026-09-08T12:00:00.000Z',
  completedAt: null,
  error: null,
}

describe('toProcessingBatch', () => {
  it('builds the row the sub-phase specifies', () => {
    const row = toProcessingBatch({ ...batch, status: 'submitted' }, t)

    expect(row.label).toBe('Lote 12/40 lecciones')
    expect(row.detail).toBe('~USD 1.10 · esperando')
    expect(row.progress).toBe(30)
  })

  it('quotes the estimate while running and the charge once it has stopped', () => {
    // Before the answers arrive there is nothing to report but the quote; afterwards the
    // quote is no longer the interesting number. The `~` only ever marks the estimate, so
    // the two are never mistaken for each other.
    expect(toProcessingBatch(batch, t).detail).toBe('~USD 1.10 · en curso')
    expect(toProcessingBatch({ ...batch, status: 'completed', succeededCount: 40 }, t).detail).toBe(
      'USD 0.34 · terminado',
    )
  })

  it('shows no bar until something has actually come back', () => {
    // A bar pinned at 0 % for the first half hour of a batch says less than no bar at all.
    expect(toProcessingBatch({ ...batch, succeededCount: 0 }, t).progress).toBeUndefined()
    expect(
      toProcessingBatch({ ...batch, requestCount: 0, succeededCount: 0 }, t).progress,
    ).toBeUndefined()
  })

  it('marks a batch that finished with failures among its requests', () => {
    // `completed` with failures is not a success: three lessons of forty are missing, and the
    // tray has to say so rather than showing a full bar.
    const row = toProcessingBatch(
      { ...batch, status: 'completed', succeededCount: 37, failedCount: 3, error: '3 fallaron' },
      t,
    )
    expect(row.failed).toBe(true)
    expect(row.error).toBe('3 fallaron')
  })

  it('falls back to the raw purpose rather than a missing-key path', () => {
    const row = toProcessingBatch({ ...batch, purpose: 'brand_new_stage' }, t)
    expect(row.label).toContain('brand_new_stage')
  })
})
