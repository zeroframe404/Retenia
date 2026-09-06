import { createHash } from 'node:crypto'
import type { Chunk, NewEntity } from '@retenia/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { OpenedDatabase } from './open-database'
import { createRepositories } from './repositories'
import { ftsQuery, searchChunksFts } from './search'
import { openTestDatabase, testClock, testIds } from './testing'

/**
 * The persistence half of sub-phase 6.2: re-chunking by `chunk_key`, the reindex sweep over
 * `chunking_version`, and `chunks.context` reaching the FTS index (migration 0008).
 */

const CHUNKING_VERSION = '1:chars4'

function key(text: string): string {
  return createHash('sha256').update(`key:${text}`).digest('hex')
}

function draft(text: string, ordinal: number, overrides: Partial<NewEntity<Chunk>> = {}) {
  return {
    sourceId: '',
    unitId: null,
    ordinal,
    text,
    charStart: 0,
    charEnd: text.length,
    tokenCount: Math.ceil(text.length / 4),
    hash: createHash('sha256').update(text).digest('hex'),
    headingPath: 'Libro > Capítulo 1',
    context: null,
    chunkKey: key(text),
    chunkingVersion: CHUNKING_VERSION,
    isFrontmatter: false,
    locator: null,
    ...overrides,
  } satisfies NewEntity<Chunk>
}

