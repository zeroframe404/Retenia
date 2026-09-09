import type { Chunk, Source } from '@retenia/core'
import type { GenerationConfig } from '../config/generation-config'
import { isChunkInScope, orderedSourceIds } from '../config/generation-config'
import type { ChunkIndex, ChunkRef } from '../validate/types'

/**
 * Which chunks a run reads, in which order: every source's chunks by ordinal, sources in
 * configuration order with the primary first, the selected scope applied, and front matter
 * counted but never sent (`docs/spec/04-path-generation.md` §14 pitfall 6).
 */

export interface ChunkPlan {
  /** In configuration order, primary first. */
  readonly sources: Source[]
  readonly chunksBySource: ReadonlyMap<string, Chunk[]>
  /** In scope, front matter included — what the table of contents and the citations index see. */
  readonly scoped: Chunk[]
  /** In scope and not front matter — what extraction reads. */
  readonly extractable: Chunk[]
  readonly chunkIndex: ChunkIndex
  readonly total: number
  readonly frontmatter: number
  readonly outOfScope: number
}

export function planChunks(
  sources: readonly Source[],
  chunksBySource: ReadonlyMap<string, readonly Chunk[]>,
  config: GenerationConfig,
): ChunkPlan {
  const byId = new Map(sources.map((source) => [source.id, source]))
  const ordered = orderedSourceIds(config)
    .map((id) => byId.get(id))
    .filter((source): source is Source => source !== undefined)

  const scoped: Chunk[] = []
  const extractable: Chunk[] = []
  const index = new Map<string, ChunkRef>()
  const perSource = new Map<string, Chunk[]>()
  let total = 0
  let frontmatter = 0
  let outOfScope = 0

  for (const source of ordered) {
    const chunks = [...(chunksBySource.get(source.id) ?? [])].sort((a, b) => a.ordinal - b.ordinal)
    perSource.set(source.id, chunks)
    for (const chunk of chunks) {
      total += 1
      if (!isChunkInScope(chunk, config.scope)) {
        outOfScope += 1
        continue
      }
      scoped.push(chunk)
      index.set(chunk.id, {
        chunkId: chunk.id,
        sourceId: chunk.sourceId,
        ordinal: chunk.ordinal,
        headingPath: chunk.headingPath,
        isFrontmatter: chunk.isFrontmatter,
      })
      if (chunk.isFrontmatter) {
        frontmatter += 1
        continue
      }
      extractable.push(chunk)
    }
  }

  return {
    sources: ordered,
    chunksBySource: perSource,
    scoped,
    extractable,
    chunkIndex: index,
    total,
    frontmatter,
    outOfScope,
  }
}
