import { createHash } from 'node:crypto'
import type { EmbeddingProvider } from '@retenia/core'
import { compareNumbers, compareStrings, sourceRank } from '../graph/order'
import type { ExtractChunkOutput, ExtractedConcept } from '../schemas/extraction'
import { type GenerationWarning, warning } from '../schemas/warnings'
import { CONCEPT_KINDS, type ConceptKind, type SourceRef } from '../validate/types'
import { consolidatedImportance } from './importance'
import { blockingTokens, matchKey, normalizeTerm } from './normalize'
import { UnionFind } from './union-find'
import { dot } from './vector'

/**
 * Concept consolidation — the code step between stages 3 and 4 of
 * `docs/spec/04-path-generation.md` §3: the concepts every chunk yielded, "deduplicated by
 * embeddings (cosine > 0.9)" and by their names, with the source refs of every occurrence
 * kept and an importance that rewards being everywhere.
 *
 * Two passes join occurrences: an exact pass over normalised canonicals and aliases, and an
 * embedding pass over `canonical: definition` for pairs of the same kind. Everything is
 * walked in a fixed order — occurrences in chunk then concept order, pairs by index — so the
 * clusters, and with them the concept ids and the P2 prompt built from them, are the same on
 * every run of the same extractions. That is what lets a re-run hit the P2 cache.
 */

/** The chunk an extraction was made from, as much of it as consolidation needs. */
export interface ExtractedChunk {
  readonly chunkId: string
  readonly chunkKey: string | null
  readonly sourceId: string
  readonly ordinal: number
  readonly headingPath: string | null
  readonly blockIds: readonly string[]
}

export interface ChunkExtraction {
  readonly chunk: ExtractedChunk
  readonly output: ExtractChunkOutput
}

export interface ConsolidatedConcept {
  readonly concept_id: string
  readonly canonical: string
  readonly aliases: string[]
  readonly definition: string
  readonly kind: ConceptKind
  /** 1–5, the rounded median over the occurrences. */
  readonly difficulty: number
  /** 0–1, `consolidatedImportance` over the occurrences. */
  readonly importance: number
  readonly source_refs: SourceRef[]
  /** Where the primary source first mentions it; `Infinity` when only other sources do. */
  readonly first_primary_ordinal: number
  /** Names the chunks around it said a reader should already know. */
  readonly prerequisites_mentioned: string[]
  readonly occurrences: number
}

export interface ConsolidationOptions {
  readonly primarySourceId: string
  /** `[primary, ...others]` — the source rank the tie-breaks use. */
  readonly sourceIds: readonly string[]
  /** Absent means the alias pass only, with an `embeddings_unavailable` warning. */
  readonly embeddings?: EmbeddingProvider
  /** Cosine above which two occurrences are one concept. Defaults to `DEFAULT_THRESHOLD`. */
  readonly threshold?: number
  /** Past this many occurrences, only pairs sharing a token are compared. */
  readonly maxPairwise?: number
  readonly batchSize?: number
}

export interface ConsolidationResult {
  readonly concepts: ConsolidatedConcept[]
  readonly stats: {
    readonly extractions: number
    readonly frontmatterLike: number
    readonly occurrences: number
    readonly mergedByAlias: number
    readonly mergedByEmbedding: number
    readonly concepts: number
  }
  readonly embeddingModelId: string | null
  readonly warnings: GenerationWarning[]
}

/** `docs/spec/04-path-generation.md` §3 stage 4: "deduplicated by embeddings (cosine > 0.9)". */
export const DEFAULT_THRESHOLD = 0.9
export const DEFAULT_MAX_PAIRWISE = 4_000
export const DEFAULT_BATCH_SIZE = 64
export const MAX_ALIASES = 12
export const MAX_PREREQUISITES = 8

interface Occurrence {
  readonly index: number
  readonly chunk: ExtractedChunk
  readonly concept: ExtractedConcept
  readonly rank: number
  readonly normalizedCanonical: string
  readonly keys: string[]
  readonly prerequisites: readonly string[]
}

