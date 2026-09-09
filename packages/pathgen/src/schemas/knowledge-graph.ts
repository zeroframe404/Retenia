import { BLOOM_LEVELS } from '@retenia/core'
import { z } from 'zod'
import { CONCEPT_KINDS, EDGE_KINDS, type KnowledgeGraph } from '../validate/types'
import { sourceRefSchema } from './path-draft'

/**
 * `KnowledgeGraph.v1` — what `path_versions.knowledge_graph` holds
 * (`docs/spec/04-path-generation.md` §3 stage 4, §8).
 *
 * `concept_id` is `c_` plus 16 hex characters of the normalised canonical's sha256, minted
 * by consolidation: stable across regenerations of the same book, which is what lets §7
 * migrate progress "by `concept_id`, not by position". A renamed canonical is a new id.
 */

export const KNOWLEDGE_GRAPH_VERSION = 1
export const KNOWLEDGE_GRAPH_SCHEMA_ID = 'knowledge_graph@1'

export const knowledgeGraphDocumentSchema = z.object({
  version: z.literal(KNOWLEDGE_GRAPH_VERSION),
  /** The embedding model consolidation deduplicated with; `null` when names alone were used. */
  embedding_model_id: z.string().nullable(),
  /** The cosine above which two occurrences were one concept. */
  threshold: z.number(),
  nodes: z.array(
    z.object({
      concept_id: z.string(),
      canonical: z.string(),
      aliases: z.array(z.string()),
      definition: z.string(),
      kind: z.enum(CONCEPT_KINDS),
      bloom_target: z.enum(BLOOM_LEVELS),
      difficulty: z.number(),
      importance: z.number(),
      source_refs: z.array(sourceRefSchema),
    }),
  ),
  edges: z.array(
    z.object({
      from: z.string(),
      to: z.string(),
      kind: z.enum(EDGE_KINDS),
      confidence: z.number(),
    }),
  ),
})

export type KnowledgeGraphDocument = z.infer<typeof knowledgeGraphDocumentSchema>

export function toKnowledgeGraphDocument(
  graph: KnowledgeGraph,
  meta: { readonly embeddingModelId: string | null; readonly threshold: number },
): KnowledgeGraphDocument {
  return {
    version: KNOWLEDGE_GRAPH_VERSION,
    embedding_model_id: meta.embeddingModelId,
    threshold: meta.threshold,
    nodes: graph.nodes.map((node) => ({
      concept_id: node.concept_id,
      canonical: node.canonical,
      aliases: [...node.aliases],
      definition: node.definition,
      kind: node.kind,
      bloom_target: node.bloom_target,
      difficulty: node.difficulty,
      importance: node.importance,
      source_refs: node.source_refs.map((ref) => ({ ...ref, block_ids: [...ref.block_ids] })),
    })),
    edges: graph.edges.map((edge) => ({ ...edge })),
  }
}
