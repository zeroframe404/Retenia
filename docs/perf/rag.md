# Retrieval performance

Measured numbers for sub-phase 6.3's two questions: **how long does indexing take** and
**how long does a query take**. Everything here comes from a benchmark that is checked in and
re-runnable; nothing is estimated.

Two machines are involved, and neither is the target one. Windows 11 on the RTX 4070 Super
that `docs/spec/01-decisions.md` §5 names is where these have to be re-measured before any of
them is quoted at a user — a GPU changes the embedding numbers by an order of magnitude and
changes the query numbers not at all.

## The machines

| | CI / development box |
|---|---|
| CPU | Intel Xeon @ 2.80 GHz, 4 vCPU |
| RAM | 15 GB |
| Storage | virtualized SSD |
| GPU | none — every number below is CPU-only |
| Node | 22 (the app ships on 24) |

**(unverified)** on the target platform: nothing in this file has been run on Windows, and
nothing has been run with CUDA or DirectML. The GPU rows of the spec's own estimate
(§3: "a 300-page book: 1–3 min on GPU, 10–20 on CPU") are the only figures we have for that
case, and they are the spec's, not ours.

## How to re-run

```
pnpm --filter @retenia/db run bench                                        # the index
RETENIA_BENCH_MODELS=1 pnpm --filter @retenia/ingest test transformers.perf  # the model
pnpm --filter @retenia/desktop test search-acceptance                      # end to end
```

The second is opt-in because it downloads ~330 MB of real ONNX weights; CI never runs it.
`RETENIA_MODELS_DIR=<dir>` reuses a model between runs. The third runs in CI on every
change — it is the sub-phase's acceptance criterion, not only a benchmark.

## Querying: the index

`pnpm --filter @retenia/db run bench` — one query over a synthetic corpus of **50,000 chunks
× 768 dims across 20 sources**, which is a quarter of the ~200k ceiling
`docs/spec/05-ingestion-rag.md` §3 puts on sqlite-vec before the index should move to LanceDB.

| Query | mean | p99 |
|---|---|---|
| hybrid, k=10 — the shipped default | **131 ms** | 143 ms |
| hybrid, k=20 — what the tutor asks for | 132 ms | 149 ms |
| **hybrid, k=10, restricted to one source** | **14 ms** | 16 ms |
| BM25 branch only, top-50 | 0.33 ms | 0.50 ms |
| vector branch only, top-50, int8 + exact rescoring | 127 ms | 134 ms |
| vector branch only, top-50, exact float32 scan | 129 ms | 132 ms |

What the shape says:

- **The vector branch is the whole cost.** BM25 over 50k chunks is a third of a millisecond;
  everything else is the brute-force vec0 scan. sqlite-vec has no ANN index, so a query reads
  every vector in the partitions it is allowed to touch, and the time is linear in the corpus.
- **Filtering by source is the single biggest lever**, and it is free: `source_id` is a vec0
  partition key, so restricting to one source of twenty scans a twentieth of the vectors and
  the query drops from 131 ms to 14 ms. That is why the search screen's source facet is not
  cosmetic.
- **Quantization does not buy speed, it buys disk.** int8 + rescoring (127 ms) and the exact
  float32 scan (129 ms) are within noise of each other; the difference is 37 MB against
  146 MB of index, and recall — see below.
- **131 ms at 50k chunks is inside the 150 ms budget, with little room.** At 200k chunks the
  vector branch would be ~4× that and the budget would be gone. The ceiling in §3 is
  therefore not advisory: past it, the `VectorIndex` port exists so LanceDB (IVF-PQ/HNSW) can
  replace the scan without touching the fusion.

### Recall, and what "precise vectors" buys

Measured in the same run, against the exact float32 top-50:

| Index actually scanned | recall@50 | index size (50k × 768) |
|---|---|---|
| int8, no rescoring — **the default** | 90 % | 37 MB |
| int8 + rescoring against the float vectors (`retrieval.preciseVectors`) | 100 % | 37 + 146 MB |

So the "precise" setting costs 4× the disk for the last tenth of the top-50, and the
quantized scan alone already returns the right answer nine times in ten. Off is the default
because the fusion has a second branch and, past it, an optional cross-encoder: a candidate
BM25 also found does not depend on the vector branch having ranked it perfectly.

There is a cheaper improvement available that has not been taken. `quantizeToInt8` maps a
component with a fixed `×127`, which assumes components spread over `[-1, 1]`; a unit vector
in 768 dimensions actually has components near `±1/√768 ≈ 0.036`, so the mapping only ever
reaches about a tenth of the int8 range and throws away ~3 bits per component. A scale tuned
to the observed spread would recover most of the missing 10 % of recall at no cost in size or
speed. It is not done here because it changes the meaning of every stored vector: it belongs
in a migration with a forced reindex, not in a patch to the encoder. The round-trip error it
currently causes is pinned in `packages/db/src/vec.test.ts` — under half a quantization step
per component, and under 0.03 absolute on the L2 distance between two unit vectors.

