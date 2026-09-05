import { useEffect, useId, useRef, useState } from 'react'
import { cn } from '../lib/cn'

export interface MermaidViewProps {
  /** Mermaid diagram source, e.g. `"graph TD; A-->B;"`. Can come from AI-generated
   * content (docs/spec/12-…: diagrams-as-code), so it is never trusted to be safe markup. */
  chart: string
  height?: number
  /** Accessible name of the rendered diagram. */
  label?: string
  errorLabel?: string
  className?: string
}

type MermaidApi = typeof import('mermaid').default

let mermaidPromise: Promise<MermaidApi> | undefined

/**
 * Loads Mermaid once and configures it once.
 *
 * `mermaid.initialize` writes a module-global config, so calling it per mount means the
 * last diagram to mount decides the settings for every diagram already on screen. It
 * belongs here, next to the import it configures.
 *
 * `securityLevel: 'strict'` is Mermaid's own sanitizing level: every label is passed through
 * DOMPurify (`chunks/mermaid.core/chunk-DU6HZSFF.mjs`'s `sanitizeText`) and `click` directives
 * are refused. It is necessary and it is **not sufficient**, which is why `htmlLabels` is off too.
 *
 * `htmlLabels: false` is the load-bearing one. `securityLevel` does *not* imply it — Mermaid
 * defaults it to `true` at every security level (`chunk-DU6HZSFF.mjs`: `evaluate(config.htmlLabels
 * ?? config.flowchart?.htmlLabels ?? true)`) — and with it on, `addHtmlSpan`
 * (`chunk-GMAD6QVW.mjs`) writes each label into a `<foreignObject>` with d3's `span.html(…)`,
 * i.e. `innerHTML`, in the live layout document. The only filter on that path is `sanitizeText`,
 * whose DOMPurify pass keeps `<img src>` and `<video><source>` — they lose their event handlers
 * and nothing else — so an AI-generated diagram would create real resource-loading nodes in this
 * origin and only the renderer's `img-src`/`media-src` would stop them. With `htmlLabels: false`,
 * `createText` takes its other branch and builds `<tspan>`s with d3's `.text(…)`, so label text
 * becomes text nodes and is never parsed as markup here at all. It is also the label form that
 * survives being loaded as an image: SVG-in-`<img>` renders no `<foreignObject>` HTML.
 *
 * That branch has a second effect worth naming: `createText`'s KaTeX call lives in the
 * `useHtmlLabels` half, so `$$…$$` in a node label no longer reaches KaTeX at all. See the note
 * on `MermaidView` for the one KaTeX path this does not cover.
 *
 * `'sandbox'` — which reads better on paper, because Mermaid then builds the diagram inside a
 * throwaway iframe instead of in this document — **cannot be used**: `sandboxedIframe`
 * (`dist/mermaid.core.mjs`) appends an `<iframe sandbox="">` and immediately reads
 * `iframe.contentDocument.body` from the parent. An empty `sandbox` withholds
 * `allow-same-origin`, so that document has an opaque origin and `contentDocument` is `null`;
 * every diagram threw before it was ever drawn. Measured in the packaged app, not inferred —
 * jsdom hands back a document either way, which is exactly why no unit test could see it.
 *
 * The memo is dropped again if the import or the configuration throws. A cached rejection would
 * turn one failed chunk load into a blank diagram for the rest of the session, since every later
 * mount would await the same settled promise; clearing it means the next diagram retries, and the
 * rethrow is what reaches the effect's `catch` and shows the error state.
 */
function loadMermaid(): Promise<MermaidApi> {
  mermaidPromise ??= import('mermaid')
    .then(({ default: mermaid }) => {
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', htmlLabels: false })
      return mermaid
    })
    .catch((error: unknown) => {
      mermaidPromise = undefined
      throw error
    })
  return mermaidPromise
}

/**
 * Where Mermaid is allowed to do its layout work.
 *
 * Mermaid has to measure real text to place nodes, so the diagram must exist in a live document
 * for a moment. Given a container it builds there; given none it builds in `document.body`. This
 * is that container: created per render, off-screen, hidden from assistive technology, and
 * removed in a `finally` — so the transient nodes are confined to one this component owns and
 * discards, rather than being appended to the page the user is looking at.
 *
 * Be precise about what this does and does not buy. The diagram *is* built in this document: d3
 * creates real `<svg>`, `<g>`, `<path>`, `<text>` and `<style>` elements here, and the `<style>`
 * is why `apps/desktop/e2e/markdown-csp.spec.ts` sees a `style-src-elem` report while a diagram
 * renders. What the container buys is that they are off-screen, `aria-hidden`, and gone by the
 * time the effect settles. What keeps *untrusted* content from being parsed as markup in them is
 * `htmlLabels: false` (see `loadMermaid`), not this function.
 */
