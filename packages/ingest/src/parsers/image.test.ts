import type { OcrProvider } from '@retenia/core'
import { describe, expect, it } from 'vitest'
import { createFakeParseContext } from '../../test/fake-parse-context'
import { OCR_CONFIDENCE_THRESHOLD, parseImage } from './image'

function fakeOcr(text: string, confidence: number): OcrProvider {
  return { id: 'fake', recognize: async () => ({ text, confidence }) }
}

describe('parseImage', () => {
  it('keeps a confident recognition and does not flag it for OCR escalation', async () => {
    const ctx = createFakeParseContext()
    const doc = await parseImage(
      { bytes: new Uint8Array(), fallbackTitle: 'receipt.png' },
      ctx,
      fakeOcr('Total: $42.00', 92),
    )

    expect(doc.kind).toBe('image')
    expect(doc.blocks).toHaveLength(1)
    expect(doc.blocks[0]?.text).toBe('Total: $42.00')
    expect(doc.meta.ocrConfidence).toBe(92)
    expect(doc.meta.needsOcr).toBe(false)
    expect(doc.sections).toHaveLength(1)
    expect(doc.sections[0]?.blocks).toEqual([doc.blocks[0]?.id])
  })

  it('flags low-confidence recognition (or handwriting) as needing OCR escalation', async () => {
    const ctx = createFakeParseContext()
    const doc = await parseImage(
      { bytes: new Uint8Array(), fallbackTitle: 'handwritten-note.jpg' },
      ctx,
      fakeOcr('scr1bbly te?t', OCR_CONFIDENCE_THRESHOLD - 1),
    )

    expect(doc.meta.needsOcr).toBe(true)
  })

  it('is null-language for text too short to detect', async () => {
    const ctx = createFakeParseContext()
    const doc = await parseImage(
      { bytes: new Uint8Array(), fallbackTitle: 'x.png' },
      ctx,
      fakeOcr('', 10),
    )
    expect(doc.language).toBeNull()
  })
})
