import { createHash } from 'node:crypto'
import { createFakeEmbeddingProvider } from '@retenia/core/testing'
import { beforeAll, bench, describe } from 'vitest'
import { createHybridSearch, type HybridSearch } from './hybrid-search'
import type { OpenedDatabase } from './open-database'
import { createRepositories } from './repositories'
import { EMBEDDING_DIMENSIONS, knnChunks, quantizeToInt8, vectorToBlob } from './search'
import { openTestDatabase, testClock, testIds } from './testing'

/**
 * The sizing benchmark of sub-phase 3.3: **50,000 chunks × 768 dimensions, one hybrid query
 * under 150 ms** on a laptop. Run with `pnpm --filter @retenia/db bench`; it is not part of
 * `pnpm test` (building the corpus takes ~30 s).
 *
 * There is deliberately no assertion here. A threshold that fails on a busy CI runner
 * teaches nothing; the numbers are read, recorded in the PR, and compared over time. What
 * the benchmark is really for is the shape of the curve: which stage costs what, and what
 * the int8 index buys.
 *
 * The corpus is 50k Spanish sentences over 20 sources, which is a bit above the largest
 * library v1 targets (~200k chunks is where `docs/spec/05-ingestion-rag.md` §3 moves the
 * vector index to LanceDB) and well above a realistic one: two 300-page books plus 20 h of
 * transcripts is around 5,000 chunks.
 */

const CHUNKS = 50_000
const SOURCES = 20
const MODEL_ID = 'bench-fake-768'

const VOCABULARY = [
  'corazón',
  'sangre',
  'aorta',
  'mitocondria',
  'célula',
  'neurona',
  'axón',
  'sinapsis',
  'glucosa',
  'piruvato',
  'enzima',
  'proteína',
  'membrana',
  'núcleo',
  'ribosoma',
  'oxígeno',
  'músculo',
  'nervio',
  'hormona',
  'tejido',
  'arteria',
  'vena',
  'capilar',
  'pulmón',
  'riñón',
  'hígado',
  'páncreas',
  'estómago',
  'intestino',
  'esófago',
]
const CONNECTORS = ['de', 'la', 'el', 'en', 'con', 'por', 'para', 'que', 'se', 'del']

/** A tiny deterministic LCG, so every run benches the same corpus. */
function lcg(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff
    return state / 0x7fffffff
  }
}

function sentence(random: () => number): string {
  const words: string[] = []
  for (let i = 0; i < 24; i++) {
    words.push(
      i % 3 === 0
        ? (CONNECTORS[Math.floor(random() * CONNECTORS.length)] as string)
        : (VOCABULARY[Math.floor(random() * VOCABULARY.length)] as string),
    )
  }
  return `${words.join(' ')}.`
}

interface Bench {
  opened: OpenedDatabase
  hybrid: HybridSearch
  query: string
  embedding: Float32Array
}

let fixture: Bench

function report(label: string, value: string): void {
  process.stdout.write(`  ${label.padEnd(42)} ${value}\n`)
}

