import { AiError } from './errors'
import type { InvokeOutcome, ProviderInvoker } from './invoker'
import type { Timers } from './ports'
import type { ProviderProfile } from './profiles'
import type { ProviderRole } from './provider-port'
import type { ModelRef, RoleMap } from './roles'
import type { TextGenerationRequest } from './text-generator'
import { approximateTokens } from './tokens'

/**
 * The "local" role: Ollama and LM Studio through `@ai-sdk/openai-compatible`, opt-in and
 * with a cloud fallback (`docs/spec/06-ai-providers.md` §7: *"'local' is just one more
 * provider, opt-in, with a cloud fallback"*). Everything here is pure — no `fetch`, no AI
 * SDK — so it stays reachable from `./index` and testable with a fake `Timers`; the actual
 * HTTP discovery probe lives in `./providers/local-discovery.ts`, behind the SDK boundary.
 */

/** `docs/spec/06-ai-providers.md` §7: "keep `num_ctx` ≤ 16–32K" on the RTX 4070 Super. */
export const DEFAULT_LOCAL_CONTEXT_TOKENS = 16_000

/**
 * How long to wait for a local model to answer before treating it as unreachable and
 * falling through to the role's cloud fallback (the sub-phase's "> 60 s first token").
 *
 * `generateText` only resolves on a finished completion, not on a first token, so this is
 * really "no *complete* answer within `timeoutMs`" — the conservative reading of the spec's
 * intent, since a model that is still generating at 60 s is exactly as unhelpful as one
 * that never started.
 */
export const DEFAULT_LOCAL_TIMEOUT_MS = 60_000

export interface CreateLocalProfileInput {
  readonly id: string
  readonly baseURL: string
  readonly models: readonly string[]
}

/**
 * Build a profile for a discovered Ollama/LM Studio endpoint.
 *
 * `keyRef: null` and `local: true` together are what make `run.ts` skip the "no key
 * stored" check and bill the call at zero; `caps.jsonStrict: false` is the honest
 * starting point — `runStructured`'s JSON-mode-plus-zod-parse fallback already handles a
 * local model with no grammar, and nothing here has verified that a given
 * `openai-compatible` endpoint's `response_format` actually constrains generation.
 */
export function createLocalProfile(input: CreateLocalProfileInput): ProviderProfile {
  return Object.freeze({
    id: input.id,
    kind: 'openai-compatible',
    keyRef: null,
    local: true,
    baseURL: input.baseURL,
    caps: Object.freeze({ jsonStrict: false }),
    models: Object.freeze([...input.models]),
  })
}

/**
 * Splice a local target in front of a role's existing chain.
 *
 * This is the whole of "preferLocal per role": no new routing concept, just data. The
 * role's prior primary and fallbacks become the fallback chain behind the local target, so
 * `resolveTargets`/`runOnce` try local first and fall through to whatever cloud chain was
 * already configured, unchanged, on any error `classify` sends to the next target —
 * including the offline/timeout errors `withLocalPolicy` produces below.
 *
 * A role with nothing configured yet gets a local-only chain: there is no cloud fallback to
 * preserve, and inventing one here would be a routing decision this module has no business
 * making.
 */
export function withLocalPreference(roles: RoleMap, role: ProviderRole, local: ModelRef): RoleMap {
  const existing = roles[role]
  const fallbacks: ModelRef[] =
    existing === undefined ? [] : [existing.primary, ...existing.fallbacks]
  return { ...roles, [role]: { primary: local, fallbacks } }
}

export interface LocalPolicyDeps {
  readonly timers: Timers
  /**
   * `net.isOnline()` plus a lightweight reachability probe, from whoever wires this in
   * `apps/desktop`. Absent means "assume online", which is what every existing caller — and
   * every test that is not about connectivity — gets today.
   */
  readonly isOnline?: () => boolean | Promise<boolean>
  readonly localTimeoutMs?: number
}

/**
 * Wrap a `ProviderInvoker` with the local-provider policy: refuse a cloud target while
 * offline (`AiError('offline', …)`, which `classify`'s default sends straight to the next
 * target rather than retrying a connection that is not coming back in 500 ms), and race a
 * local target against `localTimeoutMs` so a stalled model server falls through the same
 * way a real network error would.
 *
 * A `local: true` target is never gated on connectivity — that is the entire point of it
 * being local — and never anything but raced against the clock.
 */
export function withLocalPolicy(invoker: ProviderInvoker, deps: LocalPolicyDeps): ProviderInvoker {
  const timeoutMs = deps.localTimeoutMs ?? DEFAULT_LOCAL_TIMEOUT_MS

  return async function invoke(target, request, options) {
    if (target.profile.local !== true) {
      if (deps.isOnline !== undefined && !(await deps.isOnline())) {
        return {
          kind: 'error',
          error: new AiError(
            'offline',
            `the "${target.profile.id}" provider needs the network, and the device is offline`,
            { profileId: target.profile.id, model: target.modelId },
          ),
        }
      }
      return invoker(target, request, options)
    }

    const controller = new AbortController()
    const timeout: Promise<InvokeOutcome> = deps.timers
      .sleep(timeoutMs, controller.signal)
      .then(() => ({
        kind: 'error',
        error: new AiError(
          'network',
          `the local "${target.profile.id}" provider did not answer within ${timeoutMs}ms`,
          { profileId: target.profile.id, model: target.modelId },
        ),
      }))

    try {
      return await Promise.race([invoker(target, request, options), timeout])
    } finally {
      // Whichever settled first, the other outcome is discarded: this frees the sleep's
      // timer promptly instead of leaving it to fire uselessly up to `timeoutMs` later.
      controller.abort()
    }
  }
}

export interface LocalContextGuard {
  readonly request: TextGenerationRequest
  /** True when `cachePrefix` was cut to fit; the caller surfaces this as a warning. */
  readonly truncated: boolean
}

/**
 * Keep a request inside a local model's context window.
 *
 * Only `cachePrefix` is ever cut — it is the "stable head" a generation run stuffs with
 * source material, and the one part of the request that is safe to shorten: trimming
 * `system` would change the instructions the model is following, and trimming `prompt`
 * would change the question being asked. The cut keeps the *end* of the prefix, on the
 * assumption (true of every caller in this codebase today) that a prefix is built
 * oldest-context-first, so the most recent material is what should survive.
 */
export function guardLocalContext(
  request: TextGenerationRequest,
  maxTokens: number = DEFAULT_LOCAL_CONTEXT_TOKENS,
): LocalContextGuard {
  const prefix = request.cachePrefix ?? ''
  const fixedTokens = approximateTokens(request.system ?? '') + approximateTokens(request.prompt)
  const budget = maxTokens - fixedTokens

  if (prefix === '' || budget <= 0 || approximateTokens(prefix) <= budget) {
    return { request, truncated: false }
  }

  const maxChars = Math.max(0, budget * 4)
  const truncatedPrefix = prefix.slice(prefix.length - maxChars)
  return { request: { ...request, cachePrefix: truncatedPrefix }, truncated: true }
}
