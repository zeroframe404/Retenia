import { createHash } from 'node:crypto'
import type { IdGenerator } from '@retenia/core'
import type { OpenedDatabase } from './open-database'
import { chunks, sources } from './schema'
import { audit } from './testing'

/**
 * Minimal rows for the search tests: one `ready` source with N chunks. Test-only; not part
 * of the package's public surface.
 */
export function seedSourceWithChunks(
  opened: OpenedDatabase,
  ids: IdGenerator,
  nowMs: number,
  texts: readonly string[],
): { sourceId: string; chunkIds: string[] } {
  const sourceId = ids.next()
  opened.db
    .insert(sources)
    .values({
      id: sourceId,
      kind: 'pdf',
      title: 'Fisiología',
      status: 'ready',
      language: 'es',
      ...audit(nowMs),
    })
    .run()

  const chunkIds: string[] = []
  let offset = 0
  for (const [ordinal, text] of texts.entries()) {
    const id = ids.next()
    chunkIds.push(id)
    opened.db
      .insert(chunks)
      .values({
        id,
        sourceId,
        ordinal,
        text,
        charStart: offset,
        charEnd: offset + text.length,
        tokenCount: text.split(/\s+/).length,
        hash: createHash('sha256').update(text).digest('hex'),
        headingPath: `Fisiología > Capítulo ${ordinal + 1}`,
        ...audit(nowMs),
      })
      .run()
    offset += text.length
  }

  return { sourceId, chunkIds }
}
