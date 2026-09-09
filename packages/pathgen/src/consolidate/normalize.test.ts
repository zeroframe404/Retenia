import { describe, expect, it } from 'vitest'
import { blockingTokens, matchKey, normalizeTerm } from './normalize'

describe('normalizeTerm()', () => {
  it('folds case, accents, punctuation and a leading article', () => {
    expect(normalizeTerm('La Memoria de Trabajo.')).toBe('memoria de trabajo')
    expect(normalizeTerm('  consolidación   sináptica ')).toBe('consolidacion sinaptica')
    expect(normalizeTerm('The Working-Memory (WM)')).toBe('working-memory wm')
    expect(normalizeTerm('El')).toBe('el')
    expect(normalizeTerm('---')).toBe('')
  })

  it('keeps digits and does not confuse an article with a word that starts like one', () => {
    expect(normalizeTerm('Área 51')).toBe('area 51')
    expect(normalizeTerm('anatomía')).toBe('anatomia')
  })
})

describe('matchKey() and blockingTokens()', () => {
  it('refuses a key too short to mean anything', () => {
    expect(matchKey('AI')).toBeNull()
    expect(matchKey('  ')).toBeNull()
    expect(matchKey('ADN')).toBe('adn')
  })

  it('blocks on the longer tokens only', () => {
    expect(blockingTokens('memoria de trabajo')).toEqual(['memoria', 'trabajo'])
    expect(blockingTokens('la ola')).toEqual([])
  })
})
