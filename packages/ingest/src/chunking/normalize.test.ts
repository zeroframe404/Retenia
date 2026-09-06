import { describe, expect, it } from 'vitest'
import { makeSourceDoc, paragraph } from '../../test/make-source-doc'
import { BLOCK_SEPARATOR, blockPieces, normalizeSourceDoc } from './normalize'
import { countTokensByChars } from './tokenizer'

describe('normalizeSourceDoc', () => {
  it('lays every block end to end and records where each one landed', () => {
    const doc = makeSourceDoc({
      sections: [{ title: 'A', blocks: [{ text: 'primero' }, { text: 'segundo' }] }],
    })
    const normalized = normalizeSourceDoc(doc)

    expect(normalized.text).toBe(`primero${BLOCK_SEPARATOR}segundo`)
    for (const entry of normalized.blocks) {
      expect(normalized.text.slice(entry.start, entry.end)).toBe(entry.text)
    }
  })

  it('normalizes line endings and trims, so an offset never lands on stray whitespace', () => {
    const doc = makeSourceDoc({
      sections: [{ title: 'A', blocks: [{ text: '  uno \r\n  dos  \r\n' }] }],
    })
    const normalized = normalizeSourceDoc(doc)
    expect(normalized.text).toBe('uno\n  dos')
  })

  it('drops blocks with no text at all rather than indexing empty ranges', () => {
    const doc = makeSourceDoc({
      sections: [{ title: 'A', blocks: [{ text: '   ' }, { text: 'algo' }] }],
    })
    const normalized = normalizeSourceDoc(doc)
    expect(normalized.blocks).toHaveLength(1)
    expect(normalized.text).toBe('algo')
  })
})

describe('blockPieces', () => {
  const options = { countTokens: countTokensByChars, maxPieceTokens: 100 }

  it('keeps a block that fits whole', () => {
    const doc = makeSourceDoc({
      sections: [{ title: 'A', blocks: [{ text: paragraph(50) }] }],
    })
    const [entry] = normalizeSourceDoc(doc).blocks
    expect(blockPieces(entry as never, options)).toHaveLength(1)
  })

  it('keeps an oversized table whole anyway', () => {
    const doc = makeSourceDoc({
      sections: [{ title: 'A', blocks: [{ type: 'table', text: paragraph(500) }] }],
    })
    const [entry] = normalizeSourceDoc(doc).blocks
    const pieces = blockPieces(entry as never, options)
    expect(pieces).toHaveLength(1)
    expect(pieces[0]?.atomic).toBe(true)
  })

  it('splits an oversized paragraph on sentence boundaries and keeps the offsets exact', () => {
    const text = Array.from({ length: 8 }, (_, index) => `${paragraph(40, `f${index}`)}.`).join(' ')
    const doc = makeSourceDoc({ sections: [{ title: 'A', blocks: [{ text }] }] })
    const normalized = normalizeSourceDoc(doc)
    const pieces = blockPieces(normalized.blocks[0] as never, options)

    expect(pieces.length).toBeGreaterThan(1)
    for (const piece of pieces) {
      expect(normalized.text.slice(piece.start, piece.end)).toBe(piece.text)
      expect(piece.text.trim()).toBe(piece.text)
      expect(piece.blockId).toBe(doc.blocks[0]?.id)
    }
    // In order, and non-overlapping.
    for (const [index, piece] of pieces.slice(1).entries()) {
      expect(piece.start).toBeGreaterThanOrEqual(pieces[index]?.end as number)
    }
  })

  it('falls back to word boundaries when there is no punctuation to cut on', () => {
    const doc = makeSourceDoc({ sections: [{ title: 'A', blocks: [{ text: paragraph(400) }] }] })
    const normalized = normalizeSourceDoc(doc)
    const pieces = blockPieces(normalized.blocks[0] as never, options)

    expect(pieces.length).toBeGreaterThan(1)
    // Every cut lands on whitespace, so no word is torn in half.
    for (const piece of pieces.slice(0, -1)) {
      expect(normalized.text.slice(piece.end, piece.end + 1)).toMatch(/\s/)
    }
    // …and the pieces still cover the whole block.
    expect(pieces[0]?.start).toBe(normalized.blocks[0]?.start)
    expect(pieces.at(-1)?.end).toBe(normalized.blocks[0]?.end)
  })
})
