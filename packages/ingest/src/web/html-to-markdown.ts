import TurndownService from 'turndown'

/**
 * HTML → Markdown for one block-level element at a time (`docs/spec/05-ingestion-rag.md` §1:
 * "clean HTML → Markdown via Turndown, keep code blocks, footnotes, equations").
 *
 * Run per block rather than over the whole article: `parseWebPage` already walks the cleaned
 * article DOM element by element to build the `Section`/`Block` tree (exactly as `epub.ts` and
 * `docx.ts` do), and converting each element's own markup is what keeps inline formatting —
 * links, emphasis, inline code — that a bare `.text` accessor would silently strip. Footnotes
 * need no dedicated rule for the same reason: a footnote reference is just an anchor link
 * (`<a href="#fn1">`) and a footnote definition is just a list item, both of which Turndown's
 * built-in link and list rules already preserve.
 *
 * One instance is enough for a whole document — `TurndownService#turndown` takes an HTML
 * *fragment* and is otherwise stateless between calls.
 */

const TEX_ANNOTATION_SELECTOR = 'annotation[encoding="application/x-tex"]'

/**
 * The LaTeX source of a rendered equation, however it survived extraction — verified against
 * all three shapes this module actually sees in practice, not assumed:
 *
 *  - **Defuddle's own standardization** collapses a rendered formula to a single
 *    `<math data-latex="…" display="inline"|"block">`, dropping the visual rendering entirely.
 *  - **Readability** strips every `aria-hidden` element (KaTeX's visual `.katex-html`) and every
 *    class attribute, but leaves the accessible `.katex-mathml`'s `<math>` — and with it the
 *    `<annotation encoding="application/x-tex">` MathML itself carries — untouched.
 *  - **The untouched original markup** (the `raw` extraction fallback) has both: the same
 *    `<math>`/`annotation` pair inside `.katex-mathml`, *and* the sibling `.katex-html` this
 *    module removes below so it cannot echo the same formula a second time as visual noise.
 *
 * `display="block"` is MathML's own attribute, present in the same form in all three shapes —
 * one check, not one per extractor.
 */
function texSource(node: HTMLElement): string | undefined {
  const attr = node.getAttribute('data-latex')?.trim()
  if (attr) return attr
  const annotation = node.querySelector(TEX_ANNOTATION_SELECTOR)
  const text = annotation?.textContent?.trim()
  return text && text.length > 0 ? text : undefined
}

export function createHtmlToMarkdown(): TurndownService {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  })

  turndown.addRule('mathAnnotation', {
    // Lower-cased: unlike a regular HTML element, an element in the MathML namespace keeps the
    // case it was authored with rather than being upper-cased, and every real parser (jsdom,
    // a browser) reports it as lower-case `math` — checking both spellings costs nothing and
    // survives a parser that normalizes differently.
    filter: (node) => node.nodeName.toLowerCase() === 'math',
    replacement: (content, node) => {
      const tex = texSource(node)
      if (tex === undefined) return content
      return node.getAttribute('display') === 'block' ? `\n\n$$${tex}$$\n\n` : `$${tex}$`
    },
  })

  // Only reached by the `raw` fallback: Defuddle and Readability have each already removed
  // KaTeX's visual rendering by the time their output gets here (see `texSource` above), so
  // this is what keeps *unprocessed* KaTeX markup from turndown-ing into a second, garbled copy
  // of a formula the `mathAnnotation` rule above already converted cleanly.
  turndown.remove((node) => node.nodeName === 'SPAN' && node.classList.contains('katex-html'))

  return turndown
}

/**
 * Defuddle's `<math data-latex="…">` shorthand carries the whole formula in an *attribute*,
 * with no child text at all. Turndown's own `isBlank` check runs before any rule — including
 * `mathAnnotation` above — and short-circuits a node whose `textContent` is empty straight to
 * an empty string, so that shorthand would vanish silently without ever reaching the rule that
 * knows how to read it. A zero-width space is enough to make the node non-blank without adding
 * anything a reader would see if `texSource` ever failed to find the attribute after all.
 */
function ensureAttributeOnlyMathIsNotBlank(root: Node): void {
  const withQuerySelector = root as unknown as ParentNode
  if (typeof withQuerySelector.querySelectorAll !== 'function') return
  for (const math of withQuerySelector.querySelectorAll('math')) {
    if (math.childNodes.length === 0) math.textContent = '​'
  }
}

/**
 * One block's content, converted.
 *
 * Prefer handing this a live DOM node (an element or a `DocumentFragment`) over an HTML string
 * whenever the block might contain an equation: in a plain Node.js process Turndown parses a
 * string with `@mixmark-io/domino`, which does not implement HTML's foreign-content algorithm —
 * a bare `<math>` silently disappears before any rule ever sees it (confirmed empirically; not
 * documented anywhere in Turndown or domino). Handed a real node instead, Turndown just
 * `cloneNode`s it and walks the clone, so `parse-web.ts`'s own jsdom document — spec-compliant,
 * MathML included — is what actually gets converted. A plain string remains fine for anything
 * that cannot contain a `<math>` (a fenced code block's text, for instance).
 *
 * A node is cloned again here, before the `isBlank` workaround above mutates it, so a caller
 * that walks the same tree afterwards (`parse-web.ts` does, for the next block) never sees the
 * zero-width space this function added.
 */
export function htmlToMarkdown(
  turndown: TurndownService,
  input: string | TurndownService.Node,
): string {
  if (typeof input === 'string') return turndown.turndown(input).trim()
  const prepared = input.cloneNode(true)
  ensureAttributeOnlyMathIsNotBlank(prepared)
  return turndown.turndown(prepared as TurndownService.Node).trim()
}
