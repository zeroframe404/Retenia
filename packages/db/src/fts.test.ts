import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { OpenedDatabase } from './open-database'
import { chunks } from './schema'
import { ftsQuery, searchChunksFts } from './search'
import { seedSourceWithChunks } from './test-fixtures'
import { openTestDatabase, testClock, testIds } from './testing'

const TEXTS = [
  'El corazón bombea sangre oxigenada hacia todo el cuerpo a través de la aorta.',
  'Las mitocondrias producen ATP mediante la fosforilación oxidativa.',
  'La neurona transmite el impulso nervioso por el axón hasta la sinapsis.',
]

describe('chunks_fts (FTS5, unicode61 remove_diacritics 2)', () => {
  let opened: OpenedDatabase
  let sourceId: string
  let chunkIds: string[]
  const clock = testClock()
  const ids = testIds(clock)

  beforeEach(() => {
    opened = openTestDatabase()
    ;({ sourceId, chunkIds } = seedSourceWithChunks(opened, ids, clock.nowMs(), TEXTS))
  })
  afterEach(() => opened.close())

  it('is declared with the required tokenizer', () => {
    const row = opened.sqlite
      .prepare<[], { sql: string }>("SELECT sql FROM sqlite_master WHERE name = 'chunks_fts'")
      .get()
    expect(row?.sql).toContain("tokenize = 'unicode61 remove_diacritics 2'")
  })

  it('returns the chunk that contains the search term, with a highlighted snippet', () => {
    const hits = searchChunksFts(opened.sqlite, ftsQuery('mitocondrias'))
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ chunkId: chunkIds[1], sourceId })
    expect(hits[0]?.snippet).toContain('<b>mitocondrias</b>')
    expect(hits[0]?.rank).toBe(1)
    expect(hits[0]?.bm25).toBeLessThan(0)
  })

  it('ignores diacritics and case in both the query and the text', () => {
    expect(searchChunksFts(opened.sqlite, ftsQuery('corazon')).map((h) => h.chunkId)).toEqual([
      chunkIds[0],
    ])
    expect(searchChunksFts(opened.sqlite, ftsQuery('CORAZÓN')).map((h) => h.chunkId)).toEqual([
      chunkIds[0],
    ])
    expect(searchChunksFts(opened.sqlite, ftsQuery('fosforilacion')).map((h) => h.chunkId)).toEqual(
      [chunkIds[1]],
    )
  })

  it('indexes the heading path as well as the text', () => {
    const hits = searchChunksFts(opened.sqlite, 'heading_path : "capitulo 3"')
    expect(hits.map((h) => h.chunkId)).toEqual([chunkIds[2]])
  })

  it('ANDs the words of a multi-word query and supports prefix search', () => {
    expect(searchChunksFts(opened.sqlite, ftsQuery('sangre aorta'))).toHaveLength(1)
    expect(searchChunksFts(opened.sqlite, ftsQuery('sangre axón'))).toHaveLength(0)
    expect(searchChunksFts(opened.sqlite, ftsQuery('mitoc', { prefix: true }))).toHaveLength(1)
  })

  it('can be restricted to one source and honours the limit', () => {
    const other = seedSourceWithChunks(opened, ids, clock.nowMs(), ['La aorta es una arteria.'])
    expect(searchChunksFts(opened.sqlite, ftsQuery('aorta'))).toHaveLength(2)
    expect(
      searchChunksFts(opened.sqlite, ftsQuery('aorta'), { sourceIds: [other.sourceId] }).map(
        (h) => h.chunkId,
      ),
    ).toEqual(other.chunkIds)
    expect(searchChunksFts(opened.sqlite, ftsQuery('aorta'), { limit: 1 })).toHaveLength(1)
  })

  it('follows edits: an updated chunk is re-indexed with its new text', () => {
    opened.db
      .update(chunks)
      .set({
        text: 'Texto reemplazado sobre el páncreas.',
        updatedAt: clock.nowMs() + 1,
        version: 2,
      })
      .where(eq(chunks.id, chunkIds[0] as string))
      .run()

    expect(searchChunksFts(opened.sqlite, ftsQuery('corazón'))).toHaveLength(0)
    expect(searchChunksFts(opened.sqlite, ftsQuery('pancreas')).map((h) => h.chunkId)).toEqual([
      chunkIds[0],
    ])
  })

  it('drops soft-deleted chunks from the index and restores them when un-deleted', () => {
    opened.db
      .update(chunks)
      .set({ deletedAt: clock.nowMs() })
      .where(eq(chunks.id, chunkIds[1] as string))
      .run()
    expect(searchChunksFts(opened.sqlite, ftsQuery('mitocondrias'))).toHaveLength(0)

    opened.db
      .update(chunks)
      .set({ deletedAt: null })
      .where(eq(chunks.id, chunkIds[1] as string))
      .run()
    expect(searchChunksFts(opened.sqlite, ftsQuery('mitocondrias'))).toHaveLength(1)
  })

  it('does not index a chunk inserted already soft-deleted', () => {
    const id = ids.next()
    opened.db
      .insert(chunks)
      .values({
        id,
        sourceId,
        ordinal: 99,
        text: 'Contenido fantasma sobre el hígado.',
        charStart: 0,
        charEnd: 10,
        tokenCount: 5,
        hash: 'f'.repeat(64),
        createdAt: clock.nowMs(),
        updatedAt: clock.nowMs(),
        deletedAt: clock.nowMs(),
        deviceId: 'test-device',
        version: 1,
      })
      .run()
    expect(searchChunksFts(opened.sqlite, ftsQuery('higado'))).toHaveLength(0)
  })

  it('ftsQuery() neutralizes FTS5 syntax in user input and drops empty queries', () => {
    expect(ftsQuery('  ')).toBe('')
    expect(searchChunksFts(opened.sqlite, '')).toEqual([])
    expect(ftsQuery('a "b" c')).toBe('"a" "b" "c"')
    // Operators and parentheses are quoted, so this cannot throw a parse error.
    expect(() => searchChunksFts(opened.sqlite, ftsQuery('NOT ( OR "unbalanced'))).not.toThrow()
    // Raw syntax, by contrast, is passed through and can fail.
    expect(() => searchChunksFts(opened.sqlite, '"unbalanced')).toThrow()
  })

  it('returns a highlighted heading path beside the snippet', () => {
    const [hit] = searchChunksFts(opened.sqlite, ftsQuery('capitulo mitocondrias'))
    expect(hit?.headingHighlight).toBe('Fisiología > <b>Capítulo</b> 2')
    expect(hit?.snippet).toContain('<b>mitocondrias</b>')
  })

  it('weights a body hit above a heading-only hit', () => {
    const inBody = searchChunksFts(opened.sqlite, ftsQuery('mitocondrias'))[0]?.bm25 as number
    const inHeading = searchChunksFts(opened.sqlite, ftsQuery('capitulo'))[0]?.bm25 as number
    // bm25() is negative and lower is better, so the body hit must be the more negative one.
    expect(inBody).toBeLessThan(inHeading)
  })

  it('an empty source filter means no source, not every source', () => {
    expect(searchChunksFts(opened.sqlite, ftsQuery('aorta'), { sourceIds: [] })).toEqual([])
  })
})

