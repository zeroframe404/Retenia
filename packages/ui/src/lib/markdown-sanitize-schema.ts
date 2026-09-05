import type { Nodes } from 'hast'
import type { Schema } from 'hast-util-sanitize'
import { sanitize } from 'hast-util-sanitize'
import { toJsxRuntime } from 'hast-util-to-jsx-runtime'
import type { ReactElement } from 'react'
import { Fragment, jsx, jsxs } from 'react/jsx-runtime'
import { defaultSchema } from 'rehype-sanitize'

/**
 * MathML presentation elements KaTeX 0.18.5 builds for the accessible half of its output
 * (`katex/dist/katex.mjs`, every `new MathNode("…")` call site). `mglyph` is deliberately
 * left out: KaTeX only reaches it through `\includegraphics`, which needs `trust: true`,
 * and it is the one MathML element that can load a remote image.
 */
const MATHML_TAGS = [
  'annotation',
  'math',
  'menclose',
  'mfrac',
  'mi',
  'mn',
  'mo',
  'mover',
  'mpadded',
  'mphantom',
  'mroot',
  'mrow',
  'mspace',
  'msqrt',
  'mstyle',
  'msub',
  'msubsup',
  'msup',
  'mtable',
  'mtd',
  'mtext',
  'mtr',
  'munder',
  'munderover',
  'semantics',
]

/** The only SVG elements KaTeX emits: stretchy delimiters (`svg` > `path`) and the strokes
 * `\cancel`-style enclosures draw (`svg` > `line`). */
const SVG_TAGS = ['line', 'path', 'svg']

/**
 * MathML presentation attributes KaTeX sets, verified by rendering its full command
 * surface and collecting the attributes per tag. All of them are presentational — none
 * takes a URL, and MathML's own linking attribute (`href`) is deliberately absent.
 * `width`, `height` and `align` are not repeated here: `defaultSchema` already allows
 * them on every element.
 */
const MATHML_ATTRIBUTES: Array<string | [string, RegExp]> = [
  'accent',
  'accentunder',
  'columnalign',
  'columnlines',
  'columnspacing',
  'depth',
  'display',
  'displaystyle',
  'linebreak',
  'linethickness',
  'lspace',
  'mathbackground',
  'mathcolor',
  'mathvariant',
  'maxsize',
  'minsize',
  'notation',
  'rowspacing',
  'rspace',
  'scriptlevel',
  'stretchy',
  'voffset',
]

/**
 * An inline `style` is kept only when it is a plain list of `property: value`
 * declarations: an identifier (or a `--custom-property`) then a value with no quotes,
 * parentheses, braces or backslashes in it.
 *
 * That covers everything KaTeX and Shiki emit (lengths in `em`, hex colors, and Shiki's
 * `--shiki-dark*` custom properties) while dropping `url(…)` — the one construct in a
 * style string that reaches the network — and any value malformed enough to throw inside
 * `style-to-js` when the declaration is turned into a React style object.
 */
