import type { ConsolidatedConcept } from '../consolidate'
import type { SynthesizeOutlineOutput } from '../schemas/outline'
import { type GenerationWarning, warning } from '../schemas/warnings'
import type { ConceptNode, KnowledgeGraph } from '../validate/types'
import { DEFAULT_IMPORTANCE_THRESHOLD } from '../validate/types'

/**
 * The model's graph, completed from what the code already knows.
 *
 * The outline call returns ids, targets and edges — never names, definitions or source refs,
 * which the consolidated concepts already hold and which the model could only have copied
 * or, worse, paraphrased. An id the model invented has nothing to attach and is dropped
 * (`unknown_node`); an important concept the model left out is appended so the validation
 * gates can home it (`coverage_gap`). Everything else the graph gates check — duplicates,
 * dangling edges, cycles — is left for them, so it is reported once and in one place.
 */

export interface BuiltGraph {
  readonly graph: KnowledgeGraph
  readonly warnings: GenerationWarning[]
}

function nodeFrom(
  concept: ConsolidatedConcept,
  proposed: Pick<ConceptNode, 'bloom_target' | 'difficulty' | 'importance'>,
): ConceptNode {
  return {
    concept_id: concept.concept_id,
    canonical: concept.canonical,
    aliases: [...concept.aliases],
    definition: concept.definition,
    kind: concept.kind,
    bloom_target: proposed.bloom_target,
    difficulty: proposed.difficulty,
    importance: proposed.importance,
    source_refs: concept.source_refs.map((ref) => ({ ...ref, block_ids: [...ref.block_ids] })),
  }
}

export function buildGraph(
  proposed: SynthesizeOutlineOutput['graph'],
  concepts: readonly ConsolidatedConcept[],
  options: { readonly threshold?: number } = {},
): BuiltGraph {
  const threshold = options.threshold ?? DEFAULT_IMPORTANCE_THRESHOLD
  const byId = new Map(concepts.map((concept) => [concept.concept_id, concept]))
  const warnings: GenerationWarning[] = []
  const nodes: ConceptNode[] = []
  const seen = new Set<string>()

  for (const node of proposed.nodes) {
    const concept = byId.get(node.concept_id)
    if (concept === undefined) {
      warnings.push(warning('unknown_node', { concept_id: node.concept_id }))
      continue
    }
    seen.add(node.concept_id)
    nodes.push(nodeFrom(concept, node))
  }

  const missing = concepts.filter(
    (concept) => !seen.has(concept.concept_id) && concept.importance >= threshold,
  )
  for (const concept of missing) {
    nodes.push(
      nodeFrom(concept, {
        bloom_target: 'understand',
        difficulty: concept.difficulty,
        importance: concept.importance,
      }),
    )
  }
  if (missing.length > 0) {
    warnings.push(
      warning('coverage_gap', {
        concept_ids: missing.map((concept) => concept.concept_id),
        level: 'graph',
      }),
    )
  }

  return {
    graph: { nodes, edges: proposed.edges.map((edge) => ({ ...edge })) },
    warnings,
  }
}
