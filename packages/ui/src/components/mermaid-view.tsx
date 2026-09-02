import { useEffect, useId, useRef, useState } from 'react'
import { cn } from '../lib/cn'

export interface MermaidViewProps {
  /** Mermaid diagram source, e.g. `"graph TD; A-->B;"`. Can come from AI-generated
   * content (docs/spec/12-…: diagrams-as-code), so it is never trusted to be safe markup. */
  chart: string
  height?: number
  errorLabel?: string
  className?: string
}

const IFRAME_STYLE = `
  :root { color-scheme: light dark; }
  html, body { margin: 0; padding: 0; }
  svg { display: block; width: 100%; height: 100%; }
`

/**
 * Renders a Mermaid diagram as static SVG inside a fully sandboxed `<iframe>`
 * (`sandbox=""` — no scripts, no same-origin, no navigation): diagram source can come
 * from AI-generated lesson content, so the rendered SVG is treated as untrusted and
 * isolated from the app's own DOM even though Mermaid's own `securityLevel: 'strict'`
 * already strips click handlers and inline HTML at render time.
 *
 * `mermaid` itself is dynamically imported on mount — it never loads until a
 * `MermaidView` actually appears.
 */
export function MermaidView({ chart, height = 320, errorLabel, className }: MermaidViewProps) {
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const diagramId = useId().replace(/:/g, '-')
  const requestId = useRef(0)

  useEffect(() => {
    let cancelled = false
    const currentRequest = ++requestId.current
    setSvg(null)
    setError(null)

    import('mermaid').then(async ({ default: mermaid }) => {
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' })
      try {
        const result = await mermaid.render(`mermaid-${diagramId}-${currentRequest}`, chart)
        if (!cancelled) setSvg(result.svg)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
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
    <iframe
      title="Diagram"
      sandbox=""
      srcDoc={`<!doctype html><html><head><style>${IFRAME_STYLE}</style></head><body>${svg}</body></html>`}
      className={cn('w-full border-0', className)}
      style={{ height }}
    />
  )
}
