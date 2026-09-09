import { createHash } from 'node:crypto'
import type { Chunk, GenerationRunStatus, Source } from '@retenia/core'
import type { GenerationConfig } from '../config/generation-config'
import { asJson } from '../json'
import type { PathgenPrompt, PathgenPrompts } from '../prompts'
import { EXTRACT_CHUNK_SCHEMA_ID } from '../schemas/extraction'
import { KNOWLEDGE_GRAPH_SCHEMA_ID } from '../schemas/knowledge-graph'
import {
  type GenerationManifest,
  MANIFEST_SCHEMA_ID,
  MANIFEST_VERSION,
  type ManifestCost,
  type ManifestModel,
  type ManifestStats,
} from '../schemas/manifest'
import { SYNTHESIZE_MODULE_SCHEMA_ID, SYNTHESIZE_OUTLINE_SCHEMA_ID } from '../schemas/outline'
import { PATH_DRAFT_SCHEMA_ID } from '../schemas/path-draft'
import { dedupeWarnings, type GenerationWarning } from '../schemas/warnings'

/** Bumped when `sequencePath` would order the same input differently. */
export const SEQUENCING_ALGORITHM_VERSION = '1'

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** What "the same book" means to a re-run: the sorted chunk keys (or hashes) in scope. */
export function chunkSetHash(chunks: readonly Pick<Chunk, 'chunkKey' | 'hash'>[]): string {
  return sha256(
    chunks
      .map((chunk) => chunk.chunkKey ?? chunk.hash)
      .sort()
      .join('\n'),
  )
}

/**
 * The seed every seeded shuffle draws from: the run's *inputs* — the chunk sets, the
 * configuration and the prompt versions — never its id, so the same inputs give the same
 * draft on every run (`docs/spec/04-path-generation.md` §7).
 */
export function generationSeed(input: {
  readonly chunkSetHashes: readonly string[]
  readonly configHash: string
  readonly prompts: Pick<PathgenPrompts, 'extract' | 'outline' | 'module'>
}): string {
  const versions = [input.prompts.extract, input.prompts.outline, input.prompts.module]
    .map((prompt: PathgenPrompt) => `${prompt.promptVersion}@${prompt.schemaVersion}`)
    .join(',')
  return sha256(`${input.chunkSetHashes.join(',')}|${input.configHash}|${versions}`)
}

export interface ManifestModelInput {
  readonly provider: string | null
  readonly model: string | null
  readonly temperature: number
  readonly modelsUsed: readonly string[]
}

export interface ManifestSourceInput {
  readonly source: Pick<Source, 'id' | 'blobSha256'>
  /** The source's chunks in scope, front matter included. */
  readonly chunks: readonly Pick<Chunk, 'chunkKey' | 'hash' | 'chunkingVersion'>[]
}

export interface ManifestInput {
  readonly runId: string
  readonly createdAt: Date
  readonly stage: GenerationRunStatus
  readonly config: GenerationConfig
  readonly configHash: string
  readonly sources: readonly ManifestSourceInput[]
  readonly prompts: PathgenPrompts
  readonly models: {
    readonly extract: ManifestModelInput
    readonly outline: ManifestModelInput
    readonly module: ManifestModelInput
  }
  readonly embeddings: {
    readonly modelId: string | null
    readonly dims: number | null
    readonly threshold: number
  }
  readonly seed: string
  readonly cost: ManifestCost
  readonly stats: ManifestStats
  readonly warnings: readonly GenerationWarning[]
}

function toModel(input: ManifestModelInput): ManifestModel {
  return {
    provider: input.provider,
    model: input.model,
    temperature: input.temperature,
    seed: null,
    models_used: [...new Set(input.modelsUsed)].sort(),
  }
}

export function buildManifest(input: ManifestInput): GenerationManifest {
  return {
    version: MANIFEST_VERSION,
    created_at: input.createdAt.toISOString(),
    run_id: input.runId,
    stage: input.stage,
    config: asJson(input.config),
    config_hash: input.configHash,
    source_hashes: input.sources.map(({ source, chunks }) => ({
      source_id: source.id,
      blob_sha256: source.blobSha256,
      chunk_set_hash: chunkSetHash(chunks),
      chunk_count: chunks.length,
      chunking_version: chunks[0]?.chunkingVersion ?? null,
    })),
    prompt_versions: { ...input.prompts.snapshot },
    schema_versions: {
      extract_chunk: EXTRACT_CHUNK_SCHEMA_ID,
      synthesize_outline: SYNTHESIZE_OUTLINE_SCHEMA_ID,
      synthesize_module: SYNTHESIZE_MODULE_SCHEMA_ID,
      knowledge_graph: KNOWLEDGE_GRAPH_SCHEMA_ID,
      path_draft: PATH_DRAFT_SCHEMA_ID,
      manifest: MANIFEST_SCHEMA_ID,
    },
    models: {
      P1_extract_chunk: toModel(input.models.extract),
      P2_synthesize_outline: toModel(input.models.outline),
      P2_synthesize_module: toModel(input.models.module),
    },
    embeddings: {
      model_id: input.embeddings.modelId,
      dims: input.embeddings.dims,
      threshold: input.embeddings.threshold,
    },
    sequencing: { algorithm_version: SEQUENCING_ALGORITHM_VERSION, seed: input.seed },
    cost: { ...input.cost },
    stats: { ...input.stats },
    warnings: dedupeWarnings(input.warnings),
  }
}
