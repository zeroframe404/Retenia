import type { ChunkRepository, PathRepository, SourceRepository } from '@retenia/core'
import { parseGenerationConfig } from '../config/generation-config'
import { chunkSetHash } from '../manifest/build-manifest'
import { planChunks } from '../run/plan-chunks'
import { lessonCitationSchema } from '../schemas/lesson'
import { type GenerationManifest, generationManifestSchema } from '../schemas/manifest'
import { pathDraftSchema } from '../schemas/path-draft'

/**
 * "Regenerar afectadas" (`docs/spec/04-path-generation.md` §14 pitfall 19: "fixed path vs
 * reality — offer 'regenerate the affected ones'"): a source was updated since the version was
 * generated, so the lessons written from it may no longer say what it says.
 *
 * A source has **changed** when its file hash differs from the one the manifest recorded, or —
 * for sources with no file (a web page) — when the chunk set in scope hashes differently. A
 * lesson is **affected** when it rests on a fragment of a changed source that no longer exists:
 * re-chunking keeps a chunk whose text did not change (`chunks.chunk_key`), so a lesson citing
 * only the unchanged part of an edited book is left alone. What a lesson rests on is its
 * citations once it has been written, and the outline's mapping before that — so a lesson
 * re-written against the new source stops being listed on its own.
 */

export const SOURCE_CHANGE_REASONS = ['blob_changed', 'chunks_changed', 'missing'] as const
export type SourceChangeReason = (typeof SOURCE_CHANGE_REASONS)[number]

export interface ChangedSource {
  readonly sourceId: string
  readonly reason: SourceChangeReason
}

export interface CurrentSource {
  readonly blobSha256: string | null
  readonly chunkSetHash: string
}

export function changedSources(
  manifest: Pick<GenerationManifest, 'source_hashes'>,
  current: ReadonlyMap<string, CurrentSource>,
): ChangedSource[] {
  const changed: ChangedSource[] = []
  for (const recorded of manifest.source_hashes) {
    const now = current.get(recorded.source_id)
    if (now === undefined) {
      changed.push({ sourceId: recorded.source_id, reason: 'missing' })
    } else if (recorded.blob_sha256 !== null && now.blobSha256 !== recorded.blob_sha256) {
      changed.push({ sourceId: recorded.source_id, reason: 'blob_changed' })
    } else if (now.chunkSetHash !== recorded.chunk_set_hash) {
      changed.push({ sourceId: recorded.source_id, reason: 'chunks_changed' })
    }
  }
  return changed
}

export interface AffectedCandidate {
  readonly lessonId: string
  readonly specId: string
  readonly title: string
  /** What the lesson rests on: its citations, or the outline's mapping before it was written. */
  readonly refs: readonly { readonly chunkId: string; readonly sourceId: string }[]
}

export interface AffectedLesson {
  readonly lessonId: string
  readonly specId: string
  readonly title: string
  readonly sourceIds: readonly string[]
  /** Fragments it rests on that the changed sources no longer have. */
  readonly missingFragments: number
}

export function affectedLessons(
  lessons: readonly AffectedCandidate[],
  changed: ReadonlySet<string>,
  live: ReadonlySet<string>,
): AffectedLesson[] {
  const out: AffectedLesson[] = []
  for (const lesson of lessons) {
    const gone = lesson.refs.filter((ref) => changed.has(ref.sourceId) && !live.has(ref.chunkId))
    if (gone.length === 0) continue
    out.push({
      lessonId: lesson.lessonId,
      specId: lesson.specId,
      title: lesson.title,
      sourceIds: [...new Set(gone.map((ref) => ref.sourceId))].sort(),
      missingFragments: new Set(gone.map((ref) => ref.chunkId)).size,
    })
  }
  return out
}

export interface AffectedRepos {
  readonly paths: Pick<PathRepository, 'findVersion' | 'loadTree'>
  readonly sources: Pick<SourceRepository, 'findMany'>
  readonly chunks: Pick<ChunkRepository, 'listBySource' | 'findMany'>
}

export interface AffectedResult {
  readonly sources: readonly ChangedSource[]
  readonly lessons: readonly AffectedLesson[]
}

const NOTHING: AffectedResult = Object.freeze({ sources: [], lessons: [] })

export async function findAffectedLessons(
  repos: AffectedRepos,
  pathVersionId: string,
): Promise<AffectedResult> {
  const version = await repos.paths.findVersion(pathVersionId)
  const manifest = generationManifestSchema.safeParse(version?.manifest)
  if (version === undefined || !manifest.success) return NOTHING
  let config: ReturnType<typeof parseGenerationConfig>
  try {
    config = parseGenerationConfig(manifest.data.config)
  } catch {
    return NOTHING
  }

  const recordedIds = manifest.data.source_hashes.map((entry) => entry.source_id)
  const sources = await repos.sources.findMany(recordedIds)
  const chunksBySource = new Map(
    await Promise.all(
      sources.map(
        async (source) => [source.id, await repos.chunks.listBySource(source.id)] as const,
      ),
    ),
  )
  const plan = planChunks(sources, chunksBySource, config)
  const current = new Map<string, CurrentSource>(
    sources.map((source) => [
      source.id,
      {
        blobSha256: source.blobSha256,
        chunkSetHash: chunkSetHash(plan.scoped.filter((chunk) => chunk.sourceId === source.id)),
      },
    ]),
  )
  const changed = changedSources(manifest.data, current)
  if (changed.length === 0) return NOTHING

  const tree = await repos.paths.loadTree(pathVersionId)
  if (tree === undefined) return { sources: changed, lessons: [] }
  const draft = pathDraftSchema.safeParse(version.spec)
  const mapped = new Map<string, { chunkId: string; sourceId: string }[]>()
  if (draft.success) {
    for (const section of draft.data.sections) {
      for (const module of section.modules) {
        for (const lesson of module.lessons) {
          mapped.set(
            lesson.id,
            lesson.source_refs.map((ref) => ({ chunkId: ref.chunk_id, sourceId: ref.source_id })),
          )
        }
      }
    }
  }
  const candidates: AffectedCandidate[] = []
  for (const section of tree.sections) {
    for (const module of section.modules) {
      for (const lesson of module.lessons) {
        if (lesson.kind !== 'core') continue
        const cited = lesson.citations.flatMap((raw) => {
          const citation = lessonCitationSchema.safeParse(raw)
          return citation.success
            ? [{ chunkId: citation.data.chunk_id, sourceId: citation.data.source_id }]
            : []
        })
        candidates.push({
          lessonId: lesson.id,
          specId: lesson.specId,
          title: lesson.title,
          refs: cited.length > 0 ? cited : (mapped.get(lesson.specId) ?? []),
        })
      }
    }
  }
  const refIds = [...new Set(candidates.flatMap((lesson) => lesson.refs.map((ref) => ref.chunkId)))]
  const live = new Set((await repos.chunks.findMany(refIds)).map((chunk) => chunk.id))
  return {
    sources: changed,
    lessons: affectedLessons(candidates, new Set(changed.map((entry) => entry.sourceId)), live),
  }
}
