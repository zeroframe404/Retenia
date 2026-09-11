import type { ModuleGraph } from './types'

/**
 * §10 step 4 — propagation through the prerequisite DAG, the Knowledge-Space-Theory half of
 * the diagnostic: *"a correct answer → evidence about ancestors; a failure → about
 * descendants"*. Ancestors move by `+0.5·Δθ` only when Δθ > 0, descendants only when Δθ < 0,
 * and nothing further than two levels away moves at all.
 *
 * A module reachable at both one and two hops is one hop away — the nearer evidence wins.
 */

export const MAX_PROPAGATION_HOPS = 2

/** Every module within `maxHops` steps along `adjacency`, with its minimum distance. */
export function withinHops(
  adjacency: ReadonlyMap<string, readonly string[]>,
  from: string,
  maxHops: number = MAX_PROPAGATION_HOPS,
): Map<string, number> {
  const out = new Map<string, number>()
  let frontier = [from]
  for (let hop = 1; hop <= maxHops && frontier.length > 0; hop++) {
    const next: string[] = []
    for (const id of frontier) {
      for (const neighbour of adjacency.get(id) ?? []) {
        if (neighbour === from || out.has(neighbour)) continue
        out.set(neighbour, hop)
        next.push(neighbour)
      }
    }
    frontier = next
  }
  return out
}

export interface PropagationTarget {
  readonly moduleId: string
  readonly hop: number
  readonly delta: number
}

/** Where a Δθ on `moduleId` spreads, and by how much. Empty for Δθ = 0. */
export function propagationTargets(
  graph: ModuleGraph,
  moduleId: string,
  delta: number,
  hopFactors: readonly [number, number],
): PropagationTarget[] {
  if (delta === 0) return []
  const adjacency = delta > 0 ? graph.parents : graph.children
  const targets: PropagationTarget[] = []
  for (const [id, hop] of withinHops(adjacency, moduleId)) {
    targets.push({ moduleId: id, hop, delta: (hop === 1 ? hopFactors[0] : hopFactors[1]) * delta })
  }
  return targets
}
