import { BLOOM_LEVELS, type BloomLevel } from '@retenia/core'
import { breakCycles } from '../graph/cycles'
import { compareNumbers, compareStrings, sortedBy, sourceRank } from '../graph/order'
import { type GenerationWarning, warning } from '../schemas/warnings'
import {
  CONCEPT_KINDS,
  type ConceptEdge,
  type ConceptKind,
  type ConceptNode,
  EDGE_KINDS,
  type EdgeKind,
  type KnowledgeGraph,
  type SourceRef,
  type ValidationContext,
} from './types'

/**
 * Gates 1–4 of the validation pass: the graph the model proposed, made consistent.
 *
 * Nodes are deduplicated and clamped; every source ref is resolved against *our* chunk
 * index, which is where its position and source come from (the model only names the chunk);
 * a concept whose every reference is front matter is removed (`docs/spec/04-path-generation.md`
 * §14 pitfall 6); edges with unknown ends or both ends the same are dropped; parallel edges
 * collapse to the strongest; and every cycle among `PREREQ_OF` edges is broken at its weakest
 * edge (§3 stage 4: "it must be a DAG"; §14 pitfall 7).
 *
 * Everything is walked in sorted order, so the result — and the warnings, in order — are the
 * same whatever order the model listed things in.
 */

export interface GraphValidation {
  readonly graph: KnowledgeGraph
  /** Concepts removed as front matter: lessons and misconceptions drop them silently. */
  readonly dropped: ReadonlySet<string>
  readonly warnings: readonly GenerationWarning[]
}

const DEFAULT_BLOOM: BloomLevel = 'understand'
const DEFAULT_KIND: ConceptKind = 'concept'
const DEFAULT_EDGE_KIND: EdgeKind = 'RELATED_TO'

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min
  return Math.min(max, Math.max(min, value))
}

function isBloom(value: string): value is BloomLevel {
  return (BLOOM_LEVELS as readonly string[]).includes(value)
}

function isConceptKind(value: string): value is ConceptKind {
  return (CONCEPT_KINDS as readonly string[]).includes(value)
}

function isEdgeKind(value: string): value is EdgeKind {
  return (EDGE_KINDS as readonly string[]).includes(value)
}

/** `kind`, `from`, `to`, then the strongest first — the canonical edge order. */
export function compareEdges(a: ConceptEdge, b: ConceptEdge): number {
  return (
    compareStrings(a.kind, b.kind) ||
    compareStrings(a.from, b.from) ||
    compareStrings(a.to, b.to) ||
    compareNumbers(b.confidence, a.confidence)
  )
}

export function validateGraph(graph: KnowledgeGraph, ctx: ValidationContext): GraphValidation {
  const warnings: GenerationWarning[] = []

  // Gate 1 — nodes: one per id, values inside their ranges.
  const byId = new Map<string, ConceptNode>()
  for (const node of sortedBy(graph.nodes, (a, b) => compareStrings(a.concept_id, b.concept_id))) {
    if (byId.has(node.concept_id)) {
      warnings.push(warning('duplicate_node', { concept_id: node.concept_id }))
      continue
    }
    byId.set(node.concept_id, {
      ...node,
      importance: clamp(node.importance, 0, 1),
      difficulty: clamp(Math.round(node.difficulty), 1, 5),
      bloom_target: isBloom(node.bloom_target) ? node.bloom_target : DEFAULT_BLOOM,
      kind: isConceptKind(node.kind) ? node.kind : DEFAULT_KIND,
    })
  }

  // Gate 2 — source refs resolved against the chunk index; front matter dropped.
  const dropped = new Set<string>()
  const nodes: ConceptNode[] = []
  for (const node of byId.values()) {
    const resolved: Array<{ ref: SourceRef; frontmatter: boolean }> = []
    const seen = new Set<string>()
    let unknown = 0
    for (const ref of node.source_refs) {
      const chunk = ctx.chunks.get(ref.chunk_id)
      if (chunk === undefined) {
        unknown += 1
        continue
      }
      if (seen.has(ref.chunk_id)) continue
      seen.add(ref.chunk_id)
      resolved.push({
        ref: {
          ...ref,
          source_id: chunk.sourceId,
          ordinal: chunk.ordinal,
          heading_path: chunk.headingPath,
        },
        frontmatter: chunk.isFrontmatter,
      })
    }
    if (unknown > 0) {
      warnings.push(warning('unknown_chunk_ref', { concept_id: node.concept_id, count: unknown }))
    }
    if (resolved.length > 0 && resolved.every((entry) => entry.frontmatter)) {
      dropped.add(node.concept_id)
      warnings.push(
        warning('frontmatter_excluded', { concept_id: node.concept_id, canonical: node.canonical }),
      )
      continue
    }
    if (resolved.length === 0) {
      warnings.push(warning('concept_without_sources', { concept_id: node.concept_id }))
    }
    const refs = sortedBy(
      resolved.map((entry) => entry.ref),
      (a, b) =>
        compareNumbers(
          sourceRank(a.source_id, ctx.sourceIds),
          sourceRank(b.source_id, ctx.sourceIds),
        ) ||
        compareNumbers(a.ordinal, b.ordinal) ||
        compareStrings(a.chunk_id, b.chunk_id),
    )
    nodes.push({ ...node, source_refs: refs })
  }

  // Gate 3 — edges: known ends, no self-loops, one edge per (kind, from, to).
  const known = new Set(nodes.map((node) => node.concept_id))
  const strongest = new Map<string, ConceptEdge>()
  for (const edge of sortedBy(graph.edges, compareEdges)) {
    if (dropped.has(edge.from) || dropped.has(edge.to)) continue
    const kind = isEdgeKind(edge.kind) ? edge.kind : DEFAULT_EDGE_KIND
    if (!known.has(edge.from) || !known.has(edge.to)) {
      warnings.push(warning('dangling_edge', { from: edge.from, to: edge.to, kind }))
      continue
    }
    if (edge.from === edge.to) {
      warnings.push(warning('self_loop', { concept_id: edge.from, kind }))
      continue
    }
    const key = `${kind} ${edge.from} ${edge.to}`
    const confidence = clamp(edge.confidence, 0, 1)
    // Sorted strongest first, so the first edge of a (kind, from, to) is the one to keep.
    if (!strongest.has(key)) {
      strongest.set(key, { from: edge.from, to: edge.to, kind, confidence })
    }
  }

  // Gate 4 — prerequisite cycles, broken at the weakest edge.
  const edges = [...strongest.values()]
  const { kept, removed } = breakCycles(edges.filter((edge) => edge.kind === 'PREREQ_OF'))
  for (const edge of removed) {
    warnings.push(
      warning('cycle_broken', { from: edge.from, to: edge.to, confidence: edge.confidence }),
    )
  }
  const others = edges.filter((edge) => edge.kind !== 'PREREQ_OF')

  return {
    graph: { nodes, edges: sortedBy([...kept, ...others], compareEdges) },
    dropped,
    warnings,
  }
}
