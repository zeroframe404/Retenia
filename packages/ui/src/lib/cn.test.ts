import { describe, expect, it } from 'vitest'
import { cn } from './cn'

describe('cn', () => {
  it('joins truthy class names', () => {
    expect(cn('a', false && 'b', undefined, 'c')).toBe('a c')
  })

  it('resolves conflicting Tailwind utilities to the last one', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4')
  })
})
