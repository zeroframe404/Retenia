import type { BundledLanguage, Highlighter } from 'shiki'

let highlighterPromise: Promise<Highlighter> | undefined

/** Lazily creates (and reuses) a single Shiki highlighter instance. `shiki` itself, plus
 * its theme/grammar data, is only ever pulled in once a `CodeBlock` or a `MarkdownView`
 * with a fenced code block actually mounts — never on the app's initial render path. */
function loadHighlighter(): Promise<Highlighter> {
  highlighterPromise ??= import('shiki').then(({ createHighlighter }) =>
    createHighlighter({
      themes: ['github-light', 'github-dark'],
      langs: [],
    }),
  )
  return highlighterPromise
}

/** Highlights `code` as `lang` (a Shiki `BundledLanguage` id, e.g. `"typescript"`) into
 * dual-theme HTML — light/dark colors both embedded as CSS custom properties, toggled by
 * `theme.css`'s `[data-theme="dark"] .shiki` override. Falls back to `"plaintext"` for an
 * unknown language rather than throwing (source languages can come from AI-generated
 * content, e.g. a code activity's grader). */
export async function highlightToHtml(code: string, lang: string): Promise<string> {
  const highlighter = await loadHighlighter()
  let resolvedLang = lang

  if (lang !== 'plaintext' && lang !== 'text' && !highlighter.getLoadedLanguages().includes(lang)) {
    try {
      await highlighter.loadLanguage(lang as BundledLanguage)
    } catch {
      resolvedLang = 'plaintext'
    }
  }

  return highlighter.codeToHtml(code, {
    lang: resolvedLang,
    themes: { light: 'github-light', dark: 'github-dark' },
  })
}
