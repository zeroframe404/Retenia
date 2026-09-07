import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { extractArticle } from './extract-article'

const FIXTURES = fileURLToPath(new URL('../../test/fixtures/web/', import.meta.url))
const ARTICLE_URL = 'https://example.com/articles/spaced-repetition'

async function readFixture(name: string): Promise<string> {
  return readFile(`${FIXTURES}${name}`, 'utf-8')
}

describe('extractArticle', () => {
  it('uses Defuddle for a real article, resolving relative image URLs against the page URL', async () => {
    const html = await readFixture('article.html')
    const result = await extractArticle(html, ARTICLE_URL)

    expect(result.extractor).toBe('defuddle')
    expect(result.title).toBe('Spaced repetition, the short version')
    expect(result.author).toBe('Ada Lovelace')
    expect(result.language).toBe('en')
    expect(result.warnings).toEqual([])
    expect(result.html).toContain('https://example.com/articles/images/diagram.png')
    // Kept, not stripped: `parse-web.ts`'s own image fetcher decides what to skip.
    expect(result.html).toContain('track.adservice.example.net')
  })

  it('falls back to Readability when Defuddle finds nothing worth keeping', async () => {
    const read = await extractArticle('<html><body><p>ignored</p></body></html>', ARTICLE_URL, {
      tryDefuddle: async () => undefined,
      tryReadability: () => ({
        title: 'Readability title',
        html: `<p>${'word '.repeat(50)}</p>`,
        author: 'A. Reader',
        language: 'en',
      }),
    })

    expect(read.extractor).toBe('readability')
    expect(read.title).toBe('Readability title')
    expect(read.warnings).toEqual([
      'Defuddle could not extract this page; Readability was used instead',
    ])
  })

  it('falls back to the raw <body> when neither extractor can identify an article', async () => {
    const html =
      '<html lang="fr"><head><title>Thin page</title></head><body><p>Hi.</p></body></html>'
    const result = await extractArticle(html, ARTICLE_URL, {
      tryDefuddle: async () => undefined,
      tryReadability: () => undefined,
    })

    expect(result.extractor).toBe('raw')
    expect(result.title).toBe('Thin page')
    expect(result.language).toBe('fr')
    expect(result.html).toContain('<p>Hi.</p>')
    expect(result.warnings).toEqual([
      'Neither Defuddle nor Readability could identify the main content; the whole page was kept',
    ])
  })

  it('treats a page thinner than the word floor as no extraction at all', async () => {
    const result = await extractArticle(
      '<html><body><nav>Home · About</nav></body></html>',
      ARTICLE_URL,
    )
    // Real Defuddle and Readability both reject this; only the raw fallback is left.
    expect(result.extractor).toBe('raw')
  })

  it('treats a client-rendered SPA shell (no text, only a mount point) the same way', async () => {
    const html = await readFixture('spa-shell.html')
    const result = await extractArticle(html, ARTICLE_URL)

    // Neither extractor finds an article in an empty <div id="root">, so this is what a
    // static fetch of a real SPA looks like *before* `web-fetch.ts`'s word-count check
    // escalates to the hidden-BrowserWindow fallback — this fixture is what that check
    // itself is tested against (`apps/desktop/src/main/library/web-fetch.test.ts`).
    expect(result.extractor).toBe('raw')
    expect(result.title).toBe('Loading…')
  })

  it('reads the canonical URL from <link rel="canonical">, resolved to an absolute URL', async () => {
    const html = `<html><head>
      <link rel="canonical" href="/articles/spaced-repetition">
      <title>Thin page</title>
    </head><body><p>Hi.</p></body></html>`
    const result = await extractArticle(
      html,
      'https://example.com/articles/spaced-repetition?utm_source=x',
      {
        tryDefuddle: async () => undefined,
        tryReadability: () => undefined,
      },
    )

    expect(result.canonicalUrl).toBe('https://example.com/articles/spaced-repetition')
  })

  it('resolves an absolute canonical URL as-is, even on a different host (an AMP mirror)', async () => {
    const html =
      '<html><head><link rel="canonical" href="https://original.example/post"></head><body><p>Hi.</p></body></html>'
    const result = await extractArticle(html, 'https://amp.example/post', {
      tryDefuddle: async () => undefined,
      tryReadability: () => undefined,
    })

    expect(result.canonicalUrl).toBe('https://original.example/post')
  })

  it('is null when the page has no canonical link', async () => {
    const html = await readFixture('article.html')
    const result = await extractArticle(html, ARTICLE_URL)

    expect(result.canonicalUrl).toBeNull()
  })

  it('is null for a malformed canonical href rather than throwing', async () => {
    const html =
      '<html><head><link rel="canonical" href="   "></head><body><p>Hi.</p></body></html>'
    const result = await extractArticle(html, ARTICLE_URL, {
      tryDefuddle: async () => undefined,
      tryReadability: () => undefined,
    })

    expect(result.canonicalUrl).toBeNull()
  })
})
