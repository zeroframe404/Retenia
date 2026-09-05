import type { Activity, GradeResult, MediaRef } from '@retenia/activity-schema'
import type { AiGradeEngine, ExplainAnswer, GradeMeta } from '@retenia/core'
import { AI_GRADE_ENGINES } from '@retenia/core'

/**
 * The ports `<ActivityHost/>` depends on, in the sense `docs/spec/01-decisions.md` §5 gives the
 * word: the host is pure React over interfaces, and the Electron/AI side of each one is supplied
 * by `apps/desktop`. Every port has a stub default here so Storybook, the tests and the fixture
 * catalog run with nothing wired.
 */

export interface ExplainAnswerInput {
  activity: Activity
  /** The family response the user submitted, or `null` if they asked before answering. */
  response: unknown
  result: GradeResult | null
  /** BCP-47 tag of the answer language, so the tutor replies in it. */
  lang: string
  signal?: AbortSignal
}

/**
 * §9's "Explain" button: "calls the AI with the activity + answer + explanation". The real
 * implementation lands with the tutor in sub-phase 9.4 and goes over `packages/ipc-contract`;
 * until then the stub returns the activity's static `explanation` (§7) when it has one.
 */
export type ExplainAnswerPort = (input: ExplainAnswerInput) => Promise<string>

export class ExplainAnswerUnavailableError extends Error {
  constructor() {
    super('explainAnswer: no AI tutor is wired yet (sub-phase 9.4)')
    this.name = 'ExplainAnswerUnavailableError'
  }
}

/** Falls back to the authored `explanation`; without one it rejects, and the host shows the error. */
export const staticExplainAnswer: ExplainAnswerPort = async ({ activity }) => {
  if (activity.explanation) return activity.explanation
  throw new ExplainAnswerUnavailableError()
}

/**
 * What the learner wrote, as a domain `ExplainAnswer` wants it: the text of a `long_text`
 * answer, and the serialized response for every other family — a `matching_pairs` answer has no
 * prose, and JSON is a truer rendering of it than a guess at one would be.
 */
export function answerTextOf(activity: Activity, response: unknown): string {
  if (
    activity.family === 'long_text' &&
    typeof response === 'object' &&
    response !== null &&
    'text' in response &&
    typeof response.text === 'string'
  ) {
    return response.text
  }
  return response === null || response === undefined ? '' : JSON.stringify(response)
}

/**
 * Adapts `@retenia/core`'s domain `ExplainAnswer` — which knows nothing about React or about a
 * family response — to the host's port.
 *
 * The two exist separately on purpose: the domain port is what `packages/activity-ai` and the
 * tutor of sub-phase 9.4 implement, and the host port is what a renderer calls. This is the one
 * seam between them, and it is where the `GradeResult` on screen is turned back into the
 * `AiGradeResult` the explainer was given — using the rubric breakdown the AI grader left on
 * `meta.ai`, so the explanation can talk about criteria rather than about a bare percentage.
 */
function aiEngineOf(engine: string | undefined): AiGradeEngine {
  // A deterministic grade being explained (`fuzzy`, `keypoints`…) has no AI engine of its own;
  // reporting `local` says "no model produced this", which is exactly true.
  return AI_GRADE_ENGINES.includes(engine as AiGradeEngine) ? (engine as AiGradeEngine) : 'local'
}

export function explainAnswerPort(explain: ExplainAnswer): ExplainAnswerPort {
  return async ({ activity, response, result, signal }) =>
    explain({
      activity: {
        id: activity.id,
        type: activity.type,
        lang: activity.lang,
        prompt: activity.prompt,
        ...(activity.instructions === undefined ? {} : { instructions: activity.instructions }),
      },
      answer: answerTextOf(activity, response),
      gradeResult:
        result === null
          ? null
          : {
              perCriterion: result.meta.ai?.perCriterion ?? [],
              score: result.score,
              rating: result.rating,
              feedback: result.feedback,
              uncertain: result.meta.uncertain ?? false,
              evidence: result.meta.ai?.evidence ?? [],
              engine: aiEngineOf(result.meta.engine),
              injectionSuspected: result.meta.ai?.injectionSuspected ?? false,
            },
      ...(signal === undefined ? {} : { signal }),
    })
}

export interface SpeakInput {
  text: string
  lang: string
  /** A `MediaRef.generate.voice` id, when the activity names one. */
  voice?: string
  signal?: AbortSignal
}

/** TTS for `AudioButton`. Real providers arrive in sub-phase 11.3; the stub is a no-op. */
export type SpeakPort = (input: SpeakInput) => Promise<void>

export const noopSpeak: SpeakPort = async () => {}

/**
 * How an answer becomes a `GradeResult`. The default is the pure family dispatch of
 * `@retenia/activity-graders`; `long_text` swaps in the AI grader in sub-phase 5.5, and a mock exam
 * swaps in a deferred one — which is why the host takes it as a port rather than importing it.
 */
export type GradePort = (
  activity: Activity,
  response: unknown,
  meta: GradeMeta,
) => GradeResult | Promise<GradeResult>

/**
 * Turns a `MediaRef` into something a `<img>`/`<audio>`/`<video>` can load, or `null` when the
 * asset is not available (a `pending_media` activity, §11, or a host with no blob store).
 */
export type ResolveMediaPort = (asset: MediaRef) => string | null

/** `00-conventions.md`: blobs live outside the database, content-addressed by sha256. */
export const SHA256_REF_PATTERN = /^sha256:([0-9a-f]+)$/i

/**
 * The default resolver: a content-addressed reference becomes a `media://blob/<sha256>` URL — the
 * scheme `apps/desktop`'s `media-protocol.ts` serves, with Range support — and anything that is
 * already a URL is passed through. A ref with no `src` at all has nothing to show yet.
 *
 * Storybook and the tests have no blob store, so they pass a resolver of their own; that is the
 * whole reason this is a port and not a string concatenation inside the renderer.
 */
export const defaultResolveMedia: ResolveMediaPort = (asset) => {
  if (!asset.src) return null
  const hash = SHA256_REF_PATTERN.exec(asset.src)?.[1]
  return hash === undefined ? asset.src : `media://blob/${hash}`
}

/** Epoch milliseconds. Injected so the timer is deterministic under fake timers. */
export type NowPort = () => number
