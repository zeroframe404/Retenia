import { CheckIcon, CopyIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '../lib/cn'
import { highlightToHtml } from '../lib/shiki'
import { IconButton } from './button'

export interface CodeBlockProps {
  code: string
  /** A Shiki `BundledLanguage` id, e.g. `"typescript"`, `"python"`, `"sql"`. Defaults to
   * plain, unhighlighted text. */
  language?: string
  /** Shown in a thin header above the code, e.g. a filename. */
  filename?: string
  copyLabel?: string
  copiedLabel?: string
  className?: string
}

/** A syntax-highlighted code block (Shiki, dual light/dark theme, lazily loaded — see
 * `lib/shiki.ts`) with a copy-to-clipboard button. Used by `MarkdownView` for fenced code
 * and directly by code activities (docs/spec/03-activities.md). */
export function CodeBlock({
  code,
  language = 'plaintext',
  filename,
  copyLabel = 'Copy code',
  copiedLabel = 'Copied',
  className,
}: CodeBlockProps) {
  const [html, setHtml] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    setHtml(null)
    highlightToHtml(code, language).then((result) => {
      if (!cancelled) setHtml(result)
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
      {html ? (
        <div
          className="[&_.shiki]:overflow-x-auto [&_.shiki]:p-4 [&_.shiki]:text-sm [&_pre]:m-0"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: Shiki's own renderer output for this exact source string, not arbitrary HTML
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="overflow-x-auto p-4 text-sm">
          <code>{code}</code>
        </pre>
      )}
    </div>
  )
}
