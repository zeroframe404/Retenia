import type { AiCall, Clock, NewEntity, SecretName } from '@retenia/core'
import type { AiBudgetEvent } from './budget'
import { DEFAULT_AI_CONCURRENCY, withConcurrencyLimit } from './concurrency'
import type { AiResultCache } from './idempotency'
import type { ProviderInvoker } from './invoker'
import type { Random, Timers } from './ports'
import { realTimers } from './ports'
import type { PerMillionRates, PricingTable } from './pricing'
import { modelKey, SHIPPED_PRICING, toPerMillionRates } from './pricing'
import { DEFAULT_PROFILES } from './profiles'
import type { ProviderRole } from './provider-port'
import type { AiRegistry } from './roles'
import { DEFAULT_ROLES, resolveTargets } from './roles'
import type { AiBinding } from './run'
import { runOnce } from './run'
import type {
  StructuredArrayRequest,
  StructuredObjectRequest,
  StructuredResult,
} from './structured'
import { DEFAULT_SANITIZE_LIMITS, runStructured, sanitizeString } from './structured'
import type { TextGenerator } from './text-generator'

export interface AiClientOptions {
  /**
   * The seam. `createSdkInvoker()` from `@retenia/ai/providers` in production;
   * `createScriptedInvoker([…])` from `@retenia/ai/testing` in every test that is not
   * about the SDK itself.
   */
  invoker: ProviderInvoker
  /**
   * How many calls this client may have in flight at once, across every role and every
   * caller (`docs/spec/06-ai-providers.md` §6: "concurrency with `p-queue`"). Defaults to
   * `DEFAULT_AI_CONCURRENCY`. Set to `Infinity` for a test that wants every scripted
   * outcome dispatched without an extra tick of scheduling in between.
   */
  concurrency?: number
  /**
   * A resolver, not a value: main reads `ai.providers.allowlist` on every run, so a
   * changed setting takes effect without a relaunch and `createMainAiClient` can stay
   * synchronous. 7.5's editor writes *this argument*; this package never reads a setting.
   */
  registry?: () => Promise<AiRegistry>
  /** Defaults to the shipped table. 7.5's price editor merges into this argument. */
  pricing?: PricingTable
  /** One function rather than the four-method `SecretStore`: a one-line fake in a test. */
  getSecret(name: SecretName): Promise<string | undefined>
  /**
   * One `ai_calls` row per dispatched attempt. Typed as core's `NewEntity<AiCall>` rather
   * than a redeclared shape, so `pnpm typecheck` pins it to the real schema.
   */
  recordCall(call: NewEntity<AiCall>): Promise<void>
  /** `repos.aiCalls.sumCost({ from })`. */
  spentSinceUsd(from: Date): Promise<number>
  /** `settings.get('ai.budget.monthlyUsd')`, read per run. 0 means no cap. */
  monthlyBudgetUsd(): Promise<number>
  /** `settings.get('ai.budget.hardBlock')`. Only consulted once the cap is reached. */
  hardBlockEnabled?: () => Promise<boolean>
  /**
   * `ai_results`, so a request carrying an `idempotencyKey` is answered from the table the
   * second time it is asked (`docs/spec/04-path-generation.md` §7).
   *
   * Optional because the cache is an optimisation and never a correctness requirement: a
   * client wired without one calls the provider every time, which is what a test wants and
   * what a first run does anyway.
   */
  resultCache?: AiResultCache
  clock: Clock
  timers?: Timers
  random?: Random
  /**
   * Fires on the transition `spentBefore < threshold <= spentAfter`, which self-dedupes
   * across restarts because `spentBefore` comes from `sumCost` over the real rows.
   *
   * 7.5 adds the durable latch and the notification, and must **emit before it latches**:
   * a crash between the write and the emit would swallow the alert for a whole month, and
   * a duplicate notification beats a lost one.
   */
  onBudgetEvent?: (event: AiBudgetEvent) => void
  logger?: { warn(message: string): void; error(message: string, error?: unknown): void }
}

