import { describe, expect, it } from 'vitest'
import { nodeAt } from '../testing/graph-fixtures'
import {
  KNOWLEDGE_GRAPH_SCHEMA_ID,
  knowledgeGraphDocumentSchema,
  toKnowledgeGraphDocument,
} from './knowledge-graph'
import { generationManifestSchema, MANIFEST_SCHEMA_ID } from './manifest'
import { PATH_DRAFT_SCHEMA_ID, pathDraftSchema } from './path-draft'

describe('the persisted documents', () => {
  it('name their versions', () => {
    expect(KNOWLEDGE_GRAPH_SCHEMA_ID).toBe('knowledge_graph@1')
    expect(PATH_DRAFT_SCHEMA_ID).toBe('path_draft@1')
    expect(MANIFEST_SCHEMA_ID).toBe('generation_manifest@1')
  })

  it('turn a validated graph into a KnowledgeGraph.v1 that parses back to itself', () => {
    const node = nodeAt('a', 'c0', { aliases: ['A'] })
    const doc = toKnowledgeGraphDocument(
      { nodes: [node], edges: [{ from: 'a', to: 'a', kind: 'RELATED_TO', confidence: 0.5 }] },
      { embeddingModelId: 'fake', threshold: 0.9 },
    )
    expect(knowledgeGraphDocumentSchema.parse(doc)).toEqual(doc)
    expect(doc.nodes[0]?.source_refs[0]).toEqual(node.source_refs[0])
    expect(doc.nodes[0]?.source_refs[0]).not.toBe(node.source_refs[0])
    expect(doc.nodes[0]?.aliases).toEqual(['A'])
  })

  it('reject a draft that is not a draft, and a manifest with a bad hash', () => {
    expect(pathDraftSchema.safeParse({ version: 1, kind: 'frozen' }).success).toBe(false)
    expect(generationManifestSchema.safeParse({ version: 1, config_hash: 'short' }).success).toBe(
      false,
    )
  })
})
