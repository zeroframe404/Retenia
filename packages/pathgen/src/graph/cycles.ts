import { compareNumbers, compareStrings } from './order'
import { stronglyConnectedComponents } from './scc'

/** An edge with the confidence the model gave it, in whatever richer shape the caller has. */
export interface WeightedEdge {
  readonly from: string
  readonly to: string
  readonly confidence: number
}

/**
 * Break every cycle by removing, per strongly connected component and per pass, the edge
 * inside it with the lowest confidence — `docs/spec/04-path-generation.md` §3 stage 4
 * ("it must be a DAG"), §14 pitfall 7 ("cycles and invented prerequisites"): the least
 * supported dependency is the one most likely to be invented.
 *
 * The choice is total, so it is the same whatever order the edges arrived in: confidence
 * ascending, then `from`, then `to`, all by code unit. One edge per component per pass, then
 * the components are recomputed — a figure-eight needs two removals, not one — until nothing
 * is left cyclic. `removed` is in removal order, which is the order the warnings are raised.
 */
export function breakCycles<E extends WeightedEdge>(
  edges: readonly E[],
): { kept: E[]; removed: E[] } {
  let kept = [...edges]
  const removed: E[] = []

  for (;;) {
    const ids = new Set<string>()
    const successors = new Map<string, string[]>()
    const selfLoops = new Set<string>()
    for (const edge of kept) {
      ids.add(edge.from)
      ids.add(edge.to)
      if (edge.from === edge.to) selfLoops.add(edge.from)
      const list = successors.get(edge.from) ?? []
      list.push(edge.to)
      successors.set(edge.from, list)
    }
    for (const list of successors.values()) list.sort(compareStrings)

    const cyclic = stronglyConnectedComponents([...ids], (id) => successors.get(id) ?? []).filter(
      (component) => component.length > 1 || selfLoops.has(component[0] as string),
    )
    if (cyclic.length === 0) return { kept, removed }

    const drop = new Set<E>()
    for (const component of cyclic) {
      const members = new Set(component)
      const internal = kept.filter((edge) => members.has(edge.from) && members.has(edge.to))
      // A cyclic component has at least one internal edge by construction, so the reduce
      // always has something to start from.
      const weakest = internal.reduce((best, edge) => (compareEdges(edge, best) < 0 ? edge : best))
      drop.add(weakest)
      removed.push(weakest)
    }
    kept = kept.filter((edge) => !drop.has(edge))
  }
}

function compareEdges(a: WeightedEdge, b: WeightedEdge): number {
  return (
    compareNumbers(a.confidence, b.confidence) ||
    compareStrings(a.from, b.from) ||
    compareStrings(a.to, b.to)
  )
}
