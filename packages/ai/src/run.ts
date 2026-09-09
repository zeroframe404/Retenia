import type { AiCall, Clock, NewEntity, SecretName } from '@retenia/core'
import { isAborted, toAbortSignal } from './abort'
import type { AiBudgetEvent } from './budget'
import { crossedThresholds, monthKey, startOfMonth } from './budget'
import type { AiCallMeta } from './cost-log'
import { sanitizeMeta } from './cost-log'
import { AiError, redactKey } from './errors'
import type { AiResultCache, CachedAiResult } from './idempotency'
import type { FinishReason, InvokeOptions, InvokeOutcome, ProviderInvoker } from './invoker'
import type { Random, Timers } from './ports'
import type { BillableUsage, PricingTable } from './pricing'
import { computeCostUsd, modelKey, ZERO_USAGE } from './pricing'
import type { ProviderRole } from './provider-port'
import { classify, retryDelayMs } from './retry'
import type { AiRegistry, RoleTarget } from './roles'
import { resolveTargets } from './roles'
import type {
  TextGenerationRequest,
  TextGenerationResult,
  TextGenerationUsage,
} from './text-generator'

/** One completion the provider was happy with, offered to `review` before it is returned. */
export interface AiAttempt {
  readonly text: string
  readonly modelId: string
  readonly finishReason: FinishReason
  readonly usage: TextGenerationUsage
  /** 0 = primary target, 1 = first fallback. */
  readonly target: number
  /** 0 on a first attempt; 1 and 2 on the repair turns. */
  readonly repair: number
}

/**
 * What the caller makes of a completion the provider considered finished.
 *
 * This is the seam `runStructured` is built on, and the reason it is here rather than in a
 * second dispatch loop of its own. Validation failure is not a transport failure: the
 * request was fine, the connection was fine, one specific model produced JSON its schema
 * rejects. Answering that needs the two things only this loop has — the ability to ask the
 * *same* target again with a correction, and the ability to give up on it and fall through
 * to the next model in the role. Reimplementing either above `TextGenerator` would mean a
 * second copy of the budget gate, the retry policy and the `ai_calls` write, and the
 * invariant this package is built around — one row per dispatched attempt, on a settle path
 * with no early return — would then hold in one of the two copies.
 */
export type AiReview =
  | { readonly kind: 'accept' }
  /** Ask this same target again with a corrected request. Bounded by `repairBudget`. */
  | { readonly kind: 'repair'; readonly request: TextGenerationRequest }
  /** This model cannot answer; move to the next one in the role. */
  | { readonly kind: 'reject'; readonly error: AiError }

const ACCEPT: AiReview = Object.freeze({ kind: 'accept' })

/**
 * Two, matching the sub-phase's "repair loop (max 2)".
 *
 * A third turn has never been observed to fix what two did not: past that the model has
 * misunderstood the schema rather than slipped, and a different model — which is what
 * rejecting gets you — is the better bet and the cheaper one.
 */
export const DEFAULT_REPAIR_BUDGET = 2

export interface RunOptions {
  /**
   * Consulted for every successful completion. Defaults to accepting, which is exactly what
   * `AiClient.textGenerator` wants: a prose answer has no schema to fail.
   */
  readonly review?: (attempt: AiAttempt) => AiReview | Promise<AiReview>
  readonly repairBudget?: number
  /** Forwarded to the invoker; see `InvokeOptions.onElement`. Array mode only. */
  readonly onElement?: (element: unknown) => void
  /**
   * Called immediately before each dispatch, so a caller streaming elements can tell where
   * one attempt ends and the next begins.
   *
   * Without it, a stream that emits ten elements and *then* fails is indistinguishable from
   * one that succeeded, and the retry's ten elements are appended to the first ten. Nothing
   * else in the loop needs the boundary, which is why it is a hook here rather than a
   * per-attempt result type.
   */
  readonly onDispatch?: () => void
}

