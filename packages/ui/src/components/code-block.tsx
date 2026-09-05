import type { Root } from 'hast'
import { CheckIcon, CopyIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '../lib/cn'
import { renderSanitizedHast } from '../lib/markdown-sanitize-schema'
import { highlightToHast } from '../lib/shiki'
import { IconButton } from './button'

export interface CodeBlockProps {
  code: string
  /** A Shiki `BundledLanguage` id, e.g. `"typescript"`, `"python"`, `"sql"`. An id Shiki
   * does not bundle falls back to plain, unhighlighted text. */
  language?: string
  /** Shown in a thin header above the code, e.g. a filename. */
  filename?: string
  copyLabel?: string
  copiedLabel?: string
  className?: string
}

/** A syntax-highlighted code block (Shiki, dual light/dark theme, lazily loaded — see
 * `lib/shiki.ts`) with a copy-to-clipboard button. Used by `MarkdownView` for fenced code
 * and directly by code activities (docs/spec/03-activities.md).
 *
 * Shiki's tree is sanitized and rendered as React elements (`renderSanitizedHast`) rather
 * than injected as raw HTML: the code body is untrusted, and React-applied token colors
 * are also the only ones that survive the packaged app's `style-src`. */
export function CodeBlock({
  code,
  language = 'plaintext',
  filename,
  copyLabel = 'Copy code',
  copiedLabel = 'Copied',
  className,
}: CodeBlockProps) {
  const [highlighted, setHighlighted] = useState<Root | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    setHighlighted(null)
    highlightToHast(code, language).then((result) => {
      if (!cancelled) setHighlighted(result)
    })
    return () => {
      cancelled = true
    }
  }, [code, language])

  useEffect(() => {
    if (!copied) return
    const id = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(id)
  }, [copied])

  async function handleCopy() {
    await navigator.clipboard.writeText(code)
    setCopied(true)
  }

  return (
    <div
      className={cn(
        'group border-border bg-surface relative overflow-hidden rounded-lg border',
        className,
      )}
    >
      {filename && (
        <div className="border-border text-muted border-b px-3 py-1.5 font-mono text-xs">
          {filename}
        </div>
      )}
      <IconButton
        variant="ghost"
        size="sm"
        aria-label={copied ? copiedLabel : copyLabel}
        onClick={handleCopy}
        className="absolute top-2 right-2 opacity-0 transition-opacity duration-fast ease-standard group-hover:opacity-100 focus-visible:opacity-100"
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </IconButton>
      {highlighted ? (
        <div className="[&_.shiki]:overflow-x-auto [&_.shiki]:p-4 [&_.shiki]:text-sm [&_pre]:m-0">
          {renderSanitizedHast(highlighted)}
        </div>
      ) : (
        <pre className="overflow-x-auto p-4 text-sm">
          <code>{code}</code>
        </pre>
      )}
    </div>
  )
}
