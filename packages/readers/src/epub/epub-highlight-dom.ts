/**
 * Wraps a `Range` in `<mark>` elements — the visual half of an EPUB highlight, once its CFI
 * has been resolved back to a `Range` in the rendered section (`epub-cfi.ts`'s
 * `resolveAnnotationCfi`). Walks every text node the range touches rather than
 * `Range.surroundContents()` (which throws the moment a range's boundary splits a non-text
 * node — any highlight crossing so much as an `<em>` tag) so a highlight spanning inline
 * markup still renders as one visual run.
 */

const HIGHLIGHT_CLASS = 'retenia-highlight'

function collectTextNodes(range: Range): Text[] {
  const root = range.commonAncestorContainer
  // A range entirely within one text node has *that node* as its common ancestor — and a
  // `TreeWalker` only visits root's descendants, never root itself, so the node it needs to
  // wrap would otherwise never come back.
  if (root.nodeType === Node.TEXT_NODE) return [root as Text]

  const doc = root.ownerDocument ?? document
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
  })
  const nodes: Text[] = []
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    nodes.push(node as Text)
  }
  return nodes
}

/** Wraps `range`'s text in one `<mark>` per text node it touches, tagged with `dataset.highlightId`
 *  so `clearHighlightMarks` can remove exactly this highlight later (editing a note, or a
 *  highlight the user deleted) without touching any other. Empty ranges (a node the range
 *  only grazes at a boundary) are skipped rather than producing an empty `<mark>`. */
export function markRange(range: Range, highlightId: string, color: string): void {
  const commonAncestorContainer = range.commonAncestorContainer as
    | (Node & { ownerDocument: Document | null })
    | Document
  const doc =
    commonAncestorContainer.nodeType === Node.DOCUMENT_NODE
      ? (commonAncestorContainer as Document)
      : (commonAncestorContainer.ownerDocument ?? document)

  for (const node of collectTextNodes(range)) {
    const nodeRange = doc.createRange()
    nodeRange.selectNodeContents(node)
    if (node === range.startContainer) nodeRange.setStart(node, range.startOffset)
    if (node === range.endContainer) nodeRange.setEnd(node, range.endOffset)
    if (nodeRange.collapsed) continue

    const mark = doc.createElement('mark')
    mark.className = HIGHLIGHT_CLASS
    mark.dataset.highlightId = highlightId
    mark.style.backgroundColor = color
    try {
      nodeRange.surroundContents(mark)
    } catch {
      // A boundary that still splits an element `surroundContents` cannot wrap (rare: a
      // range edge exactly at an element boundary within the same text-node pass) — skip
      // that one node rather than losing the rest of the highlight.
    }
  }
}

/** Removes every `<mark>` this module drew, in `container`, for one highlight (or every
 *  highlight, when `highlightId` is omitted) — re-rendering a section clears the DOM anyway,
 *  but editing a single highlight's color/note in place uses this first. */
export function clearHighlightMarks(container: ParentNode, highlightId?: string): void {
  const selector =
    highlightId === undefined
      ? `mark.${HIGHLIGHT_CLASS}`
      : `mark.${HIGHLIGHT_CLASS}[data-highlight-id="${CSS.escape(highlightId)}"]`
  for (const mark of Array.from(container.querySelectorAll(selector))) {
    const parent = mark.parentNode
    if (parent === null) continue
    while (mark.firstChild !== null) parent.insertBefore(mark.firstChild, mark)
    parent.removeChild(mark)
    parent.normalize()
  }
}
