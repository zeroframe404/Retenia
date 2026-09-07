import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createFakeParseContext } from '../../test/fake-parse-context'
import { parseWebPage } from './parse-web'
import type { WebImageFetcher, WebPageEnvelope } from './types'

const FIXTURES = fileURLToPath(new URL('../../test/fixtures/web/', import.meta.url))
const PAGE_URL = 'https://example.com/articles/spaced-repetition'

async function envelopeInput(overrides: Partial<WebPageEnvelope> = {}) {
  const html = await readFile(`${FIXTURES}article.html`, 'utf-8')
  const envelope: WebPageEnvelope = {
    url: PAGE_URL,
    fetchedAt: '2026-09-06T12:00:00.000Z',
    html,
    rendered: false,
    ...overrides,
  }
  return { bytes: new TextEncoder().encode(JSON.stringify(envelope)), fallbackTitle: PAGE_URL }
}

/** Downloads only the fixture's same-origin diagram; everything else (the cross-origin tracker
 *  pixel) is refused, exactly as the real same-origin fetcher would refuse it. */
const fakeFetchImage: WebImageFetcher = async (url) => {
  if (url === 'https://example.com/articles/images/diagram.png') {
    return { bytes: new Uint8Array([1, 2, 3, 4]), mime: 'image/png' }
  }
  return null
}

describe('parseWebPage', () => {
  it('turns the article fixture into a SourceDoc sectioned by H2/H3, with the diagram as a blob', async () => {
    const ctx = createFakeParseContext()
    const doc = await parseWebPage(await envelopeInput(), ctx, { fetchImage: fakeFetchImage })

    expect(doc.kind).toBe('web')
    expect(doc.title).toBe('Spaced repetition, the short version')
    expect(doc.language).toBe('en')
    expect(doc.meta.warnings).toEqual([])
    expect(doc.meta.origin).toEqual({
      url: PAGE_URL,
      fetchedAt: '2026-09-06T12:00:00.000Z',
      author: 'Ada Lovelace',
    })

    // A synthetic preamble section holds the intro paragraph that comes before any heading —
    // Defuddle drops the fixture's own <h1> as a duplicate of the title it already extracted
    // separately, so the article's first real heading is the "Why spacing works" H2 — then
    // two H2 sections as siblings, each with its own H3 child, matching the fixture's outline.
    // The chunker (sub-phase 6.2) does the actual H2/H3 chunk-boundary cut; this only has to
    // get the section tree itself right.
    expect(doc.sections.map((s) => s.title)).toEqual([
      PAGE_URL,
      'Why spacing works',
      'What this changes in practice',
    ])
    const [preamble, whySpacing, whatChanges] = doc.sections
    expect(preamble?.level).toBe(0)
    expect(whySpacing?.children.map((s) => s.title)).toEqual(['A worked derivation'])
    expect(whatChanges?.children.map((s) => s.title)).toEqual(['Sources'])

    // The image the fake fetcher accepted became an asset...
    expect(doc.assets).toHaveLength(1)
    expect(doc.assets[0]?.mime).toBe('image/png')
    expect(ctx.assets.has(doc.assets[0]?.blobSha256 ?? '')).toBe(true)
    const figure = doc.blocks.find((b) => b.type === 'figure')
    expect(figure?.text).toBe('Review cycle diagram')
    // ...and the cross-origin tracker pixel the fake fetcher refused produced no block at all
    // (empty alt, no asset — nothing worth citing).
    expect(doc.blocks.filter((b) => b.type === 'figure')).toHaveLength(1)

    // Equations survive as LaTeX, inline and display.
    const withEquation = doc.blocks.find((b) => b.text.includes('$E=mc^2$'))
    expect(withEquation).toBeDefined()
    const display = doc.blocks.find((b) => b.text.trim() === '$$\\int_0^1 x^2\\,dx$$')
    expect(display).toBeDefined()

    // The footnote reference and its definition both survive as ordinary links.
    const withFootnoteRef = doc.blocks.find((b) => b.text.includes('[1]'))
    expect(withFootnoteRef).toBeDefined()
    const footnoteDef = doc.blocks.find((b) => b.text.includes('Dunlosky et al'))
    expect(footnoteDef).toBeDefined()

    // The code block kept its exact text and its language in `html`.
    const code = doc.blocks.find((b) => b.type === 'code')
    expect(code?.text).toBe(
      'def next_interval(stability, difficulty):\n    return stability * (1 - difficulty / 10)',
    )
    expect(code?.html).toContain('language-python')

    // The table's structure survived in `html`, and its text is still readable.
    const table = doc.blocks.find((b) => b.type === 'table')
    expect(table?.text).toBe('Stage | Interval\nLearning | 1 day\nReview | 6 days')

    expect(doc).toMatchSnapshot()
  })

  it('warns when the page was rendered through the SPA fallback', async () => {
    const ctx = createFakeParseContext()
    const doc = await parseWebPage(await envelopeInput({ rendered: true }), ctx, {
      fetchImage: fakeFetchImage,
    })
    expect(doc.meta.warnings).toContain(
      'The static page had too little text; a hidden browser window rendered it instead',
    )
  })

  it('produces an empty-but-valid document, with a warning, for a page with no readable content', async () => {
    const ctx = createFakeParseContext()
    const html = '<html><body><nav>Home</nav><footer>© 2026</footer></body></html>'
    const doc = await parseWebPage(await envelopeInput({ html }), ctx, {
      fetchImage: fakeFetchImage,
    })

    expect(doc.blocks).toEqual([])
    expect(doc.meta.warnings).toContain('No readable content was found on this page')
  })

  it("escapes attacker-controlled alt text and src when building a figure block's html", async () => {
    const ctx = createFakeParseContext()
    const html = `<html><body><article>
      <p>Intro paragraph long enough to count as real content for extraction purposes here.</p>
      <img src="https://example.com/img.png?x=1&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;" alt="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;">
    </article></body></html>`
    const fetchImage: WebImageFetcher = async () => ({
      bytes: new Uint8Array([1, 2, 3]),
      mime: 'image/png',
    })
    const doc = await parseWebPage(await envelopeInput({ html }), ctx, { fetchImage })

    const figure = doc.blocks.find((b) => b.type === 'figure')
    expect(figure?.html).toBeDefined()
    expect(figure?.html).not.toContain('<script>')
    expect(figure?.html).toContain('&lt;script&gt;')
    expect(figure?.html).toContain('&quot;')
  })

  it('caps the number of images fetched per document, warning when the cap is hit', async () => {
    const ctx = createFakeParseContext()
    const images = Array.from(
      { length: 205 },
      (_, i) => `<img src="https://example.com/img-${i}.png" alt="image ${i}">`,
    ).join('\n')
    const html = `<html><body><article>
      <p>Intro paragraph long enough to count as real content for extraction purposes here.</p>
      ${images}
    </article></body></html>`
    let fetchCount = 0
    const fetchImage: WebImageFetcher = async () => {
      fetchCount += 1
      return { bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' }
    }
    const doc = await parseWebPage(await envelopeInput({ html }), ctx, { fetchImage })

    expect(fetchCount).toBe(200)
    expect(doc.assets).toHaveLength(200)
    expect(doc.meta.warnings.some((w) => w.includes('more images than'))).toBe(true)
  })
})