/** `c_` and 16 hex characters of the canonical's sha256: stable across regenerations. */
export function conceptIdFor(normalizedCanonical: string): string {
  return `c_${createHash('sha256').update(normalizedCanonical, 'utf8').digest('hex').slice(0, 16)}`
}

function compareOccurrences(a: Occurrence, b: Occurrence): number {
  return (
    compareNumbers(a.rank, b.rank) ||
    compareNumbers(a.chunk.ordinal, b.chunk.ordinal) ||
    compareNumbers(a.index, b.index)
  )
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort(compareNumbers)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2
}

function majorityKind(occurrences: readonly Occurrence[], canonical: Occurrence): ConceptKind {
  const counts = new Map<ConceptKind, number>()
  for (const occurrence of occurrences) {
    counts.set(occurrence.concept.kind, (counts.get(occurrence.concept.kind) ?? 0) + 1)
  }
  const best = Math.max(...counts.values())
  const tied = CONCEPT_KINDS.filter((kind) => counts.get(kind) === best)
  return tied.includes(canonical.concept.kind) ? canonical.concept.kind : (tied[0] as ConceptKind)
}

export async function consolidateConcepts(
  extractions: readonly ChunkExtraction[],
  options: ConsolidationOptions,
): Promise<ConsolidationResult> {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD
  const maxPairwise = options.maxPairwise ?? DEFAULT_MAX_PAIRWISE
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE
  const warnings: GenerationWarning[] = []

  // Occurrences, in chunk order (primary source first) then in the order the model listed.
  const ordered = [...extractions].sort(
    (a, b) =>
      compareNumbers(
        sourceRank(a.chunk.sourceId, options.sourceIds),
        sourceRank(b.chunk.sourceId, options.sourceIds),
      ) ||
      compareNumbers(a.chunk.ordinal, b.chunk.ordinal) ||
      compareStrings(a.chunk.chunkId, b.chunk.chunkId),
  )
  const occurrences: Occurrence[] = []
  let frontmatterLike = 0
  for (const extraction of ordered) {
    if (extraction.output.is_frontmatter_like) {
      frontmatterLike += 1
      continue
    }
    for (const concept of extraction.output.concepts) {
      const normalizedCanonical = normalizeTerm(concept.canonical)
      if (normalizedCanonical === '') continue
      const keys = [concept.canonical, ...concept.aliases]
        .map(matchKey)
        .filter((key): key is string => key !== null)
      occurrences.push({
        index: occurrences.length,
        chunk: extraction.chunk,
        concept,
        rank: sourceRank(extraction.chunk.sourceId, options.sourceIds),
        normalizedCanonical,
        keys: [...new Set(keys)],
        prerequisites: extraction.output.prerequisites_mentioned,
      })
    }
  }

  const sets = new UnionFind(occurrences.length)

  // Pass 1 — names: any shared canonical or alias, exactly, after normalisation.
  let mergedByAlias = 0
  const byKey = new Map<string, number>()
  for (const occurrence of occurrences) {
    for (const key of occurrence.keys) {
      const first = byKey.get(key)
      if (first === undefined) byKey.set(key, occurrence.index)
      else if (sets.union(first, occurrence.index)) mergedByAlias += 1
    }
  }

  // Pass 2 — meaning: embeddings of `canonical: definition`, same kind only.
  let mergedByEmbedding = 0
  let embeddingModelId: string | null = null
  if (options.embeddings === undefined) {
    warnings.push(warning('embeddings_unavailable'))
  } else if (occurrences.length > 1) {
    /**
     * A provider that is wired but cannot answer today.
     *
     * `deps.embeddings` is decided once, at startup, while whether a model is *configured* is
     * a setting the user changes — so "there is a provider" and "it can embed right now" are
     * different questions, and only the second one can be asked here. A provider that throws,
     * or that returns fewer vectors than it was given texts, is not usable for this pass:
     * indexing past the end would compare `undefined` against `undefined` and take down a
     * whole generation run over a setting.
     *
     * The answer is the one this function already gives for no provider at all — the alias
     * pass alone, and `embeddings_unavailable` so the manifest says why the path was
     * consolidated on names.
     */
    const vectors: Float32Array[] = []
    let usable = true
    try {
      for (let start = 0; start < occurrences.length; start += batchSize) {
        const page = occurrences.slice(start, start + batchSize)
        vectors.push(
          ...(await options.embeddings.embed(
            page.map(
              (occurrence) => `${occurrence.concept.canonical}: ${occurrence.concept.definition}`,
            ),
          )),
        )
      }
    } catch {
      usable = false
    }
    if (!usable || vectors.length < occurrences.length) {
      warnings.push(warning('embeddings_unavailable'))
    } else {
      embeddingModelId = options.embeddings.modelId
      for (const [a, b] of candidatePairs(occurrences, maxPairwise)) {
        const left = occurrences[a] as Occurrence
        const right = occurrences[b] as Occurrence
        if (left.concept.kind !== right.concept.kind) continue
        if (dot(vectors[a] as Float32Array, vectors[b] as Float32Array) <= threshold) continue
        if (sets.union(a, b)) mergedByEmbedding += 1
      }
    }
  }

  // Clusters → concepts.
  const concepts: ConsolidatedConcept[] = []
  const usedIds = new Map<string, number>()
  for (const members of sets.groups()) {
    const group = members.map((index) => occurrences[index] as Occurrence).sort(compareOccurrences)

    const spellingCounts = new Map<string, number>()
    for (const occurrence of group) {
      spellingCounts.set(
        occurrence.normalizedCanonical,
        (spellingCounts.get(occurrence.normalizedCanonical) ?? 0) + 1,
      )
    }
    const mostFrequent = Math.max(...spellingCounts.values())
    const canonicalOccurrence = group.find(
      (occurrence) => spellingCounts.get(occurrence.normalizedCanonical) === mostFrequent,
    ) as Occurrence
    const canonical = canonicalOccurrence.concept.canonical

    // One spelling per normalised form: a spelling the model used as a canonical somewhere
    // beats one it only listed as an alias, then the first seen wins.
    const aliases = new Map<string, string>()
    const spellings = [
      ...group.map((occurrence) => occurrence.concept.canonical),
      ...group.flatMap((occurrence) => occurrence.concept.aliases),
    ]
    for (const spelling of spellings) {
      const normalized = normalizeTerm(spelling)
      if (normalized === '' || normalized === canonicalOccurrence.normalizedCanonical) continue
      if (!aliases.has(normalized)) aliases.set(normalized, spelling)
    }

    const primary = group.filter((occurrence) => occurrence.rank === 0)
    const definitionSource = [...(primary.length > 0 ? primary : group)].sort(
      (a, b) =>
        compareNumbers(b.concept.importance, a.concept.importance) || compareOccurrences(a, b),
    )[0] as Occurrence

    const refs = new Map<string, SourceRef>()
    for (const occurrence of group) {
      if (refs.has(occurrence.chunk.chunkId)) continue
      refs.set(occurrence.chunk.chunkId, {
        source_id: occurrence.chunk.sourceId,
        chunk_id: occurrence.chunk.chunkId,
        chunk_key: occurrence.chunk.chunkKey,
        block_ids: [...occurrence.chunk.blockIds],
        heading_path: occurrence.chunk.headingPath,
        ordinal: occurrence.chunk.ordinal,
      })
    }
    const sourceRefs = [...refs.values()].sort(
      (a, b) =>
        compareNumbers(
          sourceRank(a.source_id, options.sourceIds),
          sourceRank(b.source_id, options.sourceIds),
        ) ||
        compareNumbers(a.ordinal, b.ordinal) ||
        compareStrings(a.chunk_id, b.chunk_id),
    )
    const primaryOrdinals = sourceRefs
      .filter((ref) => ref.source_id === options.primarySourceId)
      .map((ref) => ref.ordinal)

    const prerequisites = new Map<string, string>()
    for (const occurrence of group) {
      for (const mentioned of occurrence.prerequisites) {
        const normalized = normalizeTerm(mentioned)
        if (normalized === '' || normalized === canonicalOccurrence.normalizedCanonical) continue
        if (!prerequisites.has(normalized)) prerequisites.set(normalized, mentioned)
      }
    }

    let conceptId = conceptIdFor(canonicalOccurrence.normalizedCanonical)
    const collisions = usedIds.get(conceptId) ?? 0
    usedIds.set(conceptId, collisions + 1)
    // Two clusters can share a canonical only when it was too short to be a matching key;
    // a suffix keeps their ids apart, deterministically.
    if (collisions > 0) conceptId = `${conceptId}-${collisions + 1}`

    concepts.push({
      concept_id: conceptId,
      canonical,
      aliases: [...aliases.values()].sort(compareStrings).slice(0, MAX_ALIASES),
      definition: definitionSource.concept.definition,
      kind: majorityKind(group, canonicalOccurrence),
      difficulty: Math.min(
        5,
        Math.max(1, Math.round(median(group.map((o) => o.concept.difficulty)))),
      ),
      importance: consolidatedImportance(
        Math.max(...group.map((occurrence) => occurrence.concept.importance)),
        sourceRefs.length,
        new Set(sourceRefs.map((ref) => ref.source_id)).size,
      ),
      source_refs: sourceRefs,
      first_primary_ordinal:
        primaryOrdinals.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...primaryOrdinals),
      prerequisites_mentioned: [...prerequisites.values()].slice(0, MAX_PREREQUISITES),
      occurrences: group.length,
    })
  }

  concepts.sort(
    (a, b) =>
      compareNumbers(a.first_primary_ordinal, b.first_primary_ordinal) ||
      compareNumbers(b.importance, a.importance) ||
      compareStrings(a.concept_id, b.concept_id),
  )

  return {
    concepts,
    stats: {
      extractions: extractions.length,
      frontmatterLike,
      occurrences: occurrences.length,
      mergedByAlias,
      mergedByEmbedding,
      concepts: concepts.length,
    },
    embeddingModelId,
    warnings,
  }
}

