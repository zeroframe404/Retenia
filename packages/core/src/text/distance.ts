/**
 * Optimal string alignment distance (Damerau-Levenshtein without the unrestricted
 * transposition), over code points so an accented or astral character is one edit.
 */
export function damerauLevenshtein(a: string, b: string): number {
  const s = [...a]
  const t = [...b]
  const rows = s.length + 1
  const cols = t.length + 1
  const d: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0))
  for (let i = 0; i < rows; i++) (d[i] as number[])[0] = i
  for (let j = 0; j < cols; j++) (d[0] as number[])[j] = j

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1
      let best = Math.min(
        ((d[i - 1] as number[])[j] as number) + 1, // deletion
        ((d[i] as number[])[j - 1] as number) + 1, // insertion
        ((d[i - 1] as number[])[j - 1] as number) + cost, // substitution
      )
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) {
        best = Math.min(best, ((d[i - 2] as number[])[j - 2] as number) + 1) // transposition
      }
      ;(d[i] as number[])[j] = best
    }
  }
  return (d[rows - 1] as number[])[cols - 1] as number
}

/** The distance over the longer length: 0 for identical strings, 1 for nothing in common. */
export function relativeDistance(a: string, b: string): number {
  const longest = Math.max([...a].length, [...b].length)
  return longest === 0 ? 0 : damerauLevenshtein(a, b) / longest
}