function createLayoutHost(): HTMLDivElement {
  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  host.style.cssText = 'position:absolute;left:-10000px;top:0;width:1024px;pointer-events:none'
  document.body.append(host)
  return host
}

/**
 * The finished SVG as a `data:` URL for an `<img>`.
 *
 * `encodeURIComponent` rather than `btoa`: the source is lesson content and may be any Unicode,
 * which `btoa` throws on.
 */
function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/**
 * Renders a Mermaid diagram as a static image.
 *
 * The diagram source can come from AI-generated lesson content, so the **finished SVG is treated
 * as untrusted markup and is never inserted into this document**. It is handed to an `<img>` as a
 * `data:` URL instead, which puts it in the browser's secure static mode for images: scripts
 * never run, external references are never fetched, and there is nothing to navigate. That is a
 * strictly narrower surface than the `sandbox=""` iframe this used to use.
 *
 * The *layout* pass is a different guarantee and is worth stating separately, because "never
 * inserted into this document" is not true of it: Mermaid builds the diagram's elements in a live
 * node here (`createLayoutHost`) and only then serialises them. What holds there is narrower and
 * comes from `loadMermaid`'s configuration — `htmlLabels: false` means label text reaches the DOM
 * through d3's `.text()`, as text nodes, so no part of the diagram source is parsed as markup;
 * `securityLevel: 'strict'` DOMPurifies it on the way and refuses `click` directives.
 *
 * One KaTeX path is outside `KATEX_OPTIONS`' reach and stays that way. Mermaid renders `$$…$$`
 * itself, with `katex.renderToString(c, { throwOnError: true, displayMode: true, output })` and
 * no `maxSize`/`maxExpand` (`chunks/mermaid.core/chunk-DU6HZSFF.mjs`). `htmlLabels: false` takes
 * node labels off that path, but the sequence diagram's own measuring code
 * (`calculateMathMLDimensions`, same file) calls it regardless and writes the result into
 * `document.body` with `innerHTML`. Mermaid exposes no hook to bound it. The exposure is a layout
 * spike from an unbounded `\rule`, not script execution — KaTeX's `trust` still defaults to
 * `false`, so `\href`, `\htmlStyle` and `\includegraphics` render as error text — and it is
 * recorded here rather than papered over.
 *
 * It also happens to be the only one of the two that *works* under the renderer's policy. An
 * `about:srcdoc` document inherits its embedder's policy container, so the app's
 * `style-src 'self'` (`apps/desktop/src/main/security/csp.ts`) applied inside the presentation
 * iframe, and a Mermaid SVG carries its whole theme in an inline `<style>` element — every
 * diagram would have rendered unstyled. A `<style>` inside an *image* is not subject to the
 * embedding page's CSP at all, and `img-src` already allows `data:`. Both halves were measured
 * in the packaged app under the real policy; neither is a workaround that needed
 * `'unsafe-inline'`.
 *
 * `mermaid` itself is dynamically imported on first mount — it never loads until a
 * `MermaidView` actually appears.
 */
export function MermaidView({
  chart,
  height = 320,
  label,
  errorLabel,
  className,
}: MermaidViewProps) {
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const diagramId = useId().replace(/:/g, '-')
  const requestId = useRef(0)

  useEffect(() => {
    let cancelled = false
    const currentRequest = ++requestId.current
    setSvg(null)
    setError(null)

    loadMermaid()
      .then(async (mermaid) => {
        const host = createLayoutHost()
        try {
          const result = await mermaid.render(`mermaid-${diagramId}-${currentRequest}`, chart, host)
          if (!cancelled) setSvg(result.svg)
        } finally {
          host.remove()
        }
      })
      // One `catch` for both failures. A `try` around `mermaid.render` alone left a failed
      // `loadMermaid()` — a chunk that never arrives — as an unhandled rejection with the
      // component stuck on its loading skeleton, never reaching the error state below.
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })

    return () => {
      cancelled = true
    }
  }, [chart, diagramId])

  if (error) {
    return (
      <div
        role="alert"
        className={cn(
          'border-incorrect/30 text-incorrect rounded-lg border border-dashed p-4 text-sm',
          className,
        )}
      >
        {errorLabel ?? 'Could not render this diagram.'}
      </div>
    )
  }

  if (!svg) {
    return (
      <div
        className={cn('bg-neutral-100 dark:bg-neutral-800 animate-pulse rounded-lg', className)}
        style={{ height }}
        aria-hidden="true"
      />
    )
  }

  return (
    <img
      src={svgDataUrl(svg)}
      alt={label ?? 'Diagram'}
      className={cn('w-full object-contain', className)}
      style={{ height }}
    />
  )
}