### End to end, through the real pipeline

`apps/desktop/src/main/library/search-acceptance.test.ts` is the sub-phase's acceptance
criterion, and it runs in CI: the committed Spanish fixture book is parsed, chunked,
persisted, embedded and searched, then a 600-chunk Spanish corpus (a 300-page book at §4's
300–500 tokens per chunk) is loaded into the same index and four Spanish queries are timed.

| | |
|---|---|
| corpus | 603 chunks, one SQLite file, FTS5 + vec0 |
| hybrid query, warm | **4.4 – 5.5 ms** |

That is the number a real library of one book produces, and it is what the 150 ms budget has
to hold at 50k chunks — not at 600.

## Indexing: the model

`RETENIA_BENCH_MODELS=1 pnpm --filter @retenia/ingest test transformers.perf` — the real
`EmbeddingGemma-300M`, q8, on CPU. Everything in this section came out of that run.

| | |
|---|---|
| download (verified against the checked-in manifest) | 316 MB |
| session build, warm page cache | **2.1 s** |
| first inference after the build | 872 ms |
| **one query, warm** | **mean 227 ms · median 218 · min 207** |
| one page of 16 chunks | 1,747 ms |
| **per chunk, batched** | **109 ms** |
| **a 300-page book (600 chunks)** | **≈ 1.1 min** |

### The 300-page book

**1.1 minutes on 4 CPU cores.** `docs/spec/05-ingestion-rag.md` §3 budgets "10–20 min on
CPU" for this; the real figure is an order of magnitude better, because the spec's estimate
predates the q8 export. The GPU row of that estimate (1–3 min) is now *slower* than our CPU
measurement, which says the estimate should be re-derived rather than trusted — but not by
us, and not here: **(unverified)**, no GPU run exists.

### The batch size, measured

32 chunks of ~450 characters, one session per row:

| batch | total | per chunk |
|---|---|---|
| 1 | 10,592 ms | 331 ms |
| 4 | 5,264 ms | 164 ms |
| 8 | 4,150 ms | 130 ms |
| 16 | 3,638 ms | **114 ms** |
| 32 | 3,258 ms | 102 ms |

The curve has not flattened at 16, and `defaultBatchSize('cpu')` returns 16 anyway. That is a
deliberate trade, not an oversight: the last 11 % costs another doubling of activation
memory, and the job pool recycles a worker whose RSS passes 512 MB while the weights alone
are ~310 MB. A user embedding a book should not have their worker recycled mid-source to save
seven seconds a book.

### The query is the problem, not the index

**One query embedding is 218 ms (median) on this CPU, and the whole budget is 150 ms.** The
retrieval path underneath it is 4–5 ms at book scale and 131 ms at 50k chunks, so the model —
not the index — is what puts a Spanish search over the line here.

Three things bear on that, and only the third is speculation:

1. **Measured:** the cost is the model's size, not the runtime. The same code, the same
   `onnxruntime-node`, the same box, loading `all-MiniLM-L6-v2` q8 (23 MB) instead: session
   build 251 ms, inference **10 ms**. EmbeddingGemma-300M is 13× the file and ~22× the
   inference.
2. **Measured:** the app does not pay this per keystroke. The search box debounces at 200 ms
   (`SEARCH_DEBOUNCE_MS`) and the host keeps the session warm, so the cost is per *word*, and
   it is a cost the user experiences as the results settling rather than as the app hanging —
   nothing on the UI thread is blocked, because the model runs in its own `utilityProcess`.
3. **(unverified):** the target machine is Windows with an RTX 4070 Super
   (`docs/spec/01-decisions.md` §5), and a GPU is where a 300M-parameter forward pass belongs.
   Until someone runs this on one, the honest statement is that the criterion is met by the
   *retrieval* path and not by the *embedding* path on a 4-core CPU.

If the GPU does not close it, the cheapest remedy is a smaller default: the spec's own §3
table already lists `multilingual-e5-small` (384 dims, 120 MB) beside EmbeddingGemma, and the
catalog is one manifest entry and one `TRAITS` row away from offering it.


## What is not measured yet

- **GPU.** No CUDA or DirectML run exists. `onnxruntime-node`'s CPU prebuilds ship in the
  npm tarball but its CUDA execution-provider binaries do not (see the `allowBuilds` note in
  `pnpm-workspace.yaml`), so the accelerator is an opt-in the user installs, and the numbers
  for it have to come from a machine that has one.
- **The reranker.** `bge-reranker-v2-m3` is wired and tested but its latency has not been
  measured here; `docs/spec/05-ingestion-rag.md` §3 budgets 0.2–1 s per 20 documents on CPU,
  and the setting is off by default for exactly that reason.
- **Contextual retrieval's effect on ranking.** The `context` column is indexed and weighted
  (`FTS_COLUMN_WEIGHTS`), but no measurement of what it does to recall exists — that needs a
  labelled query set, which sub-phase 8.4's QA gates will produce.