/** What `AiClient.structured` hands a caller: `runStructured` with the deps already bound. */
export interface StructuredGenerator {
  <T>(request: StructuredObjectRequest<T>): Promise<StructuredResult<T>>
  <T>(request: StructuredArrayRequest<T>): Promise<StructuredResult<T[]>>
}

export interface AiClient {
  /**
   * The seam four packages already inject and already fake with `vi.fn<TextGenerator>()`.
   * Returning exactly that type is what lets this sub-phase land with no signature change
   * anywhere downstream.
   */
  textGenerator(binding: AiBinding): TextGenerator
  /**
   * The same call, with a schema on the other end: provider-native JSON Schema where the
   * profile has it, a sanitizer, a zod parse, and up to two repair turns before the next
   * model in the role gets a look (sub-phase 7.2).
   *
   * Separate from `textGenerator` rather than an option on it, because the two return
   * different things and `TextGenerator` is a type four packages already inject and fake.
   */
  structured(binding: AiBinding): StructuredGenerator
  /**
   * What the model this role would use costs right now, for `estimateContextualization`.
   *
   * `undefined` — never a throw and never a guess — when the role is unconfigured or its
   * model is unpriced, because the caller is a quote that still has to answer.
   */
  ratesFor(role: ProviderRole): Promise<PerMillionRates | undefined>
}

const defaultRegistry = async (): Promise<AiRegistry> => ({
  profiles: DEFAULT_PROFILES,
  roles: DEFAULT_ROLES,
})

const consoleLogger = {
  warn: (message: string) => {
    console.warn(message)
  },
  error: (message: string, error?: unknown) => {
    console.error(message, error)
  },
}

export function createAiClient(options: AiClientOptions): AiClient {
  const pricing = options.pricing ?? SHIPPED_PRICING
  const registry = options.registry ?? defaultRegistry

  const deps = {
    invoker: withConcurrencyLimit(options.invoker, options.concurrency ?? DEFAULT_AI_CONCURRENCY),
    registry,
    pricing,
    getSecret: options.getSecret,
    recordCall: options.recordCall,
    spentSinceUsd: options.spentSinceUsd,
    monthlyBudgetUsd: options.monthlyBudgetUsd,
    // Defaults to blocking: an unenforced cap is a number that only looks like a control.
    // 7.5 exposes the toggle; a caller with the user's explicit consent for one call sets
    // `allowOverBudget` on its binding instead.
    hardBlockEnabled: options.hardBlockEnabled ?? (async () => true),
    ...(options.resultCache === undefined ? {} : { resultCache: options.resultCache }),
    clock: options.clock,
    timers: options.timers ?? realTimers,
    random: options.random ?? Math.random,
    onBudgetEvent: options.onBudgetEvent ?? (() => {}),
    logger: options.logger ?? consoleLogger,
  }

  return {
    // `runOnce`'s completion is the provider's raw text: nothing between it and a caller
    // that stores or renders it. `structured()` below sanitizes the *parsed* value on its
    // own path (`runStructured`); free text has no schema to carry a sanitizer, so this is
    // the one place that path gets one. These completions are written from the user's own
    // PDFs, scraped pages and video transcripts, any of which can carry a `<script>` — the
    // same reasoning `structured/sanitize.ts` documents in full.
    textGenerator: (binding) => async (request) => {
      const result = await runOnce(deps, binding, request)
      return { ...result, text: sanitizeString(result.text, DEFAULT_SANITIZE_LIMITS) }
    },

    // The overloads live on `runStructured`; this forwards them with the deps already
    // bound, and the cast is the one-line price of saying that in TypeScript — an
    // implementation signature cannot itself be overloaded.
    structured: ((binding: AiBinding) => (request: StructuredObjectRequest<unknown>) =>
      runStructured(deps, binding, request)) as unknown as AiClient['structured'],

    ratesFor: async (role) => {
      try {
        const [target] = resolveTargets(role, await registry())
        if (target === undefined) return undefined
        return toPerMillionRates(pricing, modelKey(target.profile, target.modelId), {
          at: options.clock.now(),
        })
      } catch {
        // An unconfigured role and an unpriced model are both "we cannot quote this",
        // which is an answer the caller can render. A throw would not be.
        return undefined
      }
    },
  }
}