/** What a caller is asking for, beyond the prompt itself. */
export interface AiBinding {
  readonly role: ProviderRole
  /** `ai_calls.purpose` — the feature tag: `contextualize`, `grade_long_text`, `tutor`… */
  readonly purpose: string
  /** `ai_calls.job_id`, when the call belongs to a queued job. The FK exists for this. */
  readonly jobId?: string
  readonly promptVersion?: string
  /** `ai_calls.schema_version` — the output contract this call was validated against. */
  readonly schemaVersion?: string
  /** `ai_results.stage` on a cache write; defaults to `purpose`. */
  readonly stage?: string
  /**
   * The per-call budget override (`docs/spec/06-ai-providers.md` §6: "optional blocking").
   *
   * It lives on the binding rather than on `TextGenerationRequest` because that type is
   * shared with `@retenia/activity-ai` and `@retenia/ingest`, which have no business
   * knowing this layer has a budget at all. A caller that has actually asked the user
   * "you are over your cap — continue?" binds with this set.
   */
  readonly allowOverBudget?: boolean
  /**
   * Ignore any cached result for this request's `idempotencyKey` and call the provider.
   *
   * The "Regenerate this lesson" button of `docs/spec/04-path-generation.md` §13, and the
   * only honest way to answer "give me a different answer" when the key deliberately does
   * not include the model or the temperature. The fresh answer replaces the cached one, so
   * a forced call is not a way to accumulate two answers to one question.
   */
  readonly force?: boolean
}

export interface RunDeps {
  invoker: ProviderInvoker
  registry: () => Promise<AiRegistry>
  pricing: PricingTable
  getSecret: (name: SecretName) => Promise<string | undefined>
  recordCall: (call: NewEntity<AiCall>) => Promise<void>
  spentSinceUsd: (from: Date) => Promise<number>
  monthlyBudgetUsd: () => Promise<number>
  /**
   * `ai_results`, when one is wired. Absent means "no cache", which is what every test that
   * is not about caching wants, and what a run with no database would get.
   */
  resultCache?: AiResultCache
  hardBlockEnabled: () => Promise<boolean>
  clock: Clock
  timers: Timers
  random: Random
  onBudgetEvent: (event: AiBudgetEvent) => void
  logger: { warn(message: string): void; error(message: string, error?: unknown): void }
}

/**
 * One completion, through the whole layer: the result cache, the budget gate, role
 * resolution, key lookup, dispatch, retry, the caller's review of what came back, ordered
 * fallback, and one `ai_calls` row per dispatched attempt.
 *
 * The ordering below is what the sub-phase's acceptance criteria depend on, so it is worth
 * being explicit about four of the steps:
 *
 * - **The cache is consulted before the budget gate.** A hit costs nothing, so refusing to
 *   serve one because the month's cap is spent would strand work that has already been paid
 *   for — a resumed generation run would fail on lesson 3 of 40 with 39 answers sitting in
 *   the table. Over the cap, the first *uncached* call is still the one that stops.
 * - The month's spend is read **once per run**, not once per attempt. Nothing inside a
 *   single call can move a monthly total enough to matter, and re-reading would turn one
 *   indexed `sum()` into one per attempt.
 * - The row is written for every attempt that actually **dispatched**, and for no attempt
 *   that did not. A budget block, a missing key, an unroutable role and a cache hit are all
 *   decisions taken before the network, and logging them would inflate "calls this month"
 *   with calls that never happened.
 * - **The cache is written only for a reviewed, accepted completion.** Writing on the first
 *   `ok` outcome would cache the very output the repair loop then rejected, and every later
 *   run would replay the broken answer without even the chance to repair it.
 */
