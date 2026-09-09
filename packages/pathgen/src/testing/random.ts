import type { BloomLevel } from '@retenia/core'
import { BLOOM_LEVELS, mulberry32, shuffleWithRng } from '@retenia/core'
import type {
  ChunkRef,
  ConceptEdge,
  ConceptNode,
  KnowledgeGraph,
  Outline,
  ValidationContext,
} from '../validate/types'
import { CONCEPT_KINDS, EDGE_KINDS } from '../validate/types'
import { chunk, chunkIndex, PRIMARY, ref, SECONDARY } from './graph-fixtures'

/**
 * Seeded generators for the property tests, skewed on purpose: a uniform graph almost never
 * has a cycle, a dangling edge or an untaught important concept, and those are the cases the
 * validation and sequencing stages exist for.
 */

export type Rng = () => number

export function int(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1))
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)] as T
}

export function chance(rng: Rng, probability: number): boolean {
  return rng() < probability
}

export interface RandomCase {
  readonly graph: KnowledgeGraph
  readonly outline: Outline
  readonly ctx: ValidationContext
}

/** 40 primary chunks, 3 front-matter chunks and 10 secondary chunks. */
export function randomChunks(): ChunkRef[] {
  const out: ChunkRef[] = []
  for (let index = 0; index < 40; index += 1) out.push(chunk(`p${index}`, index))
  for (let index = 0; index < 3; index += 1) {
    out.push(chunk(`f${index}`, index, { isFrontmatter: true, headingPath: 'Índice' }))
  }
  for (let index = 0; index < 10; index += 1) {
    out.push(chunk(`s${index}`, index, { sourceId: SECONDARY }))
  }
  return out
}

export function randomCase(rng: Rng): RandomCase {
  const chunks = randomChunks()
  const primaryChunks = chunks.filter((entry) => entry.sourceId === PRIMARY && !entry.isFrontmatter)
  const secondaryChunks = chunks.filter((entry) => entry.sourceId === SECONDARY)
  const frontChunks = chunks.filter((entry) => entry.isFrontmatter)

  const count = int(rng, 2, 60)
  const allUnimportant = chance(rng, 0.25)
  const nodes: ConceptNode[] = []
  for (let index = 0; index < count; index += 1) {
    const id = `k${String(index).padStart(2, '0')}`
    const pool = chance(rng, 0.05)
      ? frontChunks
      : chance(rng, 0.15)
        ? secondaryChunks
        : primaryChunks
    const refs = Array.from({ length: int(rng, 1, 2) }, () => {
      const target = pick(rng, pool)
      return ref(target.chunkId, { source_id: target.sourceId, ordinal: target.ordinal })
    })
    nodes.push({
      concept_id: id,
      canonical: id.toUpperCase(),
      aliases: [],
      definition: `${id} definition`,
      kind: pick(rng, CONCEPT_KINDS),
      bloom_target: pick(rng, BLOOM_LEVELS) as BloomLevel,
      difficulty: int(rng, 1, 5),
      importance: allUnimportant ? rng() * 0.49 : rng(),
      source_refs: refs,
    })
  }
  const ids = nodes.map((node) => node.concept_id)

  const edges: ConceptEdge[] = []
  const edgeCount = int(rng, 0, 2 * count)
  for (let index = 0; index < edgeCount; index += 1) {
    const from = chance(rng, 0.05) ? 'ghost' : pick(rng, ids)
    const to = chance(rng, 0.1) ? from : chance(rng, 0.05) ? 'phantom' : pick(rng, ids)
    edges.push({
      from,
      to,
      kind: chance(rng, 0.8) ? 'PREREQ_OF' : pick(rng, EDGE_KINDS),
      confidence: Math.round(rng() * 100) / 100,
    })
  }

  const sections = Array.from({ length: int(rng, 1, 5) }, (_, s) => ({
    title: chance(rng, 0.1) ? '' : `Sección ${s + 1}`,
    modules: Array.from({ length: int(rng, 1, 5) }, (_, m) => ({
      title: chance(rng, 0.1) ? '' : `Módulo ${s + 1}.${m + 1}`,
      objectives: Array.from({ length: int(rng, 0, 5) }, (_, o) => ({
        text: `Objetivo ${o}`,
        bloom: pick(rng, BLOOM_LEVELS) as BloomLevel,
      })),
      lesson_specs: Array.from({ length: int(rng, 1, 9) }, (_, l) => ({
        title: chance(rng, 0.1) ? '' : `Lección ${s + 1}.${m + 1}.${l + 1}`,
        concept_ids: Array.from({ length: int(rng, 0, 7) }, () =>
          chance(rng, 0.05) ? 'unknown' : pick(rng, ids),
        ),
        objectives: Array.from({ length: int(rng, 0, 5) }, (_, o) => ({
          text: `Objetivo ${o}`,
          bloom: pick(rng, BLOOM_LEVELS) as BloomLevel,
        })),
        estimated_minutes: chance(rng, 0.2) ? null : int(rng, 1, 40),
        origin: 'model' as const,
      })),
    })),
  }))

  return {
    graph: { nodes, edges },
    outline: {
      sections,
      misconceptions: Array.from({ length: int(rng, 0, 4) }, (_, index) => ({
        concept_id: chance(rng, 0.2) ? 'unknown' : pick(rng, ids),
        text: `Error ${index}`,
        why_wrong: 'porque',
      })),
      warnings: chance(rng, 0.3) ? ['nota'] : [],
    },
    ctx: { chunks: chunkIndex(chunks), sourceIds: [PRIMARY, SECONDARY] },
  }
}

/** The same case with its nodes and edges in another order: the order must not matter. */
export function shuffledCase(entry: RandomCase, seed: number): RandomCase {
  const rng = mulberry32(seed)
  return {
    ...entry,
    graph: {
      nodes: shuffleWithRng(entry.graph.nodes, rng),
      edges: shuffleWithRng(entry.graph.edges, rng),
    },
  }
}
