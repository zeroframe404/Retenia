import { describe, expect, it } from 'vitest'
import { checkDuplicates, type DuplicateItem } from './duplicates'

const unit = (values: readonly number[]): Float32Array => {
  const norm = Math.hypot(...values)
  return Float32Array.from(values.map((value) => value / norm))
}

function item(
  kind: DuplicateItem['kind'],
  id: string,
  lessonSpecId: string,
  text: string,
): DuplicateItem {
  return { kind, id, lessonSpecId, text }
}

describe('checkDuplicates() — §5 gate 5', () => {
  it('finds an exercise that asks, word for word, what another lesson’s asks', async () => {
    const result = await checkDuplicates({
      lessonSpecId: 'L03',
      own: [item('activity', 'a3', 'L03', '¿Cuántos elementos retiene la memoria de trabajo?')],
      others: [item('activity', 'a1', 'L01', 'Cuántos elementos retiene la Memoria de Trabajo')],
      vectors: new Map(),
    })
    expect(result.outcome).toBe('fix')
    expect(result.duplicates).toEqual([
      expect.objectContaining({
        reason: 'exact',
        of: expect.objectContaining({ lessonSpecId: 'L01' }),
      }),
    ])
    expect(result.findings.map((finding) => finding.kind)).toEqual(['activity_duplicate'])
    expect(result.warnings.map((entry) => entry.code)).toEqual(['activity_duplicate'])
  })

  it('finds a card that means what another lesson’s card means, over the shared vectors', async () => {
    const vectors = new Map<string, Float32Array | null>()
    const result = await checkDuplicates({
      lessonSpecId: 'L03',
      own: [item('flashcard', 'k3', 'L03', 'Otra formulación de la misma pregunta')],
      others: [item('flashcard', 'k1', 'L01', 'La pregunta original')],
      embeddings: { embed: async () => [unit([0.99, 0.14]), unit([1, 0])] },
      vectors,
    })
    expect(result.duplicates).toEqual([expect.objectContaining({ reason: 'cosine' })])
    expect(result.findings.map((finding) => finding.kind)).toEqual(['flashcard_duplicate'])
    expect(result.warnings.map((entry) => entry.code)).toEqual(['flashcard_duplicate'])
    // Memoised: the second lesson of the run does not embed the first's texts again.
    expect(vectors.size).toBe(2)
  })

  it('keeps an item that is merely on the same topic', async () => {
    const result = await checkDuplicates({
      lessonSpecId: 'L03',
      own: [item('activity', 'a3', 'L03', 'Explicá el bucle fonológico con un ejemplo')],
      others: [item('activity', 'a1', 'L01', 'Definí la memoria de trabajo')],
      embeddings: { embed: async () => [unit([0.7, 0.7]), unit([1, 0])] },
      vectors: new Map(),
    })
    expect(result.outcome).toBe('pass')
    expect(result.duplicates).toEqual([])
  })

  it('falls back to the exact pass, and says so, when the provider cannot embed', async () => {
    const result = await checkDuplicates({
      lessonSpecId: 'L03',
      own: [item('activity', 'a3', 'L03', 'Una pregunta cualquiera')],
      others: [item('activity', 'a1', 'L01', 'Otra pregunta distinta')],
      embeddings: {
        embed: async () => {
          throw new Error('no embedding model is available')
        },
      },
      vectors: new Map(),
    })
    expect(result.duplicates).toEqual([])
    expect(result.warnings.map((entry) => entry.code)).toEqual(['embeddings_unavailable'])
  })

  it('is skipped when there is nothing to compare against', async () => {
    const result = await checkDuplicates({
      lessonSpecId: 'L01',
      own: [item('activity', 'a1', 'L01', 'Una pregunta')],
      others: [],
      vectors: new Map(),
    })
    expect(result.outcome).toBe('skipped')
  })
})
