import type { Element, Root } from 'hast'
import { describe, expect, it, vi } from 'vitest'

/** Ids the fake bundle knows about — more than the ceiling, which is the whole point. */
const BUNDLED = Array.from({ length: 60 }, (_, index) => `lang${index}`)

const loaded: string[] = []
const loadLanguage = vi.fn(async (lang: string) => {
  loaded.push(lang)
})

/**
 * Shiki is faked here rather than driven for real: the assertions are about *which grammars are
 * asked for*, and a real `createHighlighter` would have to load two dozen of them to answer that.
 * `code-block.test.tsx` exercises the real highlighter end to end.
 */
vi.mock('shiki', () => ({
  bundledLanguages: Object.fromEntries(BUNDLED.map((id) => [id, () => Promise.resolve()])),
  createHighlighter: async () => ({
    getLoadedLanguages: () => [...loaded],
    loadLanguage,
    codeToHast: (code: string, options: { lang: string }): Root => ({
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'pre',
          properties: { class: `shiki language-${options.lang}` },
          children: [{ type: 'text', value: code }],
        },
      ],
    }),
  }),
}))

const { MAX_LOADED_LANGUAGES, highlightToHast } = await import('./shiki')

/** The language the highlighter actually rendered with, read off Shiki's wrapper class. */
async function highlightedAs(lang: string): Promise<string> {
  const tree = await highlightToHast('x', lang)
  const pre = tree.children[0] as Element
  const classNames = pre.properties.className as string[]
  return (classNames.find((name) => name.startsWith('language-')) ?? '').replace('language-', '')
}

describe('highlightToHast', () => {
  it('falls back to plaintext for an id the bundle does not know, without loading a grammar', async () => {
    expect(await highlightedAs('not-a-language')).toBe('plaintext')
    expect(loadLanguage).not.toHaveBeenCalledWith('not-a-language')
  })

  it('needs no grammar for the special languages', async () => {
    expect(await highlightedAs('plaintext')).toBe('plaintext')
    expect(await highlightedAs('ansi')).toBe('ansi')
    expect(loadLanguage).not.toHaveBeenCalledWith('ansi')
  })

  it('loads a bundled grammar once and reuses it', async () => {
    expect(await highlightedAs('lang0')).toBe('lang0')
    expect(await highlightedAs('lang0')).toBe('lang0')
    expect(loadLanguage.mock.calls.filter(([lang]) => lang === 'lang0')).toHaveLength(1)
  })

  it('stops loading grammars at the ceiling and degrades to plaintext instead', async () => {
    // A document of valid empty fences — one per bundled id — is what this bounds: every id is
    // real, so the "is it in the bundle?" check lets all of them through.
    for (let index = 0; index < BUNDLED.length; index += 1) {
      await highlightedAs(`lang${index}`)
    }

    expect(loaded).toHaveLength(MAX_LOADED_LANGUAGES)
    // Past the ceiling an unseen language is rendered, just not highlighted…
    expect(await highlightedAs(`lang${BUNDLED.length - 1}`)).toBe('plaintext')
    // …while one already loaded keeps its grammar.
    expect(await highlightedAs('lang0')).toBe('lang0')
  })
})
