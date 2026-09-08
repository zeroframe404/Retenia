import { generateText, jsonSchema, NoObjectGeneratedError, Output, streamText } from 'ai'
import type {
  FinishReason,
  InvokeOptions,
  InvokeOutcome,
  InvokeTarget,
  ProviderInvoker,
} from '../invoker'
import type { TextGenerationRequest } from '../text-generator'
import type { BindModel } from './bind'
import { bindLanguageModel } from './bind'
import { fromSdkError } from './from-sdk-error'
import { toBillableUsage } from './usage'

const FINISH_REASONS: ReadonlySet<string> = new Set<FinishReason>([
  'stop',
  'length',
  'content-filter',
  'tool-calls',
  'error',
  'other',
])

function toFinishReason(reason: string): FinishReason {
  return FINISH_REASONS.has(reason) ? (reason as FinishReason) : 'other'
}

/**
 * Bind the request's schema to the call, or don't.
 *
 * `docs/spec/06-ai-providers.md` §6 lists who is in which camp: Anthropic, OpenAI, Gemini and
 * a local grammar constrain generation; DeepSeek, Kimi, Qwen and GLM have JSON mode and are
 * "validate with Zod and retry". `caps.jsonStrict` is the answer for *this* endpoint, which is
 * why it lives on the profile: the same model id reached through 7.4's `openai-compatible`
 * kind and through the first-party provider are not the same capability.
 *
 * There is deliberately nothing to do on the `false` branch. `runStructured` appends the
 * schema to the system prompt of *every* request, precisely because a role's fallback may be
 * in the other camp from its primary — so the non-strict path is `generateText` with no
 * `output` bound, and the zod parse upstream is what enforces the shape.
 */
function outputFor(
  target: InvokeTarget,
  request: TextGenerationRequest,
): ReturnType<typeof Output.object> | ReturnType<typeof Output.array> | undefined {
  if (request.structuredMode === undefined) return undefined
  if (request.jsonSchema === undefined) return undefined
  if (!target.profile.caps.jsonStrict) return undefined

  const schema = jsonSchema(request.jsonSchema as Parameters<typeof jsonSchema>[0])
  const name = request.schemaName
  return request.structuredMode === 'array'
    ? Output.array({ element: schema, ...(name === undefined ? {} : { name }) })
    : Output.object({ schema, ...(name === undefined ? {} : { name }) })
}

/**
 * The only `generateText`/`streamText` call site in the codebase.
 *
 * `bindModel` is the test seam: `sdk-invoker.test.ts` passes
 * `() => new MockLanguageModelV4({ doGenerate })`, so the suite exercises the **real**
 * `generateText`, the real usage normalisation and the real error classes, with only the
 * network replaced.
 */
export function createSdkInvoker(options: { bindModel?: BindModel } = {}): ProviderInvoker {
  const bindModel = options.bindModel ?? bindLanguageModel

  return async function invoke(
    target: InvokeTarget,
    request: TextGenerationRequest,
    { signal, onElement }: InvokeOptions,
  ): Promise<InvokeOutcome> {
    const output = outputFor(target, request)

    const common = {
      model: bindModel(target.profile, target.modelId, target.apiKey),

      // `instructions`, not `system`: `system` is @deprecated in ai@7.0.93.
      //
      // The separation is the point rather than an API detail. Untrusted text — a book
      // chunk, a learner's answer, a scraped page — is always the `prompt` and never the
      // instructions. Detection of an injection attempt already lives upstream, in core's
      // `looksLikeInjection` and `activity-graders`' `sanitizeGradeInput`; this layer
      // deliberately adds no second filter, because it cannot tell which span of `prompt`
      // is untrusted, and rewriting the payload here would change the bytes behind
      // `idempotencyKey = hash(stage, input_ids, prompt_version)` so a resumed run would
      // pay for the same work twice.
      ...(request.system === undefined ? {} : { instructions: request.system }),
      prompt: request.prompt,
      temperature: request.temperature,
      ...(request.maxOutputTokens === undefined
        ? {}
        : { maxOutputTokens: request.maxOutputTokens }),
      ...(signal === undefined ? {} : { abortSignal: signal }),

      // No `tools`, ever. It is the highest-value injection control available here and it
      // is free: with no tools bound, a successful prompt injection can produce bad text
      // but never an action. 9.4's tutor introduces tools with its own review.
      ...(output === undefined ? {} : { output }),
    } as const

    try {
      // Streaming exists here for exactly one reason: `elementStream`, which §6 describes as
      // "each item arrives complete and validated". It is what lets `runStructured` persist a
      // 90-item bank as it is written rather than losing the lot to a `length` cut-off, so it
      // is taken only when the caller asked for elements *and* the schema is bound as an
      // array. Everything else stays on `generateText`, which is one round trip and no
      // partial-state bookkeeping.
      if (onElement !== undefined && output !== undefined && request.structuredMode === 'array') {
        const result = streamText({
          ...common,
          output: output as never,
          // The SDK retries twice by default. Ours is the loop that writes an `ai_calls` row
          // per attempt, so the SDK's retries would be invisible to the log and the
          // acceptance criterion "both attempts are logged" would simply be false.
          maxRetries: 0,
        })

        for await (const element of result.elementStream) {
          onElement(element)
        }

        const [text, usage, finishReason, response] = await Promise.all([
          result.text,
          result.usage,
          result.finishReason,
          result.response,
        ])

        return {
          kind: 'ok',
          text,
          modelId: target.modelId,
          usage: toBillableUsage(usage),
          finishReason: toFinishReason(finishReason),
          ...(response.id === undefined ? {} : { requestId: response.id }),
        }
      }

      // Same `maxRetries: 0`, and stated here rather than shared, so that `guards.test.ts`
      // can hold every generate call site to it by reading the call site itself.
      const result = await generateText({ ...common, maxRetries: 0 })

      return {
        kind: 'ok',
        // With an `output` bound the SDK hands back the parsed value and `result.text` is the
        // raw JSON it parsed — which is what the caller wants, because `runStructured` runs
        // its own sanitizer and its own zod schema over it. Re-serialising the parsed value
        // instead would lose the exact bytes the `ai_results` cache stores and replays.
        text: result.text,
        modelId: target.modelId,
        usage: toBillableUsage(result.usage),
        finishReason: toFinishReason(result.finishReason),
      }
    } catch (error) {
      // The model answered, and what it wrote does not fit the schema the SDK bound. That is
      // a *reviewable* completion, not a failed call: the tokens were spent, the text is the
      // one thing the repair loop needs to quote back, and the whole point of `AiReview` is
      // to give this outcome a second turn on the same model. Reported as `ok` so that it
      // reaches `review`; the `ai_calls` row then carries `meta.outputRejected` rather than
      // `status: 'error'`, which is the honest description of what happened.
      if (NoObjectGeneratedError.isInstance(error) && error.text !== undefined) {
        return {
          kind: 'ok',
          text: error.text,
          modelId: target.modelId,
          usage: toBillableUsage(error.usage),
          finishReason: toFinishReason(error.finishReason ?? 'other'),
        }
      }

      return {
        kind: 'error',
        error: fromSdkError(
          error,
          { profileId: target.profile.id, model: target.modelId },
          target.apiKey,
        ),
      }
    }
  }
}
