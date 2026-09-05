import type { Nodes, Root } from 'hast'
import type { BundledLanguage, Highlighter } from 'shiki'

/** Shiki's "special" languages: they need no grammar, so they are not keys of
 * `bundledLanguages`. `plaintext` is the fallback for anything unrecognized. */
const PLAIN_LANGUAGES = new Set(['ansi', 'plaintext', 'text', 'txt'])

interface ShikiRuntime {
  highlighter: Highlighter
  /** Every id and alias `shiki` bundles a grammar for. */
  languageIds: ReadonlySet<string>
}

let runtimePromise: Promise<ShikiRuntime> | undefined

/**
 * How many distinct bundled grammars one renderer session may load.
 *
 * `shiki@4` bundles 346 ids (242 grammars plus their aliases) and the grammar sources alone are
 * ~9 MB; the highlighter is a module-global that is never disposed, so anything it loads stays
 * resident for the session. Checking the id against `bundledLanguages` only rejects ids that do
 * not exist — a lesson body or a tutor answer made of one *valid* empty fence per id (about a
 * dozen characters each, so ~250 fit inside `RICH_TEXT_MAX`) would still walk the whole bundle in.
 *
 * A ceiling is enough because the honest case is small: a lesson mixes a handful of languages,
 * and past the ceiling an unseen language degrades to `plaintext` — the same fallback an unknown
 * id already gets — rather than failing. It is compared against `getLoadedLanguages()`, which
 * counts what the highlighter really holds (aliases included), so it errs towards being reached
 * sooner rather than later.
 */
export const MAX_LOADED_LANGUAGES = 24

/** Lazily creates (and reuses) a single Shiki highlighter instance. `shiki` itself, plus
 * its theme/grammar data, is only ever pulled in once a `CodeBlock` or a `MarkdownView`
 * with a fenced code block actually mounts — never on the app's initial render path.
 * `bundledLanguages` is read from that same dynamic import (its values are lazy
 * `import()` thunks, so listing its keys loads no grammar). */
function loadShiki(): Promise<ShikiRuntime> {
  runtimePromise ??= import('shiki').then(async ({ bundledLanguages, createHighlighter }) => ({
    highlighter: await createHighlighter({
      themes: ['github-light', 'github-dark'],
      langs: [],
    }),
    languageIds: new Set(Object.keys(bundledLanguages)),
  }))
  return runtimePromise
}

/**
 * Shiki builds its tree with raw HTML attribute names (`class`, `tabindex`); hast — and
 * therefore `markdownSanitizeSchema`, which is written against `defaultSchema` — uses
 * property names (`className`, `tabIndex`). Renaming here means every rule is spelled once:
 * an attribute Shiki starts emitting under a name the schema does not know is dropped by
 * the sanitizer rather than matching a rule meant for the other spelling.
 */
function toHastPropertyNames(node: Nodes): void {
  if (node.type === 'element') {
    const { properties } = node
    if (typeof properties.class === 'string') {
      properties.className = properties.class.split(/\s+/).filter(Boolean)
      delete properties.class
    }
    if (properties.tabindex !== undefined) {
      properties.tabIndex = Number(properties.tabindex)
      delete properties.tabindex
    }
  }
  if ('children' in node) {
    for (const child of node.children) toHastPropertyNames(child)
  }
}

/**
 * Highlights `code` as `lang` (a Shiki `BundledLanguage` id or alias, e.g. `"typescript"`
 * or `"ts"`) into a dual-theme hast tree — light/dark colors both embedded as inline CSS
 * custom properties, toggled by `theme.css`'s `[data-theme="dark"] .shiki` override.
 *
 * `lang` comes from a fence info string (`` ```python ``) in content that can be
 * AI-generated, so it is bounded twice before Shiki is asked to load anything. An id that is not
 * in the bundle falls back to `plaintext` instead of reaching `loadLanguage()` and throwing; and
 * a *valid* id past `MAX_LOADED_LANGUAGES` falls back to `plaintext` too, so a document of fenced
 * blocks cannot pull the whole 9 MB grammar bundle into a highlighter that lives as long as the
 * renderer does.
 *
 * The result is a tree rather than an HTML string on purpose — `CodeBlock` sanitizes and
 * renders it as React elements, so highlighted code never round-trips through markup.
 */
export async function highlightToHast(code: string, lang: string): Promise<Root> {
  const { highlighter, languageIds } = await loadShiki()
  let resolvedLang = PLAIN_LANGUAGES.has(lang) || languageIds.has(lang) ? lang : 'plaintext'

  const loaded = highlighter.getLoadedLanguages()
  if (!PLAIN_LANGUAGES.has(resolvedLang) && !loaded.includes(resolvedLang)) {
    if (loaded.length >= MAX_LOADED_LANGUAGES) {
      resolvedLang = 'plaintext'
    } else {
      try {
        await highlighter.loadLanguage(resolvedLang as BundledLanguage)
      } catch {
        // A bundled grammar that fails to load (a chunk that never arrives) degrades to
        // unhighlighted code rather than failing the whole block.
        resolvedLang = 'plaintext'
      }
    }
  }

  const tree = highlighter.codeToHast(code, {
    lang: resolvedLang,
    themes: { light: 'github-light', dark: 'github-dark' },
  })
  toHastPropertyNames(tree)
  return tree
}
