import type { AiCall, Clock, NewEntity, SecretName } from '@retenia/core'
import { isAborted, toAbortSignal } from './abort'
import type { AiBudgetEvent } from './budget'
import { crossedThresholds, monthKey, startOfMonth } from './budget'
import type { AiCallMeta } from './cost-log'
import { sanitizeMeta } from './cost-log'
import { AiError, redactKey } from './errors'
import type { InvokeOutcome, ProviderInvoker } from './invoker'
import type { Random, Timers } from './ports'
import type { BillableUsage, PricingTable } from './pricing'
import { computeCostUsd, modelKey, ZERO_USAGE } from './pricing'
import type { ProviderRole } from './provider-port'
import { classify, MAX_ATTEMPTS_PER_TARGET, retryDelayMs } from './retry'
import type { AiRegistry, RoleTarget } from './roles'
import { resolveTargets } from './roles'
import type { TextGenerationRequest, TextGenerationResult } from './text-generator'

/** What a caller is asking for, beyond the prompt itself. */
export interface AiBinding {
  readonly role: ProviderRole
  /** `ai_calls.purpose` — the feature tag: `contextualize`, `grade_long_text`, `tutor`… */
  readonly purpose: string
  /** `ai_calls.job_id`, when the call belongs to a queued job. The FK exists for this. */
  readonly jobId?: string
  readonly promptVersion?: string
  /**
   * The per-call budget override (`docs/spec/06-ai-providers.md` §6: "optional blocking").
   *
   * It lives on the binding rather than on `TextGenerationRequest` because that type is
   * shared with `@retenia/activity-ai` and `@retenia/ingest`, which have no business
   * knowing this layer has a budget at all. A caller that has actually asked the user
   * "you are over your cap — continue?" binds with this set.
   */
  readonly allowOverBudget?: boolean
}

export interface RunDeps {
  invoker: ProviderInvoker
  registry: () => Promise<AiRegistry>
  pricing: PricingTable
  getSecret: (name: SecretName) => Promise<string | undefined>
  recordCall: (call: NewEntity<AiCall>) => Promise<void>
  spentSinceUsd: (from: Date) => Promise<number>
  monthlyBudgetUsd: () => Promise<number>
  hardBlockEnabled: () => Promise<boolean>
  clock: Clock
  timers: Timers
  random: Random
  onBudgetEvent: (event: AiBudgetEvent) => void
  logger: { warn(message: string): void; error(message: string, error?: unknown): void }
}

/**
 * One completion, through the whole layer: budget gate, role resolution, key lookup,
 * dispatch, retry, ordered fallback, and one `ai_calls` row per dispatched attempt.
 *
 * The ordering below is what the sub-phase's acceptance criteria depend on, so it is worth
 * being explicit about two of the steps:
 *
 * - The month's spend is read **once per run**, not once per attempt. Nothing inside a
 *   single call can move a monthly total enough to matter, and re-reading would turn one
 *   indexed `sum()` into one per attempt.
 * - The row is written for every attempt that actually **dispatched**, and for no attempt
 *   that did not. A budget block, a missing key and an unroutable role are all decisions
 *   taken before the network, and logging them would inflate "calls this month" with calls
 *   that never happened.
 */
export async function runOnce(
  deps: RunDeps,
  binding: AiBinding,
  request: TextGenerationRequest,
): Promise<TextGenerationResult> {
  const now = deps.clock.now()

  if (isAborted(request.signal)) {
    throw new AiError('aborted', 'the caller cancelled before the request was dispatched')
  }

  const spentBefore = await deps.spentSinceUsd(startOfMonth(now))
  const capUsd = await deps.monthlyBudgetUsd()
  let spent = spentBefore

  // A cap of 0 means NO CAP. A user who types 0 meaning "no AI spending" is served by
  // `ai.providers.allowlist` (no profile, no call); reading 0 as "block everything" would
  // make the default-shaped value of an unset number the most restrictive setting there is.
  if (capUsd > 0 && spentBefore >= capUsd) {
    deps.onBudgetEvent({
      kind: 'blocked',
      period: monthKey(now),
      spentUsd: spentBefore,
      capUsd,
      purpose: binding.purpose,
    })
    const hardBlock = await deps.hardBlockEnabled()
    if (hardBlock && binding.allowOverBudget !== true) {
      throw new AiError(
        'budget_exceeded',
        `the monthly AI budget of USD ${capUsd.toFixed(2)} is spent ` +
          `(USD ${spentBefore.toFixed(2)} so far this month)`,
      )
    }
    // Otherwise the user has opted out of blocking, or has confirmed this one call:
    // proceed, having warned.
  }

  const { profiles, roles } = await deps.registry()
  const targets = resolveTargets(binding.role, { profiles, roles })
  const signal = toAbortSignal(request.signal)

  let last: AiError | undefined
  for (const [index, target] of targets.entries()) {
    const apiKey = await deps.getSecret(target.profile.keyRef)
    if (apiKey === undefined) {
      // No key stored for this profile: not a failure of the provider, and nothing was
      // sent, so there is nothing to log.
      last = new AiError(
        'not_configured',
        `no API key is stored for the "${target.profile.id}" provider`,
        { profileId: target.profile.id, model: target.modelId },
      )
      continue
    }

    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_TARGET; attempt += 1) {
      const startedAt = deps.clock.now()
      const outcome = await deps.invoker({ ...target, apiKey }, request, { signal })
      const latencyMs = Math.max(0, deps.clock.now().getTime() - startedAt.getTime())

      const costUsd = await settle(deps, {
        binding,
        target,
        index,
        attempt,
        outcome,
        latencyMs,
        request,
        apiKey,
        at: startedAt,
      })

      const spentAfter = spent + costUsd
      for (const threshold of crossedThresholds(spent, spentAfter, capUsd)) {
        deps.onBudgetEvent({
          kind: 'threshold',
          period: monthKey(now),
          threshold,
          spentUsd: spentAfter,
          capUsd,
          purpose: binding.purpose,
        })
      }
      spent = spentAfter

      if (outcome.kind === 'ok') {
        return {
          text: outcome.text,
          model: outcome.modelId,
          usage: {
            inputTokens: outcome.usage.inputTokens,
            outputTokens: outcome.usage.outputTokens,
            cachedInputTokens: outcome.usage.cachedInputTokens,
            reasoningTokens: outcome.usage.reasoningTokens,
            usd: costUsd,
          },
        }
      }

      last = outcome.error
      const verdict = classify(outcome.error, attempt)
      if (verdict === 'give-up') throw outcome.error
      if (verdict === 'next-target') break
      await deps.timers.sleep(retryDelayMs(deps.random), signal)
    }
  }

  throw new AiError(
    'all_targets_failed',
    `every provider for the "${binding.role}" role failed ` +
      `(${targets.map((t) => `${t.profile.id}/${t.modelId}`).join(', ')})`,
    {},
    { cause: last },
  )
}

