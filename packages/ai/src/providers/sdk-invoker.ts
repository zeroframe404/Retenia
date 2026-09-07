import { generateText } from 'ai'
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

/**
 * The only `generateText` call site in the codebase.
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
    { signal }: InvokeOptions,
  ): Promise<InvokeOutcome> {
    try {
      const result = await generateText({
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

        // The SDK retries twice by default. Ours is the loop that writes an `ai_calls` row
        // per attempt, so the SDK's retries would be invisible to the log and the
        // acceptance criterion "both attempts are logged" would simply be false.
        maxRetries: 0,

        // No `tools`, ever. It is the highest-value injection control available here and it
        // is free: with no tools bound, a successful prompt injection can produce bad text
        // but never an action. 9.4's tutor introduces tools with its own review.
        //
        // No `output` either: `jsonSchema`/`schemaName` are accepted on the request and not
        // yet enforced — 7.2 maps them onto `output: Output.object(...)` with the
        // validation/repair loop. Every current caller already validates what it gets back.
      })

      return {
        kind: 'ok',
        text: result.text,
        modelId: target.modelId,
        usage: toBillableUsage(result.usage),
        finishReason: FINISH_REASONS.has(result.finishReason)
          ? (result.finishReason as FinishReason)
          : 'other',
      }
    } catch (error) {
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
