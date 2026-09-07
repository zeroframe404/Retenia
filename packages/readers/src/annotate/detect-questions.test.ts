import { describe, expect, it } from 'vitest'
import { detectQuestions } from './detect-questions'

describe('detectQuestions', () => {
  it('flags a block ending in a question mark', () => {
    const found = detectQuestions([
      { id: 'b1', text: '¿Qué proceso consolida la memoria durante el sueño?' },
    ])
    expect(found).toEqual([
      {
        blockId: 'b1',
        text: '¿Qué proceso consolida la memoria durante el sueño?',
        matchKind: 'question-mark',
      },
    ])
  })

  it('flags an "Ejercicio"/"Exercise"/"Problema" label', () => {
    const found = detectQuestions([
      { id: 'b1', text: 'Ejercicio 3: calcule la derivada de f(x) = x^2.' },
      { id: 'b2', text: 'Exercise 4. Solve for x.' },
      { id: 'b3', text: 'Problema 12' },
    ])
    expect(found.map((q) => q.blockId)).toEqual(['b1', 'b2', 'b3'])
    expect(found.every((q) => q.matchKind === 'exercise-label')).toBe(true)
  })

  it('flags a numbered item', () => {
    const found = detectQuestions([{ id: 'b1', text: '1. La glucólisis produce ATP.' }])
    expect(found).toEqual([
      { blockId: 'b1', text: '1. La glucólisis produce ATP.', matchKind: 'numbered-item' },
    ])
  })

  it('does not flag a bare page number or an empty block', () => {
    const found = detectQuestions([
      { id: 'b1', text: '12.' },
      { id: 'b2', text: '   ' },
      { id: 'b3', text: '' },
    ])
    expect(found).toEqual([])
  })

  it('does not flag ordinary prose', () => {
    const found = detectQuestions([
      { id: 'b1', text: 'La consolidación de la memoria ocurre durante el sueño de ondas lentas.' },
    ])
    expect(found).toEqual([])
  })

  it('keeps blocks in reading order and skips only the ones that do not match', () => {
    const found = detectQuestions([
      { id: 'b1', text: 'Introducción.' },
      { id: 'b2', text: '¿Cuál es la función del hipocampo?' },
      { id: 'b3', text: 'Resumen del capítulo.' },
      { id: 'b4', text: '2. Nombre tres neurotransmisores.' },
    ])
    expect(found.map((q) => q.blockId)).toEqual(['b2', 'b4'])
  })

  it('prefers the question-mark rule over a numbered-item that also ends in "?"', () => {
    const found = detectQuestions([{ id: 'b1', text: '1. ¿Qué es la homeostasis?' }])
    expect(found[0]?.matchKind).toBe('question-mark')
  })
})