const SAFE_STYLE_VALUE =
  /^\s*(?:--)?[a-zA-Z][a-zA-Z0-9-]*\s*:[^;:{}()<>"'\\]*(?:;\s*(?:--)?[a-zA-Z][a-zA-Z0-9-]*\s*:[^;:{}()<>"'\\]*)*;?\s*$/

const STYLE: [string, RegExp] = ['style', SAFE_STYLE_VALUE]

function mathmlAttributes(): Record<string, Array<string | [string, RegExp]>> {
  return Object.fromEntries(MATHML_TAGS.map((tag) => [tag, [...MATHML_ATTRIBUTES, STYLE]]))
}

/**
 * `defaultSchema` (GitHub-style sanitation) widened by exactly what KaTeX's HTML+MathML
 * renderer and Shiki's highlighter emit, and by nothing else.
 *
 * The widening is deliberately **per tag**. `className` and `style` on `'*'` would look
 * convenient but silently void every per-tag rule `defaultSchema` carries — `code`'s
 * `/^language-./`, `li`'s `task-list-item`, `ol`/`ul`'s `contains-task-list`, `h2`'s
 * `sr-only`, `section`'s `footnotes` — because a `'*'` entry is consulted for any key the
 * tag-specific list rejects. Scoping them to `span`, `pre` and the math tags that
 * actually carry them keeps those rules doing their job.
 *
 * `markdown-sanitize-schema.test.ts` pins the diff against `defaultSchema`, so widening it
 * again — here or by a dependency bump — fails CI instead of passing unnoticed.
 */
export const markdownSanitizeSchema: Schema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), ...MATHML_TAGS, ...SVG_TAGS],
  attributes: {
    ...defaultSchema.attributes,
    ...mathmlAttributes(),
    // The TeX source KaTeX keeps alongside the MathML. Pinning `encoding` to the one
    // value KaTeX writes is what closes the `<annotation encoding="text/html">` mXSS
    // vector: an HTML-encoded annotation is the classic way to smuggle markup past a
    // sanitizer that only looks at the tree.
    annotation: [['encoding', 'application/x-tex']],
    line: ['strokeWidth', 'x1', 'x2', 'y1', 'y2'],
    math: [...MATHML_ATTRIBUTES, STYLE, 'xmlns'],
    path: ['d'],
    // Shiki's wrapper: `class="shiki shiki-themes …"` plus the theme's background/foreground
    // as an inline style.
    pre: ['className', STYLE],
    // KaTeX's entire HTML half is nested `span`s positioned with inline styles, and Shiki's
    // per-token colors are the same shape.
    span: ['ariaHidden', 'className', STYLE],
    svg: ['preserveAspectRatio', 'viewBox', 'xmlns'],
  },
  protocols: {
    ...defaultSchema.protocols,
    // Source-library media (PDF page images, keyframes, occlusion crops…) is served over
    // the app's own `media://` protocol (docs/spec/07-architecture.md §3), so an
    // `![...](media://…)` image in a flashcard or lesson body has to survive.
    //
    // `media` is the *only* entry, and the list is narrower than `defaultSchema`'s
    // `['http', 'https']` in both directions:
    //
    // - `http`/`https` are dropped: the renderer's `img-src 'self' media: data: blob:` blocks
    //   remote images anyway (apps/desktop/src/main/security/csp.ts), so keeping them would buy
    //   no working image — only a tracking-pixel channel inside AI-generated markdown the day
    //   that policy is relaxed.
    // - `data:` is **not** added, even though `img-src` allows it. An inline `data:` image is an
    //   arbitrary attacker-authored resource in this origin — an SVG among them — and the
    //   activity host refuses exactly that shape one layer up (`defaultResolveMedia`,
    //   `packages/activities/src/host/ports.ts`). Two policies on the same question have to
    //   agree, and this is the one they agree on.
    // - `blob:` is not added either: nothing mints an object URL for a Markdown `![…](…)`. Media
    //   in activity text goes through `[[media:ID]]` and a resolved `<img src>` React prop, not
    //   through this schema.
    src: ['media'],
  },
  // `defaultSchema` unwraps a disallowed element into its children instead of dropping it.
  // For `<style>` that turns a stylesheet into a text node in the middle of the prose, and
  // inside `<svg>` — where the HTML parser treats `<style>` as foreign content — into real
  // elements. Dropping it whole is both safer and better-looking; nothing in this package
  // renders a `<style>` element.
  strip: [...(defaultSchema.strip ?? []), 'style'],
}

/**
 * Sanitize a generated hast tree against {@link markdownSanitizeSchema} and render it as
 * React elements.
 *
 * This is the one sanctioned way for this package to put generated markup on screen.
 * `dangerouslySetInnerHTML` is not an option for two independent reasons:
 *
 * 1. It is an unsanitized raw-HTML sink — its safety would rest entirely on KaTeX and
 *    Shiki never emitting anything unexpected, which no test in this repo can pin.
 * 2. `style-src` in the renderer's CSP governs style attributes in *parsed markup*, so
 *    inline styles written through `innerHTML` are dropped in the packaged app (they are
 *    only allowed when a dev-server origin relaxes the policy). Going through React
 *    instead means `hast-util-to-jsx-runtime` parses each `style` string into an object
 *    and React applies it through CSSOM, which no CSP directive governs — KaTeX keeps its
 *    positioning and Shiki its colors in production.
 */
export function renderSanitizedHast(tree: Nodes): ReactElement {
  return toJsxRuntime(sanitize(tree, markdownSanitizeSchema), {
    Fragment,
    jsx,
    jsxs,
    // Same choice `react-markdown` makes: one unparseable `style` string degrades that
    // element, it does not throw out of the render and blank the subtree.
    ignoreInvalidStyle: true,
  })
}
