import { createHash } from 'node:crypto'
import type { EmbeddingProvider, IdGenerator, JsonObject } from '@retenia/core'
import type { OpenedDatabase } from './open-database'
import { chunks, sources } from './schema'
import { insertEmbedding } from './search'
import { audit } from './testing'

/**
 * Rows for the search tests: one `ready` source with N chunks, and the embeddings that put
 * those chunks into the vector index. Test-only; not part of the package's public surface.
 */

export interface SeedChunk {
  text: string
  /** Defaults to `Fisiología > Capítulo <n>`. */
  headingPath?: string
  /** Page/timestamp/`block_ids`, exactly as the ingestion parsers write it. */
  locator?: JsonObject
}

export interface SeededSource {
  sourceId: string
  chunkIds: string[]
  texts: string[]
}

/** Accepts plain strings (text only) or `SeedChunk`s. */
export function seedSourceWithChunks(
  opened: OpenedDatabase,
  ids: IdGenerator,
  nowMs: number,
  entries: readonly (string | SeedChunk)[],
  sourceOverrides: { title?: string } = {},
): SeededSource {
  const sourceId = ids.next()
  opened.db
    .insert(sources)
    .values({
      id: sourceId,
      kind: 'pdf',
      title: sourceOverrides.title ?? 'Fisiología',
      status: 'ready',
      language: 'es',
      ...audit(nowMs),
    })
    .run()

  const chunkIds: string[] = []
  const texts: string[] = []
  let offset = 0
  for (const [ordinal, entry] of entries.entries()) {
    const seed: SeedChunk = typeof entry === 'string' ? { text: entry } : entry
    const id = ids.next()
    chunkIds.push(id)
    texts.push(seed.text)
    opened.db
      .insert(chunks)
      .values({
        id,
        sourceId,
        ordinal,
        text: seed.text,
        charStart: offset,
        charEnd: offset + seed.text.length,
        tokenCount: seed.text.split(/\s+/).length,
        hash: createHash('sha256').update(seed.text).digest('hex'),
        headingPath: seed.headingPath ?? `Fisiología > Capítulo ${ordinal + 1}`,
        locator: seed.locator ?? null,
        ...audit(nowMs),
      })
      .run()
    offset += seed.text.length
  }

  return { sourceId, chunkIds, texts }
}

/**
 * Embeds a seeded source's chunks with `provider` and writes them to both vector indexes —
 * what the embedding job does for real. One transaction, as bulk loads must be.
 */
export async function embedSeededSource(
  opened: OpenedDatabase,
  ids: IdGenerator,
  provider: EmbeddingProvider,
  seeded: SeededSource,
): Promise<void> {
  const vectors = await provider.embed(seeded.texts)
  const write = opened.sqlite.transaction(() => {
    for (const [index, chunkId] of seeded.chunkIds.entries()) {
      insertEmbedding(opened.sqlite, {
        id: ids.next(),
        sourceId: seeded.sourceId,
        chunkId,
        modelId: provider.modelId,
        embedding: vectors[index] as Float32Array,
      })
    }
  })
  write()
}
