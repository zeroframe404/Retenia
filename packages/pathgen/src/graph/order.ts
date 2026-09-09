/**
 * Total, locale-independent orderings for everything the pure stages sort.
 *
 * Every loop in `graph/`, `validate/` and `sequencing/` walks arrays sorted by these
 * comparators rather than a `Map`'s insertion order, and never through `localeCompare`:
 * that is what makes "the same input in any order gives the same draft"
 * (`docs/spec/04-path-generation.md` §7) a property the tests can hold rather than an
 * accident of how the model happened to list things.
 */

/** Code-unit order: `'Z' < 'a'`, the same on every machine and in every locale. */
export function compareStrings(a: string, b: string): number {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

/** Ascending, with `Infinity` allowed — a concept with no source refs sorts last. */
export function compareNumbers(a: number, b: number): number {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

/** `[sourceRank, ordinal]`: where something first appears in the sources, primary first. */
export type PrimaryKey = readonly [rank: number, ordinal: number]

/** The position no reference ever reaches: what a concept with no refs is keyed by. */
export const NO_POSITION: PrimaryKey = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]

/**
 * The position of a source in the user's list: the primary source is rank 0, the others
 * follow in the order given, and a source not in the list at all sorts after every one that
 * is — a secondary source dropped from the configuration may still be referenced.
 */
export function sourceRank(sourceId: string, sourceIds: readonly string[]): number {
  const index = sourceIds.indexOf(sourceId)
  return index < 0 ? sourceIds.length : index
}

export function comparePrimary(a: PrimaryKey, b: PrimaryKey): number {
  return compareNumbers(a[0], b[0]) || compareNumbers(a[1], b[1])
}

/** The earliest of several positions, or `NO_POSITION` when there are none. */
export function minPrimary(keys: readonly PrimaryKey[]): PrimaryKey {
  let best = NO_POSITION
  for (const key of keys) {
    if (comparePrimary(key, best) < 0) best = key
  }
  return best
}

/** Composes comparators: the first one that decides wins. */
export function chain<T>(
  ...comparators: ReadonlyArray<(a: T, b: T) => number>
): (a: T, b: T) => number {
  return (a, b) => {
    for (const compare of comparators) {
      const verdict = compare(a, b)
      if (verdict !== 0) return verdict
    }
    return 0
  }
}

/** A sorted copy; the input is never mutated. */
export function sortedBy<T>(items: readonly T[], compare: (a: T, b: T) => number): T[] {
  return [...items].sort(compare)
}
