import type { CachePlan, ProviderProfile, TokenCounter } from '@retenia/ai'
import { cacheTtlFor, withCache } from '@retenia/ai'
import type { PathDraft } from '../schemas/path-draft'
import { headerLine, oneLine } from '../text'
import type { GlossaryTerm } from './context'
import { LESSON_FEW_SHOTS } from './few-shots'
import { MAX_DEFINITION_CHARS, MAX_TITLE_CHARS } from './theory-task'

/**
 * The cached head of every P3 call of one path (§3 stage 7: "few-shots cacheados, breakpoint
 * de caché en system + few-shots + sources, TTL 1 h").
 *
 * The breakpoint goes on the material that is the *same for every lesson of the path* — the
 * instructions, the two model lessons, the outline and the path glossary — and the lesson's
 * own fragments travel in the task after it. That is the only split a provider can actually
 * use: a prefix is matched byte for byte from the start, so putting one lesson's sources in
 * it would build a prefix no second call ever matches and buy nothing. It is the arrangement
 * `synthesize.ts` already uses for P2's modules.
 *
 * At 40 lessons this is the difference between paying for the head once and paying for it
 * forty times; `estimate-generation.ts`'s `P3_CACHED_PREFIX_TOKENS` assumes it.
 */

/** Titles are cheap and the outline is the whole path; definitions are the expensive half. */
export const MAX_OUTLINE_LESSONS = 200

export interface LessonPrefixInput {
  readonly draft: PathDraft
  readonly glossary: readonly GlossaryTerm[]
}

export interface LessonPrefixOptions {
  readonly profile: ProviderProfile
  readonly modelId: string
  readonly countTokens?: TokenCounter
}

/**
 * `section → module → lesson` titles, so the model knows what comes before and after and does
 * not teach a neighbour's material a second time.
 */
export function outlineDigest(draft: PathDraft): string {
  const lines: string[] = []
  let lessons = 0
  for (const section of draft.sections) {
    lines.push(`# ${oneLine(section.title, MAX_TITLE_CHARS)}`)
    for (const module of section.modules) {
      lines.push(`## ${oneLine(module.title, MAX_TITLE_CHARS)}`)
      for (const lesson of module.lessons) {
        if (lessons >= MAX_OUTLINE_LESSONS) continue
        lessons += 1
        lines.push(`- ${lesson.id}: ${oneLine(lesson.title, MAX_TITLE_CHARS)}`)
      }
    }
  }
  return lines.join('\n')
}

export function pathGlossaryDigest(glossary: readonly GlossaryTerm[]): string {
  return glossary
    .map(
      (term) =>
        `- ${headerLine(term.conceptId, 60)}: ${oneLine(term.name, MAX_TITLE_CHARS)} — ` +
        oneLine(term.definition, MAX_DEFINITION_CHARS),
    )
    .join('\n')
}

/**
 * The few-shots are ours and the other two sections are learner-derived, so all three go
 * through `withCache`, which wraps each in its own `<user_content>` block. Wrapping our own
 * examples costs nothing and keeps the block order — and therefore the bytes — uniform.
 */
export function buildLessonPrefix(
  system: string,
  input: LessonPrefixInput,
  options: LessonPrefixOptions,
): CachePlan {
  return withCache(
    system,
    [LESSON_FEW_SHOTS, outlineDigest(input.draft), pathGlossaryDigest(input.glossary)],
    {
      profile: options.profile,
      modelId: options.modelId,
      labels: ['few_shots', 'outline', 'path_glossary'],
      ttl: cacheTtlFor({ pathGeneration: true }),
      ...(options.countTokens === undefined ? {} : { countTokens: options.countTokens }),
    },
  )
}
