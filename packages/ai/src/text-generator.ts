import type { AbortSignalLike } from '@retenia/core'
import type { PromptCacheDirective } from './caching/directive'

/**
 * One text (or JSON) completion, as everything above the provider layer sees it.
 *
 * This is the dependency-injection seam `docs/spec/04-path-generation.md` §8 needs: the real
 * adapters — Anthropic, Gemini, a local Ollama — arrive in sub-phase 7.2 with structured
 * outputs, the validation/repair loop, batching and prompt caching behind them. Everything that
 * *asks* for a completion (the free-text grader of §12, the lesson writer of §7, the tutor)
 * depends on this interface and is testable with a fake that returns a canned string.
 *
 * `temperature` is required rather than defaulted because §7's determinism rules turn on it:
 * **0** in extraction, judges and grading; 0.5–0.7 in writing. A default here would let a grader
 * be non-deterministic by omission.
 */

export interface TextGenerationRequest {
  /** The role and the contract; the versioned prompt file's contents. */
  system?: string
  /** The task itself: the data the prompt operates on. */
  prompt: string
  /** §7: 0 for extraction, judges and grading; 0.5–0.7 for writing. */
  temperature: number
  maxOutputTokens?: number
  /**
   * A JSON Schema the output must validate against (Claude's `output_config.format =
   * json_schema`, `strict: true`). Providers that cannot enforce it fall back to asking for
   * JSON in the prompt; the caller validates either way (§8: "the AI proposes, the code
   * validates").
   *
   * When `structuredMode` is `'array'` this is the schema of one **element**, not of the
   * array — that is the shape `Output.array` takes, and the shape that makes streaming a
   * validated element at a time possible.
   */
  jsonSchema?: unknown
  /** Names the schema for providers that require one. */
  schemaName?: string
  /**
   * How `jsonSchema` is bound to the call: `Output.object` over the whole value, or
   * `Output.array` over elements of it.
   *
   * Absent means "no structured output": the schema, if any, is advice in the prompt and
   * nothing more. That is the state every 7.1 caller is in, and it stays the default so that
   * adding a `jsonSchema` to a request cannot change how it is dispatched by accident.
   */
  structuredMode?: 'object' | 'array'
  /**
   * §7's idempotency key: `hash(stage, input_ids, prompt_version)`. A provider with a call
   * cache or the Batch API keys on it, so a resumed run does not pay twice.
   */
  idempotencyKey?: string
  /**
   * The stable head of the user message: sources, wrapped in `<user_content>`, sent as their
   * own text part *before* `prompt` (sub-phase 7.3).
   *
   * It is a separate field rather than a prefix the caller concatenates, because a cache
   * breakpoint has to sit between the two: the whole point is that this half is re-read from
   * the provider's cache while `prompt` is paid for in full. A transport that cannot express
   * a breakpoint simply concatenates it, which is also the right shape for a provider that
   * caches a repeated prefix implicitly.
   *
   * Untrusted, like `prompt` and unlike `system` — see `caching/with-cache.ts`.
   */
  cachePrefix?: string
  /**
   * Where the cache breakpoints go. Built by `withCache`, which is also what decides whether
   * there should be any: below a provider's minimum a breakpoint is silently ignored and
   * silently billed, so this is absent rather than optimistic.
   */
  cache?: PromptCacheDirective
  signal?: AbortSignalLike
}

export interface TextGenerationUsage {
  inputTokens?: number
  outputTokens?: number
  cachedInputTokens?: number
  /** Inside `outputTokens`, never added to it. Recorded for the cost tooltip. */
  reasoningTokens?: number
  /**
   * What the call cost, for §6's per-call counter.
   *
   * This is the **successful attempt's** cost. A call that fell back after a 429 also paid
   * for the attempt that failed, and one that failed outright paid for whatever it burned
   * before failing; `ai_calls` holds all of them, so it — not this field — is authoritative
   * for what a month cost.
   */
  usd?: number
}

export interface TextGenerationResult {
  text: string
  /** The concrete model that answered — recorded on the grade and in the cost log. */
  model: string
  usage?: TextGenerationUsage
}

export type TextGenerator = (request: TextGenerationRequest) => Promise<TextGenerationResult>
