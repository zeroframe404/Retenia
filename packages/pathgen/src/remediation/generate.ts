import type { AiClient, AiResultCache, ProviderRole, Timers } from '@retenia/ai'
import type {
  Chunk,
  Clock,
  ItemBankEntry,
  RemediationAuthorCollected,
  RemediationAuthorRequest,
} from '@retenia/core'
import { parseSourceLocator } from '@retenia/core'
import { resolveCitations } from '../expand/citations'
import type { CitableFragment, LessonContext } from '../expand/context'
import { expansionBinding } from '../expand/requests'
import { runWave } from '../expand/wave'
import { locatorLabel } from '../extract/task'
import { readAuthoring } from '../item-bank/stems'
import type { PathgenLogger } from '../logger'
import type { PathgenPrompt } from '../prompts'
import type { LessonCitation, LessonTheory, TheoryBlock } from '../schemas/lesson'
import type { GenerationWarning } from '../schemas/warnings'
import { oneLine } from '../text'
import type { RemediationAuthor } from './author'
import { REMEDIATION_POLICY, type RemediationPolicy } from './policy'

/**
 * P11's dispatch and what is made of its answer (`docs/spec/04-path-generation.md` §9 P11:
 * *"concept + misconception + errors + chunks → 3–5 min mini-lesson with 1 worked example + 3
 * items"*).
 *
 * One synchronous call — the learner is looking at the path map when the detour appears —
 * through the same `runWave` every other stage uses, so the answer lands in `ai_results` and a
 * retry after a crash replays it instead of paying twice. The citations are resolved by the
 * same `resolveCitations` P3's are: an uncited substantive block becomes `general_knowledge`.
 */

export const REMEDIATION_STAGE = 'P11_remediation'
export const MAX_REMEDIATION_FRAGMENTS = 6
const MAX_FRAGMENT_CHARS = 1_800
const MAX_HEADING_CHARS = 200
const WORDS_PER_MINUTE = 200
const SECONDS_PER_ITEM = 45
const SECONDS_PER_CARD = 20

/** The chunks as cite-able fragments `B01`…, first occurrence wins, at most six. */
export function fragmentsFrom(chunks: readonly Chunk[]): CitableFragment[] {
  const seen = new Set<string>()
  const fragments: CitableFragment[] = []
  for (const chunk of chunks) {
    if (seen.has(chunk.id) || fragments.length >= MAX_REMEDIATION_FRAGMENTS) continue
    seen.add(chunk.id)
    const locator = parseSourceLocator(chunk)
    fragments.push({
      citeId: `B${String(fragments.length + 1).padStart(2, '0')}`,
      chunkId: chunk.id,
      sourceId: chunk.sourceId,
      blockIds: [...new Set(locator.blockIds)],
      headingPath:
        chunk.headingPath === null ? null : oneLine(chunk.headingPath, MAX_HEADING_CHARS),
      locator: locatorLabel(locator),
      text:
        chunk.text.length <= MAX_FRAGMENT_CHARS
          ? chunk.text
          : `${chunk.text.slice(0, MAX_FRAGMENT_CHARS)}…`,
      truncated: chunk.text.length > MAX_FRAGMENT_CHARS,
      origin: 'mapped',
    })
  }
  return fragments
}

/**
 * The item bank's `remediation` items on this concept, least exposed first (the order
 * `listByUsage` returns), minus the ones the learner just got wrong — a detour that asks the
 * failed question again measures memory of the question.
 */
export function pickBankItems(
  entries: readonly ItemBankEntry[],
  conceptId: string,
  exclude: ReadonlySet<string>,
  max: number = REMEDIATION_POLICY.items,
): ItemBankEntry[] {
  return entries
    .filter((entry) => !exclude.has(entry.id) && !exclude.has(entry.activityId))
    .filter((entry) => readAuthoring(entry).conceptIds.includes(conceptId))
    .slice(0, Math.max(0, max))
}

