export interface EpubSearchMatch {
  charIndex: number
  length: number
}

/**
 * Search within the current section's text — narrower than `PdfReader`'s whole-document
 * search (`pdf-search.ts`'s `findMatches`), which is a real scope decision: PDF pages are
 * cheap to extract text from up front (`page.getTextContent()`, no DOM to build), while an
 * EPUB section requires parsing and rendering its XHTML, which this reader only does for the
 * section on screen. Widening to the whole book means indexing every section's text
 * eagerly — worth doing once a book search actually turns out to be worth the extra parsing,
 * not before. `stepMatch` (page nav's "next/prev, wrapping") is shared as-is from
 * `../pdf/pdf-search`: identical logic, no reason to fork it.
 */
export { stepMatch } from '../pdf/pdf-search'

export function findMatchesInSection(text: string, query: string): EpubSearchMatch[] {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return []

  const haystack = text.toLowerCase()
  const matches: EpubSearchMatch[] = []
  let from = 0
  for (;;) {
    const at = haystack.indexOf(needle, from)
    if (at === -1) break
    matches.push({ charIndex: at, length: needle.length })
    from = at + needle.length
  }
  return matches
}
