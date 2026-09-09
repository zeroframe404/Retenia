/** Disjoint sets over `0 … size − 1`, with path compression; the merge bookkeeping of
 *  consolidation. Deterministic: the root of a merged pair is always the smaller index. */
export class UnionFind {
  private readonly parent: number[]

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, index) => index)
  }

  find(index: number): number {
    let root = index
    while (this.parent[root] !== root) root = this.parent[root] as number
    let at = index
    while (at !== root) {
      const next = this.parent[at] as number
      this.parent[at] = root
      at = next
    }
    return root
  }

  /** Joins the two sets; `true` when they were separate before. */
  union(a: number, b: number): boolean {
    const rootA = this.find(a)
    const rootB = this.find(b)
    if (rootA === rootB) return false
    if (rootA < rootB) this.parent[rootB] = rootA
    else this.parent[rootA] = rootB
    return true
  }

  /** Every set as its sorted member indices, sets ordered by their smallest member. */
  groups(): number[][] {
    const byRoot = new Map<number, number[]>()
    for (let index = 0; index < this.parent.length; index += 1) {
      const root = this.find(index)
      const members = byRoot.get(root) ?? []
      members.push(index)
      byRoot.set(root, members)
    }
    return [...byRoot.entries()].sort((a, b) => a[0] - b[0]).map(([, members]) => members)
  }
}
