import type { AbortSignalLike } from '@retenia/core'

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
   */
  jsonSchema?: unknown
  /** Names the schema for providers that require one. */
  schemaName?: string
  /**
   * §7's idempotency key: `hash(stage, input_ids, prompt_version)`. A provider with a call
   * cache or the Batch API keys on it, so a resumed run does not pay twice.
   */
  idempotencyKey?: string
  signal?: AbortSignalLike
}

export interface TextGenerationUsage {
  inputTokens?: number
  outputTokens?: number
  cachedInputTokens?: number
  /** What the call cost, for §6's per-call counter. */
  usd?: number
}

export interface TextGenerationResult {
  text: string
  /** The concrete model that answered — recorded on the grade and in the cost log. */
  model: string
  usage?: TextGenerationUsage
}

export type TextGenerator = (request: TextGenerationRequest) => Promise<TextGenerationResult>