beforeAll(async () => {
  const started = Date.now()
  const clock = testClock()
  const ids = testIds(clock)
  const opened = openTestDatabase()
  const repos = createRepositories(opened, { deviceId: 'bench', clock, ids })
  const provider = createFakeEmbeddingProvider({ modelId: MODEL_ID })
  const random = lcg(20260902)
  const now = clock.nowMs()

  const sourceIds = Array.from({ length: SOURCES }, () => ids.next())
  const insertSource = opened.sqlite.prepare(
    `INSERT INTO sources (id, kind, title, status, language, created_at, updated_at, deleted_at, device_id, version)
     VALUES (?, 'pdf', ?, 'ready', 'es', ?, ?, NULL, 'bench', 1)`,
  )
  const insertChunk = opened.sqlite.prepare(
    `INSERT INTO chunks (id, source_id, ordinal, text, char_start, char_end, token_count, hash, heading_path, locator, created_at, updated_at, deleted_at, device_id, version)
     VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, NULL, 'bench', 1)`,
  )
  const insertFloat = opened.sqlite.prepare(
    'INSERT INTO embeddings (id, source_id, chunk_id, model_id, embedding) VALUES (?, ?, ?, ?, ?)',
  )
  const insertInt8 = opened.sqlite.prepare(
    'INSERT INTO embeddings_i8 (id, source_id, chunk_id, model_id, embedding) VALUES (?, ?, ?, ?, vec_int8(?))',
  )

  const texts: string[] = []
  for (let i = 0; i < CHUNKS; i++) texts.push(sentence(random))
  const vectors = await provider.embed(texts)

  const build = opened.sqlite.transaction(() => {
    for (const [index, sourceId] of sourceIds.entries()) {
      insertSource.run(sourceId, `Fuente ${index + 1}`, now, now)
    }
    for (let i = 0; i < CHUNKS; i++) {
      const chunkId = ids.next()
      const sourceId = sourceIds[i % SOURCES] as string
      const text = texts[i] as string
      insertChunk.run(
        chunkId,
        sourceId,
        Math.floor(i / SOURCES),
        text,
        text.length,
        24,
        createHash('sha256').update(`${i}:${text}`).digest('hex'),
        `Fuente ${(i % SOURCES) + 1} > Capítulo ${Math.floor(i / 500) + 1}`,
        JSON.stringify({ page: Math.floor(i / 4) + 1, block_ids: [`b-${i}`] }),
        now,
        now,
      )
      const vector = vectors[i] as Float32Array
      const embeddingId = ids.next()
      insertFloat.run(embeddingId, sourceId, chunkId, MODEL_ID, vectorToBlob(vector))
      insertInt8.run(embeddingId, sourceId, chunkId, MODEL_ID, quantizeToInt8(vector))
    }
  })
  build()

  const hybrid = createHybridSearch({
    sqlite: opened.sqlite,
    loadChunks: (chunkIds) => repos.chunks.findMany(chunkIds),
  })

  const query = 'la sangre del corazón por la aorta y el músculo'
  const embedding = (await provider.embed([query]))[0] as Float32Array
  fixture = { opened, hybrid, query, embedding }

  // What the int8 index costs in ranking, measured rather than assumed: how much of the
  // exact float32 top-50 an int8 scan of the same depth recovers, before rescoring.
  const exact = knnChunks(opened.sqlite, embedding, {
    k: 50,
    modelId: MODEL_ID,
    precision: 'float32',
  })
  const raw = knnChunks(opened.sqlite, embedding, {
    k: 50,
    modelId: MODEL_ID,
    rescoreCandidates: 50,
  })
  const rescored = knnChunks(opened.sqlite, embedding, { k: 50, modelId: MODEL_ID })
  const truth = new Set(exact.map((hit) => hit.chunkId))
  const recall = (hits: typeof exact) =>
    `${((hits.filter((hit) => truth.has(hit.chunkId)).length / truth.size) * 100).toFixed(0)} %`

  const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(0)} MB`

  process.stdout.write('\n  Corpus\n')
  report('chunks × dimensions', `${CHUNKS.toLocaleString('en-US')} × ${EMBEDDING_DIMENSIONS}`)
  report('sources (vec0 partitions)', String(SOURCES))
  report('build time', `${((Date.now() - started) / 1000).toFixed(1)} s`)
  report('float32 vectors', megabytes(CHUNKS * EMBEDDING_DIMENSIONS * 4))
  report('int8 vectors', megabytes(CHUNKS * EMBEDDING_DIMENSIONS))
  report('int8 recall@50, no rescoring', recall(raw))
  report('int8 recall@50, rescored (default 2× over-fetch)', recall(rescored))
  process.stdout.write('\n')
}, 600_000)

describe('one query over 50k chunks × 768 dims', () => {
  bench('hybrid, k=10 (the shipped default)', async () => {
    await fixture.hybrid.search(fixture.query, {
      mode: 'hybrid',
      embedding: fixture.embedding,
      modelId: MODEL_ID,
      k: 10,
    })
  })

  bench('hybrid, k=20 (what the tutor asks for)', async () => {
    await fixture.hybrid.search(fixture.query, {
      mode: 'hybrid',
      embedding: fixture.embedding,
      modelId: MODEL_ID,
      k: 20,
    })
  })

  bench('hybrid, k=10, restricted to one source', async () => {
    await fixture.hybrid.search(fixture.query, {
      mode: 'hybrid',
      embedding: fixture.embedding,
      modelId: MODEL_ID,
      k: 10,
      sourceIds: [
        (fixture.opened.sqlite.prepare('SELECT id FROM sources LIMIT 1').get() as { id: string })
          .id,
      ],
    })
  })

  bench('BM25 branch only, top-50', async () => {
    await fixture.hybrid.search(fixture.query, { mode: 'fts', k: 50 })
  })

  bench('vector branch only, top-50, int8 + exact rescoring', async () => {
    await fixture.hybrid.search(fixture.query, {
      mode: 'vector',
      embedding: fixture.embedding,
      modelId: MODEL_ID,
      k: 50,
    })
  })

  bench('vector branch only, top-50, exact float32 scan', () => {
    knnChunks(fixture.opened.sqlite, fixture.embedding, {
      k: 50,
      modelId: MODEL_ID,
      precision: 'float32',
    })
  })
})
