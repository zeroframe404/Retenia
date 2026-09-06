import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createModelStore, downloadModel, requireModel } from '../models'
import { createTransformersEmbedding } from './transformers'

/**
 * The real local model, measured: how long it takes to download, to load, to answer one
 * search query, and to embed a book. The numbers it prints are transcribed into
 * `docs/perf/rag.md` together with the machine they came from, because "how fast is
 * embedding" has no answer that is not a statement about a particular CPU.
 *
 * **Opt-in.** It downloads ~330 MB of ONNX weights and then runs them, so it is skipped
 * unless `RETENIA_BENCH_MODELS=1`; CI never runs it. It is a `test`, not a `bench`, because
 * Vitest's bench runner reports a rate rather than the specific breakdown this needs (a
 * cold load, a single query, a batch-size sweep).
 *
 *   RETENIA_BENCH_MODELS=1 pnpm --filter @retenia/ingest test transformers.perf
 *
 * `RETENIA_MODELS_DIR` reuses an already-downloaded model between runs.
 */

const ENABLED = process.env.RETENIA_BENCH_MODELS === '1'
const MODELS_ROOT = process.env.RETENIA_MODELS_DIR ?? join(tmpdir(), 'retenia-bench-models')

/** A Spanish passage of about the size the chunker produces (300–500 tokens). */
const PASSAGE =
  'La práctica de recuperación consiste en intentar traer a la memoria una respuesta antes ' +
  'de volver a mirarla, y es junto con el espaciado la única técnica que Dunlosky clasifica ' +
  'como de utilidad alta. El efecto aparece incluso cuando la recuperación falla, siempre ' +
  'que haya retroalimentación inmediata: el intento deja una huella que el repaso pasivo no ' +
  'deja. Ebbinghaus ya había mostrado que la caída del recuerdo es rápida al principio y ' +
  'después se aplana, de modo que el momento del repaso importa tanto como su cantidad.'

const QUERY = '¿qué mostró Ebbinghaus sobre la curva del olvido?'

/** A 300-page book, at `docs/spec/05-ingestion-rag.md` §4's 300–500 tokens per chunk. */
const BOOK_CHUNKS = 600

function report(label: string, times: readonly number[]): number {
  const sorted = [...times].sort((left, right) => left - right)
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length
  const median = sorted[Math.floor(sorted.length / 2)] as number
  console.info(
    `[perf] ${label}: mean ${mean.toFixed(0)} ms | median ${median.toFixed(0)} | ` +
      `min ${(sorted[0] as number).toFixed(0)} | max ${(sorted.at(-1) as number).toFixed(0)}`,
  )
  return mean
}

async function measure(runs: number, work: () => Promise<unknown>): Promise<number[]> {
  const times: number[] = []
  for (let run = 0; run < runs; run++) {
    const startedAt = performance.now()
    await work()
    times.push(performance.now() - startedAt)
  }
  return times
}

describe.skipIf(!ENABLED)('EmbeddingGemma-300M, quantized, on this machine', () => {
  const spec = requireModel('embeddinggemma-300m', 'embedding')

  it('downloads, loads, and answers a query and a page', async () => {
    await mkdir(MODELS_ROOT, { recursive: true })
    const store = createModelStore(MODELS_ROOT)

    const downloadStartedAt = Date.now()
    const downloaded = await downloadModel(spec, { store })
    console.info(
      downloaded.downloaded.length === 0
        ? '[perf] model already installed'
        : `[perf] download: ${(downloaded.bytesDownloaded / 1e6).toFixed(0)} MB in ${(
            (Date.now() - downloadStartedAt) / 1000
          ).toFixed(1)} s`,
    )
    expect((await store.status(spec)).installed).toBe(true)

    const loadStartedAt = Date.now()
    const provider = await createTransformersEmbedding({
      spec,
      modelsRoot: MODELS_ROOT,
      onDevice: (device) => console.info(`[perf] device: ${device}`),
    })
    console.info(
      `[perf] load: ${((Date.now() - loadStartedAt) / 1000).toFixed(1)} s, batch ${provider.batchSize}`,
    )

    try {
      // The first inference pays for lazy graph initialization; no user ever sees it twice.
      const warmup = await measure(1, () => provider.embed([PASSAGE]))
      report('warm-up (first inference)', warmup)

      // What a keystroke-triggered search costs in the warm model host.
      report(
        'one query (the warm-host path)',
        await measure(10, () => provider.embedQuery?.(QUERY) as Promise<unknown>),
      )

      const page = Array.from({ length: 16 }, (_unused, index) => `${PASSAGE} (${index})`)
      const pageMean = report('one page of 16 chunks', await measure(4, () => provider.embed(page)))
      const perChunk = pageMean / page.length
      console.info(
        `[perf] per chunk: ${perChunk.toFixed(0)} ms → a ${BOOK_CHUNKS}-chunk book in ` +
          `${((perChunk * BOOK_CHUNKS) / 60_000).toFixed(1)} min`,
      )
    } finally {
      await provider.dispose()
    }
  }, 1_800_000)

  it('sweeps the batch size, which is where `defaultBatchSize` comes from', async () => {
    const chunks = Array.from({ length: 32 }, (_unused, index) => `${PASSAGE} (${index})`)
    for (const batchSize of [1, 4, 8, 16, 32]) {
      const provider = await createTransformersEmbedding({
        spec,
        modelsRoot: MODELS_ROOT,
        batchSize,
      })
      try {
        await provider.embed([PASSAGE])
        const startedAt = performance.now()
        await provider.embed(chunks)
        const total = performance.now() - startedAt
        console.info(
          `[perf] batch ${String(batchSize).padStart(2)}: ${total.toFixed(0)} ms for ` +
            `${chunks.length} chunks = ${(total / chunks.length).toFixed(0)} ms/chunk`,
        )
      } finally {
        await provider.dispose()
      }
    }
  }, 1_800_000)
})
