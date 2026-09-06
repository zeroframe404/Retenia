import type { Chunk, NewEntity, SourceUnit, UnitOfWork } from '@retenia/core'
import type { ChunkDraftsBlob } from '../../jobs/ingest-chunk'

/**
 * Turning `chunkSourceDoc`'s drafts into `source_units` and `chunks` rows (sub-phase 6.2).
 *
 * The one thing that makes this more than a `map`: the drafts name their unit by a *key*
 * (`page:12`, `section:s-3`) rather than by a row id, because the chunker is pure and has no
 * id generator. Units are written first so their real ids exist, then the chunks are written
 * against them.
 *
 * Both writes are matched against what is already there rather than replacing it wholesale —
 * `SourceRepository.replaceUnits` for the units (annotations point at those, so re-parsing a
 * book must not orphan a highlight) and `ChunkRepository.replaceBySource` for the chunks
 * (embeddings hang off those). See the note on `replaceBySource` for why.
 */

export interface PersistChunksResult {
  units: SourceUnit[]
  chunks: Chunk[]
}

export async function persistChunkDrafts(
  repos: UnitOfWork,
  drafts: ChunkDraftsBlob,
): Promise<PersistChunksResult> {
  return repos.transaction(async (tx) => {
    const units = await tx.sources.replaceUnits(
      drafts.sourceId,
      drafts.units.map((unit) => ({
        sourceId: drafts.sourceId,
        kind: unit.kind,
        ordinal: unit.ordinal,
        label: unit.label,
        tStart: unit.tStartMs,
        tEnd: unit.tEndMs,
        text: unit.text,
        blobSha256: null,
        // The draft's key travels into `meta` so a later re-chunk — or a reader that wants
        // "the row for page 12" — can find the unit without re-deriving it from the ordinal,
        // which is not unique across kinds.
        meta: { chunkUnitKey: unit.key },
      })),
    )

    const idByKey = new Map<string, string>()
    for (const [index, unit] of units.entries()) {
      const key = drafts.units[index]?.key
      if (key !== undefined) idByKey.set(key, unit.id)
    }

    const chunks = await tx.chunks.replaceBySource(
      drafts.sourceId,
      drafts.chunks.map(
        (chunk): NewEntity<Chunk> => ({
          sourceId: drafts.sourceId,
          unitId: chunk.unitKey === null ? null : (idByKey.get(chunk.unitKey) ?? null),
          ordinal: chunk.ordinal,
          text: chunk.text,
          charStart: chunk.charStart,
          charEnd: chunk.charEnd,
          tokenCount: chunk.tokenCount,
          hash: chunk.hash,
          headingPath: chunk.headingPath,
          // `null` here means "the chunker has none", not "clear what is stored": a chunk
          // whose key still matches keeps the context it already had (see `replaceBySource`),
          // because the key is a hash of the text and the context describes that text.
          context: null,
          chunkKey: chunk.key,
          chunkingVersion: drafts.chunkingVersion,
          isFrontmatter: chunk.isFrontmatter,
          locator: { ...chunk.locator },
        }),
      ),
    )

    return { units, chunks }
  })
}
