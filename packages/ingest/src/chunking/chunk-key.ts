import { sha256Hex } from '../hash'

/**
 * `sha256(source_id, block_ids, text)` — the chunk's stable identity, and the acceptance
 * criterion "chunk ids are stable across runs": re-chunking the same *persisted* `SourceDoc`
 * twice (the chunk job always reads it from its blob, never re-parses) produces the same
 * keys, so the store can leave those rows (and the embeddings hanging off them) alone.
 *
 * That stability is scoped to the stored `SourceDoc`, not to the original source file: block
 * ids come from `ParseContext.id()`, a fresh UUIDv7 per parse, so **re-parsing** the same file
 * (a re-import, or a retry of a crashed parse job) mints new block ids and therefore new chunk
 * keys — the old chunks and their embeddings are orphaned, not matched. Only a re-chunk
 * (`chunkSourceDoc` run again over the one stored blob, e.g. after a `chunking_version` bump)
 * gets this determinism for free.
 *
 * Every part is length-prefixed before it is joined, so no two different inputs can produce
 * the same string to hash — without it, block ids `["ab", "c"]` and `["a", "bc"]` would.
 */
export function chunkKey(sourceId: string, blockIds: readonly string[], text: string): string {
  const ids = blockIds.map((id) => `${id.length}:${id}`).join('')
  return sha256Hex(`${sourceId.length}:${sourceId}${ids.length}:${ids}${text}`)
}
