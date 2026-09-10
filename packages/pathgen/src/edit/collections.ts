/** First occurrence wins, order preserved. */
export function dedupe<T>(values: readonly T[]): T[] {
  return [...new Set(values)]
}

/** Same as `dedupe`, keyed by a derived value rather than `===`. */
export function dedupeBy<T>(values: readonly T[], keyOf: (value: T) => string): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const value of values) {
    const key = keyOf(value)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }
  return out
}