describe('chunk persistence (sub-phase 6.2)', () => {
  let opened: OpenedDatabase
  let repos: ReturnType<typeof createRepositories>
  let sourceId: string
  const clock = testClock()

  beforeEach(async () => {
    opened = openTestDatabase()
    repos = createRepositories(opened, { deviceId: 'device-test', clock, ids: testIds(clock) })
    const source = await repos.sources.create({
      kind: 'pdf',
      title: 'Libro',
      originUri: null,
      blobSha256: null,
      status: 'ready',
      language: 'es',
      meta: null,
      error: null,
      ingestedAt: null,
      embeddingStatus: 'pending',
      embeddingModelId: null,
      embeddingError: null,
    })
    sourceId = source.id
  })
  afterEach(() => opened.close())

  const seed = (texts: readonly string[]) =>
    repos.chunks.replaceBySource(
      sourceId,
      texts.map((text, ordinal) => draft(text, ordinal, { sourceId })),
    )

  it('inserts on a first run and keeps the same rows on an identical second one', async () => {
    const first = await seed(['uno', 'dos', 'tres'])
    const second = await seed(['uno', 'dos', 'tres'])

    expect(second.map((chunk) => chunk.id)).toEqual(first.map((chunk) => chunk.id))
    expect(await repos.chunks.listBySource(sourceId)).toHaveLength(3)
  })

  it('keeps the id of a chunk whose text survives a re-chunk, and retires the rest', async () => {
    const first = await seed(['uno', 'dos', 'tres'])
    const second = await seed(['uno', 'dos bis', 'tres'])

    const byText = new Map(second.map((chunk) => [chunk.text, chunk.id]))
    expect(byText.get('uno')).toBe(first[0]?.id)
    expect(byText.get('tres')).toBe(first[2]?.id)
    expect(byText.get('dos bis')).not.toBe(first[1]?.id)

    const live = await repos.chunks.listBySource(sourceId)
    expect(live.map((chunk) => chunk.text).sort()).toEqual(['dos bis', 'tres', 'uno'])
    // The retired chunk is soft-deleted, never gone.
    const retired = await repos.chunks.findById(first[1]?.id as string, { includeDeleted: true })
    expect(retired?.deletedAt).not.toBeNull()
  })

  it('moves a surviving chunk to its new ordinal and heading path', async () => {
    await seed(['uno', 'dos'])
    await repos.chunks.replaceBySource(sourceId, [
      draft('dos', 0, { sourceId, headingPath: 'Libro > Capítulo 2' }),
      draft('uno', 1, { sourceId }),
    ])

    const live = await repos.chunks.listBySource(sourceId)
    expect(live.map((chunk) => [chunk.ordinal, chunk.text])).toEqual([
      [0, 'dos'],
      [1, 'uno'],
    ])
    expect(live[0]?.headingPath).toBe('Libro > Capítulo 2')
  })

  it('brings a retired chunk key back rather than colliding with its own tombstone', async () => {
    // The user edits a paragraph, re-parses, reverts, re-parses. `chunks_source_key` is unique
    // over every row including tombstones, so matching only live rows would try to insert a key
    // that is already taken and abort the whole re-chunk.
    const [uno] = await seed(['uno', 'dos'])
    await seed(['dos'])
    const back = await seed(['uno', 'dos'])

    expect(back.map((chunk) => chunk.text)).toEqual(['uno', 'dos'])
    // …and it is the *same row*, so anything that cited it still resolves.
    expect(back[0]?.id).toBe(uno?.id)
    expect((await repos.chunks.listBySource(sourceId)).map((c) => c.text).sort()).toEqual([
      'dos',
      'uno',
    ])
  })

  it('keeps a context that was paid for when the chunk text has not changed', async () => {
    await seed(['uno', 'dos'])
    await repos.chunks.setContexts(sourceId, [
      { chunkKey: key('uno'), context: 'Trata de la mitocondria.' },
    ])

    // A tokenizer bump re-chunks the whole source; 'uno' comes out identical.
    await repos.chunks.replaceBySource(sourceId, [
      draft('uno', 0, { sourceId, chunkingVersion: '1:cl100k' }),
      draft('dos', 1, { sourceId, chunkingVersion: '1:cl100k' }),
    ])

    const live = await repos.chunks.listBySource(sourceId)
    expect(live[0]?.context).toBe('Trata de la mitocondria.')
    expect(live[0]?.chunkingVersion).toBe('1:cl100k')
    // …and it is still searchable by a term only the context has.
    expect(searchChunksFts(opened.sqlite, ftsQuery('mitocondria'))).toHaveLength(1)
  })

  it('lists the sources that have any chunks at all, for the "never chunked" half of the sweep', async () => {
    expect(await repos.chunks.sourceIdsWithChunks()).toEqual([])
    await seed(['uno'])
    expect(await repos.chunks.sourceIdsWithChunks()).toEqual([sourceId])
  })

  it('finds the sources whose chunks were cut under another version', async () => {
    await seed(['uno', 'dos'])
    expect(await repos.chunks.sourceIdsNeedingRechunk(CHUNKING_VERSION)).toEqual([])
    expect(await repos.chunks.sourceIdsNeedingRechunk('2:cl100k')).toEqual([sourceId])
  })

  it('treats a chunk written before the column existed as stale', async () => {
    await repos.chunks.replaceBySource(sourceId, [
      draft('viejo', 0, { sourceId, chunkingVersion: null }),
    ])
    expect(await repos.chunks.sourceIdsNeedingRechunk(CHUNKING_VERSION)).toEqual([sourceId])
  })

  it('ignores soft-deleted chunks in the staleness sweep', async () => {
    await seed(['uno'])
    await repos.chunks.replaceBySource(sourceId, [
      draft('dos', 0, { sourceId, chunkingVersion: CHUNKING_VERSION }),
    ])
    // 'uno' is soft-deleted and carries the old version; it must not keep the source stale.
    expect(await repos.chunks.sourceIdsNeedingRechunk(CHUNKING_VERSION)).toEqual([])
  })

  it('writes contexts by key and skips the ones that did not change', async () => {
    const seeded = await seed(['uno', 'dos'])

    const written = await repos.chunks.setContexts(sourceId, [
      { chunkKey: key('uno'), context: 'Del capítulo 1, sobre la memoria.' },
      { chunkKey: key('inexistente'), context: 'nada' },
    ])
    expect(written).toBe(1)

    const again = await repos.chunks.setContexts(sourceId, [
      { chunkKey: key('uno'), context: 'Del capítulo 1, sobre la memoria.' },
    ])
    expect(again).toBe(0)

    const updated = await repos.chunks.findById(seeded[0]?.id as string)
    expect(updated?.context).toBe('Del capítulo 1, sobre la memoria.')
  })

  it('indexes the context in FTS, and still snippets from the source text', async () => {
    await seed(['La aorta lleva sangre oxigenada.'])
    await repos.chunks.setContexts(sourceId, [
      {
        chunkKey: key('La aorta lleva sangre oxigenada.'),
        context: 'Capítulo 3, sistema circulatorio.',
      },
    ])

    // A word that appears only in the generated context still finds the chunk…
    const byContext = searchChunksFts(opened.sqlite, ftsQuery('circulatorio'))
    expect(byContext).toHaveLength(1)
    // …and the snippet is quoted from the document, not from the model's prose.
    expect(byContext[0]?.snippet).not.toContain('circulatorio')

    const byText = searchChunksFts(opened.sqlite, ftsQuery('aorta'))
    expect(byText[0]?.snippet).toContain('<b>aorta</b>')
  })

  it('ranks a hit in the source text above a hit in the generated context', async () => {
    await seed(['La sinapsis transmite el impulso.', 'El axón conduce la señal.'])
    await repos.chunks.setContexts(sourceId, [
      { chunkKey: key('El axón conduce la señal.'), context: 'Trata de la sinapsis.' },
    ])

    const hits = searchChunksFts(opened.sqlite, ftsQuery('sinapsis'))
    expect(hits).toHaveLength(2)
    expect(hits[0]?.snippet).toContain('<b>sinapsis</b>')
  })

  it('drops a re-chunked-away chunk out of the FTS index', async () => {
    await seed(['La aorta lleva sangre oxigenada.'])
    await seed(['Otra cosa completamente distinta.'])
    expect(searchChunksFts(opened.sqlite, ftsQuery('aorta'))).toEqual([])
  })

  it('flags front matter without hiding it from search', async () => {
    await repos.chunks.replaceBySource(sourceId, [
      draft('Índice general', 0, { sourceId, isFrontmatter: true }),
      draft('La memoria es una reconstrucción.', 1, { sourceId }),
    ])

    const live = await repos.chunks.listBySource(sourceId)
    expect(live.map((chunk) => chunk.isFrontmatter)).toEqual([true, false])
    expect(searchChunksFts(opened.sqlite, ftsQuery('Índice'))).toHaveLength(1)
  })
})
