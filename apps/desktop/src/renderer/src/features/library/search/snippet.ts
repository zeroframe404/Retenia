/**
 * FTS5's `snippet()` returns the matching passage with `<b>…</b>` around the hits. That
 * string is **source text** — the content of a file the user imported — with two markers of
 * ours inside it, so it must never reach `innerHTML`.
 *
 * This turns it into a list of runs the renderer builds real elements from. Anything that
 * looks like markup and is not one of our two markers stays literal text: a chunk from a book
 * about HTML really does contain `<script>`, and it should read as `<script>`.
 */

export interface SnippetRun {
  text: string
  /** Whether this run was inside a `<b>` pair — i.e. matched the query. */
  match: boolean
}

const MARKER = /<\/?b>/g

export function parseSnippet(snippet: string): SnippetRun[] {
  const runs: SnippetRun[] = []
  let depth = 0
  let index = 0

  const push = (text: string, match: boolean): void => {
    if (text.length === 0) return
    const previous = runs.at(-1)
    // Adjacent runs of the same kind are merged, so `</b><b>` does not split a word into two
    // spans and change how it wraps.
    if (previous !== undefined && previous.match === match) previous.text += text
    else runs.push({ text, match })
  }

  MARKER.lastIndex = 0
  for (let hit = MARKER.exec(snippet); hit !== null; hit = MARKER.exec(snippet)) {
    push(snippet.slice(index, hit.index), depth > 0)
    // An unbalanced `</b>` cannot take the depth negative: the rest of the passage would
    // then be styled as a match forever.
    depth = hit[0] === '<b>' ? depth + 1 : Math.max(0, depth - 1)
    index = hit.index + hit[0].length
  }
  push(snippet.slice(index), depth > 0)

  return runs
}
