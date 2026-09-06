import type { OcrProvider } from '@retenia/core'
import { describe, expect, it } from 'vitest'
import { createFakeParseContext } from '../test/fake-parse-context'
import { parseDocument } from './parse-document'

const noopOcr: OcrProvider = { id: 'noop', recognize: async () => ({ text: '', confidence: 0 }) }

describe('parseDocument', () => {
  it('dispatches markdown and text to the same parser with different frontmatter handling', async () => {
    const ctx = createFakeParseContext()
    const md = await parseDocument(
      'markdown',
      { bytes: new TextEncoder().encode('---\ntitle: X\n---\n# Hi'), fallbackTitle: 'a.md' },
      ctx,
      noopOcr,
    )
    expect(md.kind).toBe('markdown')
    expect(md.meta.frontmatter).toEqual({ title: 'X' })

    const text = await parseDocument(
      'text',
      { bytes: new TextEncoder().encode('Just text.'), fallbackTitle: 'a.txt' },
      ctx,
      noopOcr,
    )
    expect(text.kind).toBe('text')
    expect(text.meta.frontmatter).toBeUndefined()
  })

  it('throws a clear error for a kind with no parser yet', async () => {
    const ctx = createFakeParseContext()
    await expect(
      parseDocument('video', { bytes: new Uint8Array(), fallbackTitle: 'a.mp4' }, ctx, noopOcr),
    ).rejects.toThrow(/no parser is implemented yet for source kind "video"/i)
  })
})