/**
 * Which pairs the embedding pass compares: every pair while the count is small, and past
 * `maxPairwise` only pairs that share a blocking token — bounded work over a big book, at the
 * cost of missing a paraphrase that shares no word.
 */
export function candidatePairs(
  occurrences: readonly Occurrence[],
  maxPairwise: number,
): Array<readonly [number, number]> {
  const pairs: Array<readonly [number, number]> = []
  if (occurrences.length <= maxPairwise) {
    for (let a = 0; a < occurrences.length; a += 1) {
      for (let b = a + 1; b < occurrences.length; b += 1) pairs.push([a, b])
    }
    return pairs
  }
  const byToken = new Map<string, number[]>()
  for (const occurrence of occurrences) {
    for (const token of new Set(blockingTokens(occurrence.normalizedCanonical))) {
      const list = byToken.get(token) ?? []
      list.push(occurrence.index)
      byToken.set(token, list)
    }
  }
  const seen = new Set<string>()
  for (const token of [...byToken.keys()].sort(compareStrings)) {
    const members = byToken.get(token) as number[]
    for (let i = 0; i < members.length; i += 1) {
      for (let j = i + 1; j < members.length; j += 1) {
        const a = members[i] as number
        const b = members[j] as number
        const key = `${a}:${b}`
        if (seen.has(key)) continue
        seen.add(key)
        pairs.push([a, b])
      }
    }
  }
  return pairs.sort((x, y) => compareNumbers(x[0], y[0]) || compareNumbers(x[1], y[1]))
}
