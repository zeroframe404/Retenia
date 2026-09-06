import { sha256Hex } from '../hash'

/**
 * `sha256(source_id, block_ids, text)` — the chunk's stable identity, and the acceptance
 * criterion "chunk ids are stable across runs": chunking the same document twice produces the
 * same keys, so the store can leave those rows (and the embeddings hanging off them) alone.
 *
 * Every part is length-prefixed before it is joined, so no two different inputs can produce
 * the same string to hash — without it, block ids `["ab", "c"]` and `["a", "bc"]` would.
 */
export function chunkKey(sourceId: string, blockIds: readonly string[], text: string): string {
  const ids = blockIds.map((id) => `${id.length}:${id}`).join('')
  return sha256Hex(`${sourceId.length}:${sourceId}${ids.length}:${ids}${text}`)
}