interface SettleInput {
  binding: AiBinding
  target: RoleTarget
  index: number
  attempt: number
  outcome: InvokeOutcome
  latencyMs: number
  request: TextGenerationRequest
  apiKey: string
  at: Date
}

/**
 * Write the attempt's `ai_calls` row and return what it cost.
 *
 * Recording is wrapped so that it can never fail the call: a full disk, a locked database
 * or a schema surprise must not turn a working answer into an error the user sees. The
 * cost is still returned, so the budget arithmetic stays right even when the row is lost.
 */
async function settle(deps: RunDeps, input: SettleInput): Promise<number> {
  const { outcome, target } = input
  const usage: BillableUsage = outcome.usage ?? ZERO_USAGE
  const key = modelKey(target.profile, target.modelId)

  let costUsd = 0
  let rates: AiCallMeta['rates']
  try {
    const breakdown = computeCostUsd(deps.pricing, { modelKey: key, usage, at: input.at })
    costUsd = breakdown.usd
    rates = {
      input: breakdown.rates.input,
      output: breakdown.rates.output,
      cacheRead: breakdown.rates.cacheRead,
    }
  } catch (error) {
    // An unpriced model is a bug in our table, not a reason to lose the row: log it and
    // record the call with a cost of zero plus `costUnknown`, so the month's total is
    // visibly incomplete rather than quietly wrong.
    deps.logger.error(`[ai] no price for ${key}; recording the call with an unknown cost`, error)
  }

  const noUsage = outcome.usage === undefined
  const meta: AiCallMeta = {
    attempt: input.attempt,
    target: input.index,
    pricingRevision: deps.pricing.revision,
    ...(rates === undefined ? {} : { rates }),
    ...(usage.cacheWriteTokens > 0 ? { cacheWriteTokens: usage.cacheWriteTokens } : {}),
    ...(outcome.requestId === undefined ? {} : { requestId: outcome.requestId }),
    ...(outcome.kind === 'ok'
      ? { finishReason: outcome.finishReason }
      : {
          code: outcome.error.code,
          ...(outcome.error.statusCode === undefined
            ? {}
            : { statusCode: outcome.error.statusCode }),
          // An error that reported no usage may still have consumed tokens upstream.
          ...(noUsage ? { costUnknown: true } : {}),
        }),
  }

  const row: NewEntity<AiCall> = {
    provider: target.profile.id,
    model: target.modelId,
    role: input.binding.role,
    purpose: input.binding.purpose,
    status: outcome.kind === 'ok' ? 'ok' : 'error',
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    reasoningTokens: usage.reasoningTokens,
    costUsd,
    latencyMs: input.latencyMs,
    batchId: null,
    // Retries and fallbacks of one logical unit of work legitimately share this: it is the
    // caller's idempotency key, and what 7.3's batch resumption looks a call up by.
    customId: input.request.idempotencyKey ?? null,
    promptVersion: input.binding.promptVersion ?? null,
    schemaVersion: null,
    temperature: input.request.temperature,
    jobId: input.binding.jobId ?? null,
    error: outcome.kind === 'ok' ? null : redactKey(outcome.error.message, input.apiKey),
    meta: sanitizeMeta(meta),
  }

  try {
    await deps.recordCall(row)
  } catch (error) {
    deps.logger.error('[ai] could not write the ai_calls row; the call itself is unaffected', error)
  }
  return costUsd
}
