import { describe, expect, it } from 'vitest'
import type { TheoryBlock } from '../schemas/lesson'
import {
  citeIdsIn,
  extractClaims,
  MIN_CLAIM_CHARS,
  removeCiteIds,
  segmentSentences,
  stripMarkers,
  stripSegmentMarkers,
} from './claims'

function block(type: TheoryBlock['type'], content: string, citations: string[] = []): TheoryBlock {
  return { type, content, citations, diagram: null, misconception_id: null }
}

describe('segmentSentences()', () => {
  it('keeps a marker that follows the period with the sentence it closes', () => {
    const content = 'La capacidad es limitada. [cite:B01] El bucle repite. [cite:B02]'
    const segments = segmentSentences(content)
    expect(segments.map((segment) => segment.sentence)).toEqual([
      'La capacidad es limitada.',
      'El bucle repite.',
    ])
    expect(segments.map((segment) => segment.citationIds)).toEqual([['B01'], ['B02']])
    // The segments concatenate back to the block exactly, whitespace included.
    expect(segments.map((segment) => segment.text).join('')).toBe(content)
  })

  it('does not split on a decimal point, which has no space after it', () => {
    const segments = segmentSentences('Retiene 3.5 elementos, no 7.0 como se decía. Fin.')
    expect(segments.map((segment) => segment.sentence)).toEqual([
      'Retiene 3.5 elementos, no 7.0 como se decía.',
      'Fin.',
    ])
  })

  it('splits at every line break, so a bullet is a claim of its own', () => {
    const content = 'Error típico: siete [cite:B01]\nPor qué está mal: son cuatro [cite:B02]'
    const segments = segmentSentences(content)
    expect(segments).toHaveLength(2)
    expect(segments[0]?.citationIds).toEqual(['B01'])
    expect(segments[1]?.citationIds).toEqual(['B02'])
    expect(segments.map((segment) => segment.text).join('')).toBe(content)
  })

  it('reads a marker placed before the period too', () => {
    const segments = segmentSentences('El concepto se explica en la fuente [cite:B01]. Y sigue.')
    expect(segments[0]?.citationIds).toEqual(['B01'])
    expect(segments[0]?.sentence).toBe('El concepto se explica en la fuente.')
  })
})

describe('marker helpers', () => {
  it('lists ids once, in order, across several markers', () => {
    expect(citeIdsIn('Uno [cite:B02, B01]. Dos [cite: B01].')).toEqual(['B02', 'B01'])
  })

  it('strips markers and collapses the spaces they leave', () => {
    expect(stripMarkers('Uno [cite:B01] . Dos  [cite:B02]')).toBe('Uno. Dos')
  })

  it('removes only the named ids, drops a marker that empties, and tidies the gap', () => {
    expect(removeCiteIds('A [cite:B01, B02] B [cite:B01].', new Set(['B01']))).toBe(
      'A [cite:B02] B.',
    )
  })
})

describe('extractClaims()', () => {
  it('turns the sentences of substantive blocks into claims with their own ids', () => {
    const claims = extractClaims([
      block('hook', 'Un gancho largo que no se verifica nunca. [cite:B09]', ['B09']),
      block(
        'explanation',
        'La memoria de trabajo retiene unos cuatro elementos. [cite:B01] El bucle fonológico repite. [cite:B02]',
        ['B01', 'B02'],
      ),
    ])
    expect(
      claims.map((claim) => [claim.id, claim.blockIndex, claim.citationIds, claim.ownCitations]),
    ).toEqual([
      ['c01', 1, ['B01'], true],
      ['c02', 1, ['B02'], true],
    ])
  })

  it('lets a marker-less sentence inherit the block’s sibling list', () => {
    const claims = extractClaims([
      block('explanation', 'La memoria de trabajo retiene unos cuatro elementos a la vez.', [
        'B01',
      ]),
    ])
    expect(claims).toHaveLength(1)
    expect(claims[0]?.citationIds).toEqual(['B01'])
    expect(claims[0]?.ownCitations).toBe(false)
  })

  it('skips labels shorter than a claim and blocks with nothing to check against', () => {
    const claims = extractClaims([
      block('explanation', 'Nota: [cite:B01]', ['B01']),
      block('general_knowledge', 'Esto es conocimiento general, sin ninguna cita que verificar.'),
    ])
    expect(claims).toEqual([])
    expect(MIN_CLAIM_CHARS).toBeGreaterThan(10)
  })
})

describe('stripSegmentMarkers()', () => {
  it('removes the markers of one sentence and leaves every other byte alone', () => {
    const content = 'Uno. [cite:B01] Dos. [cite:B02] Tres. [cite:B03]'
    expect(stripSegmentMarkers(content, 1)).toBe('Uno. [cite:B01] Dos. Tres. [cite:B03]')
  })

  it('tidies the space a marker before the period leaves behind', () => {
    expect(stripSegmentMarkers('Uno [cite:B01]. Dos [cite:B02].', 0)).toBe('Uno. Dos [cite:B02].')
  })
})