export async function runOnce(
  deps: RunDeps,
  binding: AiBinding,
  request: TextGenerationRequest,
  options: RunOptions = {},
): Promise<TextGenerationResult> {
  const now = deps.clock.now()

  if (isAborted(request.signal)) {
    throw new AiError('aborted', 'the caller cancelled before the request was dispatched')
  }

  const review = options.review ?? (() => ACCEPT)
  const repairBudget = Math.max(0, options.repairBudget ?? DEFAULT_REPAIR_BUDGET)

  const cached = await readCache(deps, binding, request)
  if (cached !== undefined) {
    // Reviewed like any other completion: a cached answer is not trusted further than a
    // fresh one. A `reject` here (the stored text no longer parses) falls through to a real
    // call, whose accepted answer then replaces the entry.
    const verdict = await review({
      text: cached.output,
      modelId: cached.model,
      finishReason: 'stop',
      usage: { usd: 0 },
      target: 0,
      repair: 0,
    })
    if (verdict.kind === 'accept') {
      return { text: cached.output, model: cached.model, usage: { usd: 0 } }
    }
    deps.logger.warn(
      `[ai] the cached result for "${cached.customId}" no longer validates; calling again`,
    )
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
    // `null` is a profile that needs no key at all (Ollama, LM Studio): an empty string is
    // a real, defined `apiKey`, so it never falls into the "no key stored" branch below.
    const apiKey = target.profile.keyRef === null ? '' : await deps.getSecret(target.profile.keyRef)
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

    // Two counters, because they bound two different things. `transport` is the retry
    // policy of `retry.ts` — a blip on the wire — and `repair` is the caller's correction
    // budget. A repair turn does not consume a transport attempt: the provider answered
    // perfectly well, we simply did not like what it said.
    let transport = 0
    let repair = 0
    let current = request

    for (;;) {
      options.onDispatch?.()
      const startedAt = deps.clock.now()
      const invokeOptions: InvokeOptions = {
        signal,
        ...(options.onElement === undefined ? {} : { onElement: options.onElement }),
      }
      const outcome = await deps.invoker({ ...target, apiKey }, current, invokeOptions)
      const latencyMs = Math.max(0, deps.clock.now().getTime() - startedAt.getTime())

      let rejected = false
      let verdict: AiReview = ACCEPT
      if (outcome.kind === 'ok') {
        verdict = await review({
          text: outcome.text,
          modelId: outcome.modelId,
          finishReason: outcome.finishReason,
          usage: {
            inputTokens: outcome.usage.inputTokens,
            outputTokens: outcome.usage.outputTokens,
            cachedInputTokens: outcome.usage.cachedInputTokens,
            reasoningTokens: outcome.usage.reasoningTokens,
          },
          target: index,
          repair,
        })
        rejected = verdict.kind === 'reject'
      }

      // Reviewed *before* it is settled, so the row can say whether the answer was kept.
      // The alternative — log, then judge — would leave the cost log unable to distinguish
      // a call that worked from one that was paid for and thrown away, which is precisely
      // the number somebody debugging a expensive prompt needs.
      const costUsd = await settle(deps, {
        binding,
        target,
        index,
        attempt: transport + repair + 1,
        repair,
        rejected,
        outcome,
        latencyMs,
        request: current,
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
        if (verdict.kind === 'accept') {
          await writeCache(deps, binding, request, outcome, costUsd, target)
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

        if (verdict.kind === 'repair' && repair < repairBudget) {
          repair += 1
          // The key travels with the repair so the accepted answer is cached under the
          // question that was asked, not under the correction.
          current =
            request.idempotencyKey === undefined
              ? verdict.request
              : { ...verdict.request, idempotencyKey: request.idempotencyKey }
          continue
        }

        // Rejected, or out of repair turns: this model cannot answer. The next one in the
        // role is a different model and may well parse where this one did not.
        last =
          verdict.kind === 'reject'
            ? verdict.error
            : new AiError(
                'output_invalid',
                `the "${target.profile.id}/${target.modelId}" model did not produce a valid ` +
                  `answer within ${repairBudget} repair ${repairBudget === 1 ? 'turn' : 'turns'}`,
                { profileId: target.profile.id, model: target.modelId },
              )
        break
      }

      last = outcome.error
      transport += 1
      const retry = classify(outcome.error, transport)
      if (retry === 'give-up') throw outcome.error
      if (retry === 'next-target') break
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
  /** 0 on a first attempt, 1 and 2 on the repair turns. */
  repair: number
  /** The completion arrived intact and the caller's schema refused it. */
  rejected: boolean
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
  if (target.profile.local === true) {
    // Runs on the user's own hardware: there is no per-token rate to look up, and a model
    // id the user typed into a settings field (`qwen3.5:9b`) will never have a row in
    // `pricing.json`. Looking it up anyway would log every single local call as
    // `costUnknown`, which is the wrong story for a call that is not unpriced — it is free.
  } else {
    try {
      const breakdown = computeCostUsd(deps.pricing, {
        modelKey: key,
        usage,
        at: input.at,
        // The tier the request asked for, so a 1 h write is billed at 2x rather than at the
        // 5 m tier's 1.25x. Without it the two are indistinguishable here and the cheaper of
        // the two is always assumed — which under-reports precisely the tier a generation run
        // uses (`caching/with-cache.ts`).
        ...(input.request.cache === undefined ? {} : { cacheTtl: input.request.cache.ttl }),
      })
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
  }

  const noUsage = outcome.usage === undefined
  const meta: AiCallMeta = {
    attempt: input.attempt,
    target: input.index,
    pricingRevision: deps.pricing.revision,
    ...(input.repair > 0 ? { repair: input.repair } : {}),
    ...(input.rejected ? { outputRejected: true } : {}),
    ...(rates === undefined ? {} : { rates }),
    ...(usage.cacheWriteTokens > 0 ? { cacheWriteTokens: usage.cacheWriteTokens } : {}),
    ...(input.request.cache === undefined ? {} : { cacheTtl: input.request.cache.ttl }),
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
    schemaVersion: input.binding.schemaVersion ?? null,
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

/**
 * The `ai_results` lookup, and the reasons it can decline to be one.
 *
 * A cache read must never be able to fail a call it was only meant to make cheaper: a
 * corrupted row, a locked database or a repository bug means "no hit", not "no answer".
 * That is the same rule `settle` follows for the write side, and it is what lets the cache
 * be wired in `apps/desktop` without the AI layer growing a hard dependency on the database.
 */
async function readCache(
  deps: RunDeps,
  binding: AiBinding,
  request: TextGenerationRequest,
): Promise<CachedAiResult | undefined> {
  if (deps.resultCache === undefined) return undefined
  if (request.idempotencyKey === undefined) return undefined
  if (binding.force === true) return undefined
  try {
    return await deps.resultCache.get(request.idempotencyKey)
  } catch (error) {
    deps.logger.error('[ai] could not read the ai_results cache; calling the provider', error)
    return undefined
  }
}

/**
 * Store an accepted completion under the caller's idempotency key.
 *
 * Wrapped like the `ai_calls` write, and for the same reason: the answer is already in the
 * caller's hands, and a failure to remember it must not become a failure to return it. The
 * cost of losing the row is that the next identical call pays again — annoying, not wrong.
 */
async function writeCache(
  deps: RunDeps,
  binding: AiBinding,
  request: TextGenerationRequest,
  outcome: Extract<InvokeOutcome, { kind: 'ok' }>,
  costUsd: number,
  target: RoleTarget,
): Promise<void> {
  if (deps.resultCache === undefined || request.idempotencyKey === undefined) return
  try {
    await deps.resultCache.put({
      customId: request.idempotencyKey,
      output: outcome.text,
      model: outcome.modelId,
      provider: target.profile.id,
      costUsd,
      stage: binding.stage ?? binding.purpose,
      promptVersion: binding.promptVersion,
      schemaVersion: binding.schemaVersion,
    })
  } catch (error) {
    deps.logger.error('[ai] could not write the ai_results cache; the answer is unaffected', error)
  }
}
