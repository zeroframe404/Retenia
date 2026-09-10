import { createHash } from 'node:crypto'
import { z } from 'zod'

/**
 * What the "Generate with AI" panel asks for (`docs/spec/04-path-generation.md` §13 step 1:
 * "goal in one sentence, level, lesson language, is it for an exam? date, pace (hours/week),
 * primary source, scope (everything / chapters)"), as the schema every run is started from.
 *
 * Defined here rather than in the wizard (sub-phase 8.2) because the run, the estimator and
 * the manifest all read it, and because half of it is part of P2's `custom_id`: two runs
 * with the same sources and the same *relevant* configuration must ask the model the same
 * question, or the cache never hits.
 */

/** A BCP-47 language tag, loosely: `es`, `es-AR`, `en-GB`, `pt-BR`. */
export const BCP47 = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** The separator the chunker writes into `chunks.heading_path` (`Book > Chapter 3 > 3.2`). */
export const HEADING_PATH_SEPARATOR = ' > '

export const generationScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }),
  z.object({
    kind: z.literal('selected'),
    /** Heading-path prefixes as the chunker spells them; a chunk is in scope when its own
     *  heading path equals one of them or continues it past a separator. */
    headingPaths: z.array(z.string().trim().min(1).max(500)).min(1).max(200),
  }),
])
export type GenerationScope = z.infer<typeof generationScopeSchema>
/** What `isChunkInScope` reads — a readonly view, so a frozen scope from a test or a
 *  manifest is accepted as-is. */
export type GenerationScopeLike =
  | { readonly kind: 'all' }
  | { readonly kind: 'selected'; readonly headingPaths: readonly string[] }

export const generationConfigSchema = z
  .object({
    /** The one-sentence goal typed into the panel. */
    goal: z.string().trim().min(1).max(500),
    /** Free text, mirroring `paths.level`: `beginner`, `B1`, `undergraduate`… */
    level: z.string().trim().min(1).max(60),
    /** The language the path is written in. Sources may be in another. */
    lessonLanguage: z.string().regex(BCP47).default('es-AR'),
    /**
     * The language being *learned*, when the path teaches one — §7's "to learn English, the
     * lesson goes in Spanish and the items in English".
     *
     * `null` for every other path, which is the common case: a physics path is written in
     * `lessonLanguage` and so is everything in it. When it is set, P3 keeps the prose in
     * `lessonLanguage` and leaves the material being learned in this one, rather than
     * translating the very thing the learner is supposed to acquire.
     */
    targetLanguage: z.string().regex(BCP47).nullable().default(null),
    forExam: z
      .object({ date: z.string().regex(ISO_DATE) })
      .nullable()
      .default(null),
    paceHoursPerWeek: z.number().min(0.5).max(60).default(3),
    /** The source whose narrative the path follows; must be one of `sourceIds`. */
    primarySourceId: z.string().min(1),
    scope: generationScopeSchema.default({ kind: 'all' }),
    sourceIds: z.array(z.string().min(1)).min(1).max(50),
    /** The run's own cost cap in USD. `0` means no cap, the same reading as the monthly one. */
    budgetCapUsd: z.number().min(0).max(1000).default(0),
    /** The path's title; defaults to the primary source's title when absent. */
    title: z.string().trim().min(1).max(200).optional(),
  })
  .superRefine((config, ctx) => {
    if (!config.sourceIds.includes(config.primarySourceId)) {
      ctx.addIssue({
        code: 'custom',
        path: ['primarySourceId'],
        message: 'the primary source must be one of sourceIds',
      })
    }
    if (new Set(config.sourceIds).size !== config.sourceIds.length) {
      ctx.addIssue({ code: 'custom', path: ['sourceIds'], message: 'sourceIds must not repeat' })
    }
  })

export type GenerationConfig = z.infer<typeof generationConfigSchema>
/** What the wizard hands in: the defaults may be left out. */
export type GenerationConfigInput = z.input<typeof generationConfigSchema>

export function parseGenerationConfig(input: unknown): GenerationConfig {
  return generationConfigSchema.parse(input)
}

/** The primary source first, then the others in the order the user listed them. */
export function orderedSourceIds(
  config: Pick<GenerationConfig, 'primarySourceId' | 'sourceIds'>,
): string[] {
  return [config.primarySourceId, ...config.sourceIds.filter((id) => id !== config.primarySourceId)]
}

/**
 * Whether a chunk falls inside the requested scope.
 *
 * A selected heading path matches itself and everything nested under it — `Cap. 1` matches
 * `Cap. 1 > 1.2` but not `Cap. 10`, because the continuation has to start with the
 * separator. A chunk with no heading path is only ever in scope when everything is.
 */
export function isChunkInScope(
  chunk: { headingPath: string | null },
  scope: GenerationScopeLike,
): boolean {
  if (scope.kind === 'all') return true
  if (chunk.headingPath === null) return false
  const path = chunk.headingPath
  return scope.headingPaths.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}${HEADING_PATH_SEPARATOR}`),
  )
}

/**
 * sha256 over the parts of the configuration that change what P2 is asked, in a canonical
 * shape: `sourceIds` are ordered primary-first and the keys are fixed, so two wizards that
 * produce the same choices in a different order hash the same.
 *
 * `budgetCapUsd` and `title` are deliberately excluded — neither reaches the model, and a
 * user raising their cap to resume a run must find the outline it was already paying for.
 */
export function configHash(config: GenerationConfig): string {
  const canonical = {
    goal: config.goal,
    level: config.level,
    lessonLanguage: config.lessonLanguage,
    forExam: config.forExam,
    paceHoursPerWeek: config.paceHoursPerWeek,
    primarySourceId: config.primarySourceId,
    scope:
      config.scope.kind === 'all'
        ? { kind: 'all' }
        : { kind: 'selected', headingPaths: [...config.scope.headingPaths].sort() },
    sourceIds: orderedSourceIds(config),
  }
  return createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex')
}