/** §11's 3–5 minutes, from what the detour actually holds. */
export function estimateMinutes(
  words: number,
  items: number,
  hasCard: boolean,
  policy: Pick<RemediationPolicy, 'minutes'> = REMEDIATION_POLICY,
): number {
  const seconds =
    (words / WORDS_PER_MINUTE) * 60 + items * SECONDS_PER_ITEM + (hasCard ? SECONDS_PER_CARD : 0)
  return Math.min(policy.minutes.max, Math.max(policy.minutes.min, Math.ceil(seconds / 60)))
}

function countWords(text: string): number {
  const trimmed = text.trim()
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length
}

export interface AssembledTheory {
  readonly theory: LessonTheory
  readonly citations: readonly LessonCitation[]
  readonly warnings: readonly GenerationWarning[]
}

/** P11's blocks as `Lesson.v1.theory`, citations resolved against the fragments it was shown. */
export function assembleTheory(
  collected: Pick<RemediationAuthorCollected, 'blocks'>,
  fragments: readonly CitableFragment[],
  specId: string,
  misconceptionId: string | null,
): AssembledTheory {
  const blocks: TheoryBlock[] = collected.blocks.map((block) => ({
    type: block.type,
    content: block.content,
    citations: [...block.citations],
    diagram: null,
    misconception_id: block.type === 'misconception' ? misconceptionId : null,
  }))
  const wordCount = blocks.reduce((sum, block) => sum + countWords(block.content), 0)
  const context: LessonContext = {
    citable: fragments,
    previous: [],
    glossary: [],
    budgetedTokens: 0,
    trimmed: 0,
    warnings: [],
  }
  const resolved = resolveCitations(
    { blocks, glossary: [], word_count: wordCount, warnings: [] },
    context,
    specId,
  )
  return {
    theory: { version: 1, blocks: [...resolved.blocks], glossary: [], word_count: wordCount },
    citations: resolved.citations,
    warnings: resolved.warnings,
  }
}

export interface WriteRemediationDeps {
  readonly ai: Pick<AiClient, 'structured'>
  readonly resultCache?: Pick<AiResultCache, 'get'>
  readonly author: RemediationAuthor
  readonly prompt: PathgenPrompt
  readonly clock: Clock
  readonly timers: Pick<Timers, 'sleep'>
  readonly logger: PathgenLogger
}

export class RemediationWriteError extends Error {
  override readonly name = 'RemediationWriteError'
}

/** One P11 call, synchronous, on the role the learner's setting picked. */
export async function writeRemediation(
  deps: WriteRemediationDeps,
  request: RemediationAuthorRequest,
  role: ProviderRole,
): Promise<RemediationAuthorCollected> {
  const call = deps.author.plan(request)
  if (call.injectionSuspected) {
    deps.logger.warn(
      `[pathgen] ${request.specId}: the remediation task looks like it carries instructions; ` +
        'it is sent as data, as always',
    )
  }
  const box: { collected: RemediationAuthorCollected | null } = { collected: null }
  const result = await runWave(
    {
      ai: deps.ai,
      ...(deps.resultCache === undefined ? {} : { resultCache: deps.resultCache }),
      clock: deps.clock,
      timers: deps.timers,
      logger: deps.logger,
      concurrency: 1,
    },
    {
      requests: [{ customId: call.customId, structured: call.structured, batch: call.batch }],
      binding: { ...expansionBinding(deps.prompt, REMEDIATION_STAGE), role },
      userWaiting: true,
      allowOverBudget: false,
    },
    async ({ value }) => {
      box.collected = deps.author.collect(call, value)
    },
  )
  const collected = box.collected
  if (collected === null) {
    throw new RemediationWriteError(
      result.failed[0]?.error ?? `P11 returned no answer (${result.status})`,
    )
  }
  if (collected.blocks.length === 0) {
    throw new RemediationWriteError(
      `P11 wrote no explanation: ${collected.rejected[0]?.message ?? 'empty answer'}`,
    )
  }
  return collected
}
