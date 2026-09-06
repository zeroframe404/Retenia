#!/usr/bin/env node

/**
 * Regenerate `packages/ingest/src/models/manifest.json`: the pinned revision, byte size and
 * SHA-256 of every file the app downloads for a local ONNX model
 * (`docs/spec/05-ingestion-rag.md` §3).
 *
 * The app refuses to load a model file whose hash does not match this manifest, so the
 * manifest is the trust anchor and it has to be produced deliberately, not at install time.
 * That is also why the revision is a commit sha rather than `main`: `main` moves, and a
 * moved `main` would silently invalidate every hash below — or, worse, quietly hand the user
 * different weights than the ones we measured.
 *
 * Hashes come from two places, both authoritative:
 *   - LFS files (the weights, the big tokenizers) carry their SHA-256 as the LFS oid, which
 *     `paths-info` returns without transferring a byte.
 *   - Small files are stored as plain git blobs, whose oid is a SHA-1 over a different
 *     preimage and therefore useless here, so those are downloaded and hashed. They are
 *     configs and merge tables: a couple of megabytes per model, not weights.
 *
 * Usage: `node tooling/scripts/model-manifest.mjs [--model <id>] [--out <path>]`
 * (also `pnpm run models:manifest`). Requires network access to huggingface.co.
 */

import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '../..')
const DEFAULT_OUT = path.join(projectRoot, 'packages/ingest/src/models/manifest.json')

const HF = 'https://huggingface.co'

/**
 * transformers.js' `dtype` values, and the file suffix each one loads.
 *
 * The two are *not* the same string — `q8` loads `model_quantized.onnx` — and getting that
 * wrong is silent: an unrecognised `dtype` falls back to `fp32`, which looks for
 * `model.onnx`, a file these repositories do not ship at every quantization. So the manifest
 * records the dtype the loader is given and this map derives the file name from it.
 * Mirrors `DEFAULT_DTYPE_SUFFIX_MAPPING` in `@huggingface/transformers`.
 */
const DTYPE_SUFFIX = {
  fp32: '',
  fp16: '_fp16',
  int8: '_int8',
  uint8: '_uint8',
  q8: '_quantized',
  q4: '_q4',
  q4f16: '_q4f16',
  bnb4: '_bnb4',
}

/**
 * What to publish, and which quantization of it.
 *
 * A model over 2 GB of weights stores them outside the protobuf, in a sibling `.onnx_data`
 * that has to be fetched alongside the graph — hence both files in `files` for EmbeddingGemma.
 */
const MODELS = [
  {
    id: 'embeddinggemma-300m',
    repo: 'onnx-community/embeddinggemma-300m-ONNX',
    dtype: 'q8',
    files: [
      'config.json',
      'tokenizer.json',
      'tokenizer_config.json',
      'special_tokens_map.json',
      'added_tokens.json',
      'onnx/model_quantized.onnx',
      'onnx/model_quantized.onnx_data',
    ],
  },
  {
    id: 'bge-m3',
    repo: 'onnx-community/bge-m3-ONNX',
    dtype: 'q8',
    files: [
      'config.json',
      'tokenizer.json',
      'tokenizer_config.json',
      'special_tokens_map.json',
      'onnx/model_quantized.onnx',
    ],
  },
  {
    id: 'bge-reranker-v2-m3',
    repo: 'onnx-community/bge-reranker-v2-m3-ONNX',
    dtype: 'q8',
    files: [
      'config.json',
      'tokenizer.json',
      'tokenizer_config.json',
      'special_tokens_map.json',
      'onnx/model_quantized.onnx',
    ],
  },
]

async function json(url, init) {
  const response = await fetch(url, init)
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`)
  return response.json()
}

/** The commit the repo's default branch points at right now — what the manifest pins to. */
async function resolveRevision(repo) {
  const info = await json(`${HF}/api/models/${repo}`)
  if (typeof info.sha !== 'string') throw new Error(`no commit sha for ${repo}`)
  return info.sha
}

async function sha256Of(repo, revision, file) {
  const url = `${HF}/${repo}/resolve/${revision}/${file}`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`)
  const hash = createHash('sha256')
  for await (const part of response.body) hash.update(part)
  return hash.digest('hex')
}

async function describe(model) {
  const revision = await resolveRevision(model.repo)
  const info = await json(`${HF}/api/models/${model.repo}/paths-info/${revision}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ paths: model.files, expand: true }),
  })
  const byPath = new Map(info.map((entry) => [entry.path, entry]))

  if (!model.files.includes(graphFile(model.dtype))) {
    throw new Error(
      `${model.id} declares dtype ${model.dtype} but does not list ${graphFile(model.dtype)}`,
    )
  }

  const files = []
  for (const file of model.files) {
    const entry = byPath.get(file)
    if (entry === undefined) throw new Error(`${model.repo} has no ${file}`)
    const sha256 = entry.lfs?.oid ?? (await sha256Of(model.repo, revision, file))
    if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error(`bad sha256 for ${model.repo}/${file}`)
    files.push({ path: file, bytes: entry.size, sha256 })
    process.stderr.write(`  ${file} ${entry.size} ${sha256}\n`)
  }
  return { id: model.id, repo: model.repo, revision, dtype: model.dtype, files }
}

/** The graph file a given dtype loads, which every model in MODELS must actually ship. */
function graphFile(dtype) {
  const suffix = DTYPE_SUFFIX[dtype]
  if (suffix === undefined) throw new Error(`unknown transformers.js dtype "${dtype}"`)
  return `onnx/model${suffix}.onnx`
}

async function main() {
  const args = process.argv.slice(2)
  const only = args.includes('--model') ? args[args.indexOf('--model') + 1] : undefined
  const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : DEFAULT_OUT

  const wanted = only === undefined ? MODELS : MODELS.filter((model) => model.id === only)
  if (wanted.length === 0) throw new Error(`no model named ${only}`)

  const models = []
  for (const model of wanted) {
    process.stderr.write(`${model.id} (${model.repo})\n`)
    models.push(await describe(model))
  }

  // A partial run merges into what is already published rather than truncating it, so
  // `--model x` can refresh one entry without re-hashing every other model's weights.
  let existing = []
  if (only !== undefined) {
    const { readFileSync } = await import('node:fs')
    try {
      existing = JSON.parse(readFileSync(out, 'utf-8')).models ?? []
    } catch {
      existing = []
    }
  }
  const merged = [
    ...existing.filter((model) => !models.some((fresh) => fresh.id === model.id)),
    ...models,
  ].sort((left, right) => left.id.localeCompare(right.id))

  mkdirSync(path.dirname(out), { recursive: true })
  writeFileSync(out, `${JSON.stringify({ models: merged }, null, 2)}\n`)
  process.stderr.write(`wrote ${out}\n`)
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
  process.exit(1)
})
