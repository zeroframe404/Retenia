/**
 * Kahn's algorithm with a priority: among the items whose prerequisites are all placed, the
 * comparator decides which goes next — never the order the items were given in.
 *
 * This is the "stable topological sort … tie-broken by order in the primary source and by
 * importance" of `docs/spec/04-path-generation.md` §3 stage 5, as one function over plain
 * data, so the same rule orders sections, modules and lessons.
 *
 * Edges whose endpoints are not among `items` are ignored. If a cycle survives — the caller
 * is meant to have broken every one — what is left is appended in comparator order rather
 * than dropped: a lesson silently missing from a path is worse than one out of order.
 */
export function priorityTopologicalOrder<T>(
  items: readonly T[],
  edges: ReadonlyArray<readonly [from: T, to: T]>,
  compare: (a: T, b: T) => number,
): T[] {
  const position = new Map<T, number>()
  for (const [index, item] of items.entries()) position.set(item, index)

  const indegree = new Map<T, number>()
  for (const item of items) indegree.set(item, 0)
  const successors = new Map<T, T[]>()
  for (const [from, to] of edges) {
    if (!position.has(from) || !position.has(to)) continue
    indegree.set(to, (indegree.get(to) as number) + 1)
    const list = successors.get(from) ?? []
    list.push(to)
    successors.set(from, list)
  }

  // The comparator is expected to be total; the input position is only the tie-break that
  // keeps the order well defined when it is not.
  const order = (a: T, b: T): number =>
    compare(a, b) || (position.get(a) as number) - (position.get(b) as number)

  const ready = items.filter((item) => indegree.get(item) === 0).sort(order)
  const placed = new Set<T>()
  const out: T[] = []

  while (ready.length > 0) {
    const item = ready.shift() as T
    out.push(item)
    placed.add(item)
    for (const next of successors.get(item) ?? []) {
      const remaining = (indegree.get(next) as number) - 1
      indegree.set(next, remaining)
      if (remaining === 0) insertSorted(ready, next, order)
    }
  }

  if (out.length < items.length) {
    out.push(...items.filter((item) => !placed.has(item)).sort(order))
  }
  return out
}

function insertSorted<T>(list: T[], item: T, order: (a: T, b: T) => number): void {
  let at = list.findIndex((existing) => order(item, existing) < 0)
  if (at < 0) at = list.length
  list.splice(at, 0, item)
}
