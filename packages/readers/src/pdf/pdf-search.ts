import type { PdfSearchMatch } from './types'

/**
 * In-document search over already-extracted page text (`PDFPageProxy.getTextContent()`,
 * joined per page by `pdf-reader.tsx`). Pure string matching — no pdf.js types here, so it is
 * trivially testable without a document.
 */

/** Every case-insensitive occurrence of `query` across `pageTexts` (1-based page → its text),
 *  in reading order. Empty or whitespace-only queries match nothing, matching how a search
 *  box behaves before the user has typed anything worth searching for. */
export function findMatches(
  pageTexts: ReadonlyMap<number, string>,
  query: string,
): PdfSearchMatch[] {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return []

  const matches: PdfSearchMatch[] = []
  const pages = [...pageTexts.keys()].sort((a, b) => a - b)
  for (const page of pages) {
    const haystack = (pageTexts.get(page) ?? '').toLowerCase()
    let from = 0
    for (;;) {
      const at = haystack.indexOf(needle, from)
      if (at === -1) break
      matches.push({ page, charIndex: at, length: needle.length })
      from = at + needle.length
    }
  }
  return matches
}

/** The match to show/scroll to next, wrapping around either end — a search box's "next"/
 *  "previous" affordance never dead-ends at the last or first result. */
export function stepMatch(count: number, current: number, direction: 1 | -1): number {
  if (count === 0) return -1
  return (current + direction + count) % count
}