describe('ftsQuery()', () => {
  it('quotes every term, so index operators are only ever words', () => {
    expect(ftsQuery('sangre aorta')).toBe('"sangre" "aorta"')
    expect(ftsQuery('sangre OR aorta')).toBe('"sangre" "OR" "aorta"')
    expect(ftsQuery('text : sangre')).toBe('"text" ":" "sangre"')
    expect(ftsQuery('NEAR(a b)')).toBe('"NEAR(a" "b)"')
  })

  it('keeps a double-quoted run together as one phrase', () => {
    expect(ftsQuery('"impulso nervioso"')).toBe('"impulso nervioso"')
    expect(ftsQuery('el "impulso nervioso" viaja')).toBe('"el" "impulso nervioso" "viaja"')
  })

  it('runs an unterminated quote to the end rather than failing', () => {
    expect(ftsQuery('"impulso nervioso')).toBe('"impulso nervioso"')
  })

  it('escapes a quote inside a term by doubling it, as FTS5 requires', () => {
    expect(ftsQuery('a"b')).toBe('"a" "b"')
    expect(ftsQuery('"di ""hola"" ahora"')).toBe('"di " "hola" " ahora"')
  })

  it('marks the last term as a prefix on request, and any term the user marks', () => {
    expect(ftsQuery('mitoc', { prefix: true })).toBe('"mitoc"*')
    expect(ftsQuery('la mitoc', { prefix: true })).toBe('"la" "mitoc"*')
    // Only the last: an all-prefix query matches far too much.
    expect(ftsQuery('mitoc atp')).toBe('"mitoc" "atp"')
    expect(ftsQuery('mitoc* atp')).toBe('"mitoc"* "atp"')
    expect(ftsQuery('"impulso nervioso"*')).toBe('"impulso nervioso"*')
  })

  it('drops whitespace-only input and whitespace-only phrases', () => {
    expect(ftsQuery('')).toBe('')
    expect(ftsQuery('   \t  ')).toBe('')
    expect(ftsQuery('"   "')).toBe('')
  })
})
